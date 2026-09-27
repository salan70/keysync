# 打鍵ログ

mod-tap の閾値を調整する材料として、打鍵を記録して workspace に残す仕様です。
判断は ADR 0046 にあり、Spike は R-009（`spikes/r-009-key-observe/`）です。

記録できるのは Karabiner が処理した**後**の入力だけです。
Karabiner が内蔵キーボードを seize しているため、物理的な押下は読めません。

<!-- @code src/core/typing-log/types.ts#HidLogEvent -->
<!-- @code src/core/typing-log/types.ts#OsLogEvent -->
<!-- @code src/core/typing-log/types.ts#BrowserLogEvent -->
<!-- @code src/core/typing-log/types.ts#KeyLogEvent -->

## KeyLogEvent

イベントは記録の層ごとに 3 種類です。

| type      | 層                                    | 時刻                               | 記録する側 |
| --------- | ------------------------------------- | ---------------------------------- | ---------- |
| `hid`     | Karabiner の仮想キーボードの HID の値 | 記録開始からの ns（`ns`）          | CLI        |
| `os`      | CGEventTap が受けた OS のイベント     | 記録開始からの ns（`ns`）          | CLI        |
| `browser` | Web UI の入力欄の keydown / keyup     | ページの `timeStamp` の ms（`ms`） | Web UI     |

`hid` と `os` は同じ時計で、同じ打鍵は同じ `ns` になります。
`browser` の時刻は他の 2 つと揃いません。

`os` の `flags` は `CGEventFlags` の生の値で、左右の修飾キーを区別するビットを含みます。
`browser` の `location` は `KeyboardEvent.location` で、修飾キーの左右（1 が左、2 が右）を表します。

<!-- @code src/core/typing-log/types.ts#KeyLogMeta -->

## KeyLogMeta

ログの 1 行目です。
記録した側（`cli` / `browser`）、開始時刻、配列、記録した時点で Karabiner に効いていた閾値を持ちます。
閾値が確かめられなければ `null` です。

CLI は `originNs`（`hid` / `os` の時刻の原点、起動からの ns を 10 進の文字列で）を書きます。
Web UI は `trial`（課題の id、本文、採点の集計）を書きます。
CLI の課題つき記録は `trials`（課題ごとの id、本文、ターミナルが受け取った行、採点の集計）を書きます。
ターミナルの行は IME を通った後の文字列なので、採点には使いません。

<!-- @code src/core/typing-log/format.ts#keyLogPath -->
<!-- @code src/core/typing-log/format.ts#serializeKeyLog -->
<!-- @code src/core/typing-log/format.ts#parseKeyLog -->

## serializeKeyLog

ログは JSON Lines で、`keysync/typing-logs/<UTC 時刻>-<cli|browser>.jsonl` に置きます。
ファイル名は並べると時刻順になります。
行ごとに独立した JSON にするのは、記録が途中で止まっても読める部分を残し、`jq` などでそのまま扱えるようにするためです。

`parseKeyLog` は 1 行目が meta であること、各行が JSON であること、`type` が既知であることだけを確かめます。
書くのは KeySync 自身なので、field の値は検査しません。

<!-- @code src/core/typing-log/hid-usage.ts#hidUsageName -->
<!-- @code src/core/typing-log/hid-usage.ts#isModifierUsage -->

## hidUsageName

Keyboard/Keypad page（0x07）の usage を Karabiner の `key_code` 名へ写します。
`lang1` / `lang2` は KeySync の語彙に合わせて `japanese_kana` / `japanese_eisuu` と書きます。
表に無い usage は `usage_0x..` にします。

<!-- @code src/core/typing-log/analyze.ts#SYNTHETIC_TAP_MAX_MS -->
<!-- @code src/core/typing-log/analyze.ts#ROLL_WINDOW_MS -->
<!-- @code src/core/typing-log/analyze.ts#ModTapTapStats -->
<!-- @code src/core/typing-log/analyze.ts#HoldRecord -->
<!-- @code src/core/typing-log/analyze.ts#ModTapAnalysis -->
<!-- @code src/core/typing-log/analyze.ts#analyzeModTapOutput -->

## analyzeModTapOutput

`hid` のイベントから、layer 0 の mod-tap がどう判定されたかを推定します。

tap 側のキーの出力は、長さで分けます。

