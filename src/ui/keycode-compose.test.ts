import assert from "node:assert/strict";
import test from "node:test";
import {
  applyPick,
  canPick,
  composeKeycode,
  macBehaviorOptions,
  structuredValues,
  targetValue,
} from "./keycode-compose.ts";

test("applyPick replaces the whole keycode", () => {
  assert.equal(applyPick("LSFT_T(KC_SPACE)", "whole", "KC_ENTER"), "KC_ENTER");
});

test("applyPick preserves modifier and layer-tap wrappers for Tap", () => {
  assert.equal(applyPick("LSFT(KC_SPACE)", "tap", "KC_ENTER"), "LSFT(KC_ENTER)");
  assert.equal(applyPick("LCTL_T(KC_SPACE)", "tap", "KC_ENTER"), "LCTL_T(KC_ENTER)");
  assert.equal(applyPick("LT1(KC_SPACE)", "tap", "KC_ENTER"), "LT1(KC_ENTER)");
  assert.equal(applyPick("KC_SPACE", "tap", "KC_ENTER"), "KC_ENTER");
});

test("applyPick creates a vial-style mod-tap for Hold", () => {
  assert.equal(applyPick("KC_A", "hold", "KC_LCTRL"), "LCTL_T(KC_A)");
  assert.equal(applyPick("LSFT_T(KC_SPACE)", "hold", "KC_RGUI"), "RGUI_T(KC_SPACE)");
  assert.equal(applyPick("LT1(KC_SPACE)", "hold", "KC_LSHIFT"), "LSFT_T(KC_SPACE)");
});

test("hold accepts the eight modifier keycodes and MO(n)", () => {
  for (const keycode of [
    "KC_LCTRL",
    "KC_LSHIFT",
    "KC_LALT",
    "KC_LGUI",
    "KC_RCTRL",
    "KC_RSHIFT",
    "KC_RALT",
    "KC_RGUI",
  ]) {
    assert.equal(canPick("hold", keycode), true);
  }
  assert.equal(canPick("hold", "KC_A"), false);
  assert.equal(canPick("hold", "MO(2)"), true);
  assert.equal(canPick("hold", "TG(1)"), false);
  assert.equal(canPick("tap", "KC_A"), true);
});

test("composeKeycode preserves existing modifier and layer forms", () => {
  assert.equal(composeKeycode("modified", structuredValues("LALT(KC_A)")), "LALT(KC_A)");
  assert.equal(composeKeycode("modTap", structuredValues("RGUI_T(KC_B)")), "RGUI_T(KC_B)");
  assert.equal(composeKeycode("layerSwitch", structuredValues("LT2(KC_A)")), "LT2(KC_A)");
  assert.equal(composeKeycode("layerSwitch", structuredValues("MO(3)")), "MO(3)");
  assert.equal(composeKeycode("layerSwitch", structuredValues("TG(4)")), "TG(4)");
});

test("Macの動作選択肢は落とせるものだけ。既存の非対応値は残す", () => {
  assert.deepEqual(macBehaviorOptions("basic"), [
    "basic",
    "modified",
    "modTap",
    "layerSwitch",
    "none",
  ]);
  assert.deepEqual(macBehaviorOptions("tapDance"), [
    "basic",
    "modified",
    "modTap",
    "layerSwitch",
    "none",
    "tapDance",
  ]);
});

test("Hold で MO(n) を選ぶと LTn(tap) になる", () => {
  assert.equal(applyPick("KC_A", "hold", "MO(2)"), "LT2(KC_A)");
  assert.equal(applyPick("LT1(KC_B)", "hold", "MO(3)"), "LT3(KC_B)");
  assert.equal(applyPick("LSFT_T(KC_SPACE)", "hold", "MO(1)"), "LT1(KC_SPACE)");
  assert.equal(applyPick("KC_A", "hold", "TG(1)"), "KC_A");
});

test("LT の Hold の現在値は MO(n) として扱う", () => {
  assert.equal(targetValue("LT2(KC_A)", "hold"), "MO(2)");
  assert.equal(targetValue("LT2(KC_A)", "tap"), "KC_A");
  assert.equal(targetValue("LCTL_T(KC_A)", "hold"), "KC_LCTRL");
});
