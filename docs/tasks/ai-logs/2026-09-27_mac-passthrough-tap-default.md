# Mac の素通しキーへ Hold を足したときの Tap の初期値

## 事象

Mac の割り当ての無いキー（素通し）で Hold に modifier や `MO(n)` を選ぶと、Tap が `KC_NO` になった。
例: `a` の Hold に Shift を選ぶと `LSFT_T(KC_NO)` になる。
動作 select で `modTap` を選んだ場合も同じだった。

## 原因

`App.pick` が素通しの現在値を `KC_NO` として `applyPick` へ渡していた。
Inspector も素通しでは `structuredValues` を持たず、`composeKeycode` の Tap が `KC_NO` へ落ちていた。

## 対応

`passthroughKeycode` で位置（Karabiner の `key_code`）から素通しで送る QMK 表記を逆引きし、Tap の初期値にした。
`fn` は QMK に対応が無いため従来どおり `KC_NO` になる。
