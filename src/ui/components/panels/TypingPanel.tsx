import { useState } from "react";
import {
  gradeTypingTrial,
  tokenizeTypedEvents,
  type TrialGrade,
} from "../../../core/typing-trial/grade.ts";
import type { TrialRecord } from "../../../core/typing-trial/history.ts";
import type { BrowserLogEvent } from "../../../core/typing-log/types.ts";
import { summarizeTrials } from "../../../core/typing-trial/history.ts";
import {
  customTask,
  HOLD_REPEAT,
  holdTasksFor,
  modTapPositionsIn,
  ROLL_TASKS,
} from "../../../core/typing-trial/tasks.ts";
import type {
  ModifierSet,
  TrialToken,
  TypedEvent,
  TypingTask,
} from "../../../core/typing-trial/types.ts";
import { MAC_TAPPING_TERM_RANGE, type MacKeymapDocument } from "../../../core/mac-keymap/types.ts";
import { macKeycapLabel } from "../../mac-keycap-labels.ts";
import { Button } from "../Button.tsx";
import { ValueField } from "./BehaviorsPanel.tsx";

const CUSTOM = "custom";

function modifierMarks(modifiers: ModifierSet): string {
  return `${modifiers.ctrl ? "⌃" : ""}${modifiers.alt ? "⌥" : ""}${modifiers.shift ? "⇧" : ""}${modifiers.meta ? "⌘" : ""}`;
}

/** token の表示。空白は見えないため記号にする。 */
export function tokenLabel(token: TrialToken): string {
  if (token.kind === "char") return token.char === " " ? "␣" : token.char;
  const key =
    token.key === " " ? "Space" : token.key.length === 1 ? token.key.toUpperCase() : token.key;
  return `${modifierMarks(token.modifiers)}${key}`;
}

function percent(ok: number, expected: number): string {
  return expected === 0 ? "—" : `${Math.round((ok / expected) * 100)}%（${ok}/${expected}）`;
}

function taskInstruction(task: TypingTask, document: MacKeymapDocument): string {
  if (task.kind === "text") return task.text;
  const hold = holdKeyLabel(task.holdKeyCode, document);
  const expected = task.expected[0];
  const chord = expected === undefined ? "" : tokenLabel(expected);
  return `${hold} を押し続けて ${task.partner.toUpperCase()} を押し、両方離す。これを ${HOLD_REPEAT} 回（期待は ${chord}）。`;
}

/** 押し続けるキーの表示名。左右で刻印が同じキー（shift など）は左右を添える。 */
function holdKeyLabel(keyCode: string, document: MacKeymapDocument): string {
  const label = macKeycapLabel(keyCode, document.layout);
  if (keyCode.startsWith("left_")) return `左 ${label}`;
  if (keyCode.startsWith("right_")) return `右 ${label}`;
  return label;
}

function holdOptionLabel(task: TypingTask, document: MacKeymapDocument): string {
  if (task.kind !== "hold") return task.id;
  const expected = task.expected[0];
  return `${holdKeyLabel(task.holdKeyCode, document)} を押し続ける（${expected === undefined ? "" : tokenLabel(expected)}）`;
}

/** `KeyboardEvent` を Core の語彙へ写す。 */
function typedEvent(event: React.KeyboardEvent): TypedEvent {
  return {
    key: event.key,
    code: event.code,
    meta: event.metaKey,
    ctrl: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
    composing: event.nativeEvent.isComposing || event.key === "Process",
  };
}

/** `KeyboardEvent` をログの 1 行へ写す。記録はできるだけ落とさない（ADR 0046）。 */
function browserEvent(event: React.KeyboardEvent): BrowserLogEvent {
  return {
    type: "browser",
    ms: event.timeStamp,
    kind: event.type === "keyup" ? "keyup" : "keydown",
    key: event.key,
    code: event.code,
    location: event.location,
    repeat: event.repeat,
    meta: event.metaKey,
    ctrl: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
    composing: event.nativeEvent.isComposing,
  };
}

/** 試行 1 回のログ。採点の結果と一緒に workspace へ保存する。 */
export interface TrialLog {
  readonly taskId: string;
  readonly prompt: string;
  readonly summary: unknown;
  readonly events: readonly BrowserLogEvent[];
}

