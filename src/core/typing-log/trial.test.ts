import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { test } from "node:test";
import { gradeTypingTrial } from "../typing-trial/grade.ts";
import { customTask } from "../typing-trial/tasks.ts";
import { splitAtReturn, typedEventsFromHid } from "./trial.ts";
import type { HidLogEvent } from "./types.ts";

const USAGE = {
  a: 4,
  k: 14,
  u: 24,
  space: 0x2c,
  one: 0x1e,
  ret: 0x28,
  lshift: 0xe1,
  lalt: 0xe2,
  lcmd: 0xe3,
};

function hid(ms: number, usage: number, down: boolean): HidLogEvent {
  return { type: "hid", ns: ms * 1_000_000, usage, down, device: "Karabiner" };
}

test("HID の出力を文字と chord の打鍵へ変え、そのまま採点できる", () => {
  const events = [
    hid(0, USAGE.k, true),
    hid(4, USAGE.k, false),
    hid(10, USAGE.lalt, true),
    hid(20, USAGE.a, true),
    hid(30, USAGE.a, false),
    hid(40, USAGE.lalt, false),
    hid(50, USAGE.space, true),
    hid(54, USAGE.space, false),
    hid(60, USAGE.lshift, true),
    hid(70, USAGE.u, true),
    hid(80, USAGE.lshift, false),
    hid(90, USAGE.one, true),
  ];
  const typed = typedEventsFromHid(events);
  deepStrictEqual(
    typed.map((one) => [one.key, one.code, one.alt, one.shift]),
    [
      ["k", "KeyK", false, false],
      ["a", "KeyA", true, false],
      [" ", "Space", false, false],
      ["U", "KeyU", false, true],
      ["1", "Digit1", false, false],
    ],
  );
  const grade = gradeTypingTrial(customTask("kka U1"), typed);
  if (grade.kind !== "graded") throw new Error("採点されていない");
  strictEqual(grade.summary.misfire, 1);
});

test("Return の押下ごとに区切り、Return は区間の最後に入る", () => {
  const { segments, rest } = splitAtReturn([
    hid(0, USAGE.k, true),
    hid(4, USAGE.k, false),
    hid(10, USAGE.ret, true),
    hid(14, USAGE.ret, false),
    hid(20, USAGE.a, true),
    hid(30, USAGE.ret, true),
    hid(40, USAGE.u, true),
  ]);
  deepStrictEqual(
    segments.map((segment) => segment.map((one) => one.usage)),
    [
      [USAGE.k, USAGE.k, USAGE.ret],
      [USAGE.a, USAGE.ret],
    ],
  );
  deepStrictEqual(
    rest.map((one) => one.usage),
    [USAGE.u],
  );
});

test("区切った区間の Return は採点で捨てられる", () => {
  const { segments } = splitAtReturn([hid(0, USAGE.a, true), hid(10, USAGE.ret, true)]);
  const grade = gradeTypingTrial(customTask("a"), typedEventsFromHid(segments[0] ?? []));
  if (grade.kind !== "graded") throw new Error("採点されていない");
  strictEqual(grade.summary.ok, 1);
  strictEqual(grade.summary.extra, 0);
});
