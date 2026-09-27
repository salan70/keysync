import { useEffect, useState } from "react";
import { collectReferenceUsage } from "../../../core/validation/reference-usage.ts";
import type { VilDocument } from "../../../core/vil/types.ts";
import { keycodeLabel, type WorkspaceLabels } from "../../../workspace/labels.ts";
import { settingLabel } from "../../../workspace/settings.ts";
import { Icon } from "../Icon.tsx";

type Tab = "tapDance" | "combo" | "settings";

const TAP_DANCE_FIELDS = ["tap", "hold", "double tap", "hold after tap", "timeout（ms）"] as const;
const COMBO_FIELDS = ["入力 1", "入力 2", "入力 3", "入力 4", "出力"] as const;

/**
 * 動作定義。Tap Dance、Combo、Settings を編集する。
 *
 * 値は Enter か focus を外したときに保存する。範囲外の値は保存せず、欄の下に理由を出す。
 * Settings は qsid 辞書の名前で出し、辞書に無い qsid は raw 表記を残す。
 */
export function BehaviorsPanel({
  document,
  labels,
  onTapDance,
  onCombo,
  onSetting,
}: {
  readonly document: VilDocument;
  readonly labels: WorkspaceLabels;
  /** 保存できなければ理由を返す。 */
  readonly onTapDance: (index: number, field: number, value: string) => string | undefined;
  readonly onCombo: (index: number, field: number, value: string) => string | undefined;
  readonly onSetting: (qsid: number, value: string) => string | undefined;
}): React.JSX.Element {
  const [tab, setTab] = useState<Tab>("tapDance");
  const [showEmptyCombos, setShowEmptyCombos] = useState(false);
  const usage = collectReferenceUsage(document);
  const usedCombos = document.combo.filter((entry) => entry[4] !== "KC_NO").length;
  const tabs: readonly (readonly [Tab, string])[] = [
    ["tapDance", `Tap Dance（使用中 ${usage.tapDance.size} / ${document.tapDance.length}）`],
    ["combo", `Combo（出力あり ${usedCombos} / ${document.combo.length}）`],
    ["settings", `Settings（${Object.keys(document.settings).length}）`],
  ];

  return (
    <>
      <div className="tabs" role="tablist" aria-label="動作定義">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`behavior-tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`behavior-panel-${id}`}
            className="tab"
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "tapDance" ? (
        <div
          className="behaviors"
          role="tabpanel"
          id="behavior-panel-tapDance"
          aria-labelledby="behavior-tab-tapDance"
        >
          {document.tapDance.map((entry, index) => {
            const count = usage.tapDance.get(index) ?? 0;
            return (
              <section key={index} className={count > 0 ? "td is-used" : "td"}>
                <h3>
                  <code>TD({index})</code>
                  {keycodeLabel(labels, `TD(${index})`) === undefined ? null : (
                    <span>{keycodeLabel(labels, `TD(${index})`)}</span>
                  )}
                  {count > 0 ? (
                    <span className="tag tag-on">{count} か所で使用</span>
                  ) : (
                    <span className="tag">未使用</span>
                  )}
                </h3>
                <div className="td-fields">
                  {entry.map((value, field) => (
                    <ValueField
                      key={field}
                      id={`td-${index}-${field}`}
                      label={TAP_DANCE_FIELDS[field] ?? `field ${field}`}
                      value={String(value)}
                      numeric={field === 4}
                      hint={typeof value === "string" ? keycodeLabel(labels, value) : undefined}
                      onCommit={(next) => onTapDance(index, field, next)}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      ) : null}
      {tab === "combo" ? (
        <div role="tabpanel" id="behavior-panel-combo" aria-labelledby="behavior-tab-combo">
          <label className="check">
            <input
              type="checkbox"
              checked={showEmptyCombos}
              onChange={(event) => setShowEmptyCombos(event.target.checked)}
            />
            出力が KC_NO の Combo も表示（{document.combo.length - usedCombos} 件）
          </label>
          <div className="behaviors">
            {document.combo.map((entry, index) =>
              !showEmptyCombos && entry[4] === "KC_NO" ? null : (
                <section key={index} className={entry[4] === "KC_NO" ? "td" : "td is-used"}>
                  <h3>
                    <code>Combo {index}</code>
                    {entry[4] === "KC_NO" ? <span className="tag">空</span> : null}
                  </h3>
                  <div className="td-fields">
                    {entry.map((value, field) => (
                      <ValueField
                        key={field}
                        id={`combo-${index}-${field}`}
                        label={COMBO_FIELDS[field] ?? `field ${field}`}
                        value={value}
                        numeric={false}
                        hint={keycodeLabel(labels, value)}
                        onCommit={(next) => onCombo(index, field, next)}
                      />
                    ))}
                  </div>
                </section>
              ),
            )}
          </div>
          {!showEmptyCombos && usedCombos === 0 ? (
            <p className="muted">出力が設定された Combo は無い。</p>
          ) : null}
        </div>
      ) : null}
      {tab === "settings" ? (
        <div
          className="behaviors"
          role="tabpanel"
          id="behavior-panel-settings"
          aria-labelledby="behavior-tab-settings"
        >
          {Object.entries(document.settings).map(([qsid, value]) => (
            <ValueField
              key={qsid}
              id={`qsid-${qsid}`}
              label={`${settingLabel(Number(qsid))}（qsid ${qsid}）`}
              value={String(value)}
              numeric
              hint={undefined}
              onCommit={(next) => onSetting(Number(qsid), next)}
            />
          ))}
        </div>
      ) : null}
    </>
  );
}

/**
 * 数値や keycode を 1 つ編集する欄。Enter か focus を外したときに `onCommit` へ渡し、
 * 理由が返れば保存せずに欄の下へ出す。
 */
export function ValueField({
  id,
  label,
  value,
  numeric,
  hint,
  onCommit,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly numeric: boolean;
  readonly hint: string | undefined;
  readonly onCommit: (value: string) => string | undefined;
}): React.JSX.Element {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    setDraft(value);
    setError(undefined);
  }, [value]);

  function commit(): void {
    const next = draft.trim();
    if (next === value) {
      setError(undefined);
      return;
    }
    setError(onCommit(next));
  }

  return (
    <label className={error === undefined ? "num" : "num is-invalid"}>
      <span>{label}</span>
      <input
        id={id}
        value={draft}
        inputMode={numeric ? "numeric" : undefined}
        spellCheck={false}
        aria-invalid={error !== undefined}
        aria-describedby={error === undefined ? undefined : `${id}-error`}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          commit();
        }}
      />
      {hint === undefined ? null : <span>表示名: {hint}</span>}
      {error === undefined ? null : (
        <span id={`${id}-error`} className="error-text">
          <Icon name="error" /> {error}。保存していない。
        </span>
      )}
    </label>
  );
}
