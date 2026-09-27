/**
 * 打鍵テストの試行を閾値ごとにまとめる。
 */

import type { TrialSummary } from "./grade.ts";

/**
 * 採点した試行 1 回。`tappingTermMs` は打った時点で Karabiner に効いていると確かめた
 * 閾値で、確かめていなければ `undefined`。
 *
 * @doc docs/specs/typing-trial.md#summarizetrials
 */
export interface TrialRecord {
  readonly tappingTermMs: number | undefined;
  readonly kind: "text" | "hold";
  readonly summary: TrialSummary;
}

/**
 * 閾値 1 つの成績。文章課題と hold 課題を分けて数える。
 *
 * 文章課題は誤爆と取りこぼしが少ないほど良く、hold 課題は chord が出るほど良い。
 * 閾値を上げると前者が減り後者も減るため、両方を並べて見る。
 *
 * @doc docs/specs/typing-trial.md#summarizetrials
 */
export interface TrialRow {
  readonly tappingTermMs: number | undefined;
  readonly trials: number;
  readonly text: {
    readonly expected: number;
    readonly ok: number;
    readonly misfire: number;
    readonly dropped: number;
    readonly swapped: number;
    /** 誤字と余分。mod-tap の判定と関係ないことが多いので 1 列にまとめる。 */
    readonly other: number;
  };
  readonly hold: { readonly expected: number; readonly ok: number };
}

function emptyRow(tappingTermMs: number | undefined): TrialRow {
  return {
    tappingTermMs,
    trials: 0,
    text: { expected: 0, ok: 0, misfire: 0, dropped: 0, swapped: 0, other: 0 },
    hold: { expected: 0, ok: 0 },
  };
}

function add(row: TrialRow, record: TrialRecord): TrialRow {
  const { summary } = record;
  if (record.kind === "hold") {
    return {
      ...row,
      trials: row.trials + 1,
      hold: { expected: row.hold.expected + summary.expected, ok: row.hold.ok + summary.ok },
    };
  }
  return {
    ...row,
    trials: row.trials + 1,
    text: {
      expected: row.text.expected + summary.expected,
      ok: row.text.ok + summary.ok,
      misfire: row.text.misfire + summary.misfire,
      dropped: row.text.dropped + summary.dropped,
      swapped: row.text.swapped + summary.swapped,
      other: row.text.other + summary.wrong + summary.extra,
    },
  };
}

/**
 * 試行を閾値ごとに合計する。閾値の昇順で、未確認の閾値は最後に置く。
 *
 * @doc docs/specs/typing-trial.md#summarizetrials
 */
export function summarizeTrials(records: readonly TrialRecord[]): readonly TrialRow[] {
  const rows = new Map<number | undefined, TrialRow>();
  for (const record of records) {
    const key = record.tappingTermMs;
    rows.set(key, add(rows.get(key) ?? emptyRow(key), record));
  }
  return [...rows.values()].sort(
    (a, b) => (a.tappingTermMs ?? Infinity) - (b.tappingTermMs ?? Infinity),
  );
}
