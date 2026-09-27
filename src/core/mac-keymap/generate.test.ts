/**
 * 生成器の検証。R-006 Spike の `self-check.mjs` が固定していた契約を、
 * `karabiner_cli` に依存しない範囲でここへ移した。以後はこの test が正で、
 * spike は判断時点の記録として凍結してある。
 */

import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  generateKarabinerAsset,
  generateOwnedProfile,
  generateKarabinerRules,
  macKeycodeSupport,
} from "./generate.ts";
import type { KarabinerManipulator } from "./karabiner.ts";
import { parseMacKeymapYaml } from "./parse.ts";
import { DEFAULT_MAC_DEVICES, type MacKeyboardLayout, type MacKeymapDocument } from "./types.ts";

const FIXTURES = join(import.meta.dirname, "../../../fixtures/mac-keyboard");
const DESIRED = parseMacKeymapYaml(readFileSync(join(FIXTURES, "desired.yaml"), "utf8"));

function documentOf(
  layers: readonly Record<string, string>[],
  layout: MacKeyboardLayout = "jis",
): MacKeymapDocument {
  return {
    layout,
    devices: DEFAULT_MAC_DEVICES,
    tappingTermMs: 200,
    profile: "KeySync",
    layers: new Map(
      layers.map((assignments, layer) => [layer, new Map(Object.entries(assignments))]),
    ),
  };
}

function manipulators(document: MacKeymapDocument): readonly KarabinerManipulator[] {
  return generateKarabinerRules(document).rules.flatMap((rule) => rule.manipulators);
}

function byKey(document: MacKeymapDocument, keyCode: string): readonly KarabinerManipulator[] {
  return manipulators(document).filter((one) => one.from.key_code === keyCode);
}

test("desired.yaml は diagnostic を出さない", () => {
  deepStrictEqual(generateKarabinerRules(DESIRED).diagnostics, []);
});

test("rule は layer 降順に並ぶ", () => {
  // rule は上から評価され最初にマッチしたものが勝つ。逆順だと layer 0 が上の layer を食う。
  deepStrictEqual(
    generateKarabinerRules(DESIRED).rules.map((rule) => rule.description),
    ["KeySync layer 3", "KeySync layer 2", "KeySync layer 1", "KeySync layer 0"],
  );
});

test("MO(n) は set_variable と to_after_key_up を持つ", () => {
  const [manipulator] = byKey(DESIRED, "japanese_eisuu");
  deepStrictEqual(manipulator?.to, [{ set_variable: { name: "keysync_layer_2", value: 1 } }]);
  deepStrictEqual(manipulator?.to_after_key_up, [
    { set_variable: { name: "keysync_layer_2", value: 0 } },
  ]);
});

test("LT n(kc) は momentary に to_if_alone を足したもの", () => {
  const [manipulator] = byKey(DESIRED, "japanese_kana");
  deepStrictEqual(manipulator?.to, [{ set_variable: { name: "keysync_layer_1", value: 1 } }]);
  deepStrictEqual(manipulator?.to_if_alone, [{ key_code: "japanese_kana" }]);
});

test("mod-tap は閾値で tap と hold を分ける", () => {
  // lazy な modifier を to に置く形は、押していた時間に関係なく次のキーへ modifier が掛かる。
  // ロール打鍵で誤爆するため、閾値まで押し続けたときだけ hold にする（ADR 0044）。
  const [manipulator] = byKey(DESIRED, "caps_lock");
  strictEqual(manipulator?.to, undefined);
  deepStrictEqual(manipulator?.to_if_alone, [{ key_code: "escape", halt: true }]);
  deepStrictEqual(manipulator?.to_if_held_down, [{ key_code: "left_control" }]);
  // 閾値より前に次のキーが押されたら tap 側を送る。
  deepStrictEqual(manipulator?.to_delayed_action, { to_if_canceled: [{ key_code: "escape" }] });
});