/**
 * 打鍵テスト（Mac）。閾値を変えて Karabiner へ適用し、課題を打って採点する（ADR 0045）。
 *
 * ブラウザが受け取るのは Karabiner が処理した後の入力なので、誤爆や取りこぼしを
 * そのまま観測できる。入力欄では既定動作をすべて止め、⌘A などをブラウザに渡さない。
 */
export function TypingPanel({
  document,
  effectiveTappingTermMs,
  applyBlockedReason,
  records,
  onTappingTerm,
  onApply,
  onRecord,
  onSaveLog,
  onClearRecords,
}: {
  readonly document: MacKeymapDocument;
  /** Karabiner で効いていると確かめた閾値。確かめていなければ `undefined`。 */
  readonly effectiveTappingTermMs: number | undefined;
  readonly applyBlockedReason: string | undefined;
  readonly records: readonly TrialRecord[];
  /** 保存できなければ理由を返す。 */
  readonly onTappingTerm: (value: string) => string | undefined;
  readonly onApply: () => void;
  readonly onRecord: (record: TrialRecord) => void;
  /** 採点のたびに、入力欄が受けた全イベントを渡す。 */
  readonly onSaveLog: (log: TrialLog) => void;
  readonly onClearRecords: () => void;
}): React.JSX.Element {
  const holdTasks = holdTasksFor(document);
  const [taskId, setTaskId] = useState<string>(ROLL_TASKS[0]?.id ?? CUSTOM);
  const [customText, setCustomText] = useState("");
  const [events, setEvents] = useState<readonly TypedEvent[]>([]);
  // 採点に使わないもの（keyup、修飾キー単独、autorepeat、Enter）も含めた全イベント。
  const [raw, setRaw] = useState<readonly BrowserLogEvent[]>([]);
  const [grade, setGrade] = useState<TrialGrade | undefined>();

  const task =
    taskId === CUSTOM
      ? customTask(customText)
      : ([...ROLL_TASKS, ...holdTasks].find((one) => one.id === taskId) ?? customTask(customText));
  const typed = tokenizeTypedEvents(events).tokens;
  const rows = summarizeTrials(records);
  const yaml = document.tappingTermMs;

  function reset(): void {
    setEvents([]);
    setRaw([]);
    setGrade(undefined);
  }

  function score(log: readonly BrowserLogEvent[] = raw): void {
    if (task.expected.length === 0 || events.length === 0) return;
    const result = gradeTypingTrial(task, events);
    setGrade(result);
    if (result.kind === "graded") {
      onRecord({ tappingTermMs: effectiveTappingTermMs, kind: task.kind, summary: result.summary });
    }
    onSaveLog({
      taskId: task.id,
      prompt: task.kind === "text" ? task.text : `${task.holdKeyCode} + ${task.partner}`,
      summary: result.kind === "graded" ? result.summary : { ime: true },
      events: log,
    });
    setEvents([]);
    setRaw([]);
  }

  function onKeyUp(event: React.KeyboardEvent<HTMLDivElement>): void {
    event.preventDefault();
    event.stopPropagation();
    // 採点の直後に届く Enter などの離しを、次の試行の頭に入れない。
    if (raw.length === 0) return;
    setRaw((current) => [...current, browserEvent(event)]);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    // ⌘A・⌘F・Esc（dialog を閉じる）などをブラウザへ渡さない。
    event.preventDefault();
    event.stopPropagation();
    const logged = [...raw, browserEvent(event)];
    const plain = !event.metaKey && !event.ctrlKey && !event.altKey;
    if (plain && event.key === "Enter") {
      score(logged);
      return;
    }
    setRaw(logged);
    if (plain && event.key === "Escape") return;
    if (event.repeat) return;
    if (grade !== undefined) setGrade(undefined);
    setEvents((current) => [...current, typedEvent(event)]);
  }

  const status =
    effectiveTappingTermMs === undefined
      ? `Karabiner で効いている閾値をまだ確かめていない。適用すると確かめられる（差分が無ければ書き込まない）。`
      : effectiveTappingTermMs === yaml
        ? `Karabiner に ${yaml} ms が効いている。`
        : `yaml は ${yaml} ms、Karabiner は ${effectiveTappingTermMs} ms。打つ前に適用する。`;

  return (
    <div className="typing">
      <div className="steps">
        <section className="step">
          <h3 className="section-title">
            <span className="step-no">1</span> 閾値を決めて適用する
          </h3>
          <ValueField
            id="typing-tapping-term"
            label={`tapping term（ms、${MAC_TAPPING_TERM_RANGE.min}〜${MAC_TAPPING_TERM_RANGE.max}）`}
            value={String(yaml)}
            numeric
            hint={undefined}
            onCommit={onTappingTerm}
          />
          <p className={effectiveTappingTermMs === yaml ? "typing-status is-ok" : "typing-status"}>
            {status}
          </p>
          <Button size="small" disabled={applyBlockedReason !== undefined} onClick={onApply}>
            Karabiner へ適用…
          </Button>
          {applyBlockedReason === undefined ? null : <p className="hint">{applyBlockedReason}</p>}
        </section>
        <section className="step">
          <h3 className="section-title">
            <span className="step-no">2</span> 課題を選ぶ
          </h3>
          <div className="field">
            <label htmlFor="typing-task">課題</label>
            <select
              id="typing-task"
              value={taskId}
              onChange={(event) => {
                setTaskId(event.target.value);
                reset();
              }}
            >
              <optgroup label="ロール（文字が出るか）">
                {ROLL_TASKS.map((one) => (
                  <option key={one.id} value={one.id}>
                    {one.kind === "text" ? one.title : one.id}
                  </option>
                ))}
              </optgroup>
              {holdTasks.length === 0 ? null : (
                <optgroup label="hold（修飾キーになるか）">
                  {holdTasks.map((one) => (
                    <option key={one.id} value={one.id}>
                      {holdOptionLabel(one, document)}
                    </option>
                  ))}
                </optgroup>
              )}
              <option value={CUSTOM}>自由入力</option>
            </select>
          </div>
          {/* 自由入力を選んでいないときも欄を残し、選び替えでカードの高さを変えない。 */}
          <div className="field">
            <label htmlFor="typing-custom">自由入力の文</label>
            <input
              id="typing-custom"
              value={customText}
              disabled={taskId !== CUSTOM}
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => {
                setCustomText(event.target.value);
                reset();
              }}
            />
          </div>
          <p className="hint">
            IME は英数にして打つ。⌘Space や ⌘Tab など OS が先に取る組み合わせは止められない。
          </p>
        </section>
      </div>

      <section className="step typing-trial">
        <h3 className="section-title">
          <span className="step-no">3</span> 打って採点する
        </h3>
        <p className="typing-prompt">{taskInstruction(task, document) || "打つ文を入れる。"}</p>
        <TaskFocus task={task} document={document} />
        <div
          className="typing-capture"
          role="textbox"
          tabIndex={0}
          aria-label="打鍵の入力欄。Enter で採点する"
          onKeyDown={onKeyDown}
          onKeyUp={onKeyUp}
        >
          {typed.length === 0 ? (
            <span className="muted">ここを選んで打つ。Enter で採点、訂正はしない。</span>
          ) : (
            typed.map((token, index) => (
              <span
                key={index}
                className={token.kind === "chord" ? "typing-token is-chord" : "typing-token"}
              >
                {token.kind === "char" ? token.char : tokenLabel(token)}
              </span>
            ))
          )}
        </div>
        <div className="row">
          <Button
            size="small"
            disabled={task.expected.length === 0 || events.length === 0}
            onClick={() => score()}
          >
            採点
          </Button>
          <Button size="small" appearance="quiet" disabled={events.length === 0} onClick={reset}>
            やり直す
          </Button>
        </div>
        <TrialResult grade={grade} />
      </section>

      <section className="step typing-history">
        <div className="typing-history-head">
          <h3 className="section-title">閾値ごとの成績</h3>
          <Button
            size="small"
            appearance="quiet"
            disabled={records.length === 0}
            onClick={onClearRecords}
          >
            消去
          </Button>
        </div>
        {rows.length === 0 ? (
          <p className="muted">採点すると閾値ごとにここへ貯まる。再読込すると消える。</p>
        ) : (
          <table className="diff-table typing-table">
            <thead>
              <tr>
                <th scope="col">閾値</th>
                <th scope="col">試行</th>
                <th scope="col">文章の正解</th>
                <th scope="col">誤爆</th>
                <th scope="col">消えた</th>
                <th scope="col">入れ替わり</th>
                <th scope="col">その他</th>
                <th scope="col">hold の成功</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.tappingTermMs ?? "unknown"}
                  className={
                    row.tappingTermMs !== undefined && row.tappingTermMs === effectiveTappingTermMs
                      ? "is-current"
                      : undefined
                  }
                >
                  <th scope="row">
                    {row.tappingTermMs === undefined ? "未確認" : `${row.tappingTermMs} ms`}
                  </th>
                  <td>{row.trials}</td>
                  <td>{percent(row.text.ok, row.text.expected)}</td>
                  <td>{row.text.misfire}</td>
                  <td>{row.text.dropped}</td>
                  <td>{row.text.swapped}</td>
                  <td>{row.text.other}</td>
                  <td>{percent(row.hold.ok, row.hold.expected)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="hint">
          文章の誤爆と消えた文字が少なく、hold
          の成功が高い閾値を選ぶ。閾値を上げると誤爆は減り、hold には長く押す必要がある。
        </p>
      </section>
    </div>
  );
}

/** 合わなかった箇所の class。class 名は CSS と突き合わせるため文字列のまま書く。 */
const MARK_CLASS = {
  misfire: "typing-mark is-misfire",
  wrong: "typing-mark",
  dropped: "typing-mark is-dropped",
  extra: "typing-mark",
  swapped: "typing-mark",
} as const;

/** 課題で確かめることと、この keymap で押す mod-tap。課題を替えても高さを変えない。 */
function TaskFocus({
  task,
  document,
}: {
  readonly task: TypingTask;
  readonly document: MacKeymapDocument;
}): React.JSX.Element {
  const positions = modTapPositionsIn(task, document);
  return (
    <div className="typing-focus">
      {task.kind === "text" && task.focus !== "" ? <p>{task.focus}</p> : null}
      {task.kind !== "text" ? null : (
        <p className="hint">
          {positions.length === 0
            ? "この keymap の mod-tap を含まない。"
            : `含む mod-tap: ${positions.map((keyCode) => holdKeyLabel(keyCode, document)).join("・")}`}
        </p>
      )}
    </div>
  );
}

const ENTRY_LABEL = {
  ok: "正",
  misfire: "誤爆",
  wrong: "誤字",
  dropped: "消えた",
  extra: "余分",
  swapped: "入れ替わり",
} as const;

/** 採点結果。期待文字を並べ、合わなかった箇所に出力を添える。 */
function TrialResult({ grade }: { readonly grade: TrialGrade | undefined }): React.JSX.Element {
  if (grade === undefined) {
    return (
      <div className="typing-result">
        <p className="muted">採点するとここに結果が出る。</p>
      </div>
    );
  }
  if (grade.kind === "ime") {
    return (
      <div className="typing-result">
        <p className="error-text">
          IME の変換中の入力が混ざったため採点していない。英数にして打ち直す。Shift を短く押すと
          tap（かな）になり、IME が切り替わることがある。
        </p>
      </div>
    );
  }
  const { entries, summary } = grade;
  return (
    <div className="typing-result">
      <p className="typing-line" aria-label="採点結果">
        {entries.map((entry, index) =>
          entry.kind === "ok" ? (
            <span key={index}>
              {entry.expected
                .map((token) => (token.kind === "char" ? token.char : tokenLabel(token)))
                .join("")}
            </span>
          ) : (
            <mark key={index} className={MARK_CLASS[entry.kind]} title={ENTRY_LABEL[entry.kind]}>
              {entry.expected.map(tokenLabel).join("")}
              {entry.output.length === 0 ? null : (
                <sup>{entry.output.map(tokenLabel).join("")}</sup>
              )}
            </mark>
          ),
        )}
      </p>
      <dl className="typing-counts">
        {(
          [
            ["正解", percent(summary.ok, summary.expected)],
            ["誤爆", summary.misfire],
            ["消えた", summary.dropped],
            ["入れ替わり", summary.swapped],
            ["誤字・余分", summary.wrong + summary.extra],
            ["訂正", summary.corrections],
            ["未入力（数えない）", summary.unfinished],
          ] as const
        ).map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {summary.misfirePairs.length === 0 ? null : (
        <p>
          誤爆した組: {summary.misfirePairs.map(([pair, count]) => `${pair} ×${count}`).join("、")}
        </p>
      )}
    </div>
  );
}
