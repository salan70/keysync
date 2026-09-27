# 打鍵を Karabiner の後の 2 層（HID と OS）と Web UI で記録し、workspace に残す

状態: 採用

2026-09-27 に、mod-tap の閾値（ADR 0044）を調整する材料として、打鍵をできるだけ記録したいという要望を受けて決めた。
Spike は R-009（`spikes/r-009-key-observe/`）。

## 背景

ADR 0045 の打鍵テストは、ブラウザが受けた `keydown` から文字と chord だけを採点していた。
keyup、時刻、修飾キー単独の押下、OS が先に取るキー（⌘Space など）は残らなかった。
Karabiner がどう判定したか（tap か hold か、ロールか）も分からなかった。

R-009 で確かめた事実。

- Fact: 内蔵キーボードは Karabiner が seize しており、IOHID でデバイス単位に開いても `kIOReturnExclusiveAccess` で拒まれる。Karabiner に入る前の物理的な押下は読めない
- Fact: Karabiner の仮想キーボードは seize されておらず、Karabiner が出した HID の押下と離しを読める
- Fact: CGEventTap（listen-only）で OS のキーイベントを読める。入力監視の許可が要る
- Fact: 2 つの層の時刻は同じ mach の tick で、同じ打鍵は同じ値になる。`CGEvent.timestamp` は ns ではなく tick である
- Fact: Karabiner 15.3.0 は `send_user_command` を持たない。Karabiner に物理押下を外部へ通知させる経路は無い
- Fact: ADR 0044 の mod-tap の tap 側は、約 4〜6ms の合成された押下として出る。mod-tap でないキーは打鍵どおりの長さで出る
- Fact: nix の devShell は `SDKROOT` などを apple-sdk 11.3 に固定しており、Xcode の Swift 6 はその SDK でビルドできない

## 選択肢

記録の層について。

1. ブラウザだけ
2. ブラウザと、Karabiner の後の HID・OS の 2 層（Swift の CLI）
3. 2 に加え、Karabiner の前の物理押下

## 決定

案 2 を採る。案 3 は 15.3.0 では成り立たない。

- **CLI `keysync mac record [秒数]`**（既定 30 秒、Ctrl-C で早く止められる）を足す。Swift のレコーダー（`src/mac/key-recorder/KeyRecorder.swift`）が HID と OS の 2 層を 1 本の時系列で記録する
- レコーダーは初回に Xcode の `swiftc` でビルドし、`~/Library/Caches/keysync/` に source の hash 付きで置く。ビルド時は `SDKROOT`・`DEVELOPER_DIR`・`MACOSX_DEPLOYMENT_TARGET` を外す
- レコーダーは何も書き換えない。IOHID は seize せず、CGEventTap は listen-only にする
- **Web UI の打鍵テスト**は、入力欄が受けた keydown / keyup をすべて記録する。修飾キー単独、autorepeat、Enter、左右（`location`）、高精度の時刻を含む
- どちらのログも `keysync/typing-logs/<UTC 時刻>-<cli|browser>.jsonl` に書く。1 行目が meta で、2 行目以降がイベントである
- meta には、記録した時点で Karabiner に効いていた閾値を残す。CLI は `karabiner.json` の所有 profile から読み、Web UI は ADR 0045 の「確かめた閾値」を使う
- 時刻は記録開始からの相対 ns で書く。起動からの ns は稼働 104 日を超えると JavaScript の数値で正確に表せないためである
- CLI は記録の後、Karabiner の出力の形から mod-tap の判定を推定して出す（`analyzeModTapOutput`）。推定の規則は `typing-log.md` にある

## 理由

- **物理押下は取れない。** Karabiner の seize を外すと KeySync の所有範囲（ADR 0022）を越え、`send_user_command` は 15.3.0 に無い
- **出力の形から判定を推せる。** tap は数 ms の合成された押下で出るため、打鍵どおりのキーと区別できる。tap の直後に次の押下が続けばロールと推せる
- **2 層を 1 本にする。** 時計が同じなので突き合わせられる。HID は Karabiner の出力そのもので、OS 層は ⌘Space のようにアプリに届かないキーを含む
- **workspace に書く。** Claude や利用者が後から読み、閾値ごとに比べられる。workspace は利用者のデータの置き場所である
- **Swift は必要な範囲だけにする。** 記録だけを Swift に置き、解析と保存は Node と Core で行う。解析は純関数としてテストできる

## 影響

- `keysync mac record` には Xcode（`swiftc`）と、端末アプリへの入力監視の許可が要る
- 記録の間は、ほかのアプリでの打鍵もすべて記録される。パスワードなどを打たない
- `keysync/typing-logs/` は、workspace を Git 管理するなら除外を勧める。個人の打鍵の記録で、量も増える
- ロールの判定窓（5ms）と合成された tap の上限（20ms）は Inference である。実測で外れたら値を直す
- Karabiner が `send_user_command` を持つ版へ上がれば、物理押下の記録を再検討できる
