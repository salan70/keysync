import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { test } from "node:test";
import type { TrialSummary } from "./grade.ts";
import { summarizeTrials } from "./history.ts";

function summary(values: Partial<TrialSummary>): TrialSummary {
  return {
    expected: 0,
    ok: 0,
    misfire: 0,
    wrong: 0,
    dropped: 0,
    extra: 0,
    swapped: 0,
    unfinished: 0,
    corrections: 0,
    misfirePairs: [],
    ...values,
  };
}

test("閾値ごとに文章課題と hold 課題を分けて合計する", () => {
  const rows = summarizeTrials([
    {
      tappingTermMs: 200,
      kind: "text",
      summary: summary({ expected: 10, ok: 8, misfire: 1, extra: 1 }),
    },
    { tappingTermMs: 200, kind: "text", summary: summary({ expected: 10, ok: 10 }) },
    { tappingTermMs: 200, kind: "hold", summary: summary({ expected: 3, ok: 2 }) },
  ]);
  strictEqual(rows.length, 1);
  deepStrictEqual(rows[0]?.text, {
    expected: 20,
    ok: 18,
    misfire: 1,
    dropped: 0,
    swapped: 0,
    other: 1,
  });
  deepStrictEqual(rows[0]?.hold, { expected: 3, ok: 2 });
  strictEqual(rows[0]?.trials, 3);
});

test("閾値の昇順に並べ、未確認は最後に置く", () => {
  const rows = summarizeTrials([
    { tappingTermMs: undefined, kind: "text", summary: summary({}) },
    { tappingTermMs: 250, kind: "text", summary: summary({}) },
    { tappingTermMs: 160, kind: "text", summary: summary({}) },
  ]);
  deepStrictEqual(
    rows.map((row) => row.tappingTermMs),
    [160, 250, undefined],
  );
});
