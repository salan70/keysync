# Linux の Apple 製キーボードは keyd を engine とし、設定は Mac と別のファイルで持つ

状態: 採用（`LT` と mod-tap の展開規則は ADR 0051 が上書き）

2026-09-26 に、Omarchy（Arch Linux + Hyprland）を入れた JIS 配列の MacBook Pro でも KeySync を使うために決めた。

## 背景

利用者は JIS 配列の MacBook Pro に Omarchy を入れて使う。
このマシンで次の 2 つを行いたい。

- 内蔵キーボードへ layer（`MO` / `LT` / `TG`）と tap-hold を効かせる
- Cornix LP を Web UI から WebHID で読み書きする

Mac の内蔵キーボードは Karabiner を engine にしている（ADR 0022）。
Karabiner は macOS 専用で、Linux では別の engine が要る。

調査で確認した事実（keyd の `docs/keyd.scdoc` と `src/keys.c`）。

- keyd は evdev の入力を奪って uinput の仮想キーボードへ再入力する daemon で、Wayland（Hyprland）でも compositor に依存せず動く
- 設定は `/etc/keyd/*.conf` に置く。root 所有で、反映は `sudo keyd reload` で行う
- `[ids]` に `vendor:product`（16 進）を並べたデバイスだけに効く。`k:` 接頭辞でキーボードだけを指せる。同じ id は 1 ファイルにしか書けない
- `layer(<layer>)` / `overload(<layer>, <action>)` / `toggle(<layer>)` / `noop` を持つ。修飾キーの layer（`control` / `shift` / `alt` / `meta` / `altgr`）が定義済みである
- layer は「起動順に重なり、上から覆う keymap の stack」で、どの layer にも書かれていないキーは `main` の割り当てへ落ちる
- `keyd check <file>` は設定ファイルを検証し、失敗したときだけ非 0 で終わる
- キー名は Linux の `KEY_*` に対応する（`capslock` / `leftcontrol` / `hangeul` / `hanja` / `yen` / `ro` / `102nd` など）

Linux の HID usage → evdev の対応で、次の 2 点は Karabiner の語彙と 1:1 にならない（Linux の `hid-input.c` の表からの Inference）。

- `backslash`（0x31）と `non_us_pound`（0x32）はどちらも `KEY_BACKSLASH` になる
- `international7`〜`international9`（0x8d〜0x8f）は対応する `KEY_*` が無い

## 選択肢

engine について。

1. keyd
2. kanata
3. Hyprland の `input:kb_options`（xkb）

設定ファイルについて。

1. `mac-keyboard.jis.yaml` を Mac と共有する
2. Linux 用に別のファイルを持つ

## 決定

engine は keyd、設定ファイルは Linux 用に別に持つ。

- **desired state は `linux-keyboard.<layout>.yaml`**（`linuxKeymapPath`）。schema は `keysync/linux-keymap@1` で、`mac-keyboard.*.yaml` とは独立に編集する
- **位置と keycode の語彙は Mac と同じにする。** 位置は Karabiner の `key_code` 名、値は QMK 表記である。盤面（`macPhysicalLayout`）と keycode の解析（`classifyKeycode`）をそのまま使い、keyd のキー名への写像は `src/core/linux-keymap/key-names.ts` だけが持つ
- **適用先は `vendor:product` で必ず宣言する。** Linux には `is_built_in_keyboard` に当たる判定が無い。`devices` を省略・空にした設定は `linux-keymap/no-target-device`（error）にする。一覧は `/proc/bus/input/devices` から出す
- **KeySync が所有するのは `/etc/keyd/keysync.conf` の 1 ファイル全体である。** 他の `/etc/keyd/*.conf` には触らない
- **diff と verify はテキストで行う。** keyd は設定ファイルを書き戻さないので、Karabiner のような整形差分が起きない
- **適用は CLI だけが行う。** 手順は Mac と同じ並びにする

  ```text
  /etc/keyd/keysync.conf を read
  → workspace の keysync/backups/ へ backup
  → linux-keyboard.<layout>.yaml を validate
  → keysync/generated/keyd.conf を生成し keyd check
  → diff と fingerprint を表示
  → 人間が確認
  → sudo install で置換
  → sudo keyd reload
  → 再 read して生成物と一致することを verify
  ```

