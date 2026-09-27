import type { IconName } from "../icons.ts";
import type { PanelId } from "../types.ts";
import { Icon } from "./Icon.tsx";

/** 入口の並びと色。位置は対象によらず固定する。 */
export const PANELS: readonly {
  readonly id: PanelId;
  readonly label: string;
  readonly short: string;
  readonly icon: IconName;
  readonly tone: string;
}[] = [
  { id: "overview", label: "全体マップ", short: "全体", icon: "overview", tone: "tone-secondary" },
  { id: "behaviors", label: "動作定義", short: "動作", icon: "behaviors", tone: "tone-tertiary" },
  { id: "validation", label: "検証", short: "検証", icon: "validation", tone: "tone-primary" },
  { id: "device", label: "実機と適用", short: "実機", icon: "device", tone: "tone-secondary" },
  // 専用のアイコンが無いため、キーキャップの keymap を借りる。
  { id: "typing", label: "打鍵テスト", short: "打鍵", icon: "keymap", tone: "tone-primary" },
  { id: "files", label: "ファイル", short: "ファイル", icon: "files", tone: "tone-tertiary" },
];

/**
 * 左端の入口。割り当て（常設の盤面）と、画面中央のパネルで開く 5 つの作業。
 *
 * 選んだ対象で使えない入口は位置を保ったまま aria-disabled にし、理由は読み上げだけに渡す。
 */
export function Rail({
  panel,
  onPanel,
  unavailable,
  counts,
}: {
  readonly panel: PanelId | undefined;
  readonly onPanel: (panel: PanelId | undefined) => void;
  /** 使えない入口と、その理由（短い文）。 */
  readonly unavailable: Readonly<Partial<Record<PanelId, string | undefined>>>;
  readonly counts: Readonly<Partial<Record<PanelId, number | undefined>>>;
}): React.JSX.Element {
  return (
    <nav className="rail" aria-label="作業">
      <button
        type="button"
        data-panel="keymap"
        className={panel === undefined ? "rail-btn tone-primary is-on" : "rail-btn tone-primary"}
        aria-pressed={panel === undefined}
        onClick={() => onPanel(undefined)}
      >
        <span className="rail-icon">
          <Icon name="keymap" size="md" />
        </span>
        割り当て
      </button>
      {PANELS.map((item) => {
        const reason = unavailable[item.id];
        const count = counts[item.id];
        return (
          <button
            key={item.id}
            type="button"
            data-panel={item.id}
            className={`rail-btn ${item.tone}${panel === item.id ? " is-on" : ""}`}
            aria-pressed={panel === item.id}
            aria-disabled={reason !== undefined}
            aria-describedby={reason === undefined ? undefined : `rail-why-${item.id}`}
            aria-label={
              count === undefined || count === 0 ? undefined : `${item.label}（${count} 件）`
            }
            onClick={() => {
              if (reason === undefined) onPanel(item.id);
            }}
          >
            <span className="rail-icon">
              <Icon name={item.icon} size="md" />
            </span>
            {item.short}
            {count === undefined || count === 0 ? null : (
              <span className="rail-count" aria-hidden="true">
                {count}
              </span>
            )}
            {reason === undefined ? null : (
              <span id={`rail-why-${item.id}`} className="visually-hidden">
                {reason}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
