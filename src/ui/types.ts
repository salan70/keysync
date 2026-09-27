import type { MacKeyboardLayout } from "../core/mac-keymap/types.ts";

/** header の radiogroup が選ぶ編集対象。 */
export type EditTarget =
  | { readonly kind: "cornix" }
  | { readonly kind: "mac"; readonly layout: MacKeyboardLayout };

/** 編集対象ごとに現在地（layer、選択、picker の適用先）を持つための鍵。 */
export type TargetKey = "cornix" | MacKeyboardLayout;

export function targetKeyOf(target: EditTarget): TargetKey {
  return target.kind === "cornix" ? "cornix" : target.layout;
}

/**
 * 左端の入口から画面中央のパネルで開く作業。割り当て（盤面・picker・編集パネル）はパネルではなく常設する。
 *
 * @doc docs/specs/ui.md#rail-and-panels
 */
export type PanelId = "overview" | "behaviors" | "validation" | "device" | "typing" | "files";

export type Selection =
  | { readonly kind: "key"; readonly row: number; readonly col: number }
  | { readonly kind: "encoder"; readonly index: number; readonly direction: "ccw" | "cw" }
  /** Mac盤面のキー。位置はKarabinerの`key_code`名（ADR 0025）。 */
  | { readonly kind: "macKey"; readonly keyCode: string };
