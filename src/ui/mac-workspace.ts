/**
 * 物理配列ごとの Mac 設定の workspace 読み込み状態。
 *
 * Vial 側と違い、Mac の設定は workspace の必須ファイルではない。無い・壊れているの
 * どちらでも workspace 全体を止めず、選んだ配列の対象だけを対応する状態に
 * 落とすための判別 union をここで組み立てる（ADR 0025 / 0027）。React に依存しない。
 */

import { serializeMacKeymapYaml } from "../core/mac-keymap/serialize.ts";
import {
  KEYSYNC_PROFILE_NAME,
  DEFAULT_MAC_DEVICES,
  DEFAULT_MAC_TAPPING_TERM_MS,
  type MacKeyboardLayout,
  type MacKeymapDocument,
} from "../core/mac-keymap/types.ts";
import { readMacKeymapFor } from "../workspace/mac-keymap-file.ts";
import type { WorkspaceConflictToken, WorkspaceFileStore } from "../workspace/types.ts";

/** 1 配列の状態。`missing` は作成導線、`error` は理由の表示へ落とす。 */
export type MacWorkspaceState =
  | {
      readonly kind: "ready";
      readonly document: MacKeymapDocument;
      readonly path: string;
      readonly token: WorkspaceConflictToken | undefined;
    }
  | { readonly kind: "missing" }
  | { readonly kind: "error"; readonly reason: string };

export type MacWorkspaceByLayout = {
  readonly ansi: MacWorkspaceState;
  readonly jis: MacWorkspaceState;
};

/**
 * 指定配列の設定を読み、その対象の状態へ畳む。
 *
 * 新しい名前を先に見て、無ければ旧名を `layout` 宣言で解決する
 * （`readMacKeymapFor`）。parse 失敗は `error` に閉じ込め、例外を外へ出さない。
 *
 * @doc docs/specs/ui.md#mac-board
 */
export async function probeMacKeymap(
  store: Pick<WorkspaceFileStore, "readText" | "stat">,
  layout: MacKeyboardLayout,
): Promise<MacWorkspaceState> {
  try {
    const file = await readMacKeymapFor(store, layout);
    if (file === undefined) return { kind: "missing" };
    return {
      kind: "ready",
      document: file.document,
      path: file.path,
      token: (await store.stat(file.path)) ?? undefined,
    };
  } catch (error) {
    return { kind: "error", reason: error instanceof Error ? error.message : String(error) };
  }
}

export async function probeMacKeymaps(
  store: Pick<WorkspaceFileStore, "readText" | "stat">,
): Promise<MacWorkspaceByLayout> {
  return {
    ansi: await probeMacKeymap(store, "ansi"),
    jis: await probeMacKeymap(store, "jis"),
  };
}

/** 作成導線が書く初期状態。選んだ配列・既定 device と空の layer 0 だけを持つ。 */
export function initialMacKeymapYaml(layout: MacKeyboardLayout): string {
  const document: MacKeymapDocument = {
    layout,
    devices: DEFAULT_MAC_DEVICES,
    tappingTermMs: DEFAULT_MAC_TAPPING_TERM_MS,
    profile: KEYSYNC_PROFILE_NAME,
    layers: new Map([[0, new Map()]]),
  };
  return serializeMacKeymapYaml(document);
}

/** ドロップダウンに出す適用先の要約。Browser は検出配列を知らない。 */
export function macScopeLabel(state: MacWorkspaceState): string {
  if (state.kind === "missing") return "未作成";
  if (state.kind === "error") return "読み込み失敗";
  const builtIn = state.document.devices.some((device) => "builtIn" in device);
  const external = state.document.devices.some((device) => "vendorId" in device);
  if (state.document.devices.length === 0) return "適用先なし";
  if (builtIn && external) return "内蔵 + 外付け";
  if (builtIn) return "内蔵";
  return "外付け";
}
