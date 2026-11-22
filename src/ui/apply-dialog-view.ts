import type { ApplyState, WriteOperation } from "../core/apply/plan.ts";
import type { DiffEntry } from "../core/diff/diff.ts";
import type { ApplyGateWithEvidence } from "../core/validation/gate.ts";
import { keycodeLabel, type WorkspaceLabels } from "../workspace/labels.ts";
import { WORKSPACE_LAYOUT } from "../workspace/layout.ts";
import { abortReasonLabel } from "./apply-gate.ts";
import { subjectLabel } from "./diagnostics.ts";

/** 書き込みを始める前の段階。書き込み以降は Core の `ApplyState` の phase で決まる。 */
export type ApplyStep = "backup" | "diff" | "confirm";

/** modal の段階の名前。`ApplyDialogView.stepIndex` はこの並びの添字。 */
export const APPLY_STEP_LABELS = ["backup", "差分確認", "確認", "書き込み", "結果"] as const;

const CHANGE_VIEW: Readonly<
  Record<DiffEntry["change"], { readonly label: string; readonly className: string }>
> = {
  added: { label: "追加", className: "tag tag-add" },
  changed: { label: "変更", className: "tag tag-change" },
  removed: { label: "削除", className: "tag tag-remove" },
  notationOnly: { label: "表記", className: "tag" },
};

/** `buildApplyDialogView` の入力。接続層が hook の値から集める。 */
export interface ApplyDialogInput {
  readonly step: ApplyStep;
  readonly backupError: string | undefined;
  readonly state: ApplyState | undefined;
  readonly changed: readonly DiffEntry[];
  readonly gate: ApplyGateWithEvidence | undefined;
  readonly labels: WorkspaceLabels;
  readonly acknowledged: readonly string[];
  readonly backupRoundTrips: number;
  readonly roundTrips: number;
  readonly roundTripTotal: number;
}

export interface ApplyDiffRowView {
  readonly key: string;
  readonly changeLabel: string;
  readonly changeClassName: string;
  readonly subject: string;
  readonly beforeText: string;
  readonly beforeRaw: string;
  readonly afterText: string;
  readonly afterRaw: string;
}

export interface ApplyFatalView {
  readonly id: string;
  readonly code: string;
  readonly message: string;
}

export interface ApplyWarningView {
  readonly id: string;
  readonly message: string;
  readonly code: string;
  readonly subject: string;
  readonly acknowledged: boolean;
}

export interface ApplyWriteRowView {
  readonly key: string;
  readonly status: "done" | "active" | "pending";
  readonly target: string;
  readonly description: string;
}

export type ApplyBodyView =
  | { readonly kind: "backup"; readonly error: string | undefined }
  | {
      readonly kind: "diff";
      readonly changedCount: number;
      readonly rows: readonly ApplyDiffRowView[];
      readonly notationOnlyCount: number;
      readonly fatal: readonly ApplyFatalView[];
    }
  | {
      readonly kind: "confirm";
      readonly warnings: readonly ApplyWarningView[];
      readonly fatal: readonly ApplyFatalView[];
    }
  | {
      readonly kind: "writing";
      readonly verifiedCount: number;
      readonly operationCount: number;
      readonly roundTrips: number;
      readonly roundTripTotal: number;
      readonly rows: readonly ApplyWriteRowView[];
    }
  | { readonly kind: "completed"; readonly verifiedCount: number }
  | { readonly kind: "aborted"; readonly verifiedCount: number; readonly reason: string };

/** Apply の modal が描くものをすべて値にした形。描画は `ApplyDialog` が受け持つ。 */
export interface ApplyDialogView {
  /** `APPLY_STEP_LABELS` の添字。 */
  readonly stepIndex: number;
  readonly writing: boolean;
  readonly finished: boolean;
  readonly canWrite: boolean;
  readonly changedCount: number;
  /** backup を保存し終えたあとの段で出す行。 */
  readonly backup: { readonly roundTrips: number; readonly latestPath: string } | undefined;
  readonly body: ApplyBodyView;
}

/**
 * Apply modal の表示値を作る。段階は Core の `ApplyState` を優先し、書き込み前だけ `step` で決める。
 *
 * @doc docs/specs/ui.md#apply-modal-layers
 */
export function buildApplyDialogView(input: ApplyDialogInput): ApplyDialogView {
  const { state, gate, changed } = input;
  const stepIndex =
    state?.phase === "writing"
      ? 3
      : state?.phase === "completed" || state?.phase === "aborted"
        ? 4
        : input.step === "backup"
          ? 0
          : input.step === "diff"
            ? 1
            : 2;
  const fatal: readonly ApplyFatalView[] = (gate?.fatal ?? []).map(({ id, code, message }) => ({
    id,
    code,
    message,
  }));
  return {
    stepIndex,
    writing: state?.phase === "writing",
    finished: stepIndex === 4,
    canWrite: gate?.allowed === true && state?.phase === "awaitingConfirmation",
    changedCount: changed.length,
    backup:
      stepIndex >= 1
        ? { roundTrips: input.backupRoundTrips, latestPath: WORKSPACE_LAYOUT.latestBackup }
        : undefined,
    body: buildBody(input, stepIndex, fatal),
  };
}

