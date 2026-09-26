import { deepStrictEqual, ok, strictEqual, throws } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { KARABINER_POSITIONS } from "../mac-keymap/key-codes.ts";
import { diffKeydText, planLinuxApply, verifyLinuxApply } from "./apply.ts";
import { generateKeydConfig, keydDeviceId, linuxKeycodeSupport } from "./generate.ts";
import { KEYD_KEY_NAMES } from "./key-names.ts";
import { parseLinuxKeymapYaml } from "./parse.ts";
import { serializeLinuxKeymapYaml } from "./serialize.ts";
import { LinuxKeymapParseError, type LinuxKeymapDocument } from "./types.ts";
import { validateLinuxKeymap } from "./validate.ts";

const FIXTURES = join(import.meta.dirname, "../../../fixtures/linux-keyboard");
const readFixture = (name: string) => readFileSync(join(FIXTURES, name), "utf8");

function documentOf(layers: Record<number, Record<string, string>>): LinuxKeymapDocument {
  return {
    layout: "jis",
    devices: [{ vendorId: 0x05ac, productId: 0x027e }],
    layers: new Map(
      Object.entries(layers).map(([layer, assignments]) => [
        Number(layer),
        new Map(Object.entries(assignments)),
      ]),
    ),
  };
}

const codes = (document: LinuxKeymapDocument) =>
  validateLinuxKeymap(document).diagnostics.map((diagnostic) => diagnostic.code);

test("desired.yaml は round-trip する", () => {
  const text = readFixture("desired.yaml");
  const document = parseLinuxKeymapYaml(text);
  strictEqual(serializeLinuxKeymapYaml(document), text);
  deepStrictEqual(document.devices, [{ vendorId: 1452, productId: 638 }]);
});

test("layout・schema を省略した設定は読まない。推測できないので明示させる", () => {
  throws(
    () => parseLinuxKeymapYaml("schema: keysync/linux-keymap@1\nlayers:\n  0:\n"),
    LinuxKeymapParseError,
  );
  throws(() => parseLinuxKeymapYaml("layout: jis\nlayers:\n  0:\n"), LinuxKeymapParseError);
  throws(
    () => parseLinuxKeymapYaml("schema: keysync/mac-keymap@1\nlayout: jis\nlayers:\n"),
    LinuxKeymapParseError,
  );
});

test("Mac の内蔵指定（built_in）は Linux の設定では読まない", () => {
  throws(
    () =>
      parseLinuxKeymapYaml(
        "schema: keysync/linux-keymap@1\nlayout: jis\ndevices:\n  - { built_in: true }\nlayers:\n",
      ),
    LinuxKeymapParseError,
  );
});

test("desired.yaml から keyd の設定を生成する", () => {
  const document = parseLinuxKeymapYaml(readFixture("desired.yaml"));
  const generated = generateKeydConfig(document, "linux-keyboard.jis.yaml");
  deepStrictEqual(generated.diagnostics, []);
  strictEqual(generated.text, readFixture("keysync.conf"));
});

test("device id は 16 進 4 桁で k: を付ける", () => {
  strictEqual(keydDeviceId({ vendorId: 0x05ac, productId: 0x27e }), "k:05ac:027e");
});

test("MO / TG が指す layer は割り当てが無くても空の section を出す", () => {
  const { sections } = generateKeydConfig(documentOf({ 0: { caps_lock: "MO(4)" } }));
  deepStrictEqual(
    sections.map((section) => section.name),
    ["main", "layer4"],
  );
});

test("KC_TRNS と layer 0 と同値のキーは書かない", () => {
  const { sections } = generateKeydConfig(
    documentOf({ 0: { a: "KC_B", caps_lock: "MO(1)" }, 1: { a: "KC_B", s: "KC_TRNS" } }),
  );
  deepStrictEqual(sections[1]?.bindings, []);
});

test("mod-tap の hold 側は keyd の修飾 layer へ落とす", () => {
  const { sections } = generateKeydConfig(
    documentOf({
      0: { a: "RALT_T(KC_A)", s: "LGUI_T(KC_S)", d: "RCTL_T(KC_D)", f: "LSFT_T(KC_F)" },
    }),
  );
  deepStrictEqual(sections[0]?.bindings, [
    ["a", "overload(altgr, a)"],
    ["d", "overload(control, d)"],
    ["f", "overload(shift, f)"],
    ["s", "overload(meta, s)"],
  ]);
});

test("Linux で同じキーになる位置を同じ layer に書くと error", () => {
  deepStrictEqual(
    codes(documentOf({ 0: { backslash: "KC_A", non_us_pound: "KC_B" } })).filter((code) =>
      code.endsWith("collision"),
    ),
    ["linux-keymap/position-collision"],
  );
});

test("Linux に無い位置は error、語彙に無い位置は unknown-position だけを出す", () => {
  deepStrictEqual(codes(documentOf({ 0: { international7: "KC_A" } })), [
    "linux-keymap/unsupported-position",
  ]);
  deepStrictEqual(codes(documentOf({ 0: { nonsense: "KC_A" } })), [
    "linux-keymap/unknown-position",
  ]);
});

test("devices が空なら error", () => {
  ok(codes({ ...documentOf({ 0: {} }), devices: [] }).includes("linux-keymap/no-target-device"));
});

test("layer 0 への切り替え・修飾付き keycode・複合 mod-tap は keyd へ落とせない", () => {
  strictEqual(linuxKeycodeSupport("MO(0)").ok, false);
  strictEqual(linuxKeycodeSupport("SGUI_T(KC_S)").ok, false);
  strictEqual(linuxKeycodeSupport("LCTL(KC_A)").ok, false);
  strictEqual(linuxKeycodeSupport("LT2(KC_SPC)").ok, true);
  strictEqual(linuxKeycodeSupport("KC_LANG2").ok, true);
});

test("international7〜9 を除く Karabiner の位置はすべて keyd の名前を持つ", () => {
  const missing = [...KARABINER_POSITIONS].filter((name) => !KEYD_KEY_NAMES.has(name)).sort();
  deepStrictEqual(missing, ["international7", "international8", "international9"]);
});

test("計画は section とキーの単位で差分を出し、同じ内容なら変更なし", () => {
  const document = parseLinuxKeymapYaml(readFixture("desired.yaml"));
  const fresh = planLinuxApply(undefined, document, "linux-keyboard.jis.yaml");
  strictEqual(fresh.present, false);
  strictEqual(fresh.changed, true);
  ok(fresh.entries.some((entry) => entry.section === "ids" && entry.key === "k:05ac:027e"));

  const same = planLinuxApply(fresh.text, document, "linux-keyboard.jis.yaml");
  strictEqual(same.changed, false);
  deepStrictEqual(same.entries, []);
  strictEqual(same.fingerprint, fresh.fingerprint);
  ok(verifyLinuxApply(fresh.text, same.text));
});

test("diffKeydText は変更・追加・削除を分ける", () => {
  deepStrictEqual(diffKeydText("[main]\na = b\nc = d\n", "[main]\na = x\ne = f\n"), [
    { section: "main", key: "a", change: "changed", before: "b", after: "x" },
    { section: "main", key: "c", change: "removed", before: "d" },
    { section: "main", key: "e", change: "added", after: "f" },
  ]);
});
