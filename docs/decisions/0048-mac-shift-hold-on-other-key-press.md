# Mac keyboard の Shift の mod-tap は、次のキーを押した時点で hold にする

状態: 採用

2026-09-27 に、MacBook 内蔵キーボードで Shift の反応が Cornix より悪いという報告を受けて決めた。
ADR 0047 で予定した 2 段階のうち、第 2 段階にあたる。

## 背景

ADR 0044 の形では、mod-tap は閾値まで押し続けないと hold にならない。
Shift を押してすぐ文字を押すと、Shift が掛からず、かな・英数キーと小文字が出る。
Cornix LP は Permissive Hold が有効で、閾値より前でも Shift を押したまま文字を押して離せば Shift+文字になる。

Karabiner-Elements のソース（`src/share/manipulator/manipulators/basic/`）で確認した事実。

- Fact: `to_if_other_key_pressed` は、`from` を押している間に `other_keys` のどれかが押された時点で、`to` を離して `to_if_other_key_pressed.to` を押す。押されたキーは通常どおり送られる
- Fact: `to_if_other_key_pressed` は key down だけを見る。キーを離した順は判定に使わない
- Fact: manipulator がイベントを処理すると、そのイベントは invalid になる。後ろの manipulator は invalid なイベントで `to_if_other_key_pressed` を判定しない
- Fact: `to_if_held_down` と `to_delayed_action` の取消しと `to_if_alone` の解除は、invalid 判定より前に行われる

Permissive Hold は「文字を先に離したら hold、mod-tap を先に離したら tap」で分ける。
Karabiner の出力は、キーを押した時点で選ばれた manipulator が決める。
`to_if_alone` も「押している間に別のキーが押されたか」しか見ない。
入れ子の打鍵とロール打鍵は、どちらも押す順が同じで、離す順だけが違う。
このため、Karabiner では Permissive Hold を作れない（Inference）。

## 選択肢

1. Shift の mod-tap だけ、次のキーを押した時点で hold にする（QMK の Hold On Other Key Press）
2. Shift の mod-tap だけ閾値を短くする
3. engine を kanata へ替え、Permissive Hold をそのまま使う

## 決定

案 1 を採る。
利用者が選んだ。

- hold 側が Shift だけの mod-tap（`LSFT_T` / `RSFT_T`）は、次の形にする

  ```json
  {
    "to_if_alone": [{ "key_code": "<tap>" }],
    "to_if_held_down": [{ "key_code": "<shift>" }],
    "to_if_other_key_pressed": [
      {
        "other_keys": [
          { "any": "key_code", "modifiers": { "optional": ["any"] } },
          { "any": "pointing_button", "modifiers": { "optional": ["any"] } }
        ],
        "to": [{ "key_code": "<shift>" }]
      }
    ],
    "parameters": {
      "basic.to_if_alone_timeout_milliseconds": <T>,
      "basic.to_if_held_down_threshold_milliseconds": <T>
    }
  }
  ```

- `to_delayed_action` は持たない
- この manipulator は、どの layer の rule よりも前の `<profile> hold on other key press` rule へ移す。上の layer が同じキーに割り当てを持つときは、その layer の `variable_unless` を条件へ足す
- Shift を含む複合 modifier（`SGUI_T` など）と、Shift 以外の mod-tap は ADR 0044 の形のまま

## 理由

- **Shift+文字を確実に効かせる。** 利用者の不満は、閾値より前に押した文字に Shift が掛からないことにある。案 2 は閾値を短くするだけで、それより早く押せば同じことが起きる
- **Karabiner のまま作れる。** 案 3 は ADR 0022、0028、0034、0044 を上書きする大きな変更で、Karabiner と kanata が同時に内蔵キーボードを扱えるかも確かめていない
- **Shift に限る。** home mod に同じ形を使うと、ロール打鍵（`ka` など）が修飾キーになる。ADR 0044 で直した誤爆に戻る
- **`to_delayed_action` を持たない。** 持つと、次のキーを押したとき `to_if_canceled` がかな・英数キーを送る
- **ポインティングボタンも含める。** 閾値より前のクリックも Shift+クリックにする
- **前へ移す。** 後ろに置くと、割り当てのあるキー（home mod や記号）を押したときに Shift にならない

## 影響

- Karabiner 16.0.0 以上が要る
- かな・英数キーを押して、離す前に次のキーを押すと、そのキーに Shift が掛かり、かな・英数への切り替えも起きない。Cornix ではこの打鍵は tap になる
- Shift を押したまま何も押さずに閾値の前に離せば、これまでどおりかな・英数キーになる
- Open Question: 実機の打鍵で、Shift+文字が確実に効くか、かな・英数キーのあとの誤爆がどれだけ起きるか。利用者が確かめ、結果をこの ADR へ追記する
