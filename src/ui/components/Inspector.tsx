import { useEffect, useState, type RefObject } from "react";
import { describeKeycode } from "../../core/diff/describe.ts";
import type { createKeycodeTable } from "../../core/keycode/table.ts";
import { canonicalKeycode, classifyKeycode } from "../../core/validation/keycode-vocabulary.ts";
import { keycodeLabel, layerLabel, type WorkspaceLabels } from "../../workspace/labels.ts";
import {
  BEHAVIOR_OPTIONS,
  behaviorKind,
  composeKeycode,
  macBehaviorOptions,
  removeHold,
  structuredValues,
  targetValue,
  type PickTarget,
} from "../keycode-compose.ts";
import { keycodeDisplay, kindClass, renderKeycode } from "../keycode-display.tsx";
import type { IconName } from "../icons.ts";
import type { SaveState } from "../save-state.ts";
import { Button } from "./Button.tsx";
import { Icon } from "./Icon.tsx";

const PICK_TARGETS: readonly { readonly id: PickTarget; readonly label: string }[] = [
  { id: "whole", label: "キー全体" },
  { id: "tap", label: "Tap" },
  { id: "hold", label: "Hold" },
];

export interface InspectorSave {
  readonly state: SaveState;
  readonly path: string;
  readonly onRetry: () => void;
  readonly onReload: () => void;
}

/**
 * 編集パネル。選択中のキーの現在値、picker の適用先、動作、raw keycode と表示名、保存状態を常設する。
 *
 * ここで示す保存はローカルの workspace への保存で、実機への反映（Apply）や Mac への適用（CLI）とは別の操作である。
 */
