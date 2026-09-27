import { deepStrictEqual, ok, strictEqual, throws } from "node:assert/strict";
import { test } from "node:test";

import {
  addMacDevice,
  addMacLayer,
  clearMacAssignment,
  MacKeymapEditError,
  setMacAssignment,
  setMacFlowTapTerm,
  setMacTappingTerm,
} from "./edit.ts";
import { parseMacKeymapYaml } from "./parse.ts";
import { serializeMacKeymapYaml } from "./serialize.ts";
import { DEFAULT_MAC_DEVICES, type MacKeymapDocument } from "./types.ts";

function baseDocument(): MacKeymapDocument {
  return {
    layout: "jis",
    devices: DEFAULT_MAC_DEVICES,
    tappingTermMs: 200,
    flowTapTermMs: 0,
    layers: new Map([[0, new Map([["caps_lock", "LCTL_T(KC_ESC)"]])]]),
  };
}

test("setMacAssignmentは対象だけ差し替え、元のdocumentを壊さない", () => {
  const before = baseDocument();
  const after = setMacAssignment(before, 0, "a", "KC_HOME");

  strictEqual(after.layers.get(0)?.get("a"), "KC_HOME");
  strictEqual(after.layers.get(0)?.get("caps_lock"), "LCTL_T(KC_ESC)");
  // 元のdocumentは不変。
  strictEqual(before.layers.get(0)?.has("a"), false);
});

test("setMacAssignmentは無いlayerを作る", () => {
  const after = setMacAssignment(baseDocument(), 5, "q", "KC_NO");
  strictEqual(after.layers.get(5)?.get("q"), "KC_NO");
  // 既存layerはそのまま。
  strictEqual(after.layers.get(0)?.size, 1);
});

test("setMacAssignmentはkeycodeを正規化せず渡された表記のまま置く", () => {
  const after = setMacAssignment(baseDocument(), 0, "q", "KC_TRNS");
  strictEqual(after.layers.get(0)?.get("q"), "KC_TRNS");
});

test("setMacAssignmentは空文字と不正なlayerを拒む", () => {
  throws(() => setMacAssignment(baseDocument(), 0, "", "KC_A"), MacKeymapEditError);
  throws(() => setMacAssignment(baseDocument(), 0, "a", ""), MacKeymapEditError);
  throws(() => setMacAssignment(baseDocument(), -1, "a", "KC_A"), MacKeymapEditError);
  throws(() => setMacAssignment(baseDocument(), 0.5, "a", "KC_A"), MacKeymapEditError);
});

test("clearMacAssignmentは割り当てを外し、空になったlayerを残す", () => {
  const before = baseDocument();
  const after = clearMacAssignment(before, 0, "caps_lock");

  strictEqual(after.layers.get(0)?.size, 0);
  ok(after.layers.has(0));
  // 元のdocumentは不変。
  strictEqual(before.layers.get(0)?.size, 1);
});

test("clearMacAssignmentは無い割り当てに対して同じdocumentを返す", () => {
  const before = baseDocument();
  strictEqual(clearMacAssignment(before, 0, "q"), before);
  strictEqual(clearMacAssignment(before, 9, "q"), before);
});

test("addMacLayerは空layerを足し、既にあれば同じdocumentを返す", () => {
  const before = baseDocument();
  const after = addMacLayer(before, 3);

  strictEqual(after.layers.get(3)?.size, 0);
  strictEqual(addMacLayer(after, 3), after);
  strictEqual(addMacLayer(before, 0), before);
  throws(() => addMacLayer(before, -1), MacKeymapEditError);
});

test("空layerを含むdocumentはserialize→parseをround-tripする", () => {
  const document = addMacLayer(clearMacAssignment(baseDocument(), 0, "caps_lock"), 2);
  const reparsed = parseMacKeymapYaml(serializeMacKeymapYaml(document));

  deepStrictEqual([...reparsed.layers.keys()], [0, 2]);
  strictEqual(reparsed.layers.get(0)?.size, 0);
  strictEqual(reparsed.layers.get(2)?.size, 0);
});

test("addMacDevice は追加順のまま末尾へ足す", () => {
  const before = baseDocument();
  const after = addMacDevice(before, { vendorId: 1452, productId: 630 });
  deepStrictEqual(after.devices, [{ builtIn: true }, { vendorId: 1452, productId: 630 }]);
  deepStrictEqual(before.devices, DEFAULT_MAC_DEVICES, "入力は変えない");
});

test("addMacDevice は同じデバイスを二重に足さない", () => {
  const once = addMacDevice(baseDocument(), { vendorId: 1452, productId: 630 });
  strictEqual(addMacDevice(once, { vendorId: 1452, productId: 630 }), once);
  strictEqual(addMacDevice(once, { builtIn: true }), once);
});

test("addMacDevice は整数でない id を拒む", () => {
  throws(() => addMacDevice(baseDocument(), { vendorId: 1.5, productId: 1 }), MacKeymapEditError);
  throws(() => addMacDevice(baseDocument(), { vendorId: -1, productId: 1 }), MacKeymapEditError);
});

test("setMacTappingTerm は閾値を差し替え、元の document を壊さない", () => {
  const before = baseDocument();
  const after = setMacTappingTerm(before, 250);
  strictEqual(after.tappingTermMs, 250);
  strictEqual(before.tappingTermMs, 200, "入力は変えない");
  strictEqual(setMacTappingTerm(after, 250), after, "同じ値なら同じ document を返す");
});

test("setMacTappingTerm は範囲外と整数でない値を拒む", () => {
  for (const value of [49, 1001, 150.5, Number.NaN]) {
    throws(() => setMacTappingTerm(baseDocument(), value), MacKeymapEditError, String(value));
  }
});

test("setMacFlowTapTerm は閾値を差し替え、0 で無効にできる", () => {
  const before = baseDocument();
  const after = setMacFlowTapTerm(before, 130);
  strictEqual(after.flowTapTermMs, 130);
  strictEqual(before.flowTapTermMs, 0, "入力は変えない");
  strictEqual(setMacFlowTapTerm(after, 130), after, "同じ値なら同じ document を返す");
  strictEqual(setMacFlowTapTerm(after, 0).flowTapTermMs, 0);
});

test("setMacFlowTapTerm は範囲外と整数でない値を拒む", () => {
  for (const value of [-1, 1001, 130.5, Number.NaN]) {
    throws(() => setMacFlowTapTerm(baseDocument(), value), MacKeymapEditError, String(value));
  }
});