function buildBody(
  input: ApplyDialogInput,
  stepIndex: number,
  fatal: readonly ApplyFatalView[],
): ApplyBodyView {
  const { state, gate, changed, labels } = input;
  if (stepIndex === 3 && state?.phase === "writing") {
    return {
      kind: "writing",
      verifiedCount: state.verified.length,
      operationCount: state.plan.operations.length,
      roundTrips: input.roundTrips,
      roundTripTotal: input.roundTripTotal,
      rows: state.plan.operations.map((operation, index) => ({
        key: `${operation.target.kind}-${index}`,
        status:
          index < state.verified.length
            ? "done"
            : index === state.verified.length
              ? "active"
              : "pending",
        target: targetLabel(operation),
        description: operationDescription(operation, changed, labels),
      })),
    };
  }
  if (stepIndex === 4 && state?.phase === "aborted") {
    return {
      kind: "aborted",
      verifiedCount: state.verified,
      reason: abortReasonLabel(state.reason),
    };
  }
  if (stepIndex === 4 && state?.phase === "completed") {
    return { kind: "completed", verifiedCount: state.verified.length };
  }
  if (stepIndex === 1) {
    return {
      kind: "diff",
      changedCount: changed.length,
      rows: changed
        .filter((entry) => entry.change !== "notationOnly")
        .map((entry, index) => ({
          key: `${subjectLabel(entry.subject)}-${index}`,
          changeLabel: CHANGE_VIEW[entry.change].label,
          changeClassName: CHANGE_VIEW[entry.change].className,
          subject: subjectLabel(entry.subject),
          beforeText: labeledBehavior(entry.subject, entry.before, entry.beforeBehavior, labels),
          beforeRaw: entry.before,
          afterText: labeledBehavior(entry.subject, entry.after, entry.afterBehavior, labels),
          afterRaw: entry.after,
        })),
      notationOnlyCount: changed.filter((entry) => entry.change === "notationOnly").length,
      fatal,
    };
  }
  if (stepIndex === 2) {
    return {
      kind: "confirm",
      warnings: (gate?.evidence.diagnostics ?? [])
        .filter((diagnostic) => diagnostic.severity === "warning")
        .map((diagnostic) => ({
          id: diagnostic.id,
          message: diagnostic.message,
          code: diagnostic.code,
          subject: subjectLabel(diagnostic.subject),
          acknowledged: input.acknowledged.includes(diagnostic.id),
        })),
      fatal,
    };
  }
  return { kind: "backup", error: input.backupError };
}

/** 警告 1 件の承認を切り替えた承認済み id の一覧。 */
export function toggleAcknowledged(
  acknowledged: readonly string[],
  id: string,
  checked: boolean,
): readonly string[] {
  return checked ? [...acknowledged, id] : acknowledged.filter((candidate) => candidate !== id);
}

function labeledBehavior(
  subject: DiffEntry["subject"],
  raw: string,
  behavior: string,
  labels: WorkspaceLabels,
): string {
  if (subject.kind !== "key" && subject.kind !== "encoder") return behavior;
  const name = raw === "" ? undefined : keycodeLabel(labels, raw);
  return name === undefined ? behavior : `${name} — ${behavior}`;
}

function operationDescription(
  operation: WriteOperation,
  changed: readonly DiffEntry[],
  labels: WorkspaceLabels,
): string {
  const entry = changed.find((candidate) => subjectMatchesTarget(candidate.subject, operation));
  return entry === undefined
    ? operation.after.join(", ")
    : labeledBehavior(entry.subject, entry.after, entry.afterBehavior, labels);
}

function subjectMatchesTarget(subject: DiffEntry["subject"], operation: WriteOperation): boolean {
  const target = operation.target;
  if (target.kind === "key")
    return (
      subject.kind === "key" &&
      subject.layer === target.layer &&
      subject.row === target.row &&
      subject.col === target.col
    );
  if (target.kind === "encoder")
    return (
      subject.kind === "encoder" &&
      subject.layer === target.layer &&
      subject.index === target.index &&
      (target.direction === 0 ? subject.direction === "ccw" : subject.direction === "cw")
    );
  if (target.kind === "tapDance")
    return subject.kind === "tapDance" && subject.index === target.index;
  if (target.kind === "combo") return subject.kind === "combo" && subject.index === target.index;
  return subject.kind === "setting" && subject.qsid === target.qsid;
}

function targetLabel(operation: WriteOperation): string {
  const target = operation.target;
  switch (target.kind) {
    case "key":
      return `layer ${target.layer} / row ${target.row} col ${target.col}`;
    case "encoder":
      return `layer ${target.layer} / encoder ${target.index} ${target.direction === 0 ? "左回し" : "右回し"}`;
    case "tapDance":
      return `Tap Dance ${target.index}`;
    case "combo":
      return `Combo ${target.index}`;
    case "setting":
      return `settings / qsid ${target.qsid}`;
  }
}
