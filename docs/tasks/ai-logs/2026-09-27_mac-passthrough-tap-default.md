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

## Hold を外す操作

設定した Hold を外す手段が、動作 select で `basic` を選ぶことしか無く、見つけにくかった。
動作 select の横に「Hold を外す」を常設し、mod-tap と layer-tap を Tap だけへ戻すようにした（`removeHold`）。
Hold が無いときは無効にし、ボタンの有無で高さが変わらないようにした。
最初は適用先のヒントの横へ置いたが、ヒントの折り返しが適用先ごとに 2〜3 行で揺れたため、動作 select の横へ移した。
Mac で戻した keycode が素通しで送るキーと同じなら、`KC_A` を書かずに割り当てを外し、素通しへ戻す。
表示は Vite で Inspector だけを描き、headless Chrome で 4 状態を撮って確かめた。

## 編集パネルの簡素化

「Hold を外す」を動作 select の横に置いた形は、Hold の値・設定・解除が 3 か所に散って分かりにくかった。
解除は Hold の欄に重ねた × にまとめ、別置きのボタンをやめた。
適用先の値は `KC_LSHIFT` のような raw ではなく keycap と同じ表示名（`⇧`、`layer 1`）にし、raw は title に残した。
動作 select は `basic` などの専門語で日常の操作に要らないため、raw keycode と同じ「詳細」の中へ移した。
ヒントは 1 行に収まる長さへ縮め、適用先を切り替えても高さが揺れないようにした。
