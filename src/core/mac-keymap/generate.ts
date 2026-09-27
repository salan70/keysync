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
  KarabinerOtherKey,
  KarabinerProfile,
  KarabinerRule,
  KarabinerToEvent,
} from "./karabiner.ts";
import {
  DEFAULT_MAC_FLOW_TAP_TERM_MS,
  DEFAULT_MAC_TAPPING_TERM_MS,
  type MacDeviceIdentifier,
  type MacKeymapDocument,
} from "./types.ts";

/** layer 変数の名前空間。Karabiner の変数は global なので接頭辞で隔離する。 */
const LAYER_VARIABLE_PREFIX = "keysync_layer_";

/**
 * Flow Tap のための「直前に文字キーを押した時刻（ms）」。直前が文字キーでなければ 0。
 *
 * Karabiner には「前のキーから何 ms か」を直接見る条件が無いため、押すたびにここへ
 * `system.now.milliseconds` を書き、mod-tap 側の `expression_if` で差を見る（ADR 0047）。
 */
const FLOW_TAP_VARIABLE = "keysync_flow_tap_last_ms";

/**
 * Flow Tap の対象になる tap 側の key_code。QMK の `is_flow_tap_key` の既定
 * （`KC_A`〜`KC_Z`、`KC_COMM`、`KC_DOT`、`KC_SCLN`、`KC_SLSH`、`KC_SPC`）に合わせる。
 * 直前のキーと mod-tap の tap 側の両方がこの中にあるときだけ Flow Tap が効く（ADR 0047）。
 */
const FLOW_TAP_KEY_CODES: ReadonlySet<string> = new Set([
  ..."abcdefghijklmnopqrstuvwxyz",
  "comma",
  "period",
  "semicolon",
  "slash",
  "spacebar",
]);

