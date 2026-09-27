/**
 * ローカルサーバーの Mac 適用 API。
 *
 * 手順は CLI（`keysync mac apply`）と同じ `apply-service.ts` を通る。ここが足すのは、
 * Web UI から呼ばれることで要る 2 つの突き合わせだけである（ADR 0034）。
 *
 * - **配列**: 編集対象の配列と、このマシンの内蔵配列が一致しなければ止める
 * - **digest**: Web UI が編集中の内容と、ディスク上の設定が一致しなければ止める
 *
 * HTTP には依存しない。リクエストの防御は `guard.ts`、配線は `main.ts` が持つ。
 */

import { resolve } from "node:path";
import { diffKanataText, type MacDiffEntry } from "../core/mac-keymap/apply.ts";
import type { MacKeyboardLayout } from "../core/mac-keymap/types.ts";
import type { KanataHost } from "../kanata/node.ts";
import {
  applyMacPlan,
  planMacApplyAt,
  readOptional,
  type MacApplyPlanning,
  type MacApplyTarget,
} from "../mac/apply-service.ts";
import { macKeymapPath, type Sha256Provider } from "../workspace/layout.ts";
import { macKeymapDigest, readMacKeymapFor } from "../workspace/mac-keymap-file.ts";
import { NodeWorkspaceStore } from "../workspace/node.ts";
import {
  MAC_API,
  type MacApplyResponse,
  type MacDiffEntryView,
  type MacPlanBlocked,
  type MacPlanned,
  type MacPlanResponse,
  type MacStatusResponse,
} from "./protocol.ts";

/** API が触れる外界。テストでは偽物を渡す。 */
export interface MacApiDeps {
  readonly root: string;
  /** 書き込み先の kanata の設定ファイル。 */
  readonly config: string;
  /** 内蔵キーボードの扱いを確かめるために読む `karabiner.json`。 */
  readonly karabiner: string;
  readonly host: KanataHost;
  readonly detectLayout: () => Promise<MacKeyboardLayout | undefined>;
  readonly crypto: Sha256Provider;
}

export type MacApiResponse = MacStatusResponse | MacPlanResponse | MacApplyResponse;

/**
 * Mac 適用 API を作る。返す関数は path と JSON 本文を受けて応答を返す。
 *
 * 呼び出しは 1 本ずつ直列に処理する。kanata の設定ファイルの書き換えと `keysync/generated/` の
 * 生成が並行すると、計画を組んだ入力と書き込む入力が食い違う。
 *
 * @doc docs/specs/local-server.md#createmacapi
 */
export function createMacApi(
  deps: MacApiDeps,
): (path: string, body: unknown) => Promise<MacApiResponse | undefined> {
  let queue: Promise<unknown> = Promise.resolve();
  return (path, body) => {
    const run = async (): Promise<MacApiResponse | undefined> => {
      try {
        return await route(deps, path, body);
      } catch (error) {
        return { kind: "failed", message: error instanceof Error ? error.message : String(error) };
      }
    };
    const next = queue.then(run, run);
    queue = next;
    return next;
  };
}

async function route(
  deps: MacApiDeps,
  path: string,
  body: unknown,
): Promise<MacApiResponse | undefined> {
  switch (path) {
    case MAC_API.status:
      return {
        kind: "status",
        workspace: deps.root,
        layout: (await deps.detectLayout()) ?? null,
      };
    case MAC_API.plan: {
      const prepared = await prepare(deps, body);
      if ("kind" in prepared) return prepared;
      return prepared.planned.response;
    }
    case MAC_API.apply:
      return await apply(deps, body);
    default:
      return undefined;
  }
}

interface Prepared {
  readonly target: MacApplyTarget;
  readonly planned: {
    readonly planning: Extract<MacApplyPlanning, { kind: "planned" }>;
    readonly response: MacPlanned;
  };
}

/**
 * 配列と digest を突き合わせてから計画を組む。止まるときは理由を返す。
 *
 * 計画を組むまでの順序は CLI と同じで、error の判定 → 生成と `kanata --check` の順。
 * kanata が入っていなければ check できないので、ここで止める。
 */
