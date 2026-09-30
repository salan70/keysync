# Mac の外付けキーボードを製品名で指し、kanata へ渡す

状態: 採用

2026-09-30 に、Magic Keyboard などの外付けキーボードにも Mac の設定を効かせたいという利用者の要望を受けて決めた。

## 背景

ADR 0049 で engine を kanata へ替えたとき、外付けの `{ vendor_id, product_id }` は kanata で指せないので error にした。\
外付けの Apple 純正 US キーボードに、内蔵 US と同じ設定を使いたいという要望は ADR 0026 からある。

固定している kanata（commit `ac1ddb4`）と karabiner-driverkit 0.4.0 のソースで確かめた事実。

- Fact: `macos-dev-names-include` は製品名（IOKit の Product）の完全一致で照合する。vendor / product id では指せない
- Fact: kanata は起動時に、そのときつながっているキーボードのうち名前が一致するものだけを登録する。登録したキーボードは、切断して繋ぎ直しても掴み直す
- Fact: 起動時につながっていなかった名前は登録されず、kanata を起動し直すまで掴まない
- Fact: 掴むデバイスは起動時に決まり、TCP の Reload では読み直さない
- Fact: driverkit には未接続でも vendor / product id で登録できる関数があるが、kanata はそれを設定から使えない
- Fact: `kanata --list` は root なしで動き、kanata が照合する製品名と vendor / product id を出す（2026-09-30 に実行して確認）

Karabiner-Elements が掴んでいるキーボードは kanata が開けない。\
内蔵キーボードと同じく、外付けも Karabiner の「Modify events」を切る必要がある（ADR 0049）。

## 選択肢

1. 外付けを製品名で持ち、`macos-dev-names-include` へ渡す。起動後に初めて繋いだときは kanata を起動し直す
2. kanata に patch を当て、vendor / product id で登録する。起動後に繋いでも掴める

## 決定

案 1 を採る。
利用者が選んだ。

- `MacDeviceIdentifier` の外付けを `{ vendorId, productId }` から `{ name }` に替える。YAML では `{ name: "Magic Keyboard" }` と書く
- `{ vendor_id, product_id }` の行は parse error にし、名前で書き直すよう案内する
- 名前は空でなく、`"`・`\`・制御文字を含まないものに限る。kanata の文字列は `"` で囲むだけで escape を持たないため
- 生成器は内蔵を `"Apple Internal Keyboard / Trackpad"`、外付けを宣言した名前にして `macos-dev-names-include` へ並べる。`mac-keymap/unsupported-device` は廃止する
- `keysync mac devices` を `kanata --list` で作り直す。一覧は登録済みかと、Karabiner が掴んでいるかを出す。`--add <name>` は一覧に出た名前だけを受ける
- `keysync mac service restart` を足す。`sudo launchctl kickstart -k` で kanata を起動し直す
- 適用で `macos-dev-names-include` の行が変わるときは、`mac-keymap/devices-need-restart`（warning）で起動し直しを求める

## 理由

- **kanata を改造しない。** patch は上流が取り込むまで保守が要り、kanata を上げるたびに当て直す必要がある
- **名前は `kanata --list` から取る。** kanata が照合するのと同じ値なので、書き写しの誤りで掴めないことが起きない
- **YAML に名前だけを持つ。** kanata が使うのは名前だけで、id を併せて持つと食い違ったときに正が 2 つになる。Karabiner の判定に要る id は、`mac devices` が一覧から引く

## 影響

- 起動後に初めて繋いだ外付けは、`just mac service restart` まで掴まれない
- 適用先を足した適用は、Reload のあとに `just mac service restart` が要る
- Karabiner の「Modify events」を外付けでも切る必要がある。`mac devices` の `karabinerGrabs` で確かめる
- kanata の設定は 1 マシンに 1 つで、既定では実行中の Mac の内蔵配列の設定を適用する。JIS の MacBook に US の外付けを繋いでも、ANSI の設定は効かない
- ADR 0026 の `{ vendorId, productId }` と、ADR 0049 の「外付けは error」を上書きする

## Open Question

- Magic Keyboard の製品名は実機で確かめていない。2026-09-30 の時点で外付けがつながっておらず、`kanata --list` に出なかった
- launchd が起動時に kanata を立ち上げる時点で、Bluetooth の外付けがつながっているかは確かめていない。つながっていなければ、Mac を起動するたびに再起動が要る