/** tap-hold の閾値。`flowTapTermMs` が 0 なら Flow Tap の manipulator と変数を出さない。 */
interface TapHoldTerms {
  readonly tappingTermMs: number;
  readonly flowTapTermMs: number;
}

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
  const hoisted: KarabinerManipulator[] = [];
  /** layer ごとに manipulator を出したキー。前へ移した manipulator が上の layer を食わないようにする。 */
  const emitted = new Map<number, Set<string>>();
  const base = document.layers.get(0);
  const layers = [...document.layers.keys()].sort((a, b) => b - a);
  const device = deviceCondition(document.devices);
  const terms: TapHoldTerms = {
    tappingTermMs: document.tappingTermMs,
    flowTapTermMs: document.flowTapTermMs,
  };

  for (const layer of layers) {
    const assignments = document.layers.get(layer);
    if (assignments === undefined) continue;
    const manipulators: KarabinerManipulator[] = [];
    for (const keyCode of [...assignments.keys()].sort()) {
      const keycode = assignments.get(keyCode);
      if (keycode === undefined) continue;
      // layer 0 と同値なら出さない。出しても素通しと同じ結果にしかならない。
      if (layer > 0 && base?.get(keyCode) === keycode) continue;
      const generated = manipulatorsForKey(keyCode, keycode, layer, device, terms, diagnostics);
      if (generated.length > 0) emitted.set(layer, (emitted.get(layer) ?? new Set()).add(keyCode));
      for (const manipulator of generated) {
        if (manipulator.to_if_other_key_pressed === undefined) {
          manipulators.push(manipulator);
          continue;
        }
        // 上の layer が同じキーに割り当てを持つときは、その layer では当たらないようにする。
        // layer は降順に回るので、上の layer の emitted はここまでに埋まっている。
        const shadowed = layers.filter(
          (upper) => upper > layer && (emitted.get(upper)?.has(keyCode) ?? false),
        );
        hoisted.push({
          ...manipulator,
          conditions: [
            ...manipulator.conditions,
            ...shadowed.map(
              (upper): KarabinerCondition => ({
                type: "variable_unless",
                name: layerVariable(upper),
                value: 1,
              }),
            ),
          ],
        });
      }
    }
    if (manipulators.length === 0) continue;
    rules.push({ description: `${document.profile} layer ${layer}`, manipulators });
  }

  // 前へ移した manipulator は、どの layer の rule よりも前に置く（ADR 0048）。
  if (hoisted.length > 0) {
    rules.unshift({
      description: `${document.profile} hold on other key press`,
      manipulators: hoisted,
    });
  }

  if (terms.flowTapTermMs > 0) {
    const passThrough = flowTapPassThrough(base, device);
    if (passThrough.length > 0) {
      rules.push({ description: `${document.profile} flow tap`, manipulators: passThrough });
    }
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

/** probe 用の位置・device・閾値。`manipulatorsForKey` はどれも判定に使わない。 */
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
  manipulatorsForKey(
    PROBE_POSITION,
    keycode,
    0,
    PROBE_DEVICE,
    { tappingTermMs: DEFAULT_MAC_TAPPING_TERM_MS, flowTapTermMs: DEFAULT_MAC_FLOW_TAP_TERM_MS },
    diagnostics,
  );
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
 * mod-tap の tap / hold を閾値で分ける 3 つの timer。すべて from の key down から数える。
 *
 * 3 つを同じ値にそろえることで「閾値の前に離す・次のキーを押す = tap、閾値まで押し続ける
 * = hold」の 2 択になる（ADR 0044）。delayed action だけ長いと、hold が確定したあとに
 * 次のキーを押したとき `to_if_canceled` が tap 側の文字を送ってしまう。alone だけ長いと、
 * hold で離したときに文字も出る。
 */
function tapHoldParameters(tappingTermMs: number): Readonly<Record<string, number>> {
  return {
    "basic.to_if_alone_timeout_milliseconds": tappingTermMs,
    "basic.to_if_held_down_threshold_milliseconds": tappingTermMs,
    "basic.to_delayed_action_delay_milliseconds": tappingTermMs,
  };
}

/** Flow Tap の対象になる tap 側か。修飾キー付き（`KC_EXLM` など）は対象外。 */
function isFlowTapKey(event: KarabinerKeyEvent): boolean {
  return FLOW_TAP_KEY_CODES.has(event.key_code) && event.modifiers === undefined;
}

/**
 * 押したキーを Flow Tap の変数へ記録する `to` イベント。Flow Tap が無効なら何も出さない。
 *
 * 文字キーなら押した時刻を、それ以外なら 0 を書く。QMK の Flow Tap は「直前に押したキー」
 * が文字キーのときだけ効くため、文字以外のキーで記録を消す必要がある（ADR 0047）。
 */
function flowTapMark(terms: TapHoldTerms, flowKey: boolean): readonly KarabinerToEvent[] {
  if (terms.flowTapTermMs === 0) return [];
  return [
    flowKey
      ? { set_variable: { name: FLOW_TAP_VARIABLE, expression: "system.now.milliseconds" } }
      : { set_variable: { name: FLOW_TAP_VARIABLE, value: 0 } },
  ];
}

/**
 * tap-hold キーを Flow Tap で即 tap にする manipulator。対象外なら空配列。
 *
 * 直前の文字キーから `flowTapTermMs` 未満で押したときだけ当たり、tap 側をそのまま
 * `to` で送る。hold の判定を持たないので、押し続ければ tap 側の key repeat になる。
 * 通常の tap-hold の manipulator より**前に**置く（同じ rule の中では最初に当たったものが勝つ）。
 */
function flowTapManipulators(
  from: KarabinerFrom,
  inner: KarabinerKeyEvent,
  conditions: readonly KarabinerCondition[],
  terms: TapHoldTerms,
): readonly KarabinerManipulator[] {
  if (terms.flowTapTermMs === 0 || !isFlowTapKey(inner)) return [];
  return [
    {
      type: "basic",
      from,
      to: [...flowTapMark(terms, true), inner],
      conditions: [
        ...conditions,
        {
          type: "expression_if",
          expression: `system.now.milliseconds - ${FLOW_TAP_VARIABLE} < ${terms.flowTapTermMs}`,
        },
      ],
    },
  ];
}

/**
 * どの layer にも割り当ての無い文字キーで、押した時刻を記録するだけの素通し。
 *
 * 割り当ての無いキーは manipulator が無く、そのままでは記録されない。layer の rule より
 * 後ろに置くので、割り当てのあるキーはそちらが先に当たる。数字や矢印など文字以外の素通し
 * キーは記録を消さない。QMK との差として ADR 0047 に残す。
 */
function flowTapPassThrough(
  base: ReadonlyMap<string, string> | undefined,
  device: KarabinerCondition,
): readonly KarabinerManipulator[] {
  return [...FLOW_TAP_KEY_CODES]
    .filter((keyCode) => base?.get(keyCode) === undefined)
    .sort()
    .map((keyCode) => ({
      type: "basic",
      from: fromKey(keyCode),
      to: [
        { set_variable: { name: FLOW_TAP_VARIABLE, expression: "system.now.milliseconds" } },
        { key_code: keyCode },
      ],
      conditions: [device],
    }));
}

/** `to_if_other_key_pressed` で「どのキーでも」を表す。クリックも Shift+クリックに含める。 */
const ANY_OTHER_KEYS: readonly KarabinerOtherKey[] = [
  { any: "key_code", modifiers: { optional: ["any"] } },
  { any: "pointing_button", modifiers: { optional: ["any"] } },
];

/**
 * hold 側が Shift だけの mod-tap か。これだけは、押している間に別のキーを押した時点で hold にする
 * （QMK の Hold On Other Key Press、ADR 0048）。
 */
function holdsOnOtherKeyPress(modifiers: readonly string[]): boolean {
  return (
    modifiers.length === 1 && (modifiers[0] === "left_shift" || modifiers[0] === "right_shift")
  );
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
  terms: TapHoldTerms,
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
      return [
        { type: "basic", from, to: [...flowTapMark(terms, isFlowTapKey(to)), to], conditions },
      ];
    }

    case "layerSwitch": {
      const variable = layerVariable(lexeme.layer);
      if (lexeme.action === "momentary") {
        return [
          {
            type: "basic",
            from,
            to: [{ set_variable: { name: variable, value: 1 } }, ...flowTapMark(terms, false)],
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
          ...flowTapManipulators(from, inner, conditions, terms),
          {
            type: "basic",
            from,
            to: [
              { set_variable: { name: variable, value: 1 } },
              ...flowTapMark(terms, isFlowTapKey(inner)),
            ],
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
            to: [{ set_variable: { name: variable, value: 0 } }, ...flowTapMark(terms, false)],
            conditions: [...conditions, { type: "variable_if", name: variable, value: 1 }],
          },
          {
            type: "basic",
            from,
            to: [{ set_variable: { name: variable, value: 1 } }, ...flowTapMark(terms, false)],
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
      // 閾値より前に次のキーを押したら tap 側を送る。`to` に lazy な modifier を置く形は
      // 押していた時間に関係なく modifier が掛かり、ロール打鍵で誤爆する（ADR 0044）。
      // 文字を打っている最中なら、閾値を待たずに tap 側を送る（ADR 0047）。
      const mark = flowTapMark(terms, isFlowTapKey(inner));
      if (holdsOnOtherKeyPress(modifiers)) {
        // Shift は閾値を待たず、次のキーを押した時点で hold にする。Karabiner は押した時点で
        // 出力を決めるため、QMK の Permissive Hold（離した順で分ける）は作れない（ADR 0048）。
        // `to_delayed_action` は持たない。持つと次のキーを押したとき tap 側の文字が出る。
        // 他のキーより前に置く必要があり、generateKarabinerRules が前へ移す。後ろにあると、
        // 先に当たった manipulator が処理したキーを見られない。
        return [
          ...flowTapManipulators(from, inner, conditions, terms),
          {
            type: "basic",
            from,
            ...(mark.length === 0 ? {} : { to: mark }),
            to_if_alone: [inner],
            to_if_held_down: [modifierEvent(modifiers)],
            to_if_other_key_pressed: [
              { other_keys: ANY_OTHER_KEYS, to: [modifierEvent(modifiers)] },
            ],
            parameters: {
              "basic.to_if_alone_timeout_milliseconds": terms.tappingTermMs,
              "basic.to_if_held_down_threshold_milliseconds": terms.tappingTermMs,
            },
            conditions,
          },
        ];
      }
      return [
        ...flowTapManipulators(from, inner, conditions, terms),
        {
          type: "basic",
          from,
          ...(mark.length === 0 ? {} : { to: mark }),
          to_if_alone: [{ ...inner, halt: true }],
          to_if_held_down: [modifierEvent(modifiers)],
          to_delayed_action: { to_if_canceled: [inner] },
          parameters: tapHoldParameters(terms.tappingTermMs),
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
        {
          type: "basic",
          from,
          to: [...flowTapMark(terms, false), { key_code: inner.key_code, modifiers: all }],
          conditions,
        },
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