async function prepare(deps: MacApiDeps, body: unknown): Promise<Prepared | MacPlanBlocked> {
  const request = planRequest(body);
  const loaded = await load(deps, request.layout);
  if ("kind" in loaded) return loaded;
  if ((await macKeymapDigest(loaded.document, deps.crypto)) !== request.digest) {
    return { kind: "digest-mismatch", path: resolve(deps.root, loaded.path) };
  }
  const target: MacApplyTarget = {
    root: deps.root,
    layout: request.layout,
    path: loaded.path,
    document: loaded.document,
    config: deps.config,
    karabiner: deps.karabiner,
    host: deps.host,
  };
  const planning = await planMacApplyAt(target);
  if (planning.kind === "invalid") {
    return { kind: "invalid", diagnostics: planning.plan.diagnostics };
  }
  if (planning.check === undefined) return { kind: "kanata-missing" };
  if (!planning.check.ok) return { kind: "check-failed", output: planning.check.output };
  const { plan } = planning;
  return {
    target,
    planned: {
      planning,
      response: {
        kind: "planned",
        workspace: deps.root,
        source: resolve(deps.root, loaded.path),
        config: deps.config,
        fingerprint: plan.fingerprint,
        entries: entryViews(plan.entries),
        diagnostics: plan.diagnostics,
        running: await deps.host.reachable(),
      },
    },
  };
}

/**
 * 計画を組み直し、送られてきた fingerprint と一致したときだけ書き込む。
 *
 * 書き込みと verify が通った後の reload の失敗は**巻き戻さない**。巻き戻しはもう一度の
 * 書き込みで、新しい失敗の原因を増やす（ADR 0034 と同じ考え）。
 */
async function apply(deps: MacApiDeps, body: unknown): Promise<MacApplyResponse> {
  const fingerprint = stringField(body, "fingerprint");
  const prepared = await prepare(deps, body);
  if ("kind" in prepared) return prepared;
  const { target, planned } = prepared;
  if (planned.response.fingerprint !== fingerprint) {
    return { kind: "fingerprint-mismatch", plan: planned.response };
  }
  const applied = await applyMacPlan(target, planned.planning);
  if (!applied.verify || applied.reload === null) {
    const observed = await readOptional(deps.config);
    return {
      kind: "verify-failed",
      backup: applied.backup,
      entries: entryViews(diffKanataText(observed ?? "", planned.planning.plan.text)),
    };
  }
  if (applied.reload.kind === "failed") {
    return { kind: "reload-failed", backup: applied.backup, output: applied.reload.output };
  }
  return {
    kind: "applied",
    backup: applied.backup,
    reloaded: applied.reload.kind === "reloaded",
  };
}

/** このマシンの配列と一致するときだけ、その配列の設定を読む。 */
async function load(
  deps: MacApiDeps,
  layout: MacKeyboardLayout,
): Promise<
  | { readonly path: string; readonly document: MacApplyTarget["document"] }
  | Extract<MacPlanBlocked, { kind: "layout-mismatch" | "missing" }>
> {
  const machine = (await deps.detectLayout()) ?? null;
  if (machine !== layout) return { kind: "layout-mismatch", machine, requested: layout };
  const file = await readMacKeymapFor(new NodeWorkspaceStore(deps.root), layout);
  if (file === undefined)
    return { kind: "missing", path: resolve(deps.root, macKeymapPath(layout)) };
  return { path: file.path, document: file.document };
}

/** 差分を盤面の言葉へ写す。変化の前後の値は Web UI が編集中の内容から引く。 */
function entryViews(entries: readonly MacDiffEntry[]): readonly MacDiffEntryView[] {
  return entries.map(({ layer, keyCode, change }) => ({ layer, keyCode, change }));
}

function planRequest(body: unknown): {
  readonly layout: MacKeyboardLayout;
  readonly digest: string;
} {
  return { layout: layoutField(body), digest: stringField(body, "digest") };
}

function layoutField(body: unknown): MacKeyboardLayout {
  const layout = stringField(body, "layout");
  if (layout !== "ansi" && layout !== "jis") throw new Error(`layout が未対応: ${layout}`);
  return layout;
}

function stringField(body: unknown, name: string): string {
  const value =
    typeof body === "object" && body !== null ? (body as Record<string, unknown>)[name] : undefined;
  if (typeof value !== "string") throw new Error(`${name} が無い`);
  return value;
}
