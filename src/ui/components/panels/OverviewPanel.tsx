import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createKeycodeTable } from "../../../core/keycode/table.ts";
import type { buildKeymapView } from "../../../core/model/keymap-view.ts";
import { analyzeReachability } from "../../../core/validation/reachability.ts";
import type { KeyboardDefinition } from "../../../core/definition/types.ts";
import type { VilDocument } from "../../../core/vil/types.ts";
import { boardMetrics, boardSize, keyBox } from "../../../render/geometry.ts";
import { keycodeLabel, layerLabel, type WorkspaceLabels } from "../../../workspace/labels.ts";
import { keycapTitle, keycodeDisplay, kindClass } from "../keycode-display.tsx";
import { overviewColumns } from "../../overview-layout.ts";
import {
  buildOverviewModel,
  type OverviewLayerReference,
  type OverviewModel,
} from "../../overview-model.ts";
import { OVERVIEW_BOARD_SCALE, useBoardScale } from "../../use-board-scale.ts";
import { Button } from "../Button.tsx";
import { FitText } from "../FitText.tsx";
import { layerTone } from "../LayerBar.tsx";

type KeymapView = ReturnType<typeof buildKeymapView>;
type KeycodeTable = ReturnType<typeof createKeycodeTable>;

const TAP_DANCE_FIELDS = ["tap", "hold", "double tap", "hold after tap"] as const;

/**
 * 全体マップ。参照元のある layer を mini 盤面のカードで並べ、参照元をたどって元の layer を開ける。
 *
 * 表示する layer は layer 0 と、物理キー・encoder・Tap Dance・Combo から参照される layer。
 * 参照ありの判定は表示用の集計で、reachability 診断、severity、Apply gate を変えない。
 */
export function OverviewPanel({
  document,
  definition,
  view,
  labels,
  currentLayer,
  onRenameLayer,
  onOpenLayer,
  onExportSvg,
  onExportPdf,
}: {
  readonly document: VilDocument;
  readonly definition: KeyboardDefinition;
  readonly view: KeymapView;
  readonly labels: WorkspaceLabels;
  readonly currentLayer: number;
  readonly onRenameLayer: (layer: number, value: string) => void;
  readonly onOpenLayer: (layer: number) => void;
  readonly onExportSvg: () => void;
  readonly onExportPdf: () => void;
}): React.JSX.Element {
  const [showHidden, setShowHidden] = useState(false);
  const [hot, setHot] = useState<string | undefined>();
  const overview = buildOverviewModel(document);
  const reachability = analyzeReachability(document);
  const table = createKeycodeTable(definition, view.capacities);
  const layers = showHidden
    ? Array.from({ length: overview.layerCount }, (_, layer) => layer)
    : overview.visibleLayers;
  const gridRef = useRef<HTMLDivElement>(null);
  const [gridWidth, setGridWidth] = useState(0);

  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (grid === null) return;
    const measure = (): void => setGridWidth(grid.clientWidth);
    const observer = new ResizeObserver(measure);
    observer.observe(grid);
    measure();
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <div className="sheet-tools">
        <span className="muted">
          参照あり {overview.visibleLayers.length} / {overview.layerCount} layer
        </span>
        {overview.hiddenLayers.length === 0 ? null : (
          <label className="check">
            <input
              type="checkbox"
              checked={showHidden}
              onChange={(event) => setShowHidden(event.target.checked)}
            />
            参照なしの layer も表示（{overview.hiddenLayers.length} 件）
          </label>
        )}
        <span className="spacer" />
        <Button size="small" appearance="secondary" onClick={onExportSvg}>
          layer {currentLayer} を SVG で書き出す
        </Button>
        <Button size="small" appearance="secondary" onClick={onExportPdf}>
          layer {currentLayer} を PDF で書き出す
        </Button>
      </div>
      <div
        className="ov-grid"
        ref={gridRef}
        style={{
          gridTemplateColumns: `repeat(${overviewColumns(layers.length, gridWidth)}, minmax(0, 1fr))`,
        }}
      >
        {layers.map((layer) => (
          <LayerCard
            key={layer}
            layer={layer}
            view={view}
            table={table}
            labels={labels}
            overview={overview}
            reachable={layer === 0 || reachability.reachable.has(layer)}
            hot={hot}
            onHot={setHot}
            onRenameLayer={onRenameLayer}
            onOpenLayer={onOpenLayer}
          />
        ))}
      </div>
      <section className="ov-td" aria-labelledby="ov-td-title">
        <h3 id="ov-td-title" className="section-title">
          使用中の Tap Dance（{overview.tapDances.length} 件）
        </h3>
        {overview.tapDances.length === 0 ? <p>参照されている Tap Dance は無い。</p> : null}
        {overview.tapDances.map(({ index, usageCount, entry }) => (
          <p key={index}>
            <code>{keycodeLabel(labels, `TD(${index})`) ?? `TD(${index})`}</code>{" "}
            {TAP_DANCE_FIELDS.map((field, fieldIndex) => {
              const keycode = String(entry[fieldIndex]);
              const display = keycodeDisplay(keycode, labels, table, { compact: false });
              return (
                <span key={field} title={keycode}>
                  {field} {display.primary.replace(/\n/g, " ")}
                  {display.role === undefined ? "" : ` ${display.role}`} ·{" "}
                </span>
              );
            })}
            {entry[4]}ms · {usageCount} か所
          </p>
        ))}
        <p className="hint">Tap Dance の編集は「動作」で行う。</p>
      </section>
    </>
  );
}

