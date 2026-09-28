/**
 * desired state → kanata の設定ファイル（`kanata.kbd`）。
 *
 * 展開規則は ADR 0049。Cornix LP の Vial settings（Permissive Hold、Chordal Hold、
 * Flow Tap）と同じ判定になるよう、tap-hold の種類を選ぶ。R-010 Spike
 * （`spikes/r-010-kanata-macos/keysync.kbd`）で手書きした設定を生成器にしたもの。
 *
 * 落とせない keycode は黙って捨てず error の diagnostic にする（ADR 0023）。
 */

import { classifyKeycode } from "../../validation/keycode-vocabulary.ts";
import { createDiagnostic, type Diagnostic } from "../../validation/types.ts";
import { KARABINER_POSITIONS, karabinerKeyEvent } from "../key-codes.ts";
import {
  DEFAULT_MAC_FLOW_TAP_TERM_MS,
  DEFAULT_MAC_TAPPING_TERM_MS,
  type MacDeviceIdentifier,
  type MacKeymapDocument,
} from "../types.ts";
import { kanataChord, kanataKeyName, kanataPositionName, modifierKeyCodes } from "./key-names.ts";

/** macOS の kanata が内蔵キーボードを指す名前（R-010 で確認）。 */
export const BUILT_IN_KEYBOARD_NAME = "Apple Internal Keyboard / Trackpad";

/** 閾値を置く `defvar` の名前。適用済みの閾値を読むときにも使う。 */
export const TAPPING_TERM_VARIABLE = "tapping-term";

/**
 * Flow Tap の対象になる tap 側の key_code。QMK の `is_flow_tap_key` の既定
 * （`KC_A`〜`KC_Z`、`KC_COMM`、`KC_DOT`、`KC_SCLN`、`KC_SLSH`、`KC_SPC`）に合わせる（ADR 0047）。
 */
const FLOW_TAP_KEY_CODES: ReadonlySet<string> = new Set([
  ..."abcdefghijklmnopqrstuvwxyz",
  "comma",
  "period",
  "semicolon",
  "slash",
  "spacebar",
]);

/**
 * Chordal Hold の手の割り当て（位置の Karabiner 名）。ANSI と JIS の両方の位置を含む。
 *
 * Cornix LP で同じ役割のキーと同じ手にする。spacebar と英数は左の親指、かなは右の親指。
 * ここに無いキー（esc や F キーなど）は手が決まらず、kanata の `unknown-hand` の既定（無視）に従う。
 */
const LEFT_HAND = [
  "grave_accent_and_tilde",
  ..."12345qwertasdfgzxcvb",
  "tab",
  "caps_lock",
  "left_shift",
  "left_control",
  "left_option",
  "left_command",
  "fn",
  "spacebar",
  "japanese_eisuu",
  "non_us_backslash",
];
const RIGHT_HAND = [
  ..."67890yuiophjklnm",
  "hyphen",
  "equal_sign",
  "delete_or_backspace",
  "open_bracket",
  "close_bracket",
  "backslash",
  "non_us_pound",
  "semicolon",
  "quote",
  "return_or_enter",
  "comma",
  "period",
  "slash",
  "right_shift",
  "right_command",
  "right_option",
  "left_arrow",
  "right_arrow",
  "up_arrow",
  "down_arrow",
  "international1",
  "japanese_kana",
];

/** 生成結果。 */
export interface GeneratedKanataConfig {
  readonly text: string;
  readonly diagnostics: readonly Diagnostic[];
}

/** layer n の kanata 上の名前。 */
export function kanataLayerName(layer: number): string {
  return layer === 0 ? "base" : `l${layer}`;
}

interface Context {
  readonly tappingTermMs: number;
  readonly flowTapTermMs: number;
  readonly referenced: Set<number>;
  readonly diagnostics: Diagnostic[];
}

/**
 * desired state から kanata の設定を組み立てる。
 *
 * layer は番号の昇順に `deflayermap` で並べる。最初が layer 0（`base`）で、kanata は最初の
 * layer を起動時の layer にする。layer 1 以上は書かれていないキーを `XX`（割り当てなし）にする。
 * `MO` / `LT` が指す layer は、割り当てが無くても空の layer を出す。
 *
 * @doc docs/specs/mac-keymap.md#generatekanataconfig
 */
