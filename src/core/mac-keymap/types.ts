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
 * Flow Tap の閾値（ms）の既定。YAML で省略したときに parse が埋める。0 は無効。
 *
 * 直前の文字キーからこれより短い間隔で押した mod-tap は、押している長さに関係なく tap に
 * なる（ADR 0047）。既定を無効にして、この行の無い既存の YAML の挙動を変えない。
 */
export const DEFAULT_MAC_FLOW_TAP_TERM_MS = 0;

/** Flow Tap の閾値として受け付ける範囲（ms、両端を含む）。0 は無効。 */
export const MAC_FLOW_TAP_TERM_RANGE = { min: 0, max: 1000 } as const;

/** Flow Tap の閾値として受け付ける値か。 */
export function isMacFlowTapTerm(value: number): boolean {
  return (
    Number.isInteger(value) &&
    value >= MAC_FLOW_TAP_TERM_RANGE.min &&
    value <= MAC_FLOW_TAP_TERM_RANGE.max
  );
}

/**
 * この設定を適用するデバイス 1 個の識別子。
 *
 * kanata は macOS のデバイスを製品名の完全一致でしか指せないので、外付けは `kanata --list` が
 * 出す製品名で持つ（ADR 0052）。kanata への写像は `kanata/generate.ts` の `deviceNames` だけが持つ。
 *
 * @doc docs/specs/mac-keymap.md#mackeymapdocument
 */
export type MacDeviceIdentifier = { readonly builtIn: true } | { readonly name: string };

/**
 * 外付けの製品名として受ける文字列か。
 *
 * kanata の設定の文字列は `"` で囲むだけで escape を持たないので、`"` と `\` と制御文字を拒む。
 */
export function isMacDeviceName(name: string): boolean {
  // oxlint-disable-next-line no-control-regex
  return name.trim() !== "" && !/["\\\u0000-\u001f]/.test(name);
}

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
 * **疎な map** である。割り当ての無いキーは layer 0 では素通し、layer 1 以上では割り当てなしに
 * なるため、並べる必要が無い（ADR 0022・0050）。
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
  /**
   * Flow Tap の閾値（ms）。0 は無効。YAML で省略された場合は parse が
   * `DEFAULT_MAC_FLOW_TAP_TERM_MS` を埋める（ADR 0047）。
   */
  readonly flowTapTermMs: number;
  /** layer 番号 → 割り当て。layer 番号も疎で、連続している必要は無い。 */
  readonly layers: ReadonlyMap<number, MacLayerAssignments>;
}

/** `mac-keyboard.yaml` が期待した形をしていないときに投げる。 */
export class MacKeymapParseError extends Error {}
