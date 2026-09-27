import { ok, strictEqual } from "node:assert/strict";
import { test } from "node:test";

import { macPhysicalLayout } from "../core/mac-keymap/physical-layout.ts";
import { DEFAULT_MAC_DEVICES, type MacKeymapDocument } from "../core/mac-keymap/types.ts";
import { moveKey } from "./key-navigation.ts";
import { macBoardEntries, macLayerNumbers, nextMacLayer } from "./mac-board.ts";

function document(): MacKeymapDocument {
  return {
    layout: "jis",
    devices: DEFAULT_MAC_DEVICES,
    tappingTermMs: 200,
    profile: "KeySync",
    layers: new Map([
      [0, new Map([["caps_lock", "LCTL_T(KC_ESC)"]])],
      [3, new Map()],
    ]),
  };
}

test("盤面entryは物理配列の全キーを並べ、割り当てを重ねる", () => {
  const entries = macBoardEntries(document(), 0);
  strictEqual(entries.length, macPhysicalLayout("jis").length);

  const caps = entries.find((entry) => entry.keyCode === "caps_lock");
  strictEqual(caps?.keycode, "LCTL_T(KC_ESC)");
  // 書かれていないキーは素通し。
  const q = entries.find((entry) => entry.keyCode === "q");
  strictEqual(q?.keycode, undefined);
});

test("無いlayerでも盤面は全キー素通しで組める", () => {
  const entries = macBoardEntries(document(), 9);
  strictEqual(entries.length, macPhysicalLayout("jis").length);
  ok(entries.every((entry) => entry.keycode === undefined));
});

test("layer chipは疎な番号を昇順に並べ、+は末尾+1を作る", () => {
  strictEqual(macLayerNumbers(document()).join(","), "0,3");
  strictEqual(nextMacLayer(document()), 4);
  strictEqual(nextMacLayer({ ...document(), layers: new Map() }), 0);
});

test("盤面entryは幾何ベースの方向キー移動をそのまま通る", () => {
  const entries = macBoardEntries(document(), 0);
  const j = entries.find((entry) => entry.keyCode === "j");
  ok(j !== undefined);
  strictEqual(moveKey(entries, j, "ArrowRight")?.keyCode, "k");
  strictEqual(moveKey(entries, j, "ArrowLeft")?.keyCode, "h");
  strictEqual(moveKey(entries, j, "ArrowUp")?.keyCode, "u");
  // stagger により j の直下の最近傍は n（m ではない）。
  strictEqual(moveKey(entries, j, "ArrowDown")?.keyCode, "n");
});
