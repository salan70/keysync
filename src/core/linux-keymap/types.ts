/**
 * `linux-keyboard.<layout>.yaml`（Linux で使う Apple 製キーボードの desired state）の型。
 *
 * 位置と keycode の語彙は Mac 側と同じにする。位置は Karabiner の `key_code` 名、値は
 * QMK 表記で、盤面と keycode の解析を Mac 側と共有する（ADR 0042）。keyd の語彙への
 * 写像は `key-names.ts` だけが持つ。
 */

import type { MacKeyboardLayout, MacLayerAssignments } from "../mac-keymap/types.ts";

/** `linux-keyboard.<layout>.yaml` の schema 識別子。互換性の無い変更でだけ上げる。 */
export const LINUX_KEYMAP_SCHEMA = "keysync/linux-keymap@1";

/**
 * この設定を適用するデバイス 1 個。keyd の `[ids]` の `vendor:product`。
 *
 * Linux には Karabiner の `is_built_in_keyboard` に当たる判定が無いので、内蔵キーボードも
 * id で指す（ADR 0042）。
 *
 * @doc docs/specs/linux-keymap.md#linuxkeymapdocument
 */
export interface LinuxDeviceIdentifier {
  readonly vendorId: number;
  readonly productId: number;
}

/**
 * `linux-keyboard.<layout>.yaml` の内容。
 *
 * @doc docs/specs/linux-keymap.md#linuxkeymapdocument
 */
export interface LinuxKeymapDocument {
  /** 対象の物理配列。盤面と `position-not-on-layout` の判定に使う。 */
  readonly layout: MacKeyboardLayout;
  /** 適用するデバイス。空なら `linux-keymap/no-target-device`（error）。 */
  readonly devices: readonly LinuxDeviceIdentifier[];
  /**
   * mod-tap と `LT` の tap と hold を分ける閾値（ms）。範囲と既定は Mac 側と同じ
   * （`DEFAULT_MAC_TAPPING_TERM_MS`）。YAML で省略された場合は parse が埋める（ADR 0051）。
   */
  readonly tappingTermMs: number;
  /**
   * Flow Tap の閾値（ms）。0 は無効。範囲と既定は Mac 側と同じ
   * （`DEFAULT_MAC_FLOW_TAP_TERM_MS`）。YAML で省略された場合は parse が埋める（ADR 0051）。
   */
  readonly flowTapTermMs: number;
  /** layer 番号 → 割り当て。Mac 側と同じ疎な map。 */
  readonly layers: ReadonlyMap<number, MacLayerAssignments>;
}

/** `linux-keyboard.<layout>.yaml` が期待した形をしていないときに投げる。 */
export class LinuxKeymapParseError extends Error {}
