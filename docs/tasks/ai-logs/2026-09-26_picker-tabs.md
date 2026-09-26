# keycode picker を Vial 風のタブに分ける

2026-09-26。
利用者が「UI 刷新前の picker にはタブがあり、layer のボタンも設定できた」として、同じ形に戻すよう依頼した。

## Fact

- タブ付きの picker は過去に無かった。`KeycodePicker.tsx` は 66a926a で追加され、17fd920 で `Picker.tsx` に置き換わるまで ISO/JIS の 1 面だけだった。
- ADR 0014 は layer 番号の新規選択、media / mouse、F13 以降を picker の対象外にし、layer 番号選択 UI を別判断として残していた。
- 利用者は Vial 風の複数タブと、「Hold で MO(n) を押すと LTn(tap)」の方式を選んだ。
- Cornix の layer タブには `capacities.layerCount`（fixture では 10）の layer が並ぶ。Mac では document の layer だけが並び、Karabiner へ落とせる `MO` と `TG`、media の一部、F13〜F24、`INT6`〜`INT9` だけが有効になった。
- `KEYSYNC_WORKSPACE` を scratchpad にした Vite 開発サーバー（port 5173）を headless Chrome で操作し、確認した。
  - タブの切り替え、`MO(1)` の割り当て、Hold + `MO(2)` で `LT2(KC_A)` になること、Hold の現在値が `MO(2)` として強調されること。
  - 起動中の `just ui`（port 5178）は止めていない。

## Decision

ADR 0041 に記録した。
Hold の現在値と picker の合成はどちらも `keycode-compose.ts` に置き、`targetValue` を `Picker.tsx` から移した（node の test が `.tsx` を読めないため）。

## 追記: 操作感の改善

利用者から、タブの切り替えでレイアウトが動くこと、列が揃わず分かりにくいことを指摘された。

- Fact: 変更前は、タブごとに picker の高さが変わり（基本 7 行、メディア 3 行）、盤面の位置が動いていた。
- Fact: 全タブを重ねて描くようにした後は、4 タブすべてで picker が 214px、盤面が 522px のまま動かないことを headless Chrome で測った。
- Decision: `基本` 以外は 3u の行見出しと同じ幅の cell で列を揃え、`レイヤー` の見出しに動きの説明を添えた。
  メディア・マウス・Space Cadet・Grave Escape に表示名を足した（`SHORT_LABELS`）。盤面の表示も同じ名前になる。

## Open Question

- 基本タブ右端の `LANG1` が、headless Chrome では `LAN…` に切れて見えた。変更前のコードでも同じ縮小率で、本変更の影響ではない。
