/**
 * `kanata へ適用…` を押せるかと、押せない理由。React に依存しない。
 *
 * サーバーも同じ突き合わせをするが（ADR 0034）、押す前に分かることは押す前に示す。
 */

import type { MacKeyboardLayout } from "../core/mac-keymap/types.ts";
import type { SaveState } from "./save-state.ts";

/** サーバーから見たこのマシン。`unknown` は問い合わせ中。 */
export type MacMachine =
  | { readonly kind: "unknown" }
  | { readonly kind: "unreachable" }
  | { readonly kind: "known"; readonly layout: MacKeyboardLayout | null };

export const LAYOUT_LABEL: Readonly<Record<MacKeyboardLayout, string>> = {
  ansi: "ANSI",
  jis: "JIS",
};

/**
 * 押せない理由。押せるなら `undefined`。
 *
 * 判定の順は「サーバー → 配列 → ファイル → 保存 → 検証」。前のものが解決しないと
 * 後ろを直しても押せないので、先に解決すべきものを出す。
 *
 * @doc docs/specs/ui.md#mac-apply
 */
export function macApplyBlockedReason(input: {
  readonly machine: MacMachine;
  readonly layout: MacKeyboardLayout;
  readonly ready: boolean;
  readonly save: SaveState;
  readonly errors: number;
}): string | undefined {
  const { machine, layout } = input;
  if (machine.kind === "unknown") return "サーバーに問い合わせ中";
  if (machine.kind === "unreachable") return "サーバーに接続できない。just ui で起動する";
  if (machine.layout === null) return "この Mac の配列を検出できない";
  if (machine.layout !== layout) {
    return `この Mac は ${LAYOUT_LABEL[machine.layout]}。${LAYOUT_LABEL[layout]} の設定は ${LAYOUT_LABEL[layout]} の Mac で適用する`;
  }
  if (!input.ready) return "設定ファイルを読み込めていない";
  if (input.save.kind === "saving") return "保存中…";
  if (input.save.kind === "error" || input.save.kind === "conflict") return "保存できていない";
  if (input.errors > 0) return "error があるため適用できない";
  return undefined;
}
