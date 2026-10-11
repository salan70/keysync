# キーマップを名前を付けて保持し、切り替える

## 依頼

キーマップを保持して、切り替えたりできるようにしたい。

## 聞いたこと

対象は Mac と Cornix の両方、切り替えは適用対象の入れ替え、保持は固定名の適用対象と名前付きファイルの併置、導線は Web UI と CLI の両方を選んでもらった。\
workspace には手でコピーした `mac-keyboard.ansi.before-home-row-shift.yaml` が既にあり、この命名に合わせた。

## 対応

判断は ADR 0053。
`src/workspace/keymap-variants.ts` に名前の規則、一覧、正規形での照合、保持、切り替え、削除を置いた。\
`WorkspaceFileStore` に `listFiles` と `remove` を足し、サーバーの workspace API に `list` と `remove` を足した。\
CLI は `keysync keymaps …` と `keysync mac keymaps …`、Web UI はファイルパネルの「保持したキーマップ」。\
CLI は haiku、Web UI は sonnet に委譲し、一覧の折り返しと入力欄の装飾は統合後に直した。

## 確認

`just typecheck`、`just test`（501 件）、`just lint`、`just docbridge-check` が通る。\
workspace の複製を指す `just dev` を headless Chrome で開き、保持と切り替えがファイルと表示の両方に反映されることを確かめた。\
切り替え後の kanata への適用は実機では試していない。