test("mod-tap の 3 つの timer は document の閾値にそろう", () => {
  // delayed action だけ長いと、hold 確定後に押したキーの前へ tap 側の文字が出る。
  const [manipulator] = manipulators({
    ...documentOf([{ f: "LGUI_T(KC_F)" }]),
    tappingTermMs: 180,
  });
  deepStrictEqual(manipulator?.parameters, {
    "basic.to_if_alone_timeout_milliseconds": 180,
    "basic.to_if_held_down_threshold_milliseconds": 180,
    "basic.to_delayed_action_delay_milliseconds": 180,
  });
});

test("閾値は mod-tap 以外の manipulator に付かない", () => {
  for (const manipulator of manipulators(documentOf([{ a: "KC_B", b: "LT1(KC_B)" }, {}]))) {
    strictEqual(manipulator.parameters, undefined, manipulator.from.key_code);
  }
});

test("TG(n) は 2 本に展開され、倒す側が先に来る", () => {
  // 順序を逆にすると押した直後に立て直してしまう。
  const found = byKey(DESIRED, "right_command");
  strictEqual(found.length, 2);
  deepStrictEqual(found[0]?.to, [{ set_variable: { name: "keysync_layer_3", value: 0 } }]);
  deepStrictEqual(found[0]?.conditions.at(-1), {
    type: "variable_if",
    name: "keysync_layer_3",
    value: 1,
  });
  deepStrictEqual(found[1]?.to, [{ set_variable: { name: "keysync_layer_3", value: 1 } }]);
  deepStrictEqual(found[1]?.conditions.at(-1), {
    type: "variable_unless",
    name: "keysync_layer_3",
    value: 1,
  });
});

test("KC_NO は to を持たない manipulator になる", () => {
  const [manipulator] = byKey(DESIRED, "q");
  strictEqual(manipulator?.to, undefined);
});

test("KC_TRNS は manipulator を出さない", () => {
  strictEqual(byKey(DESIRED, "w").length, 0);
});

test("layer 0 と同値のキーは manipulator を出さない", () => {
  // Karabiner は書かれていないキーを素通しするので、出さないことが正しい挙動になる。
  strictEqual(byKey(DESIRED, "caps_lock").length, 1);
});

test("全 manipulator が内蔵キーボード限定になる", () => {
  const all = manipulators(DESIRED);
  strictEqual(all.length > 0, true);
  for (const manipulator of all) {
    deepStrictEqual(manipulator.conditions[0], {
      type: "device_if",
      identifiers: [{ is_built_in_keyboard: true }],
    });
  }
});

test("layer 1 以上には variable_if が付く", () => {
  deepStrictEqual(byKey(DESIRED, "h")[0]?.conditions[1], {
    type: "variable_if",
    name: "keysync_layer_1",
    value: 1,
  });
});

test("修飾キーは素通しさせる", () => {
  deepStrictEqual(byKey(DESIRED, "h")[0]?.from, {
    key_code: "h",
    modifiers: { optional: ["any"] },
  });
});

test("落とせない keycode は黙って消えず error になる", () => {
  const broken = documentOf([{ z: "TD(0)", x: "LT1(TD(1))", c: "LCTL_T(M(0))", v: "LSFT(M(0))" }]);
  const { rules, diagnostics } = generateKarabinerRules(broken);
  deepStrictEqual(rules, []);
  deepStrictEqual(
    diagnostics.map((one) => one.code),
    [
      // key_code 名の昇順（c / v / x / z）に出る。
      "mac-keymap/unsupported-mod-tap",
      "mac-keymap/unsupported-keycode",
      "mac-keymap/unsupported-layer-tap-inner",
      "mac-keymap/unsupported-keycode",
    ],
  );
  for (const diagnostic of diagnostics) strictEqual(diagnostic.severity, "error");
});

