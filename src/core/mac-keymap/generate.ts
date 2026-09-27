/**
 * desired state → Karabiner の rules。
 *
 * 展開規則は ADR 0022、構文層の出どころは ADR 0023。R-006 Spike
 * （`spikes/r-006-macos-keyboard/generate.mjs`）のプロトタイプを本実装へ移したもので、
 * `resolveKeycode` は持たず `classifyKeycode` の `KeycodeLexeme` から直接写像する。
 *
 * 落とせない keycode は**黙って捨てず** error の diagnostic にする。Karabiner は
 * 書かれていないキーを素通しするため、捨てると「効かないキー」として静かに残る。
 *
 */

import { classifyKeycode } from "../validation/keycode-vocabulary.ts";
import { createDiagnostic, type Diagnostic } from "../validation/types.ts";
import { KARABINER_MODIFIERS, karabinerKeyEvent } from "./key-codes.ts";
import type {
  KarabinerAsset,
  KarabinerCondition,
  KarabinerFrom,
  KarabinerKeyEvent,
  KarabinerManipulator,
  KarabinerProfile,
  KarabinerRule,
} from "./karabiner.ts";
import type { MacDeviceIdentifier, MacKeymapDocument } from "./types.ts";

/** layer 変数の名前空間。Karabiner の変数は global なので接頭辞で隔離する。 */
const LAYER_VARIABLE_PREFIX = "keysync_layer_";

/**
 * 適用先デバイスの条件。`identifiers` は OR なので 1 条件で複数デバイスを指せる。
 *
 * 内蔵限定を固定していたのを document の宣言から組むようにした（ADR 0026）。内蔵の
 * ANSI 機と外付けの US キーボードへ同じ設定を効かせるのに必要で、Karabiner の語彙への
 * 写像はここだけが持つ。
 */
function deviceCondition(devices: readonly MacDeviceIdentifier[]): KarabinerCondition {
  return {
    type: "device_if",
    identifiers: devices.map((device) =>
      "builtIn" in device
        ? { is_built_in_keyboard: true }
        : { vendor_id: device.vendorId, product_id: device.productId },
    ),
  };
}

/** 生成結果。manipulator が出ない理由は必ず diagnostic か「素通しで正しい」のどちらか。 */
export interface GeneratedRules {
  readonly rules: readonly KarabinerRule[];
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * desired state から rules を組み立てる。
 *
 * **rule は上から評価され最初にマッチしたものが勝つ**ため、高い layer から順に出す。
 * 逆順にすると layer 0 の割り当てが上の layer を食う（ADR 0022）。
 *
 * @doc docs/specs/mac-keymap.md#generatekarabinerrules
 */
export function generateKarabinerRules(document: MacKeymapDocument): GeneratedRules {
  const diagnostics: Diagnostic[] = [];
  const rules: KarabinerRule[] = [];
  const base = document.layers.get(0);
  const layers = [...document.layers.keys()].sort((a, b) => b - a);
  const device = deviceCondition(document.devices);

  for (const layer of layers) {
    const assignments = document.layers.get(layer);
    if (assignments === undefined) continue;
    const manipulators: KarabinerManipulator[] = [];
    for (const keyCode of [...assignments.keys()].sort()) {
      const keycode = assignments.get(keyCode);
      if (keycode === undefined) continue;
      // layer 0 と同値なら出さない。出しても素通しと同じ結果にしかならない。
      if (layer > 0 && base?.get(keyCode) === keycode) continue;
      manipulators.push(...manipulatorsForKey(keyCode, keycode, layer, device, diagnostics));
    }
    if (manipulators.length === 0) continue;
    rules.push({ description: `${document.profile} layer ${layer}`, manipulators });
  }

  return { rules, diagnostics };
}

/**
 * `karabiner_cli --lint-complex-modifications` が受け取る asset 形式。
 *
 * @doc docs/specs/mac-keymap.md#generatekarabinerasset
 */
export function generateKarabinerAsset(document: MacKeymapDocument): {
  readonly asset: KarabinerAsset;
  readonly diagnostics: readonly Diagnostic[];
} {
  const { rules, diagnostics } = generateKarabinerRules(document);
  return { asset: { title: document.profile, rules }, diagnostics };
}

/**
 * `karabiner.json` の `profiles[]` へ差し込む profile 1 個。KeySync が所有する唯一の範囲。
 *
 * `selected` は持たせない。profile の切り替えはユーザーの操作（ADR 0022）。
 *
 * @doc docs/specs/mac-keymap.md#generateownedprofile
 */
export function generateOwnedProfile(document: MacKeymapDocument): {
  readonly profile: KarabinerProfile;
  readonly diagnostics: readonly Diagnostic[];
} {
  const { rules, diagnostics } = generateKarabinerRules(document);
  return {
    profile: {
      name: document.profile,
      complex_modifications: { rules },
      // MacKeyboardLayout の値は Karabiner の keyboard_type_v2 の語彙と一致する（ADR 0024）。
      virtual_hid_keyboard: { keyboard_type_v2: document.layout },
    },
    diagnostics,
  };
}

/** `macKeycodeSupport` の判定結果。落とせない場合は診断の code と message を持つ。 */
export type MacKeycodeSupport =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: string; readonly message: string };