| 出力の長さ                         | 次の押下                                               | 分類          |
| ---------------------------------- | ------------------------------------------------------ | ------------- |
| `SYNTHETIC_TAP_MAX_MS`（20ms）以下 | 離しから `ROLL_WINDOW_MS`（5ms）以内、または離しより前 | `roll`        |
| `SYNTHETIC_TAP_MAX_MS` 以下        | それ以外                                               | `alone`       |
| `SYNTHETIC_TAP_MAX_MS` 超          | —                                                      | `passthrough` |

- `alone` は、離してから次を押した tap です。`to_if_alone` は物理的に離した時点で出ます
- `roll` は、押している間に次のキーが押された tap です。`to_if_canceled` は次の押下の時点で出るため、直後に次の押下が続きます
- `passthrough` は打鍵どおりの長さで出た出力です。別のキーボードからの入力や、mod-tap が効いていない場合です

修飾キーの押下は hold です。
2ms 以内に続けて押された修飾キーは 1 組にまとめます。複合 modifier（`SGUI_T` など）は 1 イベントで出るためです。
組が全部離されるまでに押されたキーを chord として持ち、同じ組を hold 側に持つ mod-tap をすべて候補に挙げます。
出力からは、同じ修飾キーを持つ mod-tap（`LGUI_T` の F と spacebar など）を区別できません。

打鍵の速さの目安として、修飾キー以外の押下どうしの間隔の 10 パーセンタイルと中央値も出します。

2 つの閾値（20ms と 5ms）は Inference です。
R-009 の実測では、tap の出力は 3.9〜5.7ms、次の押下までは最短 68.5ms でした。

<!-- @code src/core/typing-log/trial.ts#typedEventsFromHid -->
<!-- @code src/core/typing-log/trial.ts#splitAtReturn -->

## 課題つき記録の採点

`keysync mac record` は、課題をターミナルで打たせ、Enter で次へ進めます。
記録は通しで 1 本なので、HID の Return の押下で課題ごとに区切ります（`splitAtReturn`）。
区切りの Return の押下は、その区間の最後に入れます。
採点では 1 文字でない `key` として捨てられ、判定の推定では最後の tap の「次の押下」として使えます。

区切った HID の出力は、Web UI と同じ `gradeTypingTrial` で採点します。
そのために `typedEventsFromHid` で `TypedEvent` の列へ変えます。

- 修飾キーは押下と離しで状態を追い、それ以外の押下 1 回を 1 件にします
- 英字・数字・空白は文字にし、Shift が押されていれば英字を大文字にします
- それ以外のキーは `key_code` 名を `key` に置き、採点で捨てられます

HID は IME より前の層なので、IME の状態に左右されずに採点できます。
区間に文字が 1 つも無い課題は飛ばしたものとして扱います。
Return の区切りの数と進めた課題の数が合わなければ、先頭から順に対応させて警告を出します。

<!-- @code src/mac/key-recorder.ts#KeyRecording -->
<!-- @code src/mac/key-recorder.ts#KeyRecorder -->
<!-- @code src/mac/key-recorder.ts#createKeyRecorder -->

## KeyRecorder

`keysync mac record` の記録の口です。
`stop` が解決すると子プロセスへ SIGINT を送り、記録を閉じます。課題つき記録は、課題を進め終えたときにこれで止めます。
実物（`createKeyRecorder`）は Swift のレコーダーをビルドして起動し、テストは偽物を注入します。

レコーダーの source は `src/mac/key-recorder/KeyRecorder.swift` です。
初回に Xcode の `swiftc` でビルドし、`~/Library/Caches/keysync/key-recorder-<source の hash>` に置きます。
source が変われば別の名前になるため、古い binary を使い続けません。
nix の devShell が固定した `SDKROOT`・`DEVELOPER_DIR`・`MACOSX_DEPLOYMENT_TARGET` は、ビルド時に外します。

レコーダーは 2 つの層を同時に開きます。

- IOHID: キーボードを seize せずに開きます。1 台でも seize されていると全体の結果は `kIOReturnExclusiveAccess` になりますが、開けた台は読めます
- CGEventTap: `cghidEventTap` に listen-only で置き、keyDown / keyUp / flagsChanged を受けます

時刻はどちらも mach の tick で、`mach_timebase_info` で ns へ換算し、記録開始からの相対値にします。
SIGINT（Ctrl-C）と SIGTERM を受けると記録を閉じて終わり、親の CLI は子の終了を待ってからログを書きます。