export function generateKanataConfig(
  document: MacKeymapDocument,
  source = `mac-keyboard.${document.layout}.yaml`,
): GeneratedKanataConfig {
  const context: Context = {
    tappingTermMs: document.tappingTermMs,
    flowTapTermMs: document.flowTapTermMs,
    referenced: new Set(),
    diagnostics: [],
  };
  const layers = new Map<number, (readonly [string, string])[]>();

  for (const layer of [...document.layers.keys()].sort((a, b) => a - b)) {
    const assignments = document.layers.get(layer);
    if (assignments === undefined) continue;
    const bindings: (readonly [string, string])[] = [];
    for (const keyCode of [...assignments.keys()].sort()) {
      const keycode = assignments.get(keyCode);
      if (keycode === undefined) continue;
      // 位置の語彙に無いキーは validateMacKeymap の unknown-position が報告する。二重にしない。
      if (!KARABINER_POSITIONS.has(keyCode)) continue;
      const position = kanataPositionName(keyCode);
      if (position === undefined) {
        context.diagnostics.push(
          unsupported(
            "mac-keymap/unsupported-position",
            layer,
            keyCode,
            keycode,
            `${keyCode} に対応する kanata のキーが無い`,
          ),
        );
        continue;
      }
      const action = actionFor(keyCode, keycode, layer, context);
      if (action !== undefined) bindings.push([position, action]);
    }
    layers.set(layer, bindings);
  }
  for (const layer of context.referenced) if (!layers.has(layer)) layers.set(layer, []);
  if (!layers.has(0)) layers.set(0, []);

  const devices = deviceNames(document.devices);
  const text = render(document, source, devices, layers, context);
  return { text, diagnostics: context.diagnostics };
}

/** `macKeycodeSupport` の判定結果。落とせない場合は診断の code と message を持つ。 */
export type MacKeycodeSupport =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: string; readonly message: string };

/**
 * keycode を kanata へ落とせるか。
 *
 * **判定を書き写さない。** 実際の lowering を 1 キーの probe で走らせ、error 診断が出たか
 * どうかで決める。「落とせるか」の正は `actionFor` の閉じた switch である（ADR 0025）。
 *
 * @doc docs/specs/mac-keymap.md#mackeycodesupport
 */
export function macKeycodeSupport(keycode: string): MacKeycodeSupport {
  const context: Context = {
    tappingTermMs: DEFAULT_MAC_TAPPING_TERM_MS,
    flowTapTermMs: DEFAULT_MAC_FLOW_TAP_TERM_MS,
    referenced: new Set(),
    diagnostics: [],
  };
  actionFor("spacebar", keycode, 0, context);
  const first = context.diagnostics[0];
  return first === undefined
    ? { ok: true }
    : { ok: false, code: first.code, message: first.message };
}

/**
 * 適用先デバイスを kanata の名前にする。
 *
 * kanata は macOS のデバイスを製品名の完全一致で指す。内蔵は固定の名前、外付けは宣言した
 * 名前をそのまま使う（ADR 0052）。同じ名前は 1 つにまとめる。
 *
 * @doc docs/specs/mac-keymap.md#generatekanataconfig
 */
export function deviceNames(devices: readonly MacDeviceIdentifier[]): readonly string[] {
  return [
    ...new Set(
      devices.map((device) => ("builtIn" in device ? BUILT_IN_KEYBOARD_NAME : device.name)),
    ),
  ];
}

function render(
  document: MacKeymapDocument,
  source: string,
  devices: readonly string[],
  layers: ReadonlyMap<number, readonly (readonly [string, string])[]>,
  context: Context,
): string {
  const lines = [
    `;; KeySync が ${source} から生成した kanata の設定。直接編集しない。`,
    "",
    "(defcfg",
    "  process-unmapped-keys yes",
    `  macos-dev-names-include (${devices.map((name) => JSON.stringify(name)).join(" ")})`,
  ];
  if (context.flowTapTermMs > 0) {
    lines.push(`  tap-hold-require-prior-idle ${context.flowTapTermMs}`);
  }
  lines.push(
    ")",
    "",
    "(defsrc)",
    "",
    "(defhands",
    `  (left ${handNames(LEFT_HAND)})`,
    `  (right ${handNames(RIGHT_HAND)}))`,
    "",
    `(defvar ${TAPPING_TERM_VARIABLE} ${document.tappingTermMs})`,
  );
  for (const [layer, bindings] of [...layers.entries()].sort(([a], [b]) => a - b)) {
    lines.push("", `(deflayermap (${kanataLayerName(layer)})`);
    for (const [key, action] of bindings) lines.push(`  ${key} ${action}`);
    if (layer > 0) lines.push("  ___ XX");
    lines.push(")");
  }
  return `${lines.join("\n")}\n`;
}

function handNames(keyCodes: readonly string[]): string {
  return keyCodes.map((keyCode) => kanataPositionName(keyCode)).join(" ");
}

function unsupported(
  code: string,
  layer: number,
  keyCode: string,
  keycode: string,
  message: string,
): Diagnostic {
  return createDiagnostic(code, "error", { kind: "macKey", layer, keyCode }, message, {
    keyCode,
    keycode,
  });
}

/**
 * tap 側が Flow Tap の対象か。修飾キー付き（`KC_EXLM` など）は対象外。
 * Linux の keyd の生成器も同じ集合を使う（ADR 0051）。
 */
export function isFlowTapKey(keycode: string): boolean {
  const event = karabinerKeyEvent(keycode);
  return (
    event !== undefined && FLOW_TAP_KEY_CODES.has(event.key_code) && event.modifiers === undefined
  );
}