/** probe 用の位置と device。`manipulatorsForKey` はどちらも判定に使わない。 */
const PROBE_POSITION = "spacebar";
const PROBE_DEVICE = deviceCondition([{ builtIn: true }]);

/**
 * keycode を Karabiner へ落とせるか。
 *
 * **判定を書き写さない。** 実際の lowering を 1 キーの probe で走らせ、error 診断が
 * 出たかどうかで決める。「落とせるか」の正は `manipulatorsForKey` の閉じた switch と
 * 各 wrapper の表現可能性であり、判定を別に持つと必ず乖離する（ADR 0025）。UI が
 * picker の cell を無効化するのにこの関数を使っても、定義元は 1 つのまま保たれる。
 *
 * 位置と layer に依存しない判定だけを返す。書かれていない layer を指す `MO(n)` など、
 * document 全体を見ないと決まらないものは `validateMacKeymap` の担当。
 *
 * @doc docs/specs/mac-keymap.md#mackeycodesupport
 */
export function macKeycodeSupport(keycode: string): MacKeycodeSupport {
  const diagnostics: Diagnostic[] = [];
  manipulatorsForKey(PROBE_POSITION, keycode, 0, PROBE_DEVICE, diagnostics);
  const first = diagnostics[0];
  return first === undefined
    ? { ok: true }
    : { ok: false, code: first.code, message: first.message };
}

function layerVariable(layer: number): string {
  return `${LAYER_VARIABLE_PREFIX}${layer}`;
}

/** layer n を条件に加える。layer 0 は device 条件だけ。 */
function conditionsFor(layer: number, device: KarabinerCondition): readonly KarabinerCondition[] {
  return layer === 0
    ? [device]
    : [device, { type: "variable_if", name: layerVariable(layer), value: 1 }];
}

/** どの layer の manipulator も修飾キーは素通しさせる。 */
function fromKey(keyCode: string): KarabinerFrom {
  return { key_code: keyCode, modifiers: { optional: ["any"] } };
}

/**
 * 修飾キーの組を `to` イベント 1 個にする。先頭を `key_code`、残りを `modifiers` に置く。
 *
 * 単独の修飾キーは `modifiers` を付けない。付けると ADR 0043 以前の出力から差分が出る。
 */
