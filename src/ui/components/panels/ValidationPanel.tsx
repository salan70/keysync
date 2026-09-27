import { useState } from "react";
import type { MacKeyboardLayout } from "../../../core/mac-keymap/types.ts";
import { collectReferenceUsage } from "../../../core/validation/reference-usage.ts";
import { analyzeReachability } from "../../../core/validation/reachability.ts";
import type { Diagnostic, Severity } from "../../../core/validation/types.ts";
import type { VilDocument } from "../../../core/vil/types.ts";
import { keycodeLabel, type WorkspaceLabels } from "../../../workspace/labels.ts";
import { macKeymapPath } from "../../../workspace/layout.ts";
import { canJumpTo, groupDiagnostics, SEVERITY_VIEW, subjectLabel } from "../../diagnostics.ts";
import { describeDevices, kanataDeviceText } from "../../mac-references.ts";
import type { MacWorkspaceState } from "../../mac-workspace.ts";
import { Button } from "../Button.tsx";
import { Icon } from "../Icon.tsx";

const FILTERS: readonly (readonly [Severity | undefined, string])[] = [
  [undefined, "すべて"],
  ["error", "エラー"],
  ["warning", "警告"],
  ["information", "情報"],
];

const DIAG_CLASS: Readonly<Record<Severity, string>> = {
  error: "diag is-error",
  warning: "diag is-warning",
  information: "diag is-information",
};

/**
 * 検証。診断を code ごとにまとめ、盤面の該当位置へ移れるようにする。参照の整合も同じパネルに置く。
 *
 * severity は診断の性質だけで決まり、Apply を止めるかは Apply 側の gate が判断する。
 */
