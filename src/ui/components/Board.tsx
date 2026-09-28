import { useRef } from "react";
import type { createKeycodeTable } from "../../core/keycode/table.ts";
import type { MacKeymapDocument } from "../../core/mac-keymap/types.ts";
import type { buildKeymapView } from "../../core/model/keymap-view.ts";
import {
  boardMetrics,
  boardSize,
  keyBox,
  type BoardScale,
  type KeyBox,
} from "../../render/geometry.ts";
import type { WorkspaceLabels } from "../../workspace/labels.ts";
import { moveKey } from "../key-navigation.ts";
import { keycapTitle, keycodeDisplay, kindClass, renderKeycode } from "../keycode-display.tsx";
import { macBoardEntries } from "../mac-board.ts";
import { macKeycapLabel } from "../mac-keycap-labels.ts";
import type { Selection } from "../types.ts";
import { KEYMAP_BOARD_SCALE, useStageScale } from "../use-board-scale.ts";
import { Icon } from "./Icon.tsx";

type KeymapView = ReturnType<typeof buildKeymapView>;
type KeycodeTable = ReturnType<typeof createKeycodeTable>;

const DIAGNOSTIC_TEXT = { error: "エラーあり", warning: "警告あり" } as const;

function boxStyle(box: KeyBox, scale: BoardScale): React.CSSProperties {
  return {
    left: `${box.left}px`,
    top: `${box.top}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
    transform: box.angle === 0 ? undefined : `rotate(${box.angle}deg)`,
    transformOrigin: box.angle === 0 ? undefined : `${box.originX}px ${box.originY}px`,
    ["--cap-font" as string]: `${Math.max(10, Math.round(scale.unit * 0.26))}px`,
    ["--cap-sub-font" as string]: `${Math.max(9, Math.round(scale.unit * 0.2))}px`,
  };
}

/** 盤面の選択中のキー（無ければ最初のキー）へ focus を移す。 */
export function focusBoard(): void {
  const board = document.querySelector("[data-board]");
  const selected = board?.querySelector<HTMLElement>('[aria-pressed="true"]');
  (selected ?? board?.querySelector<HTMLElement>("button"))?.focus();
}

/**
 * Cornix LP の盤面と encoder の帯。
 *
 * 座標は `src/render/geometry.ts` だけから投影する。encoder は物理キーと混ぜず、実機が申告した本数を帯に並べる。
 * 方向キーで幾何的に隣のキーへ移り、Enter で編集パネルへ入る。
 */
export function CornixBoard({
  view,
  table,
  layer,
  labels,
  selection,
  onSelect,
  onEnter,
  diffKeys,
  diagnosticMarks,
}: {
  readonly view: KeymapView;
  readonly table: KeycodeTable;
  readonly layer: number;
  readonly labels: WorkspaceLabels;
  readonly selection: Selection | undefined;
  readonly onSelect: (selection: Selection) => void;
  readonly onEnter: () => void;
  readonly diffKeys: ReadonlySet<string>;
  readonly diagnosticMarks: ReadonlyMap<string, "error" | "warning">;
}): React.JSX.Element {
  const layerKeys = view.keys.filter((key) => key.position.layer === layer);
  const encoders = view.encoders.filter((encoder) => encoder.layer === layer);
  const metrics = boardMetrics(layerKeys.map((key) => key.physical));
  const stripRef = useRef<HTMLDivElement>(null);
  const { ref, scale } = useStageScale(metrics, KEYMAP_BOARD_SCALE, stripRef);
  const size = boardSize(metrics, scale);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const firstKey = layerKeys[0];

  function onKeyDown(
    event: React.KeyboardEvent<HTMLButtonElement>,
    key: (typeof layerKeys)[number],
  ): void {
    if (event.key === "Enter") {
      event.preventDefault();
      onEnter();
      return;
    }
    if (!event.key.startsWith("Arrow")) return;
    const next = moveKey(layerKeys, key, event.key);
    if (next === undefined) return;
    event.preventDefault();
    onSelect({ kind: "key", row: next.position.row, col: next.position.col });
    buttons.current.get(`${next.position.row},${next.position.col}`)?.focus();
  }

  return (
    <div className="board-fit" ref={ref}>
      <div
        className="board"
        data-board="cornix"
        role="group"
        aria-label={`Cornix LP の盤面、layer ${layer}。方向キーで移動、Enter で編集パネルへ`}
        style={{ width: `${size.width}px`, height: `${size.height}px` }}
      >
        {layerKeys.map((key) => {
          const { row, col } = key.position;
          const id = `${row},${col}`;
          const display = keycodeDisplay(key.keycode, labels, table, { compact: true });
          const selected =
            selection?.kind === "key" && selection.row === row && selection.col === col;
          const focusable = selected || (selection?.kind !== "key" && key === firstKey);
          const subject = `key:${layer}:${row}:${col}`;
          const diff = diffKeys.has(subject);
          const mark = diagnosticMarks.get(subject);
          return (
            <button
              key={id}
              ref={(element) => {
                if (element === null) buttons.current.delete(id);
                else buttons.current.set(id, element);
              }}
              type="button"
              data-key={id}
              className={`key ${kindClass(key.keycode)}${selected ? " is-selected" : ""}`}
              style={boxStyle(keyBox(key.physical, metrics, scale), scale)}
              tabIndex={focusable ? 0 : -1}
              aria-pressed={selected}
              aria-label={`row ${row} col ${col}: ${display.primary.replace(/\n/g, " ")}${display.role === undefined ? "" : ` ${display.role}`}（${key.keycode}）${diff ? "、実機と差分あり" : ""}${mark === undefined ? "" : `、${DIAGNOSTIC_TEXT[mark]}`}`}
              title={keycapTitle(display, key.keycode)}
              onClick={() => onSelect({ kind: "key", row, col })}
              onKeyDown={(event) => onKeyDown(event, key)}
            >
              {renderKeycode(display)}
              {diff ? <span className="key-diff" aria-hidden="true" /> : null}
              {mark === undefined ? null : (
                <span
                  className={mark === "error" ? "key-diag is-error" : "key-diag"}
                  aria-hidden="true"
                >
                  {mark === "error" ? "×" : "!"}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="encoders" role="group" aria-label="encoder" ref={stripRef}>
        {[...new Set(encoders.map((encoder) => encoder.index))]
          .sort((left, right) => left - right)
          .map((index) => (
            <div className="encoder" key={index}>
              <span className="encoder-name">
                <span aria-hidden="true" className="encoder-dial" />
                encoder {index}
              </span>
              {(["ccw", "cw"] as const).map((direction) => {
                const encoder = encoders.find(
                  (candidate) => candidate.index === index && candidate.direction === direction,
                );
                if (encoder === undefined) return null;
                const display = keycodeDisplay(encoder.keycode, labels, table, { compact: true });
                const selected =
                  selection?.kind === "encoder" &&
                  selection.index === index &&
                  selection.direction === direction;
                const subject = `encoder:${layer}:${index}:${direction}`;
                const diff = diffKeys.has(subject);
                const mark = diagnosticMarks.get(subject);
                const turn = direction === "ccw" ? "左回し" : "右回し";
                return (
                  <button
                    key={direction}
                    type="button"
                    data-encoder={`${index},${direction}`}
                    className={`slot ${kindClass(encoder.keycode)}${selected ? " is-selected" : ""}`}
                    aria-pressed={selected}
                    aria-label={`encoder ${index} ${turn}: ${display.primary.replace(/\n/g, " ")}${display.role === undefined ? "" : ` ${display.role}`}（${encoder.keycode}）${diff ? "、実機と差分あり" : ""}${mark === undefined ? "" : `、${DIAGNOSTIC_TEXT[mark]}`}`}
                    title={keycapTitle(display, encoder.keycode)}
                    onClick={() => onSelect({ kind: "encoder", index, direction })}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") return;
                      event.preventDefault();
                      onEnter();
                    }}
                  >
                    <span className="slot-dir">
                      <Icon name={direction === "ccw" ? "rotate-ccw" : "rotate-cw"} />
                      <span className="slot-dir-label">
                        {turn}
                        {mark === undefined ? "" : mark === "error" ? " ×" : " !"}
                      </span>
                    </span>
                    <span className="slot-value">
                      {display.primary.replace(/\n/g, " ")}
                      {display.role === undefined ? null : <small> {display.role}</small>}
                    </span>
                    {diff ? <span className="key-diff" aria-hidden="true" /> : null}
                  </button>
                );
              })}
            </div>
          ))}
      </div>
    </div>
  );
}

/**
 * Mac の物理盤面。物理配列を正として全キーを並べる。割り当ての無いキーは、layer 0 では素通しとして
 * 刻印を出し、layer 1 以上では割り当てなし（何も出さない）として `—` を出す（ADR 0050）。
 */
export function MacBoard({
  document,
  layer,
  labels,
  selection,
  onSelect,
  onEnter,
  diagnosticMarks,
}: {
  readonly document: MacKeymapDocument;
  readonly layer: number;
  /** layer 名は Vial の layer 番号空間のものなので、剥がした labels を渡す。 */
  readonly labels: WorkspaceLabels;
  readonly selection: Selection | undefined;
  readonly onSelect: (selection: Selection) => void;
  readonly onEnter: () => void;
  readonly diagnosticMarks: ReadonlyMap<string, "error" | "warning">;
}): React.JSX.Element {
  const entries = macBoardEntries(document, layer);
  const metrics = boardMetrics(entries.map((entry) => entry.physical));
  const { ref, scale } = useStageScale(metrics, KEYMAP_BOARD_SCALE);
  const size = boardSize(metrics, scale);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const selectedKeyCode = selection?.kind === "macKey" ? selection.keyCode : undefined;
  const firstKeyCode = entries[0]?.keyCode;

  return (
    <div className="board-fit" ref={ref}>
      <div
        className="board"
        data-board={document.layout}
        role="group"
        aria-label={`Mac ${document.layout.toUpperCase()} の盤面、layer ${layer}。方向キーで移動、Enter で編集パネルへ`}
        style={{ width: `${size.width}px`, height: `${size.height}px` }}
      >
        {entries.map((entry) => {
          const cap = macKeycapLabel(entry.keyCode, document.layout);
          // 割り当ての無いキーは layer 0 だけ素通しになり、layer 1 以上は何も出さない。
          const unassigned = layer === 0 ? "素通し" : "割り当てなし";
          const shownKeycode = entry.keycode ?? (layer === 0 ? undefined : "KC_NO");
          const display =
            shownKeycode === undefined
              ? undefined
              : keycodeDisplay(shownKeycode, labels, undefined, { compact: true });
          const selected = selectedKeyCode === entry.keyCode;
          const focusable =
            selected || (selectedKeyCode === undefined && entry.keyCode === firstKeyCode);
          const mark = diagnosticMarks.get(`macKey:${layer}:${entry.keyCode}`);
          return (
            <button
              key={entry.keyCode}
              ref={(element) => {
                if (element === null) buttons.current.delete(entry.keyCode);
                else buttons.current.set(entry.keyCode, element);
              }}
              type="button"
              data-mac-key={entry.keyCode}
              className={`key ${kindClass(shownKeycode)}${selected ? " is-selected" : ""}`}
              style={boxStyle(keyBox(entry.physical, metrics, scale), scale)}
              tabIndex={focusable ? 0 : -1}
              aria-pressed={selected}
              aria-label={`${cap}: ${
                display === undefined || entry.keycode === undefined
                  ? unassigned
                  : `${display.primary.replace(/\n/g, " ")}${display.role === undefined ? "" : ` ${display.role}`}（${entry.keycode}）`
              }${mark === undefined ? "" : `、${DIAGNOSTIC_TEXT[mark]}`}`}
              title={
                display === undefined || entry.keycode === undefined
                  ? `${cap} (${entry.keyCode}) — ${unassigned}`
                  : keycapTitle(display, entry.keycode)
              }
              onClick={() => onSelect({ kind: "macKey", keyCode: entry.keyCode })}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  onEnter();
                  return;
                }
                if (!event.key.startsWith("Arrow")) return;
                const next = moveKey(entries, entry, event.key);
                if (next === undefined) return;
                event.preventDefault();
                onSelect({ kind: "macKey", keyCode: next.keyCode });
                buttons.current.get(next.keyCode)?.focus();
              }}
            >
              {display === undefined ? (
                <span className="keycap-main">{cap}</span>
              ) : (
                renderKeycode(display)
              )}
              {mark === undefined ? null : (
                <span
                  className={mark === "error" ? "key-diag is-error" : "key-diag"}
                  aria-hidden="true"
                >
                  {mark === "error" ? "×" : "!"}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
