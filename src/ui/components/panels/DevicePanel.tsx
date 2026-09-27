import type { DiffEntry } from "../../../core/diff/diff.ts";
import {
  MAC_FLOW_TAP_TERM_RANGE,
  MAC_TAPPING_TERM_RANGE,
  type MacKeyboardLayout,
} from "../../../core/mac-keymap/types.ts";
import type { Diagnostic } from "../../../core/validation/types.ts";
import type { RoundTripProgress } from "../../../device/protocol.ts";
import { macKeymapPath, WORKSPACE_LAYOUT } from "../../../workspace/layout.ts";
import { subjectLabel } from "../../diagnostics.ts";
import { describeDevices, kanataDeviceText } from "../../mac-references.ts";
import type { MacWorkspaceState } from "../../mac-workspace.ts";
import { Button } from "../Button.tsx";
import { Icon } from "../Icon.tsx";
import { ValueField } from "./BehaviorsPanel.tsx";

export interface DeviceIdentity {
  readonly deviceUid: string;
  readonly workspaceUid: string | undefined;
  readonly deviceDigest: string | undefined;
  readonly workspaceDigest: string | undefined;
}

function stepClass(done: boolean, current: boolean): string {
  return done ? "step is-done" : current ? "step is-current" : "step";
}

/**
 * 実機と適用（Cornix LP）。接続、実機から読み込む、差分を確かめて Apply する、の 3 段階と backup からの復元。
 *
 * 接続しただけでは実機を読み込まない。読み込むまで差分は出ない。
 */
