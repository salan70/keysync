import { useState } from "react";
import type { IconStyle } from "../../icon-style.ts";
import { canSaveVariant, variantNameProblem } from "../../keymap-variant-view.ts";
import type { KeymapVariantsView } from "../../state/use-keymap-variants.ts";
import { Button } from "../Button.tsx";
import { Icon } from "../Icon.tsx";

export const USER_GUIDE_URL =
  "https://github.com/salan70/keysync/blob/main/docs/user-guide/web-ui.md";

const ICON_STYLE_OPTIONS: readonly { readonly value: IconStyle; readonly label: string }[] = [
  { value: "dish", label: "凹みあり" },
  { value: "flat", label: "凹みなし" },
];

/** ファイル。.vil の読込・書出、ディスクからの再読込、表示の設定、利用者ガイド。 */
export function FilesPanel({
  cornixReady,
  canReload,
  onImportVil,
  onExportVil,
  onReload,
  iconStyle,
  onIconStyle,
  targetLabel,
  hasActiveFile,
  variantsView,
  variantsBlockedReason,
}: {
  readonly cornixReady: boolean;
  readonly canReload: boolean;
  readonly onImportVil: () => void;
  readonly onExportVil: () => void;
  readonly onReload: () => void;
  readonly iconStyle: IconStyle;
  readonly onIconStyle: (style: IconStyle) => void;
  /** 保持の対象。「Cornix」「Mac（ANSI）」など。 */
  readonly targetLabel: string;
  /** 適用対象のファイルを読めているか。無いときは保持できない。 */
  readonly hasActiveFile: boolean;
  readonly variantsView: KeymapVariantsView;
  /** 保存中・保存失敗で保持と切り替えを止める理由。 */
  readonly variantsBlockedReason: string | undefined;
}): React.JSX.Element {
  const [name, setName] = useState("");
  const { variants, matched, busy } = variantsView;
  const nameProblem = variantNameProblem(name);
  const canSave =
    !busy &&
    variantsBlockedReason === undefined &&
    nameProblem === undefined &&
    canSaveVariant(name, hasActiveFile);
  const saveReason = !hasActiveFile
    ? "適用対象のファイルを読み込めていないため保持できない。"
    : variantsBlockedReason;
  return (
    <div className="steps">
      <section className="step">
        <h3 className="section-title">.vil</h3>
        <p>
          読込は目標状態（keymap.yaml）を置き換えて保存する。実機には書き込まない。書出は
          keysync/generated/ に保存する。
        </p>
        <div className="row">
          <Button size="small" appearance="secondary" disabled={!cornixReady} onClick={onImportVil}>
            VIL 読込…
          </Button>
          <Button size="small" appearance="secondary" disabled={!cornixReady} onClick={onExportVil}>
            VIL 書出
          </Button>
        </div>
        {cornixReady ? null : <p className="hint">keymap.yaml を読み込めていないため使えない。</p>}
      </section>
      <section className="step" data-keymap-variants>
        <h3 className="section-title">保持したキーマップ（{targetLabel}）</h3>
        <p>
          現在の内容に名前を付けて保持し、あとで切り替える。切り替えは適用対象のファイルを書き換えるだけで、実機と
          kanata へは別途適用する。
        </p>
        <p className="hint">
          {matched === undefined
            ? "現在の内容は未保持。"
            : `現在の内容は ${matched} と一致している。`}
        </p>
        {variants.length === 0 ? (
          <p className="hint">保持したものはない。</p>
        ) : (
          <ul className="variant-list">
            {variants.map((variant) => (
              <li key={variant.name}>
                <span className="variant-name">
                  <span>{variant.name}</span>
                  {variant.name === matched ? <span className="tag tag-on">現在</span> : null}
                </span>
                <span className="variant-actions">
                  <Button
                    size="small"
                    appearance="secondary"
                    disabled={
                      busy || variantsBlockedReason !== undefined || variant.name === matched
                    }
                    onClick={() => void variantsView.switchTo(variant.name)}
                  >
                    切り替え
                  </Button>
                  <Button
                    size="small"
                    appearance="secondary"
                    disabled={busy}
                    onClick={() => void variantsView.remove(variant.name)}
                  >
                    削除
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <form
          className="field variant-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canSave) return;
            void variantsView.save(name).then(() => setName(""));
          }}
        >
          <label htmlFor="variant-name">名前を付けて保持</label>
          <div className="field-row">
            <input
              id="variant-name"
              value={name}
              placeholder="例: home-row"
              spellCheck={false}
              onChange={(event) => setName(event.target.value)}
            />
            <Button size="small" appearance="secondary" type="submit" disabled={!canSave}>
              現在の内容を保持
            </Button>
          </div>
        </form>
        {nameProblem === undefined ? null : <p className="hint">{nameProblem}</p>}
        {saveReason === undefined ? null : <p className="hint">{saveReason}</p>}
        {variantsBlockedReason === undefined ? null : (
          <p className="hint">切り替えも同じ理由で止めている。</p>
        )}
      </section>
      <section className="step">
        <h3 className="section-title">ディスクから再読込</h3>
        <p>
          外部エディタで変えたファイルを取り込む。保存の競合もここで解ける。未保存の編集は取り込まない。
        </p>
        <Button size="small" appearance="secondary" disabled={!canReload} onClick={onReload}>
          再読込
        </Button>
      </section>
      <section className="step">
        <h3 className="section-title">表示</h3>
        <p>アイコンのキーの天面に、淡い凹みを描くかを選ぶ。選択はこのブラウザに保存する。</p>
        <fieldset className="seg is-two" data-icon-style-setting>
          <legend>アイコン</legend>
          {ICON_STYLE_OPTIONS.map((option) => (
            <label key={option.value} className={iconStyle === option.value ? "is-on" : ""}>
              <input
                type="radio"
                name="icon-style"
                value={option.value}
                checked={iconStyle === option.value}
                onChange={() => onIconStyle(option.value)}
              />
              <span className="seg-label">
                <Icon name="keymap" size="md" iconStyle={option.value} /> {option.label}
              </span>
            </label>
          ))}
        </fieldset>
      </section>
      <section className="step">
        <h3 className="section-title">利用者ガイド</h3>
        <p>操作、安全な Apply、復旧の手順をまとめている。</p>
        <a className="link" href={USER_GUIDE_URL} target="_blank" rel="noreferrer">
          Web UI の使い方（新しいタブで開く）
        </a>
      </section>
    </div>
  );
}