export function Inspector({
  headingRef,
  mode,
  position,
  keycode,
  passthroughKeycode,
  table,
  labels,
  pickTarget,
  onPickTarget,
  onEdit,
  onClear,
  onLabel,
  onJumpLayer,
  jumpableLayers,
  location,
  save,
  onBackToBoard,
  unavailable,
}: {
  readonly headingRef: RefObject<HTMLHeadingElement | null>;
  readonly mode: "cornix" | "mac";
  /** 選択中の位置の文言。未選択なら `undefined`。 */
  readonly position: string | undefined;
  /** 現在値。Mac の素通しは `undefined`。 */
  readonly keycode: string | undefined;
  /** Mac のキーが素通しで送る keycode。動作を足すときの Tap の初期値。Hold を外してこれに戻るなら素通しへ戻す。 */
  readonly passthroughKeycode?: string | undefined;
  readonly table: ReturnType<typeof createKeycodeTable> | undefined;
  readonly labels: WorkspaceLabels;
  readonly pickTarget: PickTarget;
  readonly onPickTarget: (target: PickTarget) => void;
  readonly onEdit: (keycode: string) => void;
  readonly onClear: () => void;
  readonly onLabel: (keycode: string, value: string) => void;
  readonly onJumpLayer: (layer: number) => void;
  /** 移動できる layer。Mac は存在する layer だけ。 */
  readonly jumpableLayers: ReadonlySet<number>;
  /** 保存先の中の位置（例: `layers[0] row 1 col 2`）。 */
  readonly location: string | undefined;
  readonly save: InspectorSave;
  readonly onBackToBoard: () => void;
  /** 編集できない理由。対象のファイルを読み込めていないときに出す。 */
  readonly unavailable: string | undefined;
}): React.JSX.Element {
  const [draftRaw, setDraftRaw] = useState(keycode ?? "");
  const [draftName, setDraftName] = useState("");
  const nameFor = (raw: string | undefined): string =>
    raw === undefined ? "" : (keycodeLabel(labels, raw) ?? "");

  useEffect(() => {
    setDraftRaw(keycode ?? "");
    setDraftName(nameFor(keycode));
  }, [keycode, labels]);

  function onKeyDown(event: React.KeyboardEvent): void {
    if (event.key !== "Escape") return;
    event.preventDefault();
    onBackToBoard();
  }

  const heading = (
    <h2 id="inspector-title" ref={headingRef} tabIndex={-1} className="panel-title">
      選択中のキー
    </h2>
  );

  if (position === undefined || unavailable !== undefined) {
    return (
      <aside className="inspector" aria-labelledby="inspector-title" onKeyDown={onKeyDown}>
        {heading}
        <p className="muted">
          {unavailable ??
            "盤面のキーか encoder を選ぶと、ここで割り当てを変えられる。方向キーで移動し、Enter でここへ来る。"}
        </p>
        <SaveBox mode={mode} save={save} />
      </aside>
    );
  }

  const display =
    keycode === undefined ? undefined : keycodeDisplay(keycode, labels, table, { compact: true });
  const lexeme = keycode === undefined ? undefined : classifyKeycode(keycode);
  const base = keycode ?? passthroughKeycode;
  const structured = base === undefined ? undefined : structuredValues(base);
  const behavior = keycode === undefined ? "none" : behaviorKind(lexeme);
  const options =
    mode === "mac" ? macBehaviorOptions(behavior) : [...new Set([behavior, ...BEHAVIOR_OPTIONS])];
  const withoutHold = keycode === undefined ? undefined : removeHold(keycode);
  function onRemoveHold(): void {
    if (withoutHold === undefined) return;
    const backToPassthrough =
      mode === "mac" &&
      passthroughKeycode !== undefined &&
      canonicalKeycode(withoutHold) === canonicalKeycode(passthroughKeycode);
    if (backToPassthrough) onClear();
    else onEdit(withoutHold);
  }
  const referencedLayer = lexeme?.kind === "layerSwitch" ? lexeme.layer : undefined;
  /** 適用先ごとの現在値。Tap は素通しなら送るキーを初期値として出す。 */
  const slotValue = (target: PickTarget): string | undefined =>
    target === "tap" ? targetValue(base, "tap") : targetValue(keycode, target);
  const readable = (value: string | undefined): string => {
    if (value === undefined) return "—";
    const shown = keycodeDisplay(value, labels, table, { compact: true });
    const text = shown.role === undefined ? shown.primary : `${shown.primary} · ${shown.role}`;
    return text.replace(/\n/g, " ");
  };

  return (
    <aside className="inspector" aria-labelledby="inspector-title" onKeyDown={onKeyDown}>
      <div className="panel-head">
        {heading}
        <span className="tag">{position}</span>
      </div>

      <div className="selected">
        <span className={`cap ${kindClass(keycode)}`} aria-hidden="true">
          {display === undefined ? <span className="keycap-main">—</span> : renderKeycode(display)}
        </span>
        <div>
          <code className="raw">{keycode ?? "割り当てなし（素通し）"}</code>
          <p className="behavior">
            {keycode === undefined ? "入力をそのまま通す" : describeKeycode(keycode, table)}
          </p>
          {referencedLayer === undefined ? null : jumpableLayers.has(referencedLayer) ? (
            <button type="button" className="link" onClick={() => onJumpLayer(referencedLayer)}>
              <Icon name="arrow-right" />{" "}
              {mode === "cornix" ? layerLabel(labels, referencedLayer) : `layer ${referencedLayer}`}{" "}
              を開く
            </button>
          ) : (
            <p className="hint">layer {referencedLayer} を参照している（この対象には無い layer）</p>
          )}
        </div>
      </div>

      <fieldset className="seg">
        <legend>下の一覧で選ぶ先</legend>
        {PICK_TARGETS.map((option) => {
          const value = slotValue(option.id);
          const shown = option.id === "whole" && keycode === undefined ? "素通し" : readable(value);
          return (
            <div key={option.id} className="seg-cell">
              <label className={pickTarget === option.id ? "is-on" : ""} title={value}>
                <input
                  type="radio"
                  name="pick-target"
                  value={option.id}
                  checked={pickTarget === option.id}
                  onChange={() => onPickTarget(option.id)}
                />
                <span className="seg-label">{option.label}</span>
                <span className="seg-value">{shown}</span>
              </label>
              {option.id === "hold" && withoutHold !== undefined ? (
                <button
                  type="button"
                  className="seg-clear"
                  aria-label="Hold を外す"
                  title="Hold を外す"
                  onClick={onRemoveHold}
                >
                  <Icon name="close" />
                </button>
              ) : null}
            </div>
          );
        })}
      </fieldset>
      <p className="hint">
        {pickTarget === "hold"
          ? "Hold には修飾キーと MO(n) だけ選べる。"
          : "選ぶとすぐに保存する。"}
      </p>

      <details className="details">
        <summary>詳細</summary>
        <label className="field">
          <span>動作</span>
          <select
            value={behavior}
            onChange={(event) => onEdit(composeKeycode(event.target.value, structured))}
          >
            {options.map((option) => (
              <option value={option} key={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <form
          className="field"
          onSubmit={(event) => {
            event.preventDefault();
            const value = draftRaw.trim();
            if (value === "") {
              if (mode === "mac") onClear();
              return;
            }
            onEdit(value);
          }}
        >
          <label htmlFor="inspector-raw">raw keycode</label>
          <div className="field-row">
            <input
              id="inspector-raw"
              data-keymap-editor
              value={draftRaw}
              placeholder={mode === "mac" ? "空 = 素通し" : undefined}
              spellCheck={false}
              onChange={(event) => setDraftRaw(event.target.value)}
            />
            <Button size="small" appearance="secondary" type="submit">
              反映
            </Button>
          </div>
          <p className="hint">Enter または「反映」で保存する。</p>
        </form>
        {mode === "cornix" && keycode !== undefined ? (
          <div className="field">
            <label htmlFor="inspector-name">表示名（任意）</label>
            <input
              id="inspector-name"
              value={draftName}
              placeholder="例: 英数"
              onChange={(event) => setDraftName(event.target.value)}
              onBlur={() => {
                if (draftName.trim() !== nameFor(keycode)) onLabel(keycode, draftName.trim());
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                event.currentTarget.blur();
              }}
            />
            <p className="hint">
              keysync/labels.yaml に保存する。空欄は表示名を消す。実機へ書く内容は変わらない。
            </p>
          </div>
        ) : null}
        {location === undefined ? null : (
          <dl className="kv">
            <dt>{save.path}</dt>
            <dd>
              <code>{location}</code>
            </dd>
          </dl>
        )}
        {mode === "mac" && keycode !== undefined ? (
          <Button size="small" appearance="danger" onClick={onClear}>
            割り当てを外す（素通しへ戻す）
          </Button>
        ) : null}
      </details>

      <SaveBox mode={mode} save={save} />
    </aside>
  );
}

const SAVE_VIEW: Readonly<
  Record<
    SaveState["kind"],
    { readonly className: string; readonly icon: IconName | undefined; readonly text: string }
  >
> = {
  idle: { className: "save is-idle", icon: undefined, text: "未保存の変更はない" },
  saving: { className: "save is-saving", icon: "saving", text: "保存中…" },
  saved: { className: "save is-saved", icon: "check", text: "ローカル保存済み" },
  error: { className: "save is-error", icon: "error", text: "保存に失敗した" },
  conflict: {
    className: "save is-conflict",
    icon: "warning",
    text: "外部で変更されたため保存できない",
  },
};

/** 選択中の編集の保存状態。error は再試行、conflict は再読込だけを出す。 */
function SaveBox({
  mode,
  save,
}: {
  readonly mode: "cornix" | "mac";
  readonly save: InspectorSave;
}): React.JSX.Element {
  const view = SAVE_VIEW[save.state.kind];
  return (
    <section className={view.className} aria-label="保存状態" data-save={save.state.kind}>
      <p className="save-line" role="status" aria-live="polite">
        <span className="save-icon">
          {view.icon === undefined ? null : <Icon name={view.icon} />}
        </span>
        <strong>{view.text}</strong>
      </p>
      <p className="save-file">
        <code>{save.path}</code>
      </p>
      {save.state.kind === "error" ? (
        <>
          <p className="save-note">{save.state.message}</p>
          <Button size="small" appearance="secondary" onClick={save.onRetry}>
            もう一度保存する
          </Button>
        </>
      ) : null}
      {save.state.kind === "conflict" ? (
        <>
          <p className="save-warning">
            未保存の編集は失われている。外部エディタの変更を上書きしないため、この後の編集も保存されない。
          </p>
          <p className="save-note">{save.state.message}</p>
          <Button size="small" appearance="danger" onClick={save.onReload}>
            ディスクから再読込
          </Button>
        </>
      ) : null}
      <p className="save-note">
        {mode === "cornix"
          ? "ローカルの workspace への保存。実機へは「実機へ Apply」で反映する。"
          : "ローカルの workspace への保存。Mac へは「Karabiner へ適用」で反映する。"}
      </p>
    </section>
  );
}