export function ValidationPanel({
  diagnostics,
  filter,
  onFilter,
  onJump,
  references,
}: {
  readonly diagnostics: readonly Diagnostic[];
  readonly filter: Severity | undefined;
  readonly onFilter: (filter: Severity | undefined) => void;
  readonly onJump: (diagnostic: Diagnostic) => void;
  readonly references: React.ReactNode;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const filtered =
    filter === undefined
      ? diagnostics
      : diagnostics.filter((diagnostic) => diagnostic.severity === filter);
  const groups = groupDiagnostics(filtered);

  function row(diagnostic: Diagnostic): React.JSX.Element {
    const view = SEVERITY_VIEW[diagnostic.severity];
    return (
      <li key={diagnostic.id} className={DIAG_CLASS[diagnostic.severity]}>
        <span className="diag-sev">
          <Icon name={view.icon} /> {view.label}
        </span>
        <div>
          <code>{diagnostic.code}</code>
          <p>{diagnostic.message}</p>
        </div>
        {canJumpTo(diagnostic.subject) ? (
          <Button size="small" appearance="quiet" onClick={() => onJump(diagnostic)}>
            {subjectLabel(diagnostic.subject)} へ
          </Button>
        ) : (
          <span className="muted">{subjectLabel(diagnostic.subject)}</span>
        )}
      </li>
    );
  }

  return (
    <>
      <section aria-labelledby="diag-title">
        <h3 id="diag-title" className="section-title">
          診断 {filtered.length} 件
        </h3>
        <div className="filters" role="group" aria-label="severity で絞り込む">
          {FILTERS.map(([value, label]) => (
            <button
              key={label}
              type="button"
              className="filter"
              aria-pressed={filter === value}
              onClick={() => onFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        {groups.length === 0 ? <p className="muted">該当する診断は無い。</p> : null}
        <ul className="diags">
          {groups.map((group) => {
            const [first, ...rest] = group.items;
            if (first === undefined) return null;
            const open = expanded.has(group.code);
            return (
              <li key={group.code} className="diag-group">
                <ul>
                  {row(first)}
                  {rest.length === 0 ? null : (
                    <li>
                      <button
                        type="button"
                        className="link"
                        aria-expanded={open}
                        onClick={() =>
                          setExpanded((current) => {
                            const next = new Set(current);
                            if (open) next.delete(group.code);
                            else next.add(group.code);
                            return next;
                          })
                        }
                      >
                        同じ code の残り {rest.length} 件を{open ? "畳む" : "表示"}
                      </button>
                    </li>
                  )}
                  {open ? rest.map(row) : null}
                </ul>
              </li>
            );
          })}
        </ul>
        <p className="hint">
          Apply を止めるかは Apply 側の判定で決まる。error は常に止め、warning は Apply
          の確認で承認する。
        </p>
      </section>
      {references}
    </>
  );
}

/** Cornix LP の参照の整合。dynamic entry の usages / unused と、到達できない layer。 */
export function CornixReferences({
  document,
  labels,
}: {
  readonly document: VilDocument;
  readonly labels: WorkspaceLabels;
}): React.JSX.Element {
  const usage = collectReferenceUsage(document);
  const reachability = analyzeReachability(document);
  const named = (keycode: string): string => {
    const name = keycodeLabel(labels, keycode);
    return name === undefined ? keycode : `${name}（${keycode}）`;
  };
  const usages = [
    ...[...usage.tapDance.entries()].map(([index, count]) => `${named(`TD(${index})`)} × ${count}`),
    ...[...usage.macro.entries()].map(([index, count]) => `${named(`M(${index})`)} × ${count}`),
  ];
  const unusedTapDance = document.tapDance
    .map((_, index) => index)
    .filter((index) => !usage.tapDance.has(index));
  const unusedMacro = document.macro
    .map((_, index) => index)
    .filter((index) => !usage.macro.has(index));
  const unreachable = document.layout
    .map((_, index) => index)
    .filter((index) => !reachability.reachable.has(index));
  return (
    <section aria-labelledby="ref-title">
      <h3 id="ref-title" className="section-title">
        参照
      </h3>
      <dl className="kv">
        <dt>使用中</dt>
        <dd>{usages.length === 0 ? "参照されている dynamic entry は無い" : usages.join("、")}</dd>
        <dt>未使用</dt>
        <dd>
          Tap Dance{" "}
          {unusedTapDance.length === 0
            ? "なし"
            : unusedTapDance.map((index) => named(`TD(${index})`)).join(", ")}
          <br />
          Macro{" "}
          {unusedMacro.length === 0
            ? "なし"
            : unusedMacro.map((index) => named(`M(${index})`)).join(", ")}
        </dd>
        <dt>到達できない layer</dt>
        <dd>
          {unreachable.length === 0
            ? "なし"
            : unreachable.map((layer) => `layer ${layer}`).join("、")}
        </dd>
      </dl>
    </section>
  );
}

/** Mac の参照。ファイル、物理配列、適用先、件数。内蔵配列の検出は CLI が行う。 */
export function MacReferences({
  layout,
  mac,
  diagnostics,
}: {
  readonly layout: MacKeyboardLayout;
  readonly mac: MacWorkspaceState;
  readonly diagnostics: readonly Diagnostic[];
}): React.JSX.Element {
  if (mac.kind !== "ready") {
    return (
      <section aria-labelledby="ref-title">
        <h3 id="ref-title" className="section-title">
          ファイルと適用先
        </h3>
        <p>
          {mac.kind === "missing"
            ? `${macKeymapPath(layout)} がまだ無い。`
            : `${macKeymapPath(layout)} を読み込めない: ${mac.reason}`}
        </p>
      </section>
    );
  }
  const { document, path } = mac;
  const assignmentCount = [...document.layers.values()].reduce(
    (total, layer) => total + layer.size,
    0,
  );
  const unsupportedCount = diagnostics.filter((diagnostic) =>
    diagnostic.code.startsWith("mac-keymap/unsupported"),
  ).length;
  return (
    <section aria-labelledby="ref-title">
      <h3 id="ref-title" className="section-title">
        ファイルと適用先
      </h3>
      <dl className="kv">
        <dt>ファイル</dt>
        <dd>
          <code>{path}</code>
        </dd>
        <dt>物理配列</dt>
        <dd>{document.layout.toUpperCase()}</dd>
        <dt>適用先</dt>
        <dd>{describeDevices(document.devices)}</dd>
        <dt>kanata の対象</dt>
        <dd>
          <code>{kanataDeviceText(document.devices)}</code>
        </dd>
        <dt>件数</dt>
        <dd>
          layer {document.layers.size} · 割り当て {assignmentCount} · kanata 非対応{" "}
          {unsupportedCount}
        </dd>
        <dt>内蔵配列</dt>
        <dd>Browser では検出しない。CLI が apply / diff のときに検出する。</dd>
      </dl>
    </section>
  );
}
