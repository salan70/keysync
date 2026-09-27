/**
 * Karabiner-Elements の設定の型。
 *
 * `karabiner.json` の全体ではなく、**KeySync が読み書きする範囲だけ**に型を付ける。
 * `global` や他 profile の中身は解釈せず `unknown` のまま持ち回る。解釈すると、
 * Karabiner が増やした field を書き戻しで落とす経路ができるため（ADR 0001 と同じ理由）。
 *
 */

/** manipulator の `conditions` に置く条件。 */
export type KarabinerCondition =
  | { readonly type: "device_if"; readonly identifiers: readonly Record<string, unknown>[] }
  | { readonly type: "variable_if"; readonly name: string; readonly value: number }
  | { readonly type: "variable_unless"; readonly name: string; readonly value: number };

/** キーを送る `to` イベント。`modifiers` は同時に押す修飾キー（ADR 0043）。 */
export interface KarabinerKeyEvent {
  readonly key_code: string;
  readonly modifiers?: readonly string[];
  /** `to_if_alone` で送ったあと `to_delayed_action` を打ち切る（ADR 0044）。 */
  readonly halt?: true;
}

/** manipulator の `to` に置く 1 イベント。 */
export type KarabinerToEvent =
  | KarabinerKeyEvent
  | { readonly set_variable: { readonly name: string; readonly value: number } };

/** `from` の指定。修飾キーは素通しさせる。 */
export interface KarabinerFrom {
  readonly key_code: string;
  readonly modifiers: { readonly optional: readonly string[] };
}

/**
 * manipulator 1 個。
 *
 * `to` が無い manipulator は**イベントを捨てる**。`KC_NO` はこれで表す。
 * `exactOptionalPropertyTypes` が有効なので、出さない field は付けない。
 */
export interface KarabinerManipulator {
  readonly type: "basic";
  readonly from: KarabinerFrom;
  readonly to?: readonly KarabinerToEvent[];
  readonly to_after_key_up?: readonly KarabinerToEvent[];
  readonly to_if_alone?: readonly KarabinerToEvent[];
  readonly to_if_held_down?: readonly KarabinerToEvent[];
  readonly to_delayed_action?: {
    readonly to_if_invoked?: readonly KarabinerToEvent[];
    readonly to_if_canceled?: readonly KarabinerToEvent[];
  };
  /** manipulator 単位で上書きする `basic.*` の閾値（ms）。 */
  readonly parameters?: Readonly<Record<string, number>>;
  readonly conditions: readonly KarabinerCondition[];
}

/** rule 1 個。**上から評価され、最初にマッチしたものが勝つ**。 */
export interface KarabinerRule {
  readonly description: string;
  readonly manipulators: readonly KarabinerManipulator[];
}

/** `karabiner_cli --lint-complex-modifications` が受け取る asset 形式。 */
export interface KarabinerAsset {
  readonly title: string;
  readonly rules: readonly KarabinerRule[];
}

/** `profiles[]` の 1 個。KeySync が所有するのは name が一致する 1 個だけ。 */
export interface KarabinerProfile {
  readonly name: string;
  readonly complex_modifications: { readonly rules: readonly KarabinerRule[] };
  readonly virtual_hid_keyboard: { readonly keyboard_type_v2: string };
  /** 所有しない profile を読み書きするときだけ現れる。KeySync は生成しない。 */
  readonly [field: string]: unknown;
}

/**
 * `karabiner.json` 全体。`profiles` 以外は解釈しない。
 *
 * @doc docs/specs/mac-keymap.md#karabinerconfig
 */
export interface KarabinerConfig {
  readonly profiles: readonly KarabinerProfile[];
  readonly [field: string]: unknown;
}
