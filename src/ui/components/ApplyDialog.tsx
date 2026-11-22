import { useEffect, useRef } from "react";
import {
  APPLY_STEP_LABELS,
  type ApplyDialogView,
  type ApplyFatalView,
} from "../apply-dialog-view.ts";
import { SEVERITY_VIEW } from "../diagnostics.ts";
import { Button } from "./Button.tsx";
import { Icon } from "./Icon.tsx";

/**
 * 実機への Apply。backup → 差分確認 → 確認 → 書き込み → 結果の線形の modal。
 *
 * 表示値は `buildApplyDialogView` が作り、この部品は受け取った値を描くだけにする。
 * 書き込みを始める前はキャンセルでき、始めた後は「中断」だけを出す。Esc は書き込み中は何もしない。
 * 完了は「実機に反映した」とだけ言い、電源を切った後に残るかは確かめていないと明示する。
 */
export function ApplyDialog({
  view,
  onNext,
  onAcknowledge,
  onCancel,
  onWrite,
}: {
  readonly view: ApplyDialogView;
  readonly onNext: () => void;
  readonly onAcknowledge: (id: string, checked: boolean) => void;
  readonly onCancel: () => void;
  readonly onWrite: () => void;
}): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const { stepIndex: index, writing, finished, body } = view;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  useEffect(() => {
    headingRef.current?.focus();
  }, [index]);

  return (
    <dialog
      ref={dialogRef}
      className="apply"
      data-apply-dialog
      data-step={index}
      aria-labelledby="apply-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!writing) onCancel();
      }}
    >
      <header className="apply-head">
        <h2 id="apply-title" ref={headingRef} tabIndex={-1}>
          実機へ Apply
        </h2>
        <ol className="apply-steps" aria-label="Apply の段階">
          {APPLY_STEP_LABELS.map((label, stepIndex) => (
            <li
              key={label}
              className={stepIndex < index ? "is-done" : stepIndex === index ? "is-current" : ""}
              aria-current={stepIndex === index ? "step" : undefined}
            >
              <span className="step-no">
                {stepIndex < index ? (
                  <>
                    <Icon name="check" />
                    {/* アイコンは読み上げから外すので、完了した段の番号は文字で添える。 */}
                    <span className="visually-hidden">{stepIndex + 1}（完了）</span>
                  </>
                ) : (
                  stepIndex + 1
                )}
              </span>
              {label}
            </li>
          ))}
        </ol>
      </header>

      <div className="apply-body">
        {view.backup === undefined ? null : (
          <p className="backup-row">
            <strong>
              <Icon name="check" />
            </strong>
            <span>
              Apply 前の全 read（往復 {view.backup.roundTrips} 回）を <code>keysync/backups/</code>{" "}
              と <code>{view.backup.latestPath}</code> に保存した
            </span>
          </p>
        )}

        {body.kind === "backup" ? (
          <section role="status" aria-live="polite">
            <h3 className="section-title">実機の現在の状態を backup する</h3>
            {body.error === undefined ? (
              <p>この接続で読み込んだ実機の状態を keysync/backups/ に保存している…</p>
            ) : (
              <p className="bad">backup を保存できなかったため、書き込みへ進まない: {body.error}</p>
            )}
          </section>
        ) : null}

        {body.kind === "diff" ? (
          <section>
            <h3 className="section-title">書き込む差分 {body.changedCount} 件</h3>
            <p className="hint">
              書き込むのは差分だけ。1 件ごとに書き、同じ entry を読み直して確かめる。
            </p>
            <table className="diff-table">
              <thead>
                <tr>
                  <th>種類</th>
                  <th>対象</th>
                  <th>現在（実機）</th>
                  <th>移行後</th>
                </tr>
              </thead>
              <tbody>
                {body.rows.map((row) => (
                  <tr key={row.key}>
                    <td>
                      <span className={row.changeClassName}>{row.changeLabel}</span>
                    </td>
                    <td>{row.subject}</td>
                    <td>
                      {row.beforeText}
                      <code>{row.beforeRaw}</code>
                    </td>
                    <td>
                      <strong>{row.afterText}</strong>
                      <code>{row.afterRaw}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {body.notationOnlyCount === 0 ? null : (
              <p className="hint">
                挙動が変わらない表記の差が {body.notationOnlyCount} 件ある。書き込み対象には含める。
              </p>
            )}
            <FatalList fatal={body.fatal} />
          </section>
        ) : null}

        {body.kind === "confirm" ? (
          <section>
            <h3 className="section-title">書き込む前の確認</h3>
            {body.warnings.length === 0 ? (
              <p>承認が要る警告は無い。</p>
            ) : (
              <>
                <p>
                  警告 {body.warnings.length}{" "}
                  件を確かめる。内容を理解した警告だけ承認する。承認は問題の解決ではなく、根拠の値が変わると外れる。
                </p>
                {body.warnings.map((warning) => (
                  <label key={warning.id} className="ack">
                    <input
                      type="checkbox"
                      checked={warning.acknowledged}
                      onChange={(event) => onAcknowledge(warning.id, event.target.checked)}
                    />
                    <span>
                      <Icon name={SEVERITY_VIEW.warning.icon} /> {SEVERITY_VIEW.warning.label}:{" "}
                      {warning.message}
                      <br />
                      <code>{warning.code}</code> · {warning.subject}
                    </span>
                  </label>
                ))}
              </>
            )}
            <FatalList fatal={body.fatal} />
            <p className="hint">書き込み中は実機を切断しない。</p>
          </section>
        ) : null}

        {body.kind === "writing" ? (
          <section role="status" aria-live="polite">
            <h3 className="section-title">
              書き込みと確認 {body.verifiedCount} / {body.operationCount} 件
            </h3>
            <p>
              往復 {body.roundTrips} / {body.roundTripTotal} 回。残り時間は推定しない。
            </p>
            <progress max={Math.max(1, body.roundTripTotal)} value={body.roundTrips} />
            <ul className="write-rows">
              {body.rows.map((row) => (
                <li
                  key={row.key}
                  className={
                    row.status === "done" ? "is-done" : row.status === "active" ? "is-active" : ""
                  }
                >
                  <span>
                    {row.status === "done" ? (
                      <>
                        <Icon name="check" /> 書き込み → 読み直しが一致
                      </>
                    ) : row.status === "active" ? (
                      <>
                        <Icon name="saving" /> 書き込んだ値を読み直している
                      </>
                    ) : (
                      "待機"
                    )}
                  </span>
                  <span>
                    {row.target} {row.description}
                  </span>
                </li>
              ))}
            </ul>
            <p className="hint">中断すると、途中までの状態は持ち越さずに全 read からやり直す。</p>
          </section>
        ) : null}

        {body.kind === "completed" ? (
          <section>
            <h3 className="section-title ok">
              <Icon name="check" /> {body.verifiedCount} 件を実機に反映した
            </h3>
            <p>
              1 件ごとに書き込んだ値を読み直し、一致を確かめた。続けて実機を全 read
              し直し、差分を取り直す。
            </p>
            <p className="hint">
              確かめたのは実機に反映されたことまでで、電源を切っても残るかは確認していない。確かめるには、電源を入れ直してから実機を読み込む。
            </p>
          </section>
        ) : null}

        {body.kind === "aborted" ? (
          <section>
            <h3 className="section-title bad">
              ! 中断した（{body.verifiedCount} 件まで確認済み）: {body.reason}
            </h3>
            <p>
              途中の状態は持ち越さない。再接続し、「実機と適用」から実機を読み込み直して差分を確かめてから、Apply
              をやり直す。
            </p>
          </section>
        ) : null}
      </div>

      <footer className="apply-foot">
        {index < 3 ? (
          <Button appearance="quiet" onClick={onCancel}>
            キャンセル
          </Button>
        ) : null}
        <span className="spacer" />
        {index === 1 ? <Button onClick={onNext}>確認へ進む</Button> : null}
        {index === 2 ? (
          <Button disabled={!view.canWrite} onClick={onWrite}>
            {view.changedCount} 件を実機へ書き込む
          </Button>
        ) : null}
        {writing ? (
          <Button appearance="danger" onClick={onCancel}>
            中断
          </Button>
        ) : null}
        {finished && !writing ? <Button onClick={onCancel}>閉じる</Button> : null}
      </footer>
    </dialog>
  );
}

function FatalList({
  fatal,
}: {
  readonly fatal: readonly ApplyFatalView[];
}): React.JSX.Element | null {
  if (fatal.length === 0) return null;
  return (
    <div className="fatal-list" role="alert">
      <strong>
        <Icon name="error" /> error があるため書き込めない
      </strong>
      <ul>
        {fatal.map((diagnostic) => (
          <li key={diagnostic.id}>
            <code>{diagnostic.code}</code> {diagnostic.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