/**
 * tap-hold 1 つ。Cornix の判定に合わせて種類を選ぶ（ADR 0049）。
 *
 * - hold が Shift だけなら `tap-hold-release`。手を問わない Permissive Hold。Mac の Shift は
 *   小指で押し、同じ手の文字とも組むため Chordal Hold を掛けない
 * - それ以外は `tap-hold-opposite-hand-release`。Chordal Hold（同じ手なら tap）と Permissive
 *   Hold（反対の手のキーを押して離せば hold）。閾値を過ぎたら QMK と同じく hold にする
 * - tap 側が Flow Tap の対象でなければ、`require-prior-idle` を 0 にして Flow Tap から外す
 */
function tapHold(
  tap: string,
  tapKeycode: string,
  hold: string,
  shiftOnly: boolean,
  context: Context,
): string {
  const options: string[] = [];
  if (!shiftOnly) options.push("(timeout hold)");
  if (context.flowTapTermMs > 0 && !isFlowTapKey(tapKeycode))
    options.push("(require-prior-idle 0)");
  const term = `$${TAPPING_TERM_VARIABLE}`;
  const head = shiftOnly
    ? `tap-hold-release 0 ${term} ${tap} ${hold}`
    : `tap-hold-opposite-hand-release ${term} ${tap} ${hold}`;
  return `(${[head, ...options].join(" ")})`;
}

/** 修飾キー（Karabiner 名）の組を hold の action にする。1 個ならキー名、複数なら `multi`。 */
function holdAction(modifiers: readonly string[]): string | undefined {
  const names = modifiers.map((modifier) => kanataPositionName(modifier));
  if (names.some((name) => name === undefined)) return undefined;
  return names.length === 1 ? names[0] : `(multi ${names.join(" ")})`;
}

/**
 * keycode 1 つを kanata の action にする。`undefined` は「書かない」。
 *
 * `KC_TRNS` は layer 1 以上で `_`（下の layer へ落とす）、layer 0 では書かない。layer 0 は
 * `process-unmapped-keys` で素通しになる。
 */
function actionFor(
  keyCode: string,
  keycode: string,
  layer: number,
  context: Context,
): string | undefined {
  const lexeme = classifyKeycode(keycode);
  const fail = (code: string, message: string) => {
    context.diagnostics.push(unsupported(code, layer, keyCode, keycode, message));
    return undefined;
  };

  switch (lexeme.kind) {
    case "transparent":
      return layer > 0 ? "_" : undefined;
    case "none":
      return "XX";
    case "basic":
      return (
        kanataKeyName(lexeme.name) ??
        fail("mac-keymap/unsupported-keycode", `${keycode} に対応する kanata のキーが無い`)
      );
    case "layerSwitch": {
      const target = kanataLayerName(lexeme.layer);
      if (lexeme.action === "momentary") {
        context.referenced.add(lexeme.layer);
        return `(layer-while-held ${target})`;
      }
      if (lexeme.action === "layerTap") {
        const inner = lexeme.inner === undefined ? undefined : kanataKeyName(lexeme.inner);
        if (lexeme.inner === undefined || inner === undefined) {
          return fail(
            "mac-keymap/unsupported-layer-tap-inner",
            `${keycode} の tap 側を kanata のキーへ落とせない`,
          );
        }
        context.referenced.add(lexeme.layer);
        return tapHold(inner, lexeme.inner, `(layer-while-held ${target})`, false, context);
      }
      return fail(
        "mac-keymap/unsupported-keycode",
        `${keycode} の layer 操作は kanata へ落とせない（対応するのは MO / LT）`,
      );
    }
    case "modTap": {
      const modifiers = modifierKeyCodes(lexeme.modifier);
      const inner = kanataKeyName(lexeme.inner);
      const hold = modifiers === undefined ? undefined : holdAction(modifiers);
      if (modifiers === undefined || inner === undefined || hold === undefined) {
        return fail(
          "mac-keymap/unsupported-mod-tap",
          `${keycode} を kanata の mod-tap へ落とせない`,
        );
      }
      const shiftOnly =
        modifiers.length === 1 && (modifiers[0] === "left_shift" || modifiers[0] === "right_shift");
      return tapHold(inner, lexeme.inner, hold, shiftOnly, context);
    }
    case "modified": {
      const modifiers = modifierKeyCodes(lexeme.modifier);
      const inner = karabinerKeyEvent(lexeme.inner);
      const chord =
        modifiers === undefined || inner === undefined
          ? undefined
          : kanataChord([...modifiers, ...(inner.modifiers ?? [])], inner.key_code);
      return chord ?? fail("mac-keymap/unsupported-keycode", `${keycode} は kanata へ落とせない`);
    }
    case "oneShotMod":
    case "tapDance":
    case "macro":
    case "custom":
    case "numeric":
    case "unknown":
      return fail("mac-keymap/unsupported-keycode", `${keycode} は kanata へ落とせない`);
  }
}
