# R-010 Spike: MacBook 内蔵キーボードを kanata で Cornix と同じ判定にできるか

Mac の home mod を Cornix LP と同じ判定（Permissive Hold + Chordal Hold + Flow Tap）にするため、engine を kanata へ替えられるかを確かめる使い捨ての設定です。
本実装ではありません。
KeySync の生成器も Karabiner の設定も変えません。

`keysync.kbd` は、利用者の `mac-keyboard.ansi.yaml`（2026-09-27 時点）を手で写したものです。

## 確かめたいこと

1. Karabiner-Elements 16.3.0 を入れたまま kanata を動かせるか。Karabiner の「Modify events」を内蔵キーボードだけ切れば共存できるか。
2. 内蔵キーボードだけを掴み、Cornix LP などの外付けに触らないか。
3. home mod のショートカットが、閾値の前でも反対の手のキーで効くか。ロール打鍵（`ka`、`df` など）が誤爆しないか。
4. Shift、かな・英数、layer（caps_lock、左 ⌘、左 control、右 ⌘）が今の Karabiner と同じに動くか。

## 前提（2026-09-27 に調べた事実）

- kanata の安定版 v1.12.0 は Karabiner の VirtualHIDDevice v6 用で、Karabiner-Elements 16.x の v8 と通信できない（jtroo/kanata#2105、#2123）。v8 対応は未リリースで、`brew install --HEAD kanata` で入れる。
- kanata は root で動かす。入力監視とアクセシビリティの許可が要る。
- Karabiner-Elements が同じキーボードを掴んでいると kanata は動かない（jtroo/kanata#1586）。デバイスごとに分けて共存できるかは文書が無い。

## 手順

1. 設定を検査する（root は要らない）。

   ```bash
   kanata --cfg spikes/r-010-kanata-macos/keysync.kbd --check
   ```

2. Karabiner-Elements の設定 →「Devices」で、`Apple Internal Keyboard / Trackpad` の「Modify events」を切る。この間、内蔵キーボードは素の配列になる。
3. kanata を起動する。

   ```bash
   sudo kanata --cfg spikes/r-010-kanata-macos/keysync.kbd
   ```

   入力監視・アクセシビリティの許可を求められたら許可し、起動し直す。

4. 打って確かめる。止めるときは次のどれかを使う。
   - 別の端末で `sudo pkill kanata` を実行する
   - kanata に組み込みの緊急停止を使う。物理キーの左 control・spacebar・esc を同時に押す
   - 外付けキーボードから、kanata の端末で Ctrl+C を押す（内蔵キーボードの左 control は layer 4 なので効かない）
5. 戻すときは、Karabiner-Elements の「Modify events」を入れ直す。

## 確かめたこと（2026-09-27、MacBook Air / macOS 26 / Karabiner-Elements 16.3.0 / kanata HEAD-ac1ddb4）

### Fact

- `brew install --HEAD kanata` で入った build は `1.12.1-prerelease-1` と名乗るが、VirtualHIDDevice v8 対応（jtroo/kanata#2123）より後のコミットである
- `kanata --check` は root なしで設定を検査できる
- Karabiner-Elements が内蔵キーボードを掴んだままでも kanata は起動し、仮想キーボードを作った。しかし内蔵キーボードの入力は kanata に届かなかった
- このとき macOS のキーボード設定アシスタントが開いた。kanata の仮想キーボードを新しいキーボードとして見つけたためと考えられる
- KeySync profile で内蔵キーボードの「Modify events」を切ると、`karabiner.json` の KeySync profile に `{"identifiers": {"is_keyboard": true}, "ignore": true}` が加わり、Karabiner は内蔵キーボードを手放した
- その後に起動した kanata は、Karabiner の VirtualHIDDevice daemon へつながった。Karabiner の Core Service は kanata の仮想キーボードを observed で扱い、掴まなかった。Karabiner-Elements を入れたまま動く
- 利用者が実機で打って、次を確かめた
  - home mod の tap と、f を押したまま c での ⌘C
  - caps_lock を押したままの n で ↓
  - ローマ字の文章や `df` のロールで誤爆しない
  - Shift、かな・英数、各 layer が Karabiner のときと同じ

### Inference

- Karabiner の「Modify events」をデバイス単位で切れば、Karabiner-Elements と kanata を共存させられる。Karabiner を消して単体のドライバへ移る必要は無い
- KeySync が KeySync profile を書き直すと、`ignore` の設定が消えて Karabiner が内蔵キーボードを掴み直す可能性がある（未確認）

### Open Question

- kanata を常駐させる方法（launchd）と、設定の反映を root なしで行えるか
