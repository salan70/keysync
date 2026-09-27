import { deepStrictEqual, strictEqual, throws } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { parseMacKeymapYaml } from "./parse.ts";
import { serializeMacKeymapYaml } from "./serialize.ts";
import {
  DEFAULT_MAC_DEVICES,
  DEFAULT_MAC_TAPPING_TERM_MS,
  MacKeymapParseError,
  type MacKeymapDocument,
} from "./types.ts";

const FIXTURES = join(import.meta.dirname, "../../../fixtures/mac-keyboard");
const readFixture = (name: string) => readFileSync(join(FIXTURES, name), "utf8");

function layersOf(document: MacKeymapDocument): Record<number, Record<string, string>> {
  return Object.fromEntries(
    [...document.layers.entries()].map(([layer, assignments]) => [
      layer,
      Object.fromEntries(assignments),
    ]),
  );
}

test("desired.yaml を読むと疎な map になる", () => {
  const document = parseMacKeymapYaml(readFixture("desired.yaml"));
  strictEqual(document.profile, "KeySync");
  strictEqual(document.layout, "jis");
  // 割り当ての無いキーは書かない。全キーを並べない（ADR 0022）。
  deepStrictEqual(layersOf(document), {
    0: {
      caps_lock: "LCTL_T(KC_ESC)",
      japanese_eisuu: "MO(2)",
      japanese_kana: "LT1(KC_LANG1)",
      right_command: "TG(3)",
    },
    1: {
      a: "KC_HOME",
      d: "KC_DEL",
      e: "KC_END",
      h: "KC_LEFT",
      j: "KC_DOWN",
      k: "KC_UP",
      l: "KC_RGHT",
    },
    2: {
      1: "KC_F1",
      2: "KC_F2",
      caps_lock: "LCTL_T(KC_ESC)",
      q: "KC_NO",
      w: "KC_TRNS",
    },
    3: { i: "KC_8", o: "KC_9", u: "KC_7" },
  });
});

test("desired.yaml は mac-keyboard.yaml を経由して round-trip する", () => {
  const document = parseMacKeymapYaml(readFixture("desired.yaml"));
  deepStrictEqual(parseMacKeymapYaml(serializeMacKeymapYaml(document)), document);
});

test("serialize は layer 昇順・key_code 名昇順で並べる", () => {
  const text = serializeMacKeymapYaml({
    layout: "jis",
    devices: DEFAULT_MAC_DEVICES,
    tappingTermMs: 200,
    profile: "KeySync",
    layers: new Map([
      [2, new Map([["z", "KC_Z"]])],
      [
        0,
        new Map([
          ["b", "KC_B"],
          ["a", "KC_A"],
        ]),
      ],
    ]),
  });
  strictEqual(
    text,
    [
      "schema: keysync/mac-keymap@1",
      "layout: jis",
      "devices:",
      "  - { built_in: true }",
      "tapping_term_ms: 200",
      'profile: "KeySync"',
      "layers:",
      "  0:",
      '    "a": "KC_A"',
      '    "b": "KC_B"',
      "  2:",
      '    "z": "KC_Z"',
      "",
    ].join("\n"),
  );
});

test("layout を省略すると jis になる", () => {
  // 既存の mac-keyboard.yaml（layout 行なし）を壊さないための既定（ADR 0024）。
  const document = parseMacKeymapYaml(
    ["schema: keysync/mac-keymap@1", 'profile: "x"', "layers:", "  0:"].join("\n"),
  );
  strictEqual(document.layout, "jis");
});

test("layout: ansi の document も round-trip する", () => {
  const document = parseMacKeymapYaml(
    [
      "schema: keysync/mac-keymap@1",
      "layout: ansi",
      'profile: "x"',
      "layers:",
      "  0:",
      '    "a": "KC_A"',
    ].join("\n"),
  );
  strictEqual(document.layout, "ansi");
  deepStrictEqual(parseMacKeymapYaml(serializeMacKeymapYaml(document)), document);
});

test("未対応の layout は読まずに落ちる", () => {
  throws(
    () =>
      parseMacKeymapYaml(
        ["schema: keysync/mac-keymap@1", "layout: iso", 'profile: "x"', "layers:"].join("\n"),
      ),
    MacKeymapParseError,
  );
});

test("layer 番号は連続していなくてよい", () => {
  const document = parseMacKeymapYaml(
    ["schema: keysync/mac-keymap@1", 'profile: "x"', "layers:", "  5:", '    "a": "KC_A"'].join(
      "\n",
    ),
  );
  deepStrictEqual([...document.layers.keys()], [5]);
});

test("未対応の schema は読まずに落ちる", () => {
  throws(
    () => parseMacKeymapYaml('schema: keysync/mac-keymap@2\nprofile: "x"\nlayers:\n'),
    MacKeymapParseError,
  );
});

