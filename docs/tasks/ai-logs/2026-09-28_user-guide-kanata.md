# 利用者ガイドを kanata の engine に合わせる

## 依頼

プロジェクトのドキュメントを改善したい。

## 対応

ADR 0049 で Mac の engine を kanata へ替えた後も、利用者ガイドは Karabiner 前提の手順のままだった。
`docs/specs/` は更新済みだったため、利用者ガイドを仕様と実装（`src/cli/main.ts`、`MacApplyDialog`）に合わせた。

- `cli.md`: 初回の準備（Modify events、`brew install --HEAD kanata`、`mac service install`、権限）、`service`、`record`、戻し方を書いた。廃止した `mac devices` と `--no-select` を消した
- `web-ui.md`: `kanata へ適用…` の手順、押せない理由と止まったときの表示を実装の文言に揃えた。ADR 0050 の「割り当てなし」を反映した
- `safe-apply.md`、`workspace-and-terms.md`: 書き込み先、backup、生成物を kanata の設定ファイルへ替えた
- `troubleshooting.md`: Mac の設定が効かないときの確認手順を足した
- `linux.md`: kanata での layer の優先順位は確かめていないため、Karabiner の記述を未確認と書き直した

`just --list` は複数行コメントの最終行を説明に出すため、`format` などで補足文が表示されていた。
`[doc(...)]` 属性で要約を指定した。

## 確認

`just lint-md` が通る。
`check-prose.sh` は `~/Projects/tool/dotfiles/infra/ai/` に無く、実行できなかった。
戻し方の `launchctl bootout` / `kickstart -k` は実機で試していない。
