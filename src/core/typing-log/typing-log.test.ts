import { deepStrictEqual, strictEqual, throws } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { DEFAULT_MAC_DEVICES, type MacKeymapDocument } from "../mac-keymap/types.ts";
import { analyzeModTapOutput } from "./analyze.ts";
import { KeyLogParseError, keyLogPath, parseKeyLog, serializeKeyLog } from "./format.ts";
import { hidUsageName } from "./hid-usage.ts";
import type { HidLogEvent, KeyLogMeta } from "./types.ts";

const FIXTURE = join(import.meta.dirname, "../../../fixtures/typing-log/r-009-kakikukeko.jsonl");

/** 利用者の MacBook（ANSI）と同じ mod-tap の配置。 */
const DOCUMENT: MacKeymapDocument = {
  layout: "ansi",
  devices: DEFAULT_MAC_DEVICES,
  tappingTermMs: 200,
  profile: "KeySync",
  layers: new Map([
    [
      0,
      new Map([
        ["s", "SGUI_T(KC_S)"],
        ["d", "LALT_T(KC_D)"],
        ["f", "LGUI_T(KC_F)"],
        ["h", "RCTL_T(KC_H)"],
        ["j", "RGUI_T(KC_J)"],
        ["k", "RALT_T(KC_K)"],
        ["spacebar", "LGUI_T(KC_SPACE)"],
      ]),
    ],
  ]),
};

const MS = 1_000_000;
const USAGE = { a: 4, f: 9, h: 11, k: 14, s: 22, u: 24, leftShift: 0xe1, leftCommand: 0xe3 };

function hid(ms: number, usage: number, down: boolean): HidLogEvent {
  return { type: "hid", ns: Math.round(ms * MS), usage, down, device: "Karabiner" };
}

test("実測（R-009）の 21 打鍵では、k・h・space の tap はすべて離してから次を押したもの", () => {
  const { events } = parseKeyLog(readFileSync(FIXTURE, "utf8"));
  const result = analyzeModTapOutput(events, DOCUMENT);
  deepStrictEqual(
    result.taps.map((one) => [one.position, one.alone, one.roll, one.passthrough]),
    [
      ["h", 5, 0, 0],
      ["k", 5, 0, 0],
      ["spacebar", 1, 0, 0],
    ],
  );
  strictEqual(result.holds.length, 0);
  strictEqual(result.intervalsMs.count, 20);
});

test("tap の離しの直後に次の押下が続けば、ロールとみなす", () => {
  const result = analyzeModTapOutput(
    [
      hid(0, USAGE.k, true),
      hid(4, USAGE.k, false),
      hid(4.5, USAGE.a, true),
      hid(80, USAGE.a, false),
    ],
    DOCUMENT,
  );
  deepStrictEqual(result.taps[0], {
    position: "k",
    tapKey: "k",
    alone: 0,
    roll: 1,
    passthrough: 0,
  });
});

test("次の押下が tap の離しより前に来ても、ロールとみなす", () => {
  const result = analyzeModTapOutput(
    [hid(0, USAGE.k, true), hid(1, USAGE.a, true), hid(4, USAGE.k, false), hid(80, USAGE.a, false)],
    DOCUMENT,
  );
  strictEqual(result.taps[0]?.roll, 1);
});

test("打鍵どおりの長さで出た tap 側のキーは、合成された tap に数えない", () => {
  const result = analyzeModTapOutput([hid(0, USAGE.k, true), hid(90, USAGE.k, false)], DOCUMENT);
  strictEqual(result.taps[0]?.passthrough, 1);
});

test("同時に出た修飾キーは 1 組の hold で、押している間のキーを chord として持つ", () => {
  const result = analyzeModTapOutput(
    [
      hid(0, USAGE.leftShift, true),
      hid(0.5, USAGE.leftCommand, true),
      hid(120, USAGE.u, true),
      hid(180, USAGE.u, false),
      hid(300, USAGE.leftCommand, false),
      hid(300.5, USAGE.leftShift, false),
    ],
    DOCUMENT,
  );
  deepStrictEqual(result.holds, [
    {
      ns: 0,
      modifiers: ["left_command", "left_shift"],
      candidates: ["s"],
      chords: ["u"],
      durationMs: 300.5,
    },
  ]);
});

test("同じ修飾キーを持つ mod-tap が複数あれば、候補に全部を挙げる", () => {
  const result = analyzeModTapOutput(
    [hid(0, USAGE.leftCommand, true), hid(200, USAGE.leftCommand, false)],
    DOCUMENT,
  );
  deepStrictEqual(result.holds[0]?.candidates, ["f", "spacebar"]);
  deepStrictEqual(result.holds[0]?.chords, []);
});

test("usage は Karabiner の key_code 名になり、表に無いものは 16 進で残す", () => {
  strictEqual(hidUsageName(4), "a");
  strictEqual(hidUsageName(0x2c), "spacebar");
  strictEqual(hidUsageName(0x90), "japanese_kana");
  strictEqual(hidUsageName(0xe7), "right_command");
  strictEqual(hidUsageName(0xa5), "usage_0xa5");
});

test("ログは JSON Lines で round-trip し、ファイル名は時刻順に並ぶ", () => {
  const meta: KeyLogMeta = {
    type: "meta",
    recorder: "cli",
    startedAt: "2026-09-27T01:02:03.456Z",
    layout: "ansi",
    tappingTermMs: null,
    originNs: "123",
  };
  const events = [hid(0, USAGE.a, true)];
  deepStrictEqual(parseKeyLog(serializeKeyLog(meta, events)), { meta, events });
  strictEqual(
    keyLogPath(new Date("2026-09-27T01:02:03.456Z"), "cli"),
    "keysync/typing-logs/2026-09-27T01-02-03-456Z-cli.jsonl",
  );
});

test("meta で始まらないログと、未対応の type の行は読まずに落ちる", () => {
  throws(() => parseKeyLog('{"type":"hid"}\n'), KeyLogParseError);
  throws(() => parseKeyLog('{"type":"meta"}\n{"type":"mouse"}\n'), KeyLogParseError);
  throws(() => parseKeyLog('{"type":"meta"}\nnot json\n'), KeyLogParseError);
});
