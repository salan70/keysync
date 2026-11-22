import type { DiffEntry } from "../core/diff/diff.ts";
import type { ApplyGateWithEvidence } from "../core/validation/gate.ts";
import type { WorkspaceLabels } from "../workspace/labels.ts";
import { applyRoundTripTotal } from "./apply-gate.ts";
import { buildApplyDialogView, toggleAcknowledged } from "./apply-dialog-view.ts";
import { ApplyDialog } from "./components/ApplyDialog.tsx";
import type { useApply } from "./state/use-apply.ts";

/**
 * Apply modal の接続層。`useApply` の状態と `App` が集めた値を表示値へ写し、純粋な `ApplyDialog` へ渡す。
 * @doc docs/specs/ui.md#apply-modal-layers
 */
export function ApplyDialogContainer({
  apply,
  changed,
  gate,
  labels,
  acknowledged,
  backupRoundTrips,
  onAcknowledge,
  onWrite,
}: {
  readonly apply: ReturnType<typeof useApply>;
  readonly changed: readonly DiffEntry[];
  readonly gate: ApplyGateWithEvidence | undefined;
  readonly labels: WorkspaceLabels;
  readonly acknowledged: readonly string[];
  readonly backupRoundTrips: number;
  readonly onAcknowledge: (ids: readonly string[]) => void;
  readonly onWrite: () => void;
}): React.JSX.Element {
  const view = buildApplyDialogView({
    step: apply.step,
    backupError: apply.backupError,
    state: apply.state,
    changed,
    gate,
    labels,
    acknowledged,
    backupRoundTrips,
    roundTrips: apply.roundTrips,
    roundTripTotal: applyRoundTripTotal(apply.state),
  });
  return (
    <ApplyDialog
      view={view}
      onNext={apply.next}
      onAcknowledge={(id, checked) => onAcknowledge(toggleAcknowledged(acknowledged, id, checked))}
      onCancel={apply.cancel}
      onWrite={onWrite}
    />
  );
}