function LayerCard({
  layer,
  view,
  table,
  labels,
  overview,
  reachable,
  hot,
  onHot,
  onRenameLayer,
  onOpenLayer,
}: {
  readonly layer: number;
  readonly view: KeymapView;
  readonly table: KeycodeTable;
  readonly labels: WorkspaceLabels;
  readonly overview: OverviewModel;
  readonly reachable: boolean;
  readonly hot: string | undefined;
  readonly onHot: (id: string | undefined) => void;
  readonly onRenameLayer: (layer: number, value: string) => void;
  readonly onOpenLayer: (layer: number) => void;
}): React.JSX.Element {
  const keys = view.keys.filter((key) => key.position.layer === layer);
  const encoders = view.encoders.filter((encoder) => encoder.layer === layer);
  const metrics = boardMetrics(keys.map((key) => key.physical));
  const { ref, scale } = useBoardScale(metrics, OVERVIEW_BOARD_SCALE);
  const size = boardSize(metrics, scale);
  const references = overview.referencesByTarget.get(layer) ?? [];
  const named = labels.layers.get(layer);
  const [draft, setDraft] = useState(named ?? "");
  const cancelled = useRef(false);

  useEffect(() => {
    setDraft(named ?? "");
  }, [named]);

  function commit(): void {
    if (cancelled.current) {
      cancelled.current = false;
      setDraft(named ?? "");
      return;
    }
    const value = draft.trim();
    if (value !== (named ?? "")) onRenameLayer(layer, value);
  }

  return (
    <section
      className={`ov-card ${layerTone(layer)}`}
      aria-labelledby={`ov-name-${layer}`}
      data-overview-layer={layer}
    >
      <header className="ov-head">
        <span className="layer-badge">L{layer}</span>
        <input
          id={`ov-name-${layer}`}
          className="ov-name"
          aria-label={`layer ${layer} の表示名`}
          value={draft}
          placeholder={`layer ${layer}`}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            } else if (event.key === "Escape") {
              // パネル全体を閉じずに、入力だけを取り消す。
              event.preventDefault();
              event.stopPropagation();
              cancelled.current = true;
              event.currentTarget.blur();
            }
          }}
        />
        {layer !== 0 && references.length === 0 ? <span className="tag">参照なし</span> : null}
        {layer !== 0 && references.length > 0 && !reachable ? (
          <span className="tag tag-warn">到達不能</span>
        ) : null}
        <Button size="small" appearance="quiet" onClick={() => onOpenLayer(layer)}>
          開く
        </Button>
      </header>
      <div className="ov-board-host" ref={ref}>
        <div
          className="ov-board"
          aria-hidden="true"
          style={{ width: `${size.width}px`, height: `${size.height}px` }}
        >
          {keys.map((key) => {
            const box = keyBox(key.physical, metrics, scale);
            const display = keycodeDisplay(key.keycode, labels, table, { compact: true });
            const id = `key:${layer}:${key.position.row}:${key.position.col}`;
            return (
              <span
                key={id}
                className={`mini ${kindClass(key.keycode)}${hot === id ? " is-hot" : ""}`}
                title={keycapTitle(display, key.keycode)}
                style={{
                  left: `${box.left}px`,
                  top: `${box.top}px`,
                  width: `${box.width}px`,
                  height: `${box.height}px`,
                  transform: box.angle === 0 ? undefined : `rotate(${box.angle}deg)`,
                  transformOrigin:
                    box.angle === 0 ? undefined : `${box.originX}px ${box.originY}px`,
                  ["--cap-font" as string]: `${Math.max(7, Math.round(scale.unit * 0.3))}px`,
                }}
              >
                <FitText className="keycap-main">{display.primary.split("\n")[0] ?? ""}</FitText>
              </span>
            );
          })}
        </div>
      </div>
      {encoders.length === 0 ? null : (
        <p className="ov-encoders">
          {[...new Set(encoders.map((encoder) => encoder.index))]
            .sort((left, right) => left - right)
            .map((index) => (
              <span key={index}>
                E{index}{" "}
                {(["ccw", "cw"] as const)
                  .map((direction) => {
                    const encoder = encoders.find(
                      (candidate) => candidate.index === index && candidate.direction === direction,
                    );
                    if (encoder === undefined) return "";
                    const display = keycodeDisplay(encoder.keycode, labels, table, {
                      compact: true,
                    });
                    return `${direction === "ccw" ? "↺" : "↻"} ${display.primary.replace(/\n/g, " ")}`;
                  })
                  .join(" ")}
              </span>
            ))}
        </p>
      )}
      {references.length === 0 ? (
        <p className="ov-summary">{layer === 0 ? "起点の layer" : "参照元なし"}</p>
      ) : (
        <ul className="ov-refs" aria-label={`${layerLabel(labels, layer)} への参照元`}>
          {references.map((reference) => (
            <ReferenceItem
              key={`${reference.source.id}->${reference.targetLayer}`}
              reference={reference}
              onHot={onHot}
              onOpenLayer={onOpenLayer}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function ReferenceItem({
  reference,
  onHot,
  onOpenLayer,
}: {
  readonly reference: OverviewLayerReference;
  readonly onHot: (id: string | undefined) => void;
  readonly onOpenLayer: (layer: number) => void;
}): React.JSX.Element {
  const source = reference.source;
  const text =
    source.kind === "key"
      ? `← L${source.layer} row ${source.row} col ${source.col}`
      : source.kind === "encoder"
        ? `← L${source.layer} encoder ${source.index} ${source.direction === "ccw" ? "左回し" : "右回し"}`
        : source.kind === "tapDance"
          ? `← Tap Dance ${source.index} ${TAP_DANCE_FIELDS[source.field ?? 0] ?? ""}`
          : `← Combo ${source.index}`;
  const content = (
    <>
      {text} <code>{source.keycode}</code> <span className="muted">（{reference.action}）</span>
    </>
  );
  if (source.layer === undefined) {
    return (
      <li>
        <span>{content}</span>
      </li>
    );
  }
  const sourceLayer = source.layer;
  return (
    <li>
      <button
        type="button"
        onMouseEnter={() => onHot(source.id)}
        onMouseLeave={() => onHot(undefined)}
        onFocus={() => onHot(source.id)}
        onBlur={() => onHot(undefined)}
        onClick={() => onOpenLayer(sourceLayer)}
        aria-label={`${text.replace("← ", "")} の ${source.keycode} から参照。layer ${sourceLayer} を開く`}
      >
        {content}
      </button>
    </li>
  );
}
