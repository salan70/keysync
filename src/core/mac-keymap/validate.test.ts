import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { parseMacKeymapYaml } from "./parse.ts";
import { DEFAULT_MAC_DEVICES, type MacKeyboardLayout, type MacKeymapDocument } from "./types.ts";
import { validateMacKeymap } from "./validate.ts";

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
    flowTapTermMs: 0,
    profile: "KeySync",
    layers: new Map(
      layers.map((assignments, layer) => [layer, new Map(Object.entries(assignments))]),
    ),
  };
}

test("desired.yaml は診断を出さない", () => {
  const result = validateMacKeymap(DESIRED);
  deepStrictEqual(result.diagnostics, []);
  deepStrictEqual(result.summary, { error: 0, warning: 0, information: 0 });
});

test("Karabiner に無い key_code は error になる", () => {
  // lint を通らない生成物を作らないため、位置は表で閉じる。
  const result = validateMacKeymap(documentOf([{ not_a_key: "KC_A" }]));
  strictEqual(result.diagnostics[0]?.code, "mac-keymap/unknown-position");
  strictEqual(result.diagnostics[0]?.severity, "error");
  strictEqual(result.summary.error, 1);
});

test("QMK に対応の無い fn は位置として書ける", () => {
  deepStrictEqual(validateMacKeymap(documentOf([{ fn: "KC_A" }])).diagnostics, []);
});

test("ansi に無い japanese_kana への割り当ては warning になる", () => {
  // rule は lint を通り load もされるが、キーが無いので決して発火しない（ADR 0024）。
  const result = validateMacKeymap(documentOf([{ japanese_kana: "KC_A" }], "ansi"));
  strictEqual(result.diagnostics.length, 1);
  strictEqual(result.diagnostics[0]?.code, "mac-keymap/position-not-on-layout");
  strictEqual(result.diagnostics[0]?.severity, "warning");
  deepStrictEqual(result.diagnostics[0]?.subject, {
    kind: "macKey",
    layer: 0,
    keyCode: "japanese_kana",
  });
});

test("同じ割り当てでも jis なら診断を出さない", () => {
  deepStrictEqual(
    validateMacKeymap(documentOf([{ japanese_kana: "KC_A" }], "jis")).diagnostics,
    [],
  );
});

test("ansi に無い international3 への割り当ても warning になる", () => {
  // Inference 側の集合（HID usage の定義上 ANSI に対応キーが無い）も同じ規則で見る。
  const result = validateMacKeymap(documentOf([{ international3: "KC_A" }], "ansi"));
  strictEqual(result.diagnostics[0]?.code, "mac-keymap/position-not-on-layout");
  strictEqual(result.summary.warning, 1);
});

test("Karabiner に無い key_code は ansi でも unknown-position の error だけになる", () => {
  // LAYOUT_MISSING_POSITIONS は KARABINER_POSITIONS の部分集合なので二重報告しない。
  const result = validateMacKeymap(documentOf([{ not_a_key: "KC_A" }], "ansi"));
  strictEqual(result.diagnostics.length, 1);
  strictEqual(result.diagnostics[0]?.code, "mac-keymap/unknown-position");
});

test("書かれていない layer を指す MO は warning になる", () => {
  const result = validateMacKeymap(documentOf([{ a: "MO(9)" }]));
  strictEqual(result.diagnostics[0]?.code, "mac-keymap/unknown-layer");
  strictEqual(result.diagnostics[0]?.severity, "warning");
});

test("layer 0 から辿り着けない layer は information になる", () => {
  // 書いたとおりに rule へは入る。失われる値が無いので error にしない（ADR 0010）。
  const result = validateMacKeymap(documentOf([{ a: "KC_A" }, { b: "KC_B" }]));
  strictEqual(result.diagnostics[0]?.code, "mac-keymap/unreachable-layer");
  strictEqual(result.diagnostics[0]?.severity, "information");
});

test("落とせない keycode は表現可能性の error として出る", () => {
  const result = validateMacKeymap(documentOf([{ a: "TD(0)" }]));
  strictEqual(result.diagnostics[0]?.code, "mac-keymap/unsupported-keycode");
  strictEqual(result.summary.error, 1);
});

test("devices が空なら適用先が無いので error", () => {
  const result = validateMacKeymap({
    layout: "jis",
    devices: [],
    tappingTermMs: 200,
    flowTapTermMs: 0,
    profile: "KeySync",
    layers: new Map([[0, new Map([["a", "KC_A"]])]]),
  });
  const diagnostic = result.diagnostics.find((d) => d.code === "mac-keymap/no-target-device");
  strictEqual(diagnostic?.severity, "error");
});

test("JIS 盤面に無い ANSI 固有キーへの割り当ては warning", () => {
  const result = validateMacKeymap(
    documentOf([{ grave_accent_and_tilde: "KC_ESCAPE", right_option: "KC_A" }], "jis"),
  );
  const codes = result.diagnostics
    .filter((d) => d.code === "mac-keymap/position-not-on-layout")
    .map((d) => (d.subject.kind === "macKey" ? d.subject.keyCode : ""))
    .sort();
  deepStrictEqual(codes, ["grave_accent_and_tilde", "right_option"]);
  strictEqual(
    result.diagnostics.every(
      (d) => d.code !== "mac-keymap/position-not-on-layout" || d.severity === "warning",
    ),
    true,
  );
});