test("改名前の schema ID の設定も読み、書き出しは新しい ID にする", () => {
  // 旧 ID は読み込みだけ受け付ける。開いただけでは書き換えない（ADR 0036）。
  const current = readFixture("desired.yaml");
  const legacy = current.replace(
    "schema: keysync/mac-keymap@1\n",
    "schema: cornix-bonsai/mac-keymap@1\n",
  );
  strictEqual(legacy.includes("schema: cornix-bonsai/mac-keymap@1\n"), true);

  const document = parseMacKeymapYaml(legacy);

  deepStrictEqual(document, parseMacKeymapYaml(current));
  strictEqual(serializeMacKeymapYaml(document).startsWith("schema: keysync/mac-keymap@1\n"), true);
});

test("解釈できない行は黙って捨てずに落ちる", () => {
  // 汎用の YAML parser ではない。serialize が出す部分集合だけを受ける（ADR 0009 と同じ理由）。
  throws(
    () =>
      parseMacKeymapYaml(
        ["schema: keysync/mac-keymap@1", 'profile: "x"', "layers:", "  0:", "    a: KC_A"].join(
          "\n",
        ),
      ),
    MacKeymapParseError,
  );
});

test("同じ layer で key_code が重複したら落ちる", () => {
  throws(
    () =>
      parseMacKeymapYaml(
        [
          "schema: keysync/mac-keymap@1",
          'profile: "x"',
          "layers:",
          "  0:",
          '    "a": "KC_A"',
          '    "a": "KC_B"',
        ].join("\n"),
      ),
    MacKeymapParseError,
  );
});

test("profile が無ければ落ちる", () => {
  throws(() => parseMacKeymapYaml("schema: keysync/mac-keymap@1\nlayers:\n"), MacKeymapParseError);
});

test("devices を省略した設定は内蔵キーボードだけを対象にする", () => {
  const document = parseMacKeymapYaml(
    [
      "schema: keysync/mac-keymap@1",
      "layout: jis",
      'profile: "KeySync"',
      "layers:",
      "  0:",
      '    "a": "KC_A"',
    ].join("\n"),
  );
  deepStrictEqual(document.devices, DEFAULT_MAC_DEVICES);
});

test("tapping_term_ms を省略すると既定の閾値になる", () => {
  const document = parseMacKeymapYaml(
    ["schema: keysync/mac-keymap@1", 'profile: "x"', "layers:", "  0:"].join("\n"),
  );
  strictEqual(document.tappingTermMs, DEFAULT_MAC_TAPPING_TERM_MS);
});

test("tapping_term_ms は round-trip する", () => {
  const text = [
    "schema: keysync/mac-keymap@1",
    "layout: ansi",
    "devices:",
    "  - { built_in: true }",
    "tapping_term_ms: 180",
    'profile: "KeySync"',
    "layers:",
    "  0:",
    "",
  ].join("\n");
  const document = parseMacKeymapYaml(text);
  strictEqual(document.tappingTermMs, 180);
  strictEqual(serializeMacKeymapYaml(document), text);
});

test("範囲外や整数でない tapping_term_ms は読まずに落ちる", () => {
  for (const value of ["49", "1001", "200.5", "abc", ""]) {
    throws(
      () =>
        parseMacKeymapYaml(
          [
            "schema: keysync/mac-keymap@1",
            `tapping_term_ms: ${value}`,
            'profile: "x"',
            "layers:",
          ].join("\n"),
        ),
      MacKeymapParseError,
      value,
    );
  }
});

test("内蔵と外付けを並べた devices が round-trip する", () => {
  const document: MacKeymapDocument = {
    layout: "ansi",
    devices: [{ builtIn: true }, { vendorId: 1452, productId: 630 }],
    tappingTermMs: 200,
    profile: "KeySync",
    layers: new Map([[0, new Map([["a", "KC_A"]])]]),
  };
  const text = serializeMacKeymapYaml(document);
  strictEqual(
    text.includes("devices:\n  - { built_in: true }\n  - { vendor_id: 1452, product_id: 630 }\n"),
    true,
  );
  deepStrictEqual(parseMacKeymapYaml(text), document);
});

test("devices を 2 回書いた設定は落ちる", () => {
  const text = [
    "schema: keysync/mac-keymap@1",
    "devices:",
    "  - { built_in: true }",
    "devices:",
    "  - { built_in: true }",
    'profile: "KeySync"',
    "layers:",
  ].join("\n");
  throws(() => parseMacKeymapYaml(text), MacKeymapParseError);
});

test("解釈できない devices の行は落ちる", () => {
  const text = [
    "schema: keysync/mac-keymap@1",
    "devices:",
    "  - { vendor_id: 1452 }",
    'profile: "KeySync"',
    "layers:",
  ].join("\n");
  throws(() => parseMacKeymapYaml(text), MacKeymapParseError);
});
