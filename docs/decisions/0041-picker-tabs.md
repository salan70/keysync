# keycode picker を Vial 風のタブに分け、layer キーとメディア・マウスを選べるようにする

状態: 採用

2026-09-26 に、盤面の下の picker で layer キーを GUI から選べないという利用者の指摘を受けて決めた。
実機操作は行っていない。

## 背景

ADR 0014 は picker を ISO/JIS の 1 面に限り、layer 番号の新規選択、media / mouse、F13 以降を raw 入力と動作 select へ回した。
layer 番号選択 UI の追加は別判断として残していた。

- `MO(n)` や `TG(n)` を割り当てるには raw keycode を打つか、動作 select で `MO(0)` を作ってから raw で番号を直す必要があった。
- `LTn(kc)` は raw 入力でしか新規に作れなかった。
- 利用者は Vial のタブ付き picker（Basic / Layers / Quantum / App, Media and Mouse）と同じ操作を期待していた。

## 選択肢

1. 動作 select に layer 番号の入力を足し、picker は 1 面のまま保つ
2. picker を Vial 風の複数タブに分け、layer キーを番号ごとの cell として並べる
3. 検索付きの keycode palette を置く

## 決定

案 2 を採る。

- **タブは `基本` `レイヤー` `メディア・マウス` `特殊` の 4 つ。** `基本` は ADR 0014 の ISO/JIS 面をそのまま使う
- **`レイヤー` は行を `MO` `TG` `TT` `TO` `DF` `OSL`、列を存在する layer 番号にする。** Cornix は layer 数、Mac は document に書かれた layer から決める
- **全タブを同じ高さに重ねて描く。** タブを切り替えても盤面が動かない
- **`基本` 以外は見出し付きの行で、keycode の幅を揃えて列を縦に揃える。** メディア・マウスのキーには読める表示名を付け、盤面と共有する
- **`LTn(kc)` は Hold を選んだ状態で `MO(n)` を押して作る。** Tap は保ったまま `LTn(tap)` に組み立てる。Hold に置けるのは modifier と `MO(n)` だけにする
- **`RESET` `QK_BOOT` `EE_CLR` `DEBUG` は picker に置かない。** 必要なら raw keycode で明示して入力する
- Mac は既存どおり `macKeycodeSupport` で Karabiner へ落とせない cell を無効にし、タブごとの特別扱いはしない
- ADR 0025（picker は編集対象を知らず、選ばれた keycode を生のまま返す）は変えない

## 理由

- **案 2 は既存の適用先（キー全体・Tap・Hold）と同じ操作で layer キーを扱える。** 案 1 は layer キーだけ別の入力部品になり、Tap / Hold の切り替えと連携しない
- **Hold + `MO(n)` で LT を作ると、mod-tap の `X_T(kc)` と同じ手順になる。** `applyPick` の Hold 分岐を 1 つ足すだけで、専用の LT ボタンは要らない
- **案 3 は keycode の綴りを知っている前提になる。** raw 入力の不便さが残る
- **危険な quantum keycode は、押しただけで bootloader 移行や EEPROM 消去が起きる。** 誤クリックで割り当てると、次の Apply で実機に入る

## 影響

- ADR 0014 の「面は ISO/JIS の 1 面だけ」「layer 番号・media / mouse・F13 以降は picker から選べない」を本 ADR で改める。Tap Dance と macro は引き続き動作 select と raw 入力で扱う
- Picker は layer 番号の一覧を props で受け取る
- Hold の現在値は、`LTn(kc)` のとき `MO(n)` として表示する