function modifierEvent(modifiers: readonly string[]): KarabinerKeyEvent {
  const [first, ...rest] = modifiers;
  if (first === undefined) throw new Error("modifier の組が空");
  return rest.length === 0 ? { key_code: first } : { key_code: first, modifiers: rest };
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
 * キー 1 つを manipulator の配列へ落とす。
 *
 * 空配列は「manipulator を出さない」を意味する。Karabiner は書かれていないキーを
 * 素通しするので、`KC_TRNS` と layer 0 と同値のキーは出さないことがそのまま
 * 正しい挙動になる（ADR 0022）。
 */
function manipulatorsForKey(
  keyCode: string,
  keycode: string,
  layer: number,
  device: KarabinerCondition,
  diagnostics: Diagnostic[],
): readonly KarabinerManipulator[] {
  const lexeme = classifyKeycode(keycode);
  const conditions = conditionsFor(layer, device);
  const from = fromKey(keyCode);

  switch (lexeme.kind) {
    case "transparent":
      return [];

    case "none":
      // `to` を書かない manipulator がイベントを捨てる。無効化はこれで表す。
      return [{ type: "basic", from, conditions }];

    case "basic": {
      const to = karabinerKeyEvent(lexeme.name);
      if (to === undefined) {
        diagnostics.push(
          unsupported(
            "mac-keymap/unsupported-keycode",
            layer,
            keyCode,
            keycode,
            `${keycode} に対応する Karabiner の key_code が無い`,
          ),
        );
        return [];
      }
      return [{ type: "basic", from, to: [to], conditions }];
    }

    case "layerSwitch": {
      const variable = layerVariable(lexeme.layer);
      if (lexeme.action === "momentary") {
        return [
          {
            type: "basic",
            from,
            to: [{ set_variable: { name: variable, value: 1 } }],
            to_after_key_up: [{ set_variable: { name: variable, value: 0 } }],
            conditions,
          },
        ];
      }
      if (lexeme.action === "layerTap") {
        const inner = lexeme.inner === undefined ? undefined : karabinerKeyEvent(lexeme.inner);
        if (inner === undefined) {
          diagnostics.push(
            unsupported(
              "mac-keymap/unsupported-layer-tap-inner",
              layer,
              keyCode,
              keycode,
              `${keycode} の tap 側を Karabiner の key_code へ落とせない`,
            ),
          );
          return [];
        }
        return [
          {
            type: "basic",
            from,
            to: [{ set_variable: { name: variable, value: 1 } }],
            to_after_key_up: [{ set_variable: { name: variable, value: 0 } }],
            to_if_alone: [inner],
            conditions,
          },
        ];
      }
      if (lexeme.action === "toggle") {
        // Karabiner に toggle は無い。variable_if で分岐した 2 本で表す。
        // 「立っているとき倒す」を先に置く。順序を逆にすると押した直後に立て直す。
        return [
          {
            type: "basic",
            from,
            to: [{ set_variable: { name: variable, value: 0 } }],
            conditions: [...conditions, { type: "variable_if", name: variable, value: 1 }],
          },
          {
            type: "basic",
            from,
            to: [{ set_variable: { name: variable, value: 1 } }],
            conditions: [...conditions, { type: "variable_unless", name: variable, value: 1 }],
          },
        ];
      }
      diagnostics.push(
        unsupported(
          "mac-keymap/unsupported-keycode",
          layer,
          keyCode,
          keycode,
          `${keycode} の layer 操作は Karabiner へ落とせない（対応するのは MO / LT / TG）`,
        ),
      );
      return [];
    }

    case "modTap": {
      const modifiers = KARABINER_MODIFIERS.get(lexeme.modifier);
      const inner = karabinerKeyEvent(lexeme.inner);
      if (modifiers === undefined || inner === undefined) {
        diagnostics.push(
          unsupported(
            "mac-keymap/unsupported-mod-tap",
            layer,
            keyCode,
            keycode,
            `${keycode} を Karabiner の mod-tap へ落とせない`,
          ),
        );
        return [];
      }
      return [
        {
          type: "basic",
          from,
          // lazy を付けないと hold 側の modifier が単独で発火する。
          to: [{ ...modifierEvent(modifiers), lazy: true }],
          to_if_alone: [inner],
          conditions,
        },
      ];
    }

    case "modified": {
      const modifiers = KARABINER_MODIFIERS.get(lexeme.modifier);
      const inner = karabinerKeyEvent(lexeme.inner);
      if (modifiers === undefined || inner === undefined) {
        diagnostics.push(
          unsupported(
            "mac-keymap/unsupported-keycode",
            layer,
            keyCode,
            keycode,
            `${keycode} は Karabiner へ落とせない`,
          ),
        );
        return [];
      }
      // `LCTL(KC_EXLM)` のように inner 側が shift を持つ場合は両方を足す。
      const all = [...new Set([...modifiers, ...(inner.modifiers ?? [])])];
      return [
        { type: "basic", from, to: [{ key_code: inner.key_code, modifiers: all }], conditions },
      ];
    }

    case "oneShotMod":
    case "tapDance":
    case "macro":
    case "custom":
    case "numeric":
    case "unknown":
      diagnostics.push(
        unsupported(
          "mac-keymap/unsupported-keycode",
          layer,
          keyCode,
          keycode,
          `${keycode} は Karabiner へ落とせない`,
        ),
      );
      return [];
  }
}
