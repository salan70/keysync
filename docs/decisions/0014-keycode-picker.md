# ISO/JIS 1 面の keycode picker で Tap / Hold の割り当てを行う

状態: 採用（面の数と layer・media / mouse・F13 以降の扱いは ADR 0041 で改訂）

2026-08-20に、盤面編集のraw keycode入力への依存を減らすために決めた。実機操作は行っていない。

## 背景

現行UIのTap / Holdは少数のkeycodeだけを持つselectで、ISO/JISキーボードに刻印される基本キーを
直接選べなかった。`fixtures/cornix-lp/baseline.vil`には、selectの固定候補を超えるplain keycodeが
多数あり、キーコードの綴りを覚えてraw入力する必要があった。

変更は`src/core/`へ入れず、UIの表示表とwrapperの組み立てを`src/ui/`へ置く。編集結果は従来どおり
coreの純関数へ渡し、物理配列はkeymapのdefinitionではなくpicker専用の表示データとして扱う。

## 選択肢

1. 既存selectへkeycode候補を追加する
2. キー全体・Tap・Holdを別々のISO/JIS物理配列pickerへ分ける
3. 1つのISO/JIS物理配列pickerと適用先トグルを常設する

## 決定

案3を採る。

- pickerは盤面の下に常設する
- 面はISO/JISの1面だけにする。Basicの別面は持たない
- クリックの適用先をキー全体・Tap・Holdから選ぶ
- Tapでは既存のmodifier / mod-tap / layer-tap wrapperを保ったままinnerだけを差し替える
- Holdでは`KC_LCTRL`などのmodifier keycodeだけを受け付け、`LCTL_T(kc)`の形式へ組み立てる
- keycapとpickerの表示は`keycodeDisplay()`と`renderKeycode()`を共有し、ラベル表を複製しない
- ISO/JIS面に無いmedia / mouse、F13以降、layer系、Tap Danceは既存のraw入力または動作selectで扱う

## 理由

- `baseline.vil`のplain keycodeを確認すると、ISO/JISの物理配列へ置けない代表的な値は
  `KC_MUTE`・`KC_BTN3`・`KC_F13`であり、それ以外の編集頻度が高い基本キーは1面で探せる。
  encoderのmedia / mouse割り当てはpickerの対象外としてraw入力を残す
- 面を増やすより、キー全体・Tap・Holdを同じkeycapの刻印から選ぶ方が、選択中の物理位置を
  保ったまま連続編集できる。適用先は表示中の現在値と一緒に切り替えられる
- wrapperの再構成を純粋関数へ分けることで、`LALT(KC_A)`を動作selectで再保存しても`LGUI`へ
  変質せず、`LT2(KC_A)`のlayer番号とactionも保てる。pickerのTap適用でも同じ規則を使える
- 表示関数を共有すれば、JIS固有キーやshift済み記号の見た目が盤面とpickerでずれない。新しい
  表示名辞書を持つと、keycode vocabularyと表示の二重管理になる

## 影響

- media / mouse、F13以降、layer番号の新規選択、Tap Danceはpickerから選べない。これはraw入力と
  動作selectを残すことで成立させる。layer番号選択UIの追加は別判断とする
- Holdは8個の左右modifier keycodeだけが有効で、通常の文字キーは無効表示になる
- pickerは物理配列の幅を`u`で表現するが、実機のdefinitionやkeymapの座標は変更しない
- `applyPick`とkeycode catalogはnodeの純粋関数テストで、wrapper保持・modifier制約・keycodeの
  既知性・重複・各行の幅を検証する
