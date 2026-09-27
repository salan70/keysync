/**
 * `mac-keyboard.yaml`（MacBook 内蔵キーボードの desired state）の型。
 *
 * ADR 0006 の「状態は `VilDocument` ただ 1 つ」は **Vial device の話**であり、Apple 製
 * キーボードには射影元の raw 層が存在しない。したがって `VilDocument` へ寄せず、
 * matrix・容量・definition digest という存在しない概念も持たない（ADR 0022）。
 *
 */

/** `mac-keyboard.yaml` の schema 識別子。互換性の無い変更でだけ上げる。 */
export const MAC_KEYMAP_SCHEMA = "keysync/mac-keymap@1";

/** 改名前（ADR 0035）の schema 識別子。読み込みだけ受け付け、書き出さない（ADR 0036）。 */
export const LEGACY_MAC_KEYMAP_SCHEMA = "cornix-bonsai/mac-keymap@1";

/**
 * このドキュメントが対象にするキーボードの物理配列。値は Karabiner の `keyboard_type_v2`
 * と同じ語彙（ADR 0024）。ANSI / JIS 以外は扱わない（#23 の対象外）。
 */
export type MacKeyboardLayout = "ansi" | "jis";

/** YAML で `layout` を省略したときの既定。作成導線はこれを使わない（ADR 0024）。 */
export const DEFAULT_MAC_LAYOUT: MacKeyboardLayout = "jis";

/**
 * KeySync が所有する Karabiner profile の既定の名前。設定を新しく作るときだけ使う。
 *
 * `karabiner.json` の `profiles[]` のうち、この名前の 1 個だけを書き換える。
 * `global` と他の profile、`selected` には触らない（ADR 0022）。
 */
export const KEYSYNC_PROFILE_NAME = "KeySync";

/**
 * 改名前（ADR 0035）の既定の profile 名。Karabiner に残っていれば知らせるだけで、
 * 置き換えも削除もしない（ADR 0036）。
 */
export const LEGACY_PROFILE_NAME = "Cornix Bonsai";

/**
 * mod-tap の tap と hold を分ける閾値（ms）の既定。YAML で省略したときに parse が埋める。
 *
 * これより短く押して離すか、これより前に次のキーを押せば tap になる（ADR 0044）。
 */
export const DEFAULT_MAC_TAPPING_TERM_MS = 200;

/** tapping term として受け付ける範囲（ms、両端を含む）。 */
export const MAC_TAPPING_TERM_RANGE = { min: 50, max: 1000 } as const;

/** tapping term として受け付ける値か。 */
export function isMacTappingTerm(value: number): boolean {
  return (
    Number.isInteger(value) &&
    value >= MAC_TAPPING_TERM_RANGE.min &&
    value <= MAC_TAPPING_TERM_RANGE.max
  );
}

/**
 * この設定を適用するデバイス 1 個の識別子。
 *
 * Karabiner の `device_if` の identifiers と同じ語彙で、写像は `generate.ts` の
 * 3 行だけが持つ。内蔵キーボードは vendor / product id を申告しないため
 * `is_built_in_keyboard` でしか指せない（2026-09-19 に
 * `karabiner_grabber_devices.json` で確認）。
 *
 * @doc docs/specs/mac-keymap.md#mackeymapdocument
 */
export type MacDeviceIdentifier =
  | { readonly builtIn: true }
  | { readonly vendorId: number; readonly productId: number };

/**
 * YAML で `devices` を省略したときの既定。
 *
 * ADR 0026 より前の設定は内蔵キーボードだけを対象にしていた。省略時の既定をそれに
 * 合わせることで、既存の `mac-keyboard.yaml` の意味を変えない。
 */
export const DEFAULT_MAC_DEVICES: readonly MacDeviceIdentifier[] = [{ builtIn: true }];

/**
 * layer 1 枚の割り当て。key は Karabiner の `key_code` 名、値は QMK 表記。
 *
 * **疎な map** である。Karabiner は書かれていないキーを素通しするため、割り当ての無い
 * キーを並べる必要が無い（ADR 0022）。
 */
export type MacLayerAssignments = ReadonlyMap<string, string>;

/**
 * `mac-keyboard.yaml` の内容。
 *
 * @doc docs/specs/mac-keymap.md#mackeymapdocument
 */
export interface MacKeymapDocument {
  /** 対象の物理配列。YAML で省略された場合は parse が `DEFAULT_MAC_LAYOUT` を埋める。 */
  readonly layout: MacKeyboardLayout;
  /**
   * この設定を適用するデバイス。YAML で省略された場合は parse が
   * `DEFAULT_MAC_DEVICES` を埋める（ADR 0026）。
   */
  readonly devices: readonly MacDeviceIdentifier[];
  /**
   * mod-tap の tap と hold を分ける閾値（ms）。全 mod-tap で共通。YAML で省略された場合は
   * parse が `DEFAULT_MAC_TAPPING_TERM_MS` を埋める（ADR 0044）。
   */
  readonly tappingTermMs: number;
  /** 所有する Karabiner profile の名前。通常は `KEYSYNC_PROFILE_NAME`。 */
  readonly profile: string;
  /** layer 番号 → 割り当て。layer 番号も疎で、連続している必要は無い。 */
  readonly layers: ReadonlyMap<number, MacLayerAssignments>;
}

/** `mac-keyboard.yaml` が期待した形をしていないときに投げる。 */
export class MacKeymapParseError extends Error {}