test("修飾付きキーは key_code に modifiers を付けて送る", () => {
  deepStrictEqual(
    manipulators(documentOf([{ a: "LSFT(KC_1)", b: "RCG(KC_2)" }])).map((one) => one.to),
    [
      [{ key_code: "1", modifiers: ["left_shift"] }],
      [{ key_code: "2", modifiers: ["right_control", "right_command"] }],
    ],
  );
});

test("shift 済み keycode は base の key_code に left_shift を付ける", () => {
  // Karabiner に `!` 単体の key_code は無い（ADR 0043）。
  deepStrictEqual(manipulators(documentOf([{ a: "KC_EXLM" }]))[0]?.to, [
    { key_code: "1", modifiers: ["left_shift"] },
  ]);
});

test("修飾と shift 済み keycode を重ねても modifiers は重複しない", () => {
  deepStrictEqual(manipulators(documentOf([{ a: "LSFT(KC_EXLM)" }]))[0]?.to, [
    { key_code: "1", modifiers: ["left_shift"] },
  ]);
});

test("複合 modifier の mod-tap は先頭を key_code、残りを modifiers にする", () => {
  const [manipulator] = manipulators(documentOf([{ s: "SGUI_T(KC_S)" }]));
  deepStrictEqual(manipulator?.to_if_held_down, [
    { key_code: "left_shift", modifiers: ["left_command"] },
  ]);
  deepStrictEqual(manipulator?.to_if_alone, [{ key_code: "s", halt: true }]);
});

test("単独 modifier の mod-tap には modifiers を付けない", () => {
  deepStrictEqual(manipulators(documentOf([{ f: "LGUI_T(KC_F)" }]))[0]?.to_if_held_down, [
    { key_code: "left_command" },
  ]);
});

test("diagnostic は layer と key_code を指す", () => {
  const { diagnostics } = generateKarabinerRules(documentOf([{}, { z: "KC_BOGUS" }]));
  deepStrictEqual(diagnostics[0]?.subject, { kind: "macKey", layer: 1, keyCode: "z" });
});

test("MO / LT / TG 以外の layer 操作は落とせない", () => {
  const { diagnostics } = generateKarabinerRules(documentOf([{ a: "TO(1)", b: "OSL(2)" }]));
  strictEqual(diagnostics.length, 2);
  for (const diagnostic of diagnostics) strictEqual(diagnostic.severity, "error");
});

test("alias 表記も長い表記と同じ key_code へ落ちる", () => {
  // 表は canonical で持ち、引く前に canonicalKeycode で畳む（ADR 0001）。
  const short = generateKarabinerRules(documentOf([{ a: "KC_BSPC" }]));
  const long = generateKarabinerRules(documentOf([{ a: "KC_BSPACE" }]));
  deepStrictEqual(short.rules, long.rules);
  deepStrictEqual(short.rules[0]?.manipulators[0]?.to, [{ key_code: "delete_or_backspace" }]);
});

test("manipulator が 1 つも出ない layer は rule ごと省略する", () => {
  const { rules } = generateKarabinerRules(documentOf([{ a: "KC_A" }, { a: "KC_A" }]));
  deepStrictEqual(
    rules.map((rule) => rule.description),
    ["KeySync layer 0"],
  );
});

test("asset は lint に渡せる形になる", () => {
  const { asset } = generateKarabinerAsset(DESIRED);
  strictEqual(asset.title, "KeySync");
  strictEqual(asset.rules.length, 4);
});

test("profile は selected も simple_modifications も持たない", () => {
  // profile の切り替えはユーザーの操作（ADR 0022）。
  const { profile } = generateOwnedProfile(DESIRED);
  strictEqual(profile.name, "KeySync");
  strictEqual("selected" in profile, false);
  strictEqual("simple_modifications" in profile, false);
  // DESIRED（fixture）は layout: jis なので keyboard_type_v2 も jis になる（ADR 0024）。
  deepStrictEqual(profile.virtual_hid_keyboard, { keyboard_type_v2: "jis" });
});

