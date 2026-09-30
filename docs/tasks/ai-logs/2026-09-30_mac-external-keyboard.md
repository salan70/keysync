# Mac の設定を外付けキーボードにも効かせる

## 依頼

Magic Keyboard などの外付けキーボードにも使えるようにしたい。

## 調査

固定している kanata と karabiner-driverkit のソースを読み、名前でしか指せないことと、掴むデバイスが起動時に決まることを確かめた。\
事実は ADR 0052 の背景にある。

利用者に「名前指定と再起動」と「kanata への patch」を示し、名前指定と再起動が選ばれた。

## 対応

判断は ADR 0052。
外付けの識別子を `{ vendorId, productId }` から `{ name }` へ替え、生成器が `macos-dev-names-include` へ並べるようにした。
`keysync mac devices [--add <name>]` を `kanata --list` で作り、`keysync mac service restart` を足した。
適用先が変わる適用には `mac-keymap/devices-need-restart` の warning を出す。

## 確認

`just typecheck`、`just test`、`just docbridge-check` が通る。
外付けの名前を含む生成物が、固定した kanata の `--check` を通った。
外付けキーボードがつながっていなかったため、実機で掴めるかは確かめていない。
