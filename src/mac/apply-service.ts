/**
 * kanata の設定ファイルへの適用を filesystem と kanata 越しに行う Node の手順。
 *
 * CLI（`keysync mac apply`）とローカルサーバーの適用 API（ADR 0034）が同じ手順を通る。
 * 計画の組み立ては純関数の `planMacApply` が持ち、ここは read / 生成 / check / backup /
 * write / verify / reload の順序だけを持つ（ADR 0049）。
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  karabinerGrabsBuiltIn,
  planMacApply,
  verifyMacApply,
  type MacApplyPlan,
} from "../core/mac-keymap/apply.ts";
import { generateKanataConfig } from "../core/mac-keymap/kanata/generate.ts";
import type { MacKeyboardLayout, MacKeymapDocument } from "../core/mac-keymap/types.ts";
import { readKarabinerConfig } from "../karabiner/node.ts";
import {
  writeFileAtomic,
  type KanataHost,
  type KanataReload,
  type KanataResult,
} from "../kanata/node.ts";
import { backupPath, generatedPath } from "../workspace/layout.ts";
import { NodeWorkspaceStore } from "../workspace/node.ts";

/** 生成物の置き場所。workspace からの相対 path。 */
export const KANATA_GENERATED = generatedPath("kanata.kbd");

/** 適用の対象。どの workspace のどの配列の設定を、どの kanata の設定ファイルへ書くか。 */
export interface MacApplyTarget {
  readonly root: string;
  readonly layout: MacKeyboardLayout;
  /** workspace からの相対 path。 */
  readonly path: string;
  readonly document: MacKeymapDocument;
  /** 書き込み先。通常は `defaultKanataConfigPath()`。 */
  readonly config: string;
  /** 内蔵キーボードの扱いを確かめるために読む `karabiner.json`。 */
  readonly karabiner: string;
  readonly host: KanataHost;
}

/** 計画フェーズの結果。`invalid` は error があり、生成物を書いていない。 */
export type MacApplyPlanning =
  | { readonly kind: "invalid"; readonly plan: MacApplyPlan }
  | {
      readonly kind: "planned";
      readonly plan: MacApplyPlan;
      readonly generated: string;
      /** kanata が入っていなければ `undefined`。 */
      readonly check: KanataResult | undefined;
      /** 読んだ現在の内容。無ければ `undefined`。backup はこれをそのまま置く。 */
      readonly current: string | undefined;
    };

/** 書き込みまで終えた結果。 */
export interface MacApplied {
  /** 適用前にファイルが無ければ `null`。 */
  readonly backup: string | null;
  readonly verify: boolean;
  /** verify が通らなければ reload しないので `null`。 */
  readonly reload: KanataReload | null;
}

/**
 * 現在の設定を読んで計画を組み、error が無ければ生成物を書いて `kanata --check` を通す。
 *
 * 設定ファイルへは書かない。check は書き込み前のゲートで、呼び出し側が結果を見る。
 *
 * @doc docs/specs/mac-keymap.md#適用の境界
 */
export async function planMacApplyAt(target: MacApplyTarget): Promise<MacApplyPlanning> {
  const current = await readOptional(target.config);
  const karabiner = await readKarabinerConfig(target.karabiner);
  const plan = planMacApply(current, target.document, {
    source: target.path,
    karabinerGrabsBuiltIn: karabiner !== undefined && karabinerGrabsBuiltIn(karabiner),
  });
  if (plan.validation.summary.error > 0) return { kind: "invalid", plan };
  const check = await writeAndCheck(target.root, plan.text, KANATA_GENERATED, target.host);
  return { kind: "planned", plan, generated: KANATA_GENERATED, check, current };
}

/**
 * backup → atomic 置換 → 読み直して verify → reload、の順で適用する。
 *
 * fingerprint の照合と check の判定は呼び出し側が先に済ませる。verify が通らなければ
 * reload しない。kanata が常駐していなければ reload は `not-running` になり、ファイルは
 * 次に kanata が起動したときに読まれる。
 *
 * @doc docs/specs/mac-keymap.md#適用の境界
 */
export async function applyMacPlan(
  target: MacApplyTarget,
  planning: Extract<MacApplyPlanning, { kind: "planned" }>,
): Promise<MacApplied> {
  let backup: string | null = null;
  if (planning.current !== undefined) {
    backup = backupPath(new Date(), { prefix: "kanata-", extension: "kbd" });
    await new NodeWorkspaceStore(target.root).writeText(backup, planning.current);
  }
  await writeFileAtomic(target.config, planning.plan.text);
  const verify = verifyMacApply(await readOptional(target.config), planning.plan.text);
  const reload = verify ? await target.host.reload() : null;
  return { backup, verify, reload };
}

/**
 * kanata の設定を workspace へ書き出して check する。
 *
 * kanata が入っていない環境では check が `undefined` になり、判定は呼び出し側に委ねる。
 *
 * @doc docs/specs/mac-keymap.md#適用の境界
 */
export async function writeAndCheck(
  root: string,
  text: string,
  output: string,
  host: KanataHost,
): Promise<KanataResult | undefined> {
  await new NodeWorkspaceStore(root).writeText(output, text);
  return await host.check(join(root, output));
}

/** desired state から kanata の設定を書き出して check する。`mac generate` が使う。 */
export async function generateKanataAt(
  root: string,
  document: MacKeymapDocument,
  source: string,
  output: string,
  host: KanataHost,
): Promise<KanataResult | undefined> {
  return await writeAndCheck(root, generateKanataConfig(document, source).text, output, host);
}

/** ファイルを読む。無ければ `undefined`。 */
export async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
