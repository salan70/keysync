import type { DiagnosticSummary, Severity } from "../../core/validation/types.ts";
import type { RoundTripProgress } from "../../device/protocol.ts";
import { SEVERITY_VIEW } from "../diagnostics.ts";
import type { SaveState } from "../save-state.ts";
import { Button } from "./Button.tsx";
import { Icon } from "./Icon.tsx";

const SAVE_TEXT: Readonly<Record<SaveState["kind"], string>> = {
  idle: "変更なし",
  saving: "保存中…",
  saved: "ローカル保存済み",
  error: "保存に失敗",
  conflict: "外部変更のため保存できない",
};

const SAVE_CLASS: Readonly<Record<SaveState["kind"], string>> = {
  idle: "status-save is-idle",
  saving: "status-save is-saving",
  saved: "status-save is-saved",
  error: "status-save is-error",
  conflict: "status-save is-conflict",
};

const SEVERITY_CLASS: Readonly<Record<Severity, string>> = {
  error: "sev sev-error",
  warning: "sev sev-warning",
  information: "sev sev-information",
};

export type StatusBarMode =
  | {
      readonly kind: "cornix";
      readonly read: boolean;
      readonly changedCount: number;
      readonly applyBlockedReason: string | undefined;
      readonly onApply: () => void;
    }
  | {
      readonly kind: "mac";
      readonly applyBlockedReason: string | undefined;
      readonly onApply: () => void;
    };

/**
 * 画面下の status bar。診断の件数、保存状態と保存先、通知、実機との差分と Apply の入口。
 *
 * Apply を開始できないときはボタンを無効にし、理由を文字で並べる。Mac では kanata への適用を出す（ADR 0034・0049）。
 */
export function StatusBar({
  summary,
  onSeverity,
  save,
  savePath,
  message,
  progress,
  mode,
}: {
  readonly summary: DiagnosticSummary;
  readonly onSeverity: (severity: Severity) => void;
  readonly save: SaveState;
  readonly savePath: string;
  readonly message: string;
  readonly progress: RoundTripProgress | undefined;
  readonly mode: StatusBarMode;
}): React.JSX.Element {
  const text =
    progress === undefined
      ? message
      : `${progress.label}（往復 ${progress.count}${progress.total === undefined ? "" : ` / ${progress.total}`} 回）`;
  return (
    <footer className="status">
      <div className="sev-group">
        {(["error", "warning", "information"] as const).map((severity) => (
          <button
            key={severity}
            type="button"
            data-severity={severity}
            className={SEVERITY_CLASS[severity]}
            aria-label={`${SEVERITY_VIEW[severity].label} ${summary[severity]} 件。検証を開く`}
            onClick={() => onSeverity(severity)}
          >
            <Icon name={SEVERITY_VIEW[severity].icon} /> {summary[severity]}
          </button>
        ))}
      </div>
      <span className={SAVE_CLASS[save.kind]} data-save={save.kind}>
        {SAVE_TEXT[save.kind]} <code>{savePath}</code>
      </span>
      <span className="status-msg" role="status" aria-live="polite" title={text}>
        {text}
      </span>
      {mode.kind === "cornix" ? (
        <>
          <span className="status-diff muted">
            {mode.read ? `実機との差分 ${mode.changedCount} 件` : "実機の差分は未読込"}
          </span>
          <Button
            size="small"
            data-apply
            disabled={mode.applyBlockedReason !== undefined}
            aria-describedby={mode.applyBlockedReason === undefined ? undefined : "apply-reason"}
            onClick={mode.onApply}
          >
            実機へ Apply…
          </Button>
          {mode.applyBlockedReason === undefined ? null : (
            <span id="apply-reason" className="status-why">
              {mode.applyBlockedReason}
            </span>
          )}
        </>
      ) : (
        <>
          <Button
            size="small"
            data-mac-apply
            disabled={mode.applyBlockedReason !== undefined}
            aria-describedby={mode.applyBlockedReason === undefined ? undefined : "apply-reason"}
            onClick={mode.onApply}
          >
            kanata へ適用…
          </Button>
          {mode.applyBlockedReason === undefined ? null : (
            <span id="apply-reason" className="status-why">
              {mode.applyBlockedReason}
            </span>
          )}
        </>
      )}
    </footer>
  );
}