- **展開規則。** layer 0 は `[main]`、layer n は `[layern]` に置く。`MO(n)` → `layer(layern)`、`LT n(kc)` → `overload(layern, kc)`、`TG(n)` → `toggle(layern)`、mod-tap → `overload(<修飾 layer>, kc)`（`LT` と mod-tap は ADR 0051 で `overloadt2` / `lettermod` に変えた）、`KC_NO` → `noop`。`KC_TRNS` と layer 0 と同値のキーは書かない
- **Karabiner へ落とせても keyd へ落とせないものは error にする。** `international7`〜`9` の位置と、Linux で同じ evdev キーになる位置の重複（`backslash` と `non_us_pound`）が該当する
- **Cornix LP の WebHID は Linux の Chrome でも同じコードで動かす。** hidraw の権限は udev rule で与え、`docs/user-guide/` で案内する。コードは変えない

## 理由

- **keyd を選ぶ。** Arch の公式 repo にあり、device を id で絞れ、layer と tap-hold（`overload`）を持つ。設定が ini で、生成物を人が読める
- **kanata は表現力で勝るが要らない。** 要件は ADR 0022 と同じ `MO` / `LT` / `TG` / mod-tap で、keyd で足りる。uinput 権限を利用者の group へ付ける導入手順が増える
- **xkb は layer と tap-hold を表現できない。** ADR 0022 が `hidutil` を退けたのと同じ理由である
- **別ファイルにするのは利用者の要望による。** Linux と macOS では Apple の `fn` 周りや IME の扱いが違い、同じ割り当てが正しいとは限らない
- **語彙を Mac と揃える。** 同じ物理キーボード（Apple の JIS 盤面）なので、盤面・編集・検証の実装を再利用できる。keyd の名前を位置に使うと盤面データを二重に持つ
- **適用を CLI に限る。** `/etc/keyd/` への書き込みと `keyd reload` には root が要る。ローカルサーバーから sudo のパスワードを受け取る経路は作らない。端末の sudo なら既存の認証をそのまま使える
- **ファイル単位で所有する。** keyd は 1 つの id を 1 ファイルにしか書けないので、ファイルの中で所有範囲を分ける必要が無い。テキストで比べられるので構造 diff も要らない

## 影響

- Linux の実行時の前提に keyd が加わる。インストールと `systemctl enable --now keyd` は利用者が行う
- `sudo` を CLI が子プロセスとして起動する。パスワードの入力は端末で行う
- keyd の layer は「後から起動した layer が勝つ」。Karabiner の「高い layer 番号が勝つ」と、2 つの layer を同時に押したときの結果が違う
- 右 Control / 右 Command の mod-tap は keyd の `control` / `meta` layer に落ちるため、hold 側は左右を区別しない
- Web UI からの Linux への適用は無い。適用は `just linux apply` で行う
- Web UI はまだ Linux の設定を表示・編集しない。当面は YAML を直接編集する。盤面の編集を Linux の設定へ広げるのは別の作業にする

## Open Question

以下は実機（Omarchy の MacBook Pro）で確認する。手順は `spikes/r-008-linux-keyd/` に置く。

- 内蔵キーボードの `vendor:product` と、`/proc/bus/input/devices` での見え方
- 英数 / かなが `hanja` / `hangeul` として届くか（HID の LANG2 / LANG1 からの Inference）
- `fn` と最上段のキーが keyd へどう届くか（`hid-apple` の `fnmode` に依存する）
- 既存の `/etc/keyd/default.conf` が `[ids] *` を持つ場合に、`keysync.conf` の明示 id が優先されるか
