import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import { test } from "node:test";
import type { ApplyPlan, ApplyState, WriteOperation } from "../core/apply/plan.ts";
import type { DiffEntry } from "../core/diff/diff.ts";
import type { ApplyGateWithEvidence } from "../core/validation/gate.ts";
import { EMPTY_LABELS } from "../workspace/labels.ts";
import {
  buildApplyDialogView,
  toggleAcknowledged,
  type ApplyDialogInput,
} from "./apply-dialog-view.ts";

const keyEntry: DiffEntry = {
  subject: { kind: "key", layer: 0, row: 1, col: 2 },
  change: "changed",
  before: "KC_A",
  after: "KC_B",
  beforeBehavior: "A",
  afterBehavior: "B",
};
const notation: DiffEntry = {
  ...keyEntry,
  change: "notationOnly",
  before: "KC_NO",
  after: "XXXXXXX",
};
const operation: WriteOperation = {
  target: { kind: "key", layer: 0, row: 1, col: 2 },
  command: "key",
  before: [4],
  after: [5],
};
const plan = { operations: [operation, operation] } as unknown as ApplyPlan;

function input(overrides: Partial<ApplyDialogInput>): ApplyDialogInput {
  return {
    step: "backup",
    backupError: undefined,
    state: undefined,
    changed: [keyEntry, notation],
    gate: undefined,
    labels: EMPTY_LABELS,
    acknowledged: [],
    backupRoundTrips: 12,
    roundTrips: 0,
    roundTripTotal: 0,
    ...overrides,
  };
}

test("書き込み前は step で段を決め、backup の段だけ保存済みの行を出さない", () => {
  const backup = buildApplyDialogView(input({ backupError: "disk full" }));
  strictEqual(backup.stepIndex, 0);
  strictEqual(backup.backup, undefined);
  deepStrictEqual(backup.body, { kind: "backup", error: "disk full" });

  const diff = buildApplyDialogView(input({ step: "diff" }));
  strictEqual(diff.stepIndex, 1);
  deepStrictEqual(diff.backup, { roundTrips: 12, latestPath: diff.backup?.latestPath ?? "" });
  ok(diff.backup?.latestPath.endsWith("latest.vil"));
});

test("差分確認は表記だけの差を行にせず件数にする", () => {
  const view = buildApplyDialogView(input({ step: "diff" }));
  if (view.body.kind !== "diff") throw new Error("diff ではない");
  strictEqual(view.body.changedCount, 2);
  strictEqual(view.body.notationOnlyCount, 1);
  strictEqual(view.body.rows.length, 1);
  deepStrictEqual(
    { ...view.body.rows[0]!, key: undefined },
    {
      key: undefined,
      changeLabel: "変更",
      changeClassName: "tag tag-change",
      subject: view.body.rows[0]!.subject,
      beforeText: "A",
      beforeRaw: "KC_A",
      afterText: "B",
      afterRaw: "KC_B",
    },
  );
});

test("確認の段階は warning だけを承認の対象にし、書き込めるのは gate が開いて確認待ちのときだけ", () => {
  const gate = {
    allowed: true,
    fatal: [],
    evidence: {
      diagnostics: [
        {
          id: "w1",
          severity: "warning",
          code: "C1",
          message: "m1",
          subject: { kind: "layer", layer: 1 },
        },
        {
          id: "i1",
          severity: "info",
          code: "C2",
          message: "m2",
          subject: { kind: "layer", layer: 1 },
        },
      ],
    },
  } as unknown as ApplyGateWithEvidence;
  const waiting: ApplyState = { phase: "awaitingConfirmation", plan };
  const view = buildApplyDialogView(
    input({ step: "confirm", state: waiting, gate, acknowledged: ["w1"] }),
  );
  strictEqual(view.stepIndex, 2);
  strictEqual(view.canWrite, true);
  if (view.body.kind !== "confirm") throw new Error("confirm ではない");
  deepStrictEqual(
    view.body.warnings.map(({ id, acknowledged }) => ({ id, acknowledged })),
    [{ id: "w1", acknowledged: true }],
  );
  strictEqual(buildApplyDialogView(input({ step: "confirm", state: waiting })).canWrite, false);
});

test("書き込み中は verify 済み・実行中・待機を operation ごとに出し、Core の phase が step より優先する", () => {
  const view = buildApplyDialogView(
    input({
      step: "diff",
      state: { phase: "writing", plan, cursor: 1, verified: [operation] },
      roundTrips: 3,
      roundTripTotal: 4,
    }),
  );
  strictEqual(view.stepIndex, 3);
  strictEqual(view.writing, true);
  if (view.body.kind !== "writing") throw new Error("writing ではない");
  strictEqual(view.body.verifiedCount, 1);
  strictEqual(view.body.operationCount, 2);
  deepStrictEqual(
    view.body.rows.map((row) => row.status),
    ["done", "active"],
  );
  strictEqual(view.body.rows[0]!.target, "layer 0 / row 1 col 2");
});

test("完了と中断は結果の段で、中断は理由を文にする", () => {
  const completed = buildApplyDialogView(
    input({ state: { phase: "completed", verified: [operation] } }),
  );
  strictEqual(completed.stepIndex, 4);
  strictEqual(completed.finished, true);
  deepStrictEqual(completed.body, { kind: "completed", verifiedCount: 1 });

  const aborted = buildApplyDialogView(
    input({ state: { phase: "aborted", reason: "disconnected", verified: 2 } }),
  );
  deepStrictEqual(aborted.body, {
    kind: "aborted",
    verifiedCount: 2,
    reason: "実機が切断された",
  });
});

test("承認の切り替えは id を足し引きする", () => {
  deepStrictEqual(toggleAcknowledged(["a"], "b", true), ["a", "b"]);
  deepStrictEqual(toggleAcknowledged(["a", "b"], "a", false), ["b"]);
});