test("keyboard_type_v2 は document の layout から導出する", () => {
  const { profile } = generateOwnedProfile(documentOf([{ a: "KC_A" }], "ansi"));
  deepStrictEqual(profile.virtual_hid_keyboard, { keyboard_type_v2: "ansi" });
});

test("device_if の identifiers は document の devices から組む", () => {
  const document: MacKeymapDocument = {
    layout: "ansi",
    devices: [{ builtIn: true }, { vendorId: 1452, productId: 630 }],
    tappingTermMs: 200,
    profile: "KeySync",
    layers: new Map([[0, new Map([["caps_lock", "KC_ESCAPE"]])]]),
  };
  const { rules } = generateKarabinerRules(document);
  deepStrictEqual(rules[0]?.manipulators[0]?.conditions, [
    {
      type: "device_if",
      identifiers: [{ is_built_in_keyboard: true }, { vendor_id: 1452, product_id: 630 }],
    },
  ]);
});

test("layer 1 以上でも device 条件は先頭に残る", () => {
  const document: MacKeymapDocument = {
    layout: "ansi",
    devices: [{ vendorId: 1452, productId: 630 }],
    tappingTermMs: 200,
    profile: "KeySync",
    layers: new Map([
      [0, new Map([["caps_lock", "MO(1)"]])],
      [1, new Map([["h", "KC_LEFT"]])],
    ]),
  };
  const { rules } = generateKarabinerRules(document);
  const layerOne = rules.find((rule) => rule.description.endsWith("layer 1"));
  deepStrictEqual(layerOne?.manipulators[0]?.conditions, [
    { type: "device_if", identifiers: [{ vendor_id: 1452, product_id: 630 }] },
    { type: "variable_if", name: "keysync_layer_1", value: 1 },
  ]);
});

test("macKeycodeSupport は落とせる keycode を ok にする", () => {
  for (const keycode of [
    "KC_A",
    "KC_TRNS",
    "KC_NO",
    "MO(1)",
    "TG(2)",
    "LT1(KC_SPACE)",
    "LCTL_T(KC_TAB)",
    "LSFT(KC_1)",
    "KC_EXLM",
    "SGUI_T(KC_S)",
  ]) {
    strictEqual(macKeycodeSupport(keycode).ok, true, keycode);
  }
});

test("macKeycodeSupport は落とせない keycode に診断の code を付ける", () => {
  const cases: readonly (readonly [string, string])[] = [
    ["LSFT(M(0))", "mac-keymap/unsupported-keycode"],
    ["TD(0)", "mac-keymap/unsupported-keycode"],
    ["M(0)", "mac-keymap/unsupported-keycode"],
    ["USER00", "mac-keymap/unsupported-keycode"],
    ["LCTL_T(KC_NO)", "mac-keymap/unsupported-mod-tap"],
    ["LT1(KC_NO)", "mac-keymap/unsupported-layer-tap-inner"],
  ];
  for (const [keycode, code] of cases) {
    const support = macKeycodeSupport(keycode);
    strictEqual(support.ok, false, keycode);
    if (!support.ok) strictEqual(support.code, code, keycode);
  }
});

test("macKeycodeSupport と生成器の判定はずれない", () => {
  // 判定を書き写していないことの確認。probe と本番の lowering が同じ結論になる。
  const samples = [
    "KC_A",
    "KC_TRNS",
    "KC_NO",
    "MO(1)",
    "TG(2)",
    "LT1(KC_SPACE)",
    "LCTL_T(KC_TAB)",
    "LSFT(KC_1)",
    "LSFT(M(0))",
    "KC_EXLM",
    "SGUI_T(KC_S)",
    "TD(0)",
    "M(0)",
    "USER00",
    "KC_LANG1",
  ];
  for (const keycode of samples) {
    const { diagnostics } = generateKarabinerRules(documentOf([{ spacebar: keycode }]));
    const hasError = diagnostics.some((diagnostic) => diagnostic.severity === "error");
    strictEqual(macKeycodeSupport(keycode).ok, !hasError, keycode);
  }
});
