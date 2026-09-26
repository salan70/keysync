import { useLayoutEffect, useRef, useState } from "react";
import type { createKeycodeTable } from "../../core/keycode/table.ts";
import type { WorkspaceLabels } from "../../workspace/labels.ts";
import { observeFitContainer } from "../fit-text-bus.ts";
import {
  EXTRA_ROW,
  ISO_JIS_ROWS,
  labeledKeyUnits,
  layerPickerRows,
  MEDIA_ROWS,
  PICKER_GROUP_OFFSETS,
  PICKER_LABEL_UNITS,
  PICKER_TABS,
  PICKER_TOTAL_UNITS,
  SPECIAL_ROWS,
  type PickerEntry,
  type PickerLabeledRow,
  type PickerTabId,
} from "../keycode-catalog.ts";
import { canPick, targetValue, type PickTarget } from "../keycode-compose.ts";
import { keycapTitle, keycodeDisplay, kindClass } from "../keycode-display.tsx";
import { FitText } from "./FitText.tsx";

/**
 * keycode の選択盤。Vial に倣ってタブで面を切り替える。基本は ISO/JIS の 26u 物理配列と記号の帯、
 * 他のタブ（レイヤー・メディア・マウス・特殊）は同じ 26u の座標に、行見出しと同じ幅の cell で列を揃えて並べる。
 *
 * 選択中の編集対象が何か（key / encoder / Mac の盤面位置）は知らず、現在値 `selectedKeycode` と、
 * 選ばれた keycode を生のまま通知するだけにする。適用先での組み立て（`applyPick`）と保存先の解決は呼び出し側が持つ（ADR 0025）。
 */
export function Picker({
  table,
  labels,
  pickTarget,
  selectedKeycode,
  layers,
  disabled,
  isKeycodeEnabled,
  disabledReason,
  onPick,
}: {
  readonly table: ReturnType<typeof createKeycodeTable> | undefined;
  readonly labels: WorkspaceLabels;
  readonly pickTarget: PickTarget;
  /** 選択中の編集対象の現在値。未割り当て（Mac の素通し）は `undefined` のまま渡す。 */
  readonly selectedKeycode: string | undefined;
  /** レイヤータブに並べる layer 番号。 */
  readonly layers: readonly number[];
  /** 編集対象が選ばれていないときに全 cell を無効にする。 */
  readonly disabled: boolean;
  /** 省略時は語彙を絞らない。Mac は `macKeycodeSupport` を渡す。 */
  readonly isKeycodeEnabled?: (keycode: string) => boolean;
  /** `isKeycodeEnabled` で無効にした cell の理由。 */
  readonly disabledReason?: string;
  readonly onPick: (keycode: string) => void;
}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<PickerTabId>("basic");
  const current = targetValue(selectedKeycode, pickTarget);

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (element === null) return;
    return observeFitContainer(element);
  }, []);

  function cell(entry: PickerEntry, left: number, key: string): React.JSX.Element | null {
    if (!("keycode" in entry)) return null;
    const unit = entry.u ?? 1;
    const keycode = entry.keycode;
    const holdBlocked = !canPick(pickTarget, keycode);
    const vocabularyBlocked = isKeycodeEnabled !== undefined && !isKeycodeEnabled(keycode);
    const reason = vocabularyBlocked
      ? (disabledReason ?? "この対象では選べない")
      : holdBlocked
        ? "Hold に選べるのは modifier と MO だけ"
        : undefined;
    const display = keycodeDisplay(keycode, labels, table, { compact: true });
    const modifier = canPick("hold", keycode);
    const label = display.primary.replace(/\n/g, " ");
    return (
      <button
        key={key}
        type="button"
        data-keycode={keycode}
        className={`pk ${modifier ? "kind-mod" : kindClass(keycode)}${current === keycode ? " is-current" : ""}`}
        style={{
          left: `${(left / PICKER_TOTAL_UNITS) * 100}%`,
          width: `calc(${(unit / PICKER_TOTAL_UNITS) * 100}% - var(--space-50))`,
        }}
        disabled={disabled || reason !== undefined}
        aria-pressed={current === keycode}
        aria-label={`${label}（${keycode}）${reason === undefined ? "" : `、${reason}`}`}
        title={`${keycapTitle(display, keycode)}${reason === undefined ? "" : `、${reason}`}`}
        onClick={() => onPick(keycode)}
      >
        <FitText className="keycap-main">{display.primary}</FitText>
      </button>
    );
  }

  function group(entries: readonly PickerEntry[] | undefined, offset: number, prefix: string) {
    let left = offset;
    return (entries ?? []).map((entry, index) => {
      const node = cell(entry, left, `${prefix}-${index}`);
      left += entry.u ?? 1;
      return node;
    });
  }

  function labeledRows(rows: readonly PickerLabeledRow[], prefix: string): React.JSX.Element[] {
    const unit = labeledKeyUnits(rows);
    return rows.map((row, index) => (
      <div className="pk-row" key={`${prefix}${index}`}>
        <span
          className="pk-label"
          style={{
            width: `calc(${(PICKER_LABEL_UNITS / PICKER_TOTAL_UNITS) * 100}% - var(--space-50))`,
          }}
        >
          <span className="pk-label-main">{row.label}</span>
          {row.description === undefined ? null : (
            <span className="pk-label-sub">{row.description}</span>
          )}
        </span>
        {group(
          row.keycodes.map((keycode) => ({ keycode, u: unit })),
          PICKER_LABEL_UNITS,
          `${prefix}${index}`,
        )}
      </div>
    ));
  }

  const panels: Readonly<Record<PickerTabId, React.JSX.Element | React.JSX.Element[]>> = {
    basic: (
      <>
        {ISO_JIS_ROWS.map((row, index) => (
          <div className="pk-row" key={index}>
            {group(row.main, PICKER_GROUP_OFFSETS.main, `m${index}`)}
            {group(row.nav, PICKER_GROUP_OFFSETS.nav, `n${index}`)}
            {group(row.numpad, PICKER_GROUP_OFFSETS.numpad, `p${index}`)}
          </div>
        ))}
        <div className="pk-row pk-row-extra">{group(EXTRA_ROW, 0, "x")}</div>
      </>
    ),
    layer: labeledRows(layerPickerRows(layers), "l"),
    media: labeledRows(MEDIA_ROWS, "d"),
    special: labeledRows(SPECIAL_ROWS, "s"),
  };

  return (
    <>
      <div className="tabs pk-tabs" role="tablist" aria-label="keycode の種類">
        {PICKER_TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`picker-tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`picker-panel-${id}`}
            className="tab"
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {/* 全タブを同じ格子に重ねて描き、高さを最も高い面に固定する。タブを切り替えても盤面が動かない。 */}
      <div className="picker" ref={containerRef} aria-disabled={disabled}>
        {PICKER_TABS.map(({ id }) => (
          <div
            key={id}
            className={`pk-panel${tab === id ? "" : " is-inactive"}`}
            role="tabpanel"
            id={`picker-panel-${id}`}
            aria-labelledby={`picker-tab-${id}`}
            inert={tab !== id}
          >
            {panels[id]}
          </div>
        ))}
      </div>
    </>
  );
}
