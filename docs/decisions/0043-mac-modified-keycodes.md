# Mac keyboardでも修飾付きkeycodeと複合modifierのmod-tapをKarabinerへ落とす

状態: 採用

2026-09-26に、Cornix LPのkeymapをMacBook（ANSI）へ移す案を選んだときに決めた。

## 背景

ADR 0023は、`LSFT(KC_1)`のような`modified`を「Karabinerで表現できるが要件に無い」として落とさなかった。
mod-tapのhold側も単独のmodifierだけを扱い、`SGUI_T(KC_S)`はerrorにしていた。

Cornixのkeymapを移す方法として、Cornixの指の動きをMacの盤面でそのまま再現する案を採った。
この案は記号レイヤー、NavレイヤーのCtrl+AやCmd+[、ホームロウのS・Lにある`SGUI_T`を使う。
生成器で試すと31件がerrorになった。
ADR 0023の「要件に無い」という前提が成り立たなくなった。

## 選択肢

1. 生成器を変えず、記号とショートカットはMacの物理キーで打つ
2. `modified`、shift済みkeycode、複合modifierのmod-tapを落とす
3. 2に加え、入れ子の`LCTL(LSFT(KC_A))`と`MT(MOD_LCTL | MOD_LSFT, kc)`も落とす

## 決定

案2を採る。

- `modified`は、innerの`key_code`に修飾の`modifiers`を付けた`to`イベント1個にする
- `KC_EXLM`のようなshift済みkeycodeは、baseの`key_code`に`left_shift`を付ける
- mod-tapのhold側が複合modifierなら、先頭を`key_code`、残りを`modifiers`に置き、`lazy`を付ける
- 単独modifierのmod-tapは`modifiers`を付けず、これまでと同じ出力を保つ
- 修飾の構成はQMKの定義どおりとし、`classifyKeycode`が`modified`と判定するwrapperをすべて覆う
- Web UIのMacの動作選択肢に`modified`を加える

ADR 0023の「`modified`は落とさない」を本ADRが上書きする。
構文層を`classifyKeycode`に置く決定と、落とせないkeycodeをerrorにする決定は変わらない。

## 理由

- **採った移植案に必要**。案1では記号レイヤーとNavのショートカットが丸ごと移らない
- **表記が違っても同じ出力にする**。Web UIのpickerは`$`を`KC_DLR`で出し、Cornixのkeymapは`LSFT(KC_4)`で持つ。片方だけ落とせると、同じ記号がpickerの経路でだけerrorになる
- **Karabinerの語彙で素直に書ける**。`to`イベントの`modifiers`で同時押しを表せ、追加のmanipulatorや変数が要らない
- 案3の入れ子と`MT(MOD_*)`は、移すkeymapに1件も無い。将来の要件のためにparserを広げない

## 影響

- Fact: 移植案のyamlは生成器でerror 0件になり、`karabiner_cli --lint-complex-modifications`も通る
- Open Question: `lazy`と`modifiers`を併せ持つ`to`が、実機でShift+Cmdのholdとして働くかは確かめていない。
  lintはschemaしか見ない。適用後に実機で確かめる
- 入れ子の`modified`と`MT(MOD_*)`は、引き続き`mac-keymap/unsupported-keycode`または`mac-keymap/unsupported-mod-tap`のerrorになる
- Web UIのpickerで、shift済み記号のcellがMacでも選べるようになる
