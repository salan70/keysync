/**
 * `/etc/keyd/keysync.conf` への適用を filesystem と keyd 越しに行う Node の手順。
 *
 * 計画の組み立ては純関数の `planLinuxApply` が持ち、ここは read / 生成 / check / backup /
 * install / reload / verify の順序だけを持つ（ADR 0042）。
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  planLinuxApply,
  verifyLinuxApply,
  type LinuxApplyPlan,
} from "../core/linux-keymap/apply.ts";
import type { LinuxKeymapDocument } from "../core/linux-keymap/types.ts";
import { backupPath, generatedPath } from "../workspace/layout.ts";
import { NodeWorkspaceStore } from "../workspace/node.ts";
import type { KeydHost, KeydResult } from "./keyd.ts";

/** 生成物の置き場所。workspace からの相対 path。 */
export const KEYD_GENERATED = generatedPath("keyd.conf");

/** 適用の対象。 */
export interface LinuxApplyTarget {
  readonly root: string;
  /** workspace からの相対 path。 */
  readonly path: string;
  readonly document: LinuxKeymapDocument;
  /** 書き込み先。通常は `KEYD_CONFIG_PATH`。 */
  readonly config: string;
  readonly host: KeydHost;
}

/** 計画フェーズの結果。`invalid` は error があり、生成物を書いていない。 */
export type LinuxApplyPlanning =
  | { readonly kind: "invalid"; readonly plan: LinuxApplyPlan }
  | {
      readonly kind: "planned";
      readonly plan: LinuxApplyPlan;
      readonly generated: string;
      /** keyd が入っていなければ `undefined`。 */
      readonly check: KeydResult | undefined;
      /** 読んだ現在の内容。無ければ `undefined`。backup はこれをそのまま置く。 */
      readonly current: string | undefined;
    };

/** 書き込みまで終えた結果。途中で止まった段階以降は `null`。 */
export interface LinuxApplied {
  readonly backup: string | null;
  readonly install: KeydResult;
  readonly reload: KeydResult | null;
  readonly verify: boolean;
}

/**
 * 現在の設定を読んで計画を組み、error が無ければ生成物を書いて `keyd check` を通す。
 *
 * `/etc/keyd/` へは書かない。check は書き込み前のゲートで、呼び出し側が結果を見る。
 *
 * @doc docs/specs/linux-keymap.md#linux-適用の境界
 */
export async function planLinuxApplyAt(target: LinuxApplyTarget): Promise<LinuxApplyPlanning> {
  const current = await readOptional(target.config);
  const plan = planLinuxApply(current, target.document, target.path);
  if (plan.validation.summary.error > 0) return { kind: "invalid", plan };
  await new NodeWorkspaceStore(target.root).writeText(KEYD_GENERATED, plan.text);
  const check = await target.host.check(join(target.root, KEYD_GENERATED));
  return { kind: "planned", plan, generated: KEYD_GENERATED, check, current };
}

/**
 * backup → install → reload → 読み直して verify、の順で適用する。
 *
 * fingerprint の照合と check の判定は呼び出し側が先に済ませる。install が失敗したら
 * reload しない。reload が失敗してもファイルは置き換わっているので、verify は行う。
 *
 * @doc docs/specs/linux-keymap.md#linux-適用の境界
 */
export async function applyLinuxPlan(
  target: LinuxApplyTarget,
  planning: Extract<LinuxApplyPlanning, { kind: "planned" }>,
): Promise<LinuxApplied> {
  let backup: string | null = null;
  if (planning.current !== undefined) {
    backup = backupPath(new Date(), { prefix: "keyd-", extension: "conf" });
    await new NodeWorkspaceStore(target.root).writeText(backup, planning.current);
  }
  const install = await target.host.install(join(target.root, planning.generated), target.config);
  if (!install.ok) return { backup, install, reload: null, verify: false };
  const reload = await target.host.reload();
  const verify = verifyLinuxApply(await readOptional(target.config), planning.plan.text);
  return { backup, install, reload, verify };
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
