# Linux の mod-tap と LT を overloadt2 と lettermod で作る

2026-09-28。
Omarchy の MacBook（JIS）で、内蔵キーボードの割り当てを Cornix LP から作ろうとした。
`overload` のままだと、home mod と Super のロール打鍵が Omarchy のウィンドウ操作（Super+W など）に誤爆すると分かった。
利用者が `lettermod` への対応を依頼した。

## Fact

- このマシンの keyd は v2.6.0 で、man に `overloadt2`、`overloadi`、`lettermod` がある。
- 生成した fixture の `keysync.conf` は、keyd v2.6.0 の `keyd check` を通った。
- `just format` は、この作業と無関係な `spikes/d-004-workspace/index.html` と `src/ui/styles/tokens/typography.css` も整形した。範囲外なので戻した。
- 利用者の workspace の `linux-keyboard.jis.yaml`（下書き）は dotfiles 側にあり、この commit には含めない。

## Decision

ADR 0051 に記録した。
ADR 0042 の状態欄と展開規則に、0051 が上書きしたことを書いた。

## Open Question

- keyd の `overloadi` が、直前のキーが `lettermod` で tap になったときも「文字キーを打った」と数えるか。実機のロール打鍵で確かめる。
- 実機で home mod のショートカットと、ロール打鍵での誤爆を確かめる。
