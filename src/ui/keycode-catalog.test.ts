import assert from "node:assert/strict";
import test from "node:test";
import { macKeycodeSupport } from "../core/mac-keymap/kanata/generate.ts";
import { isKnownKeycode } from "../core/validation/keycode-vocabulary.ts";
import {
  EXTRA_ROW,
  ISO_JIS_ROWS,
  labeledKeyUnits,
  layerPickerRows,
  MEDIA_ROWS,
  PICKER_GROUP_OFFSETS,
  PICKER_LABEL_UNITS,
  PICKER_TOTAL_UNITS,
  SPECIAL_ROWS,
  type PickerEntry,
  type PickerLabeledRow,
} from "./keycode-catalog.ts";

function entries(): PickerEntry[] {
  return [
    ...ISO_JIS_ROWS.flatMap((row) => [...row.main, ...(row.nav ?? []), ...(row.numpad ?? [])]),
    ...EXTRA_ROW,
  ];
}

function units(entriesToMeasure: readonly PickerEntry[]): number {
  return entriesToMeasure.reduce((total, entry) => total + (entry.u ?? 1), 0);
}

test("ISO/JIS picker contains only known, unique keycodes", () => {
  const keycodes = entries()
    .filter(
      (entry): entry is Extract<PickerEntry, { readonly keycode: string }> => "keycode" in entry,
    )
    .map((entry) => entry.keycode);
  assert.equal(new Set(keycodes).size, keycodes.length);
  for (const keycode of keycodes) assert.equal(isKnownKeycode(keycode), true, keycode);
});

test("ISO/JIS main rows preserve their intended physical widths", () => {
  assert.deepEqual(
    ISO_JIS_ROWS.map((row) => units(row.main)),
    [16, 16, 16, 16, 16, 16],
  );
  assert.deepEqual(
    ISO_JIS_ROWS.map((row) => units(row.nav ?? [])),
    [3, 3, 3, 0, 3, 3],
  );
  assert.deepEqual(
    ISO_JIS_ROWS.map((row) => units(row.numpad ?? [])),
    [0, 4, 4, 4, 4, 4],
  );
  assert.equal(units(EXTRA_ROW), 26);
});

test("picker groups use fixed 26u coordinates", () => {
  assert.deepEqual(PICKER_GROUP_OFFSETS, { main: 0, nav: 18, numpad: 22 });
  assert.equal(PICKER_TOTAL_UNITS, 26);
});

test("EXTRA_ROWのshift済み記号はmacKeycodeSupportが受け付ける", () => {
  // shift 済み keycode は base の key_code + left_shift で落ちる（ADR 0043）。
  const unsupported = EXTRA_ROW.flatMap((entry) =>
    "keycode" in entry && !macKeycodeSupport(entry.keycode).ok ? [entry.keycode] : [],
  );
  assert.deepEqual(unsupported, []);
});

function keycodesOf(rows: readonly PickerLabeledRow[]): string[] {
  return rows.flatMap((row) => row.keycodes);
}

test("メディア・マウスと特殊タブは既知で重複の無い keycode だけを 26u 以内に並べる", () => {
  for (const rows of [MEDIA_ROWS, SPECIAL_ROWS]) {
    const keycodes = keycodesOf(rows);
    assert.equal(new Set(keycodes).size, keycodes.length);
    for (const keycode of keycodes) assert.equal(isKnownKeycode(keycode), true, keycode);
    const longest = Math.max(...rows.map((row) => row.keycodes.length));
    assert.ok(PICKER_LABEL_UNITS + longest * labeledKeyUnits(rows) <= PICKER_TOTAL_UNITS);
  }
});

test("基本以外のタブは基本タブの行数（物理配列 6 行と記号の帯）に収める", () => {
  for (const rows of [MEDIA_ROWS, SPECIAL_ROWS, layerPickerRows([0])]) {
    assert.ok(rows.length <= ISO_JIS_ROWS.length + 1);
  }
});

test("列を揃える keycode の幅は 2u を上限に、長い行が 26u に収まるまで縮める", () => {
  assert.equal(labeledKeyUnits(layerPickerRows(range(10))), 2);
  assert.equal(
    labeledKeyUnits(layerPickerRows(range(16))),
    (PICKER_TOTAL_UNITS - PICKER_LABEL_UNITS) / 16,
  );
});

function range(length: number): number[] {
  return Array.from({ length }, (_, index) => index);
}

test("picker は bootloader 移行や EEPROM 消去を起こす keycode を置かない", () => {
  const all = [
    ...entries().flatMap((entry) => ("keycode" in entry ? [entry.keycode] : [])),
    ...keycodesOf(MEDIA_ROWS),
    ...keycodesOf(SPECIAL_ROWS),
  ];
  for (const dangerous of ["RESET", "QK_BOOT", "EE_CLR", "DEBUG", "DB_TOGG"]) {
    assert.ok(!all.includes(dangerous), dangerous);
  }
});

test("レイヤータブは layer 操作ごとに渡された layer 番号を並べる", () => {
  const rows = layerPickerRows([0, 2]);
  assert.deepEqual(
    rows.map((row) => row.label),
    ["MO", "TG", "TT", "TO", "DF", "OSL"],
  );
  assert.deepEqual(rows[0]?.keycodes, ["MO(0)", "MO(2)"]);
  assert.deepEqual(rows[5]?.keycodes, ["OSL(0)", "OSL(2)"]);
  for (const keycode of keycodesOf(rows)) assert.equal(isKnownKeycode(keycode), true, keycode);
});