export function CornixDevicePanel({
  connected,
  productName,
  reading,
  readAt,
  roundTrips,
  identity,
  changed,
  fatal,
  applyBlockedReason,
  cornixReady,
  onConnect,
  onDisconnect,
  onRead,
  onApply,
  onRestore,
}: {
  readonly connected: boolean;
  readonly productName: string | undefined;
  readonly reading: RoundTripProgress | undefined;
  readonly readAt: Date | undefined;
  readonly roundTrips: number;
  readonly identity: DeviceIdentity | undefined;
  readonly changed: readonly DiffEntry[];
  readonly fatal: readonly Diagnostic[];
  readonly applyBlockedReason: string | undefined;
  readonly cornixReady: boolean;
  readonly onConnect: () => void;
  readonly onDisconnect: () => void;
  readonly onRead: () => void;
  readonly onApply: () => void;
  readonly onRestore: () => void;
}): React.JSX.Element {
  const read = readAt !== undefined;
  return (
    <>
      <ol className="steps">
        <li className={stepClass(connected, !connected)}>
          <h3 className="section-title">
            <span className="step-no">1</span> 接続する
          </h3>
          <p>
            {connected
              ? `${productName ?? "Cornix LP"} に接続している。`
              : "未接続。接続しただけでは実機の設定を読み込まない。"}
          </p>
          <div className="row">
            <Button
              size="small"
              appearance={connected ? "secondary" : "primary"}
              onClick={onConnect}
            >
              接続（機器を選ぶ）
            </Button>
            {connected ? (
              <Button size="small" appearance="quiet" onClick={onDisconnect}>
                切断
              </Button>
            ) : null}
          </div>
        </li>
        <li className={stepClass(read, connected && !read)}>
          <h3 className="section-title">
            <span className="step-no">2</span> 実機から読み込む
          </h3>
          {reading !== undefined ? (
            <div role="status" aria-live="polite">
              <p>
                読み込み中… 往復 {reading.count}
                {reading.total === undefined ? "" : ` / ${reading.total}`} 回（{reading.label}）
              </p>
              {reading.total === undefined ? (
                <progress />
              ) : (
                <progress max={reading.total} value={reading.count} />
              )}
            </div>
          ) : read ? (
            <p>
              {readAt.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}{" "}
              に読み込んだ。全 {roundTrips} 往復。
            </p>
          ) : (
            <p>この接続で読み込むまで差分は出ない。残り時間は推定しない。</p>
          )}
          <Button
            size="small"
            appearance="secondary"
            disabled={!connected || reading !== undefined}
            onClick={onRead}
          >
            実機から読み込む
          </Button>
          {identity === undefined ? null : (
            <dl className="kv">
              <dt>UID</dt>
              <dd>
                実機 <code>{identity.deviceUid}</code>
                {identity.workspaceUid === undefined
                  ? ""
                  : identity.workspaceUid === identity.deviceUid
                    ? "（workspace と一致）"
                    : `（workspace は ${identity.workspaceUid}。不一致）`}
              </dd>
              <dt>definition</dt>
              <dd>
                <code>{identity.deviceDigest ?? "未取得"}</code>
                {identity.workspaceDigest === undefined
                  ? ""
                  : identity.workspaceDigest === identity.deviceDigest
                    ? "（binding と一致）"
                    : "（binding と不一致）"}
              </dd>
            </dl>
          )}
        </li>
        <li className={stepClass(false, read)}>
          <h3 className="section-title">
            <span className="step-no">3</span> 差分を確かめて Apply する
          </h3>
          {read ? (
            <>
              <p>
                workspace と実機の差分 <strong>{changed.length} 件</strong>
              </p>
              {changed.length === 0 ? null : (
                <ul className="diff-mini" aria-label="実機との差分">
                  {changed.slice(0, 12).map((entry, index) => (
                    <li key={`${subjectLabel(entry.subject)}-${index}`}>
                      <span>{subjectLabel(entry.subject)}</span>
                      <span>
                        {entry.beforeBehavior} → <strong>{entry.afterBehavior}</strong>
                      </span>
                    </li>
                  ))}
                  {changed.length > 12 ? (
                    <li>ほか {changed.length - 12} 件は Apply の差分確認で一覧する。</li>
                  ) : null}
                </ul>
              )}
              {fatal.length === 0 ? null : (
                <div className="fatal-list">
                  <strong>
                    <Icon name="error" /> error が {fatal.length} 件あるため Apply できない
                  </strong>
                  <ul>
                    {fatal.map((diagnostic) => (
                      <li key={diagnostic.id}>
                        <code>{diagnostic.code}</code> {diagnostic.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <p className="muted">読み込むと差分がここに出る。</p>
          )}
          <Button
            data-apply
            disabled={applyBlockedReason !== undefined}
            aria-describedby={applyBlockedReason === undefined ? undefined : "apply-reason-panel"}
            onClick={onApply}
          >
            実機へ Apply…
          </Button>
          {applyBlockedReason === undefined ? null : (
            <p id="apply-reason-panel" className="hint">
              {applyBlockedReason}
            </p>
          )}
        </li>
      </ol>
      <section className="step">
        <h3 className="section-title">backup から復元</h3>
        <p>
          <code>{WORKSPACE_LAYOUT.latestBackup}</code>{" "}
          を目標状態として読み込む。この時点では実機にも keymap.yaml
          にも書き込まず、通常の差分確認と Apply に戻る。
        </p>
        <Button size="small" appearance="secondary" disabled={!cornixReady} onClick={onRestore}>
          backup から復元
        </Button>
        {cornixReady ? null : <p className="hint">keymap.yaml を読み込めていないため使えない。</p>}
      </section>
    </>
  );
}

/**
 * 実機と適用（Mac）。kanata への適用の入口と、適用先と kanata の設定の書き出しを置く。
 *
 * 書き込みはローカルサーバーが行い、Web UI は差分を見せて承認を送るだけ（ADR 0034）。
 */
export function MacDevicePanel({
  layout,
  mac,
  applyBlockedReason,
  onApply,
  onTappingTerm,
  onFlowTapTerm,
  onExportKanata,
}: {
  readonly layout: MacKeyboardLayout;
  readonly mac: MacWorkspaceState;
  readonly applyBlockedReason: string | undefined;
  readonly onApply: () => void;
  /** 保存できなければ理由を返す。 */
  readonly onTappingTerm: (value: string) => string | undefined;
  /** 保存できなければ理由を返す。 */
  readonly onFlowTapTerm: (value: string) => string | undefined;
  readonly onExportKanata: () => void;
}): React.JSX.Element {
  const path = mac.kind === "ready" ? mac.path : macKeymapPath(layout);
  return (
    <div className="steps">
      <section className="step is-info">
        <h3 className="section-title">kanata へ適用</h3>
        <p>
          <code>{path}</code> と、この Mac の kanata の設定との差分を確かめてから適用する。
          適用の前に自動で backup を取り、適用後は常駐している kanata に読み直させる。
        </p>
        <Button size="small" disabled={applyBlockedReason !== undefined} onClick={onApply}>
          kanata へ適用…
        </Button>
        {applyBlockedReason === undefined ? null : <p className="hint">{applyBlockedReason}</p>}
        <p className="hint">ターミナルからは just mac apply でも適用できる。</p>
      </section>
      <section className="step">
        <h3 className="section-title">適用先</h3>
        {mac.kind === "ready" ? (
          <p>
            {describeDevices(mac.document.devices)}{" "}
            <code>{kanataDeviceText(mac.document.devices)}</code>
          </p>
        ) : (
          <p className="muted">{path} を読み込めていない。</p>
        )}
      </section>
      <section className="step">
        <h3 className="section-title">mod-tap の閾値</h3>
        {mac.kind === "ready" ? (
          <>
            <ValueField
              id="mac-tapping-term"
              label={`tapping term（ms、${MAC_TAPPING_TERM_RANGE.min}〜${MAC_TAPPING_TERM_RANGE.max}）`}
              value={String(mac.document.tappingTermMs)}
              numeric
              hint={undefined}
              onCommit={onTappingTerm}
            />
            <ValueField
              id="mac-flow-tap-term"
              label={`flow tap（ms、${MAC_FLOW_TAP_TERM_RANGE.min}〜${MAC_FLOW_TAP_TERM_RANGE.max}、0 で無効）`}
              value={String(mac.document.flowTapTermMs)}
              numeric
              hint={undefined}
              onCommit={onFlowTapTerm}
            />
          </>
        ) : (
          <p className="muted">{path} を読み込めていない。</p>
        )}
        <p className="hint">
          tapping term より前に離すか次のキーを押すと文字、押し続けると修飾キー。直前の文字キーから
          flow tap より短い間隔で押した文字の mod-tap は、押し続けても文字になる。kanata
          への適用で反映する。
        </p>
      </section>
      <section className="step">
        <h3 className="section-title">kanata の設定</h3>
        <p>
          編集中の内容から kanata の設定を keysync/generated/ へ書き出す。error
          があると書き出さない。
        </p>
        <Button
          size="small"
          appearance="secondary"
          disabled={mac.kind !== "ready"}
          onClick={onExportKanata}
        >
          kanata の設定を書き出す
        </Button>
      </section>
    </div>
  );
}
