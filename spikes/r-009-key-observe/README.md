# R-009 Spike: 打鍵をどの層まで記録できるか

mod-tap の閾値（ADR 0044）を調整するための記録を、どの層まで取れるかを確かめる使い捨てコードです。
本実装ではありません。
何も書き込まず、Karabiner の設定にも触れません。

**本実装は `keysync mac record`（`src/mac/key-recorder/`、`src/core/typing-log/`）にあります。**
この Spike は判断時点の記録として凍結してあり、以後は更新しません。判断は ADR 0046 にあります。

## 使い方

```bash
spikes/r-009-key-observe/run.sh 10
```

`recording` と出たら、秒数のあいだ任意の場所で打鍵します。
IOHID（`hid-observe.swift`）と CGEventTap（`event-tap.swift`）を同時に動かし、JSON Lines を `$TMPDIR/r-009-<時刻>/` へ書きます。

nix の devShell は `SDKROOT` を apple-sdk 11.3 に固定します。
システムの Swift 6.2 はこの SDK を読めないため、`run.sh` は Xcode の SDK へ差し替えてビルドします。

## 確かめたこと（2026-09-27、MacBook Air / macOS 26 / Karabiner 15.3.0）

### Fact

- 内蔵キーボード（`Apple Internal Keyboard / Trackpad`）は、seize せずにデバイス単位で開いても `kIOReturnExclusiveAccess`（`0xE00002C5`）で拒まれる。Karabiner が seize しているためで、Karabiner の前の物理的な押下は IOHID では読めない
- Karabiner の仮想キーボード（`Karabiner DriverKit VirtualHIDKeyboard 1.8.0`、vendor 1452 / product 591）は開けて、Karabiner が出した HID の押下と離しが取れる
- CGEventTap（`cghidEventTap`、listen-only）は開けて、keyDown / keyUp / flagsChanged が取れる。この端末には入力監視の許可があった
- 2 つの層の時刻は同じ時計である。`IOHIDValueGetTimeStamp` と `CGEvent.timestamp` はどちらも mach 時刻の tick で、同じ打鍵は同じ値になる（ns への換算は `mach_timebase_info` で、この機種は 125/3）
- Karabiner 15.3.0 の lint は `send_user_command` を `unknown key` として拒む。Karabiner に物理押下を外部へ通知させる経路は、このバージョンには無い
- ADR 0044 の形の mod-tap は、tap 側を約 4〜6ms の合成された押下として出す。mod-tap でないキーは、打鍵どおりの長さ（48〜104ms）で出る
- 21 打鍵（`kakikukeko hahihuheho`）で、文字の順序は入れ替わらなかった

### Inference

- mod-tap の tap がどの経路で出たかは、出力の時刻から推定できる
  - `to_if_alone` は物理的に離した時点で出る
  - `to_if_canceled` は次のキーを押した時点で出るため、直後（1ms 未満）に次のキーの押下が続く
  - hold の修飾キーは、押下から閾値の後に単独で出る
- 今回の 21 打鍵では、mod-tap の出力から次の押下まで最短 68.5ms で、すべて `to_if_alone`（離してから次を押した）と推定できる。ロール（`to_if_canceled`）は起きていない
- 物理的な押下時刻は、mod-tap でないキーについては出力と一致するが、mod-tap のキーについては分からない

### Open Question

- hold（F を押し続けて U）の打鍵は記録の時間内に入らず、未確認である
- Karabiner を `send_user_command` のあるバージョンへ上げれば、物理押下を取れる可能性がある
- このスクリプトの `event-tap.swift` は `CGEvent.timestamp` を ns として出しているが、実際は mach の tick である（HID 側と同じ値になることから確かめた）。本実装は ns へ換算する
