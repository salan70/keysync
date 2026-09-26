# Linux（Omarchy）で使う

Omarchy（Arch Linux + Hyprland）を入れた MacBook で KeySync を使う手順です。
Linux では次の 2 つができます。

- Web UI から Cornix LP を WebHID で読み書きする
- 内蔵キーボードの設定を keyd へ適用する

内蔵キーボードの設定は Mac の `mac-keyboard.<layout>.yaml` とは別の `linux-keyboard.<layout>.yaml` に置きます。
Web UI はまだ Linux の設定を表示・編集できません。
設定ファイルを直接編集し、CLI で適用します。

## 準備

Nix と direnv を入れ、リポジトリを clone します。
手順は [README](../../README.md#初回セットアップと起動) と同じです。

keyd を入れて起動します。

```bash
sudo pacman -S keyd
sudo systemctl enable --now keyd
```

## Cornix LP を Web UI から使う

Chrome / Chromium が Cornix LP へ接続するには、hidraw の権限を与える udev rule が要ります。
リポジトリの rule を置いて読み直します。

```bash
sudo cp docs/user-guide/linux/99-vial.rules /etc/udev/rules.d/
sudo udevadm control --reload
sudo udevadm trigger
```

Cornix LP を接続し直してから `just ui` を実行します。
既定のブラウザで <http://127.0.0.1:5178/> が開きます。
開かないときは Chromium で URL を開きます。

## 内蔵キーボードの設定を作る

### 適用先を登録する

Linux が認識しているキーボードを一覧表示します。

```bash
just linux devices --layout jis
```

`observed` に並ぶ `name` を見て、内蔵キーボードの `identifier` を選びます。
MacBook では `Apple Internal Keyboard` を含む名前です。
Cornix LP を登録すると、firmware の keymap と二重に効くので登録しません。

選んだ id を登録します。
設定ファイルが無ければ、このとき `linux-keyboard.jis.yaml` が作られます。

```bash
just linux devices --layout jis --add 05ac:027e
```

### 割り当てを書く

`$KEYSYNC_WORKSPACE/linux-keyboard.jis.yaml` を編集します。
キーの名前と keycode の書き方は Mac の設定と同じです。

```yaml
schema: keysync/linux-keymap@1
layout: jis
devices:
  - { vendor_id: 1452, product_id: 638 }
layers:
  0:
    "caps_lock": "LCTL_T(KC_ESC)"
    "japanese_kana": "LT1(KC_LANG1)"
  1:
    "h": "KC_LEFT"
    "j": "KC_DOWN"
```

使える keycode は Mac と同じ範囲から、次を除いたものです。

- `LCTL(KC_A)` のような修飾付き keycode
- `SGUI_T(KC_S)` のような複数の修飾を持つ mod-tap
- layer 0 を指す `MO(0)` などの layer 操作

## 適用する

操作は 2 つです。
workspace に `linux-keyboard.*.yaml` が 1 つだけなら `--layout` は要りません。

```bash
just linux apply                          # 差分と確認用 fingerprint を表示（何も書き換えない）
just linux apply --confirm v1-xxxx-yyyy   # 適用する（sudo のパスワードを求める）
```

`--confirm` が無いうちは、次を行って終わります。

1. 設定を検証する。error があればここで止まる。
2. keyd の設定を `keysync/generated/keyd.conf` へ生成し、`keyd check` で検証する。
3. 現在の `/etc/keyd/keysync.conf` との差分と、確認用の fingerprint を表示する。

fingerprint を渡すと、次を行います。

1. keyd が無い、または `keyd check` が通らなければ、何も書かずに終了する。
2. 現在の `/etc/keyd/keysync.conf` を `keysync/backups/keyd-<時刻>.conf` へ退避する。
3. `sudo install` で `/etc/keyd/keysync.conf` を置き換える。
4. `sudo keyd reload` で読み直させる。
5. ファイルを読み直し、生成物と一致することを確かめる。

KeySync が書くのは `/etc/keyd/keysync.conf` だけです。
他の `/etc/keyd/*.conf` には触りません。
keyd は同じキーボードを 1 つのファイルにしか書けないため、同じ id を他のファイルに書いているときは外してください。

## 戻し方

KeySync の設定を外すと、内蔵キーボードは元の動作に戻ります。

```bash
sudo rm /etc/keyd/keysync.conf
sudo keyd reload
```

以前の設定へ戻すときは、`keysync/backups/keyd-<時刻>.conf` を `/etc/keyd/keysync.conf` へコピーして reload します。

## Mac との違い

- 2 つの layer を同時に押したとき、keyd は後から押した layer を優先します。Mac（Karabiner）は番号の大きい layer を優先します。
- 右 Control / 右 Command の mod-tap は、hold 側が左右を区別しません。
- `backslash` と `non_us_pound` は Linux では同じキーです。同じ layer に両方を書くと error になります。
- 内蔵キーボードの配列は自動で検出しません。`--layout` かファイル名で決まります。
