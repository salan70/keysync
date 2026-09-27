import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_MAC_DEVICES, type MacKeymapDocument } from "../mac-keymap/types.ts";
import { HOLD_REPEAT, holdTasksFor, ROLL_TASKS } from "./tasks.ts";

const NONE = { meta: false, ctrl: false, alt: false, shift: false };

function documentOf(layer0: Record<string, string>): MacKeymapDocument {
  return {
    layout: "ansi",
    devices: DEFAULT_MAC_DEVICES,
    tappingTermMs: 200,
    profile: "KeySync",
    layers: new Map([[0, new Map(Object.entries(layer0))]]),
  };
}

test("既定のロール集は期待が本文の 1 文字ずつ", () => {
  for (const task of ROLL_TASKS) {
    if (task.kind !== "text") throw new Error("text 課題のはず");
    strictEqual(task.expected.length, [...task.text].length);
  }
});

test("左手の mod-tap は右手の文字と chord になる", () => {
  const [task] = holdTasksFor(documentOf({ f: "LGUI_T(KC_F)" }));
  strictEqual(task?.kind, "hold");
  if (task?.kind !== "hold") return;
  strictEqual(task.partner, "u");
  strictEqual(task.expected.length, HOLD_REPEAT);
  deepStrictEqual(task.expected[0], {
    kind: "chord",
    modifiers: { ...NONE, meta: true },
    key: "u",
  });
});

test("右手の mod-tap は左手の文字と chord になり、複合 modifier も揃う", () => {
  const [task] = holdTasksFor(documentOf({ l: "SGUI_T(KC_L)" }));
  if (task?.kind !== "hold") throw new Error("hold 課題のはず");
  strictEqual(task.partner, "e");
  deepStrictEqual(task.expected[0], {
    kind: "chord",
    modifiers: { ...NONE, meta: true, shift: true },
    key: "e",
  });
});

test("Shift だけの mod-tap は大文字を期待する", () => {
  const [task] = holdTasksFor(documentOf({ left_shift: "LSFT_T(KC_LANG1)" }));
  deepStrictEqual(task?.expected[0], { kind: "char", char: "U" });
});

test("割り当てのある文字は相手に選ばない", () => {
  const [task] = holdTasksFor(documentOf({ f: "LGUI_T(KC_F)", u: "KC_BSPACE" }));
  if (task?.kind !== "hold") throw new Error("hold 課題のはず");
  strictEqual(task.partner, "i");
});

test("mod-tap が無ければ hold 課題は無い", () => {
  deepStrictEqual(holdTasksFor(documentOf({ a: "KC_B", caps_lock: "MO(1)" })), []);
});
