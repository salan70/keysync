# 依存境界の機械検査と UI 層の規約

## 依頼

Issue #28。bpj の「違反はコード → 静的解析 → 検証の順に先に防ぐ」原則と、画面の「接続・表示値計算・純粋描画」の分割を、TypeScript と React で取り入れる。

## 対応

判断は ADR 0054。
`src/architecture/` に、`src/` を文字列で走査して import の向きを検査する構造検査を置いた。\
`core-boundary.test.ts` は `src/core` の `node:`、react、`src/core` の外への到達を違反とし、入口から違反までの経路を出す。\
`view-convention.test.ts` は `src/ui/components/**/*.tsx` が `src/ui/state/use-*`、`src/device`、`src/server` を import することを違反とする。\
どちらも理由付きの allowlist と stale 検出を持つ。\
`boundary-rules.test.ts` は、検査が違反と stale を実際に検出することを合成した入力で確かめる。

`src/core` に既存の違反は無く、例外は 0 件だった。\
view は、既存の型だけの import が 7 件あり、うち `ApplyDialog` の 1 件は分割で解消した。\
残る 6 件は allowlist に理由付きで置いた。

Apply の確認 modal を、次の 3 層に分けた。

- 表示値計算: `src/ui/apply-dialog-view.ts` の `buildApplyDialogView`（純粋関数、テスト付き）
- 接続: `src/ui/ApplyDialogContainer.tsx`（`useApply` と `App` の値を表示値へ写す）
- 純粋描画: `src/ui/components/ApplyDialog.tsx`（値と callback だけを受ける）

`ApplyStep` の型は hook から表示値計算の側へ移した。\
Cornix の盤面ではなく Apply の modal を選んだのは、props がすでに hook の外の値で、表示値の計算が部品の中にまとまって残っていたためである。\
盤面は座標計算と `FitText` の測定が描画に絡み、分割の範囲が広い。

`docs/glossary.md` に、keymap、Vial、kanata、Karabiner の用語辞書を作った。\
詳細は複製せず、ADR と仕様へのリンクで示す。

## 確認

`just lint`、`pnpm typecheck`、`pnpm test`、`just docbridge-check` が通る。\
`ApplyDialog` の DOM は変えていない。\
ブラウザでの Apply modal の表示は、実機を使わないため確かめていない。
