import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { test } from "node:test";
import { gradeTypingTrial, type TrialGrade } from "./grade.ts";
import { customTask } from "./tasks.ts";
import type { TrialToken, TypedEvent, TypingTask } from "./types.ts";

const NONE = { meta: false, ctrl: false, alt: false, shift: false };

/** 修飾キーの無い文字の打鍵列。 */
function typed(text: string): TypedEvent[] {
  return [...text].map((char) => ({
    ...NONE,
    key: char,
    code: /[a-z]/.test(char) ? `Key${char.toUpperCase()}` : char === " " ? "Space" : char,
    composing: false,
  }));
}

function chord(key: string, modifiers: Partial<typeof NONE>): TypedEvent {
  return { ...NONE, ...modifiers, key, code: `Key${key.toUpperCase()}`, composing: false };
}

function graded(grade: TrialGrade) {
  if (grade.kind !== "graded") throw new Error("採点されていない");
  return grade;
}

test("そのまま打てば全部 ok", () => {
  const { summary } = graded(gradeTypingTrial(customTask("kaki"), typed("kaki")));
  strictEqual(summary.ok, 4);
  strictEqual(summary.misfire, 0);
});

test("前の文字が修飾キーになった chord は、組の誤爆 1 件として数える", () => {
  // k↓ a↓ k↑ で ⌥A が出た。k は消え、a は chord になる。
  const { entries, summary } = graded(
    gradeTypingTrial(customTask("kaki"), [chord("a", { alt: true }), ...typed("ki")]),
  );
  strictEqual(summary.misfire, 1);
  strictEqual(summary.dropped, 0);
  strictEqual(summary.ok, 2);
  deepStrictEqual(summary.misfirePairs, [["ka", 1]]);
  strictEqual(entries[0]?.kind, "misfire");
});

test("Option で文字化けしても chord の key は code から取る", () => {
  const event: TypedEvent = { ...NONE, alt: true, key: "å", code: "KeyA", composing: false };
  const { summary } = graded(gradeTypingTrial(customTask("ha"), [event]));
  deepStrictEqual(summary.misfirePairs, [["ha", 1]]);
});

test("文字が消えたら dropped", () => {
  const { summary } = graded(gradeTypingTrial(customTask("df"), typed("f")));
  strictEqual(summary.dropped, 1);
  strictEqual(summary.ok, 1);
});

test("打ち終える前に採点したら、末尾の未入力は数えない", () => {
  const { entries, summary } = graded(gradeTypingTrial(customTask("kakikukeko"), typed("kaki")));
  strictEqual(summary.expected, 4);
  strictEqual(summary.ok, 4);
  strictEqual(summary.dropped, 0);
  strictEqual(summary.unfinished, 6);
  strictEqual(entries.length, 4);
});

test("途中の脱落は末尾の未入力と区別して数える", () => {
  const { summary } = graded(gradeTypingTrial(customTask("dfjk"), typed("fj")));
  strictEqual(summary.dropped, 1);
  strictEqual(summary.unfinished, 1);
});

test("打ち終える前の組の誤爆は、先頭の組に整列する（遠くの同じ母音へずらさない）", () => {
  const { summary } = graded(
    gradeTypingTrial(customTask("kakikukeko gagigugego"), [
      ...typed("k"),
      chord("a", { alt: true }),
      ...typed("ki"),
    ]),
  );
  strictEqual(summary.ok, 3);
  strictEqual(summary.misfire, 1);
  strictEqual(summary.dropped, 0);
  strictEqual(summary.unfinished, 17);
});

test("余分な出力は extra", () => {
  const { summary } = graded(gradeTypingTrial(customTask("df"), typed("dff")));
  strictEqual(summary.extra, 1);
});

test("隣り合う 2 文字の入れ替わりは swapped 1 件", () => {
  const { summary } = graded(gradeTypingTrial(customTask("kaki"), typed("akki")));
  strictEqual(summary.swapped, 1);
  strictEqual(summary.ok, 2);
});

test("別の文字は wrong", () => {
  const { summary } = graded(gradeTypingTrial(customTask("ka"), typed("ks")));
  strictEqual(summary.wrong, 1);
});

test("修飾キー単独の押下は捨て、Backspace は訂正として数えるだけ", () => {
  const shift: TypedEvent = {
    ...NONE,
    shift: true,
    key: "Shift",
    code: "ShiftLeft",
    composing: false,
  };
  const backspace: TypedEvent = { ...NONE, key: "Backspace", code: "Backspace", composing: false };
  const { summary } = graded(
    gradeTypingTrial(customTask("ka"), [shift, ...typed("k"), backspace, ...typed("a")]),
  );
  strictEqual(summary.ok, 2);
  strictEqual(summary.corrections, 1);
});

test("IME の変換中の入力が混ざると採点しない", () => {
  const events = typed("ka").map((event) => ({ ...event, composing: true }));
  strictEqual(gradeTypingTrial(customTask("ka"), events).kind, "ime");
});

test("hold 課題は期待 chord の数だけ ok になる", () => {
  const cmdU: TrialToken = { kind: "chord", modifiers: { ...NONE, meta: true }, key: "u" };
  const task: TypingTask = {
    kind: "hold",
    id: "hold-f",
    holdKeyCode: "f",
    partner: "u",
    expected: [cmdU, cmdU, cmdU],
  };
  const hit = chord("u", { meta: true });
  // 3 回のうち 1 回は閾値に届かず f と u がそのまま出た。
  const { summary } = graded(gradeTypingTrial(task, [hit, ...typed("fu"), hit]));
  strictEqual(summary.ok, 2);
});

test("修飾の組が違う chord は ok にしない", () => {
  const task: TypingTask = {
    kind: "hold",
    id: "hold-s",
    holdKeyCode: "s",
    partner: "u",
    expected: [{ kind: "chord", modifiers: { ...NONE, meta: true, shift: true }, key: "u" }],
  };
  const { summary } = graded(gradeTypingTrial(task, [chord("u", { meta: true })]));
  strictEqual(summary.ok, 0);
});
