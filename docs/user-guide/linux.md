# Linux（Omarchy）で使う

Omarchy でも、導入と Cornix LP の操作は Mac と同じです（[利用者ガイド](./README.md)）。\
内蔵キーボードは keyd で設定します。\
Web UI では編集できないため、設定ファイルを直接書いて CLI で反映します。

## 内蔵キーボードの設定を作る

1. キーボードの一覧を出し、`Apple Internal Keyboard` を含む行の id を控えます。

   ```bash
   just linux devices --layout jis
   ```

2. id を登録します。\
   `linux-keyboard.jis.yaml` が無ければ作られます。

   ```bash
   just linux devices --layout jis --add 05ac:027e
   ```

3. `$KEYSYNC_WORKSPACE/linux-keyboard.jis.yaml` の `layers` に割り当てを書きます。

Cornix LP は登録しません。\
登録すると、firmware の割り当てと二重に効きます。

割り当ての書き方は Mac の設定と同じです。

```yaml
tapping_term_ms: 180
flow_tap_term_ms: 130
layers:
  0:
    "caps_lock": "LCTL_T(KC_ESC)"
    "f": "LGUI_T(KC_F)"
    "japanese_kana": "LT1(KC_LANG1)"
  1:
    "h": "KC_LEFT"
```

`tapping_term_ms` と `flow_tap_term_ms` で tap-hold の判定時間を設定します。\
Cornix LP と同じ値（180 と 130）にすると、home mod がロール打鍵で誤爆しにくくなります。

次の keycode は使えません。

- `LCTL(KC_A)` のような修飾付き keycode
- `SGUI_T(KC_S)` のような複数の修飾を持つ mod-tap
- `MO(0)` のような layer 0 を指す layer 操作

## 反映する

```bash
just linux apply                          # 差分と fingerprint を出す（書き換えない）
just linux apply --confirm <fingerprint>  # 反映する（sudo のパスワードを求める）
```

反映の前に、元の `/etc/keyd/keysync.conf` を `keysync/backups/keyd-<時刻>.conf` へ保存します。

## 元に戻す

以前の設定へ戻すときは、`keysync/backups/keyd-<時刻>.conf` を `/etc/keyd/keysync.conf` へコピーし、`sudo keyd reload` を実行します。\
KeySync の設定を外すときは、次を実行します。

```bash
sudo rm /etc/keyd/keysync.conf
sudo keyd reload
```

## Mac との違い

- 右 Control と右 Command の mod-tap は、hold 側が左右を区別しません。
- `backslash` と `non_us_pound` は同じキーになるため、同じ layer に両方を書くと error になります。
- 2 つの layer を同時に押すと、後から押した layer が優先されます。
- mod-tap の判定に Chordal Hold がありません。\
  tapping term の中で、mod-tap を押したまま同じ手のキーを押して離すと hold になります。\
  Cornix LP では tap になります。
