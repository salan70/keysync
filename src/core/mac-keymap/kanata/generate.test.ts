/**
 * kanata の生成器の検証。
 *
 * 判定の写像（ADR 0049）を固定する。生成物を kanata が読めることは、kanata が PATH にある
 * 開発機でだけ `kanata --check` で確かめる。CI の runner には kanata が無い。
 */

import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DEFAULT_MAC_DEVICES, type MacKeyboardLayout, type MacKeymapDocument } from "../types.ts";
import { deviceNames, generateKanataConfig, macKeycodeSupport } from "./generate.ts";
import { KANATA_KEY_NAMES } from "./key-names.ts";

function documentOf(
  layers: readonly Record<string, string>[],
  options: {
    readonly layout?: MacKeyboardLayout;
    readonly tappingTermMs?: number;
    readonly flowTapTermMs?: number;
  } = {},
): MacKeymapDocument {
  return {
    layout: options.layout ?? "ansi",
    devices: DEFAULT_MAC_DEVICES,
    tappingTermMs: options.tappingTermMs ?? 180,
    flowTapTermMs: options.flowTapTermMs ?? 130,
    layers: new Map(
      layers.map((assignments, layer) => [layer, new Map(Object.entries(assignments))]),
    ),
  };
}

/** layer 名 → その layer の行（`キー action`）。 */
function bindings(text: string): ReadonlyMap<string, readonly string[]> {
  const layers = new Map<string, string[]>();
  let current: string[] | undefined;
  for (const line of text.split("\n")) {
    const header = /^\(deflayermap \((.+)\)$/.exec(line);
    if (header?.[1] !== undefined) {
      current = [];
      layers.set(header[1], current);
      continue;
    }
    if (line === ")") current = undefined;
    else if (current !== undefined) current.push(line.trim());
  }
  return layers;
}

/** 利用者の MacBook（ANSI）と同じ割り当て（R-010 の `keysync.kbd` の元）。 */
const USER = documentOf([
  {
    caps_lock: "MO(2)",
    d: "LALT_T(KC_D)",
    f: "LGUI_T(KC_F)",
    left_shift: "LSFT_T(KC_LANG1)",
    l: "SGUI_T(KC_L)",
    quote: "LSFT(KC_1)",
    return_or_enter: "RGUI_T(KC_ENTER)",
    spacebar: "LGUI_T(KC_SPACE)",
  },
  {},
  { h: "LCTL(KC_A)", i: "C_S(KC_TAB)", k: "LGUI(KC_LBRACKET)" },
]);

test("home mod は反対の手の Permissive Hold と Chordal Hold、閾値を過ぎたら hold", () => {
  const base = bindings(generateKanataConfig(USER).text).get("base") ?? [];
  strictEqual(
    base.includes("d (tap-hold-opposite-hand-release $tapping-term d lalt (timeout hold))"),
    true,
  );
  strictEqual(
    base.includes(
      "l (tap-hold-opposite-hand-release $tapping-term l (multi lsft lmet) (timeout hold))",
    ),
    true,
  );
  strictEqual(
    base.includes("spc (tap-hold-opposite-hand-release $tapping-term spc lmet (timeout hold))"),
    true,
  );
});

test("Shift だけの mod-tap は手を問わない Permissive Hold で、Flow Tap から外す", () => {
  const base = bindings(generateKanataConfig(USER).text).get("base") ?? [];
  strictEqual(
    base.includes("lsft (tap-hold-release 0 $tapping-term kana lsft (require-prior-idle 0))"),
    true,
  );
});

test("tap 側が文字でない mod-tap は Flow Tap から外す", () => {
  // QMK の Flow Tap は tap 側が文字キーのときだけ効く（ADR 0047）。
  const base = bindings(generateKanataConfig(USER).text).get("base") ?? [];
  strictEqual(
    base.includes(
      "ret (tap-hold-opposite-hand-release $tapping-term ret rmet (timeout hold) (require-prior-idle 0))",
    ),
    true,
  );
});

test("Flow Tap と閾値は defcfg と defvar に 1 回だけ書く", () => {
  const { text } = generateKanataConfig(USER);
  strictEqual(text.includes("  tap-hold-require-prior-idle 130\n"), true);
  strictEqual(text.includes("(defvar tapping-term 180)\n"), true);
  const off = generateKanataConfig({ ...USER, flowTapTermMs: 0 }).text;
  strictEqual(off.includes("require-prior-idle"), false, "Flow Tap が無効なら option も出さない");
});

test("layer 1 以上は書かれていないキーを割り当てなしにし、MO が指す空の layer も出す", () => {
  const layers = bindings(generateKanataConfig(USER).text);
  deepStrictEqual(layers.get("l1"), ["___ XX"]);
  deepStrictEqual(layers.get("l2"), ["h C-a", "i C-S-tab", "k M-lbrc", "___ XX"]);
  deepStrictEqual([...layers.keys()], ["base", "l1", "l2"]);
});

test("内蔵キーボードは固定の名前、外付けは宣言した名前で指す", () => {
  const { text } = generateKanataConfig(USER);
  strictEqual(
    text.includes('  macos-dev-names-include ("Apple Internal Keyboard / Trackpad")\n'),
    true,
  );
  const external = generateKanataConfig({
    ...USER,
    devices: [{ builtIn: true }, { name: "Magic Keyboard" }],
  });
  deepStrictEqual(external.diagnostics, []);
  strictEqual(
    external.text.includes(
      '  macos-dev-names-include ("Apple Internal Keyboard / Trackpad" "Magic Keyboard")\n',
    ),
    true,
  );
});

test("同じデバイスを指す名前は 1 つにまとめる", () => {
  deepStrictEqual(
    deviceNames([{ builtIn: true }, { name: "Apple Internal Keyboard / Trackpad" }]),
    ["Apple Internal Keyboard / Trackpad"],
  );
});

test("layer 0 と同値のキーも上の layer に書く", () => {
  const layers = bindings(generateKanataConfig(documentOf([{ a: "KC_B" }, { a: "KC_B" }])).text);
  deepStrictEqual(layers.get("l1"), ["a b", "___ XX"]);
});

test("KC_TRNS は layer 1 以上で下の layer へ落とし、layer 0 では書かない", () => {
  const layers = bindings(
    generateKanataConfig(documentOf([{ a: "KC_TRNS" }, { a: "KC_TRNS" }])).text,
  );
  deepStrictEqual(layers.get("base"), []);
  deepStrictEqual(layers.get("l1"), ["a _", "___ XX"]);
});

test("macKeycodeSupport は落とせる keycode を ok にする", () => {
  for (const keycode of [
    "KC_A",
    "KC_TRNS",
    "KC_NO",
    "MO(1)",
    "LT1(KC_SPACE)",
    "LCTL_T(KC_TAB)",
    "LSFT(KC_1)",
    "KC_EXLM",
    "SGUI_T(KC_S)",
    "KC_LANG1",
  ]) {
    strictEqual(macKeycodeSupport(keycode).ok, true, keycode);
  }
});

test("macKeycodeSupport は落とせない keycode に診断の code を付ける", () => {
  const cases: readonly (readonly [string, string])[] = [
    ["TG(2)", "mac-keymap/unsupported-keycode"],
    ["LSFT(M(0))", "mac-keymap/unsupported-keycode"],
    ["TD(0)", "mac-keymap/unsupported-keycode"],
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
  for (const keycode of ["KC_A", "TG(2)", "LT1(KC_SPACE)", "TD(0)", "KC_EXLM", "USER00"]) {
    const { diagnostics } = generateKanataConfig(documentOf([{ spacebar: keycode }]));
    const hasError = diagnostics.some((diagnostic) => diagnostic.severity === "error");
    strictEqual(macKeycodeSupport(keycode).ok, !hasError, keycode);
  }
});

/** kanata が PATH にあれば、その path。 */
function kanata(): string | undefined {
  for (const candidate of ["kanata", "/opt/homebrew/bin/kanata"]) {
    try {
      execFileSync(candidate, ["--version"], { stdio: "ignore" });
      return candidate;
    } catch {
      // 次の候補を試す。
    }
  }
  return undefined;
}

function check(binary: string, text: string): void {
  const path = join(mkdtempSync(join(tmpdir(), "keysync-kanata-")), "check.kbd");
  writeFileSync(path, text);
  execFileSync(binary, ["--cfg", path, "--check"], { stdio: "pipe" });
}

const binary = kanata();

test("生成物は kanata --check を通る", { skip: binary === undefined }, () => {
  if (binary === undefined) return;
  check(binary, generateKanataConfig(USER).text);
  check(binary, generateKanataConfig(USER, "mac-keyboard.jis.yaml").text);
});

test("キー名の表はすべて kanata が読める", { skip: binary === undefined }, () => {
  if (binary === undefined) return;
  // 位置として全キーを layer 1 へ書き、kanata に読ませる。
  const keycodes = [...KANATA_KEY_NAMES.keys()].map((keyCode) => [keyCode, "KC_NO"]);
  check(binary, generateKanataConfig(documentOf([{}, Object.fromEntries(keycodes)])).text);
});
