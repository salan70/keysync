# 打鍵を HID・OS・Web UI の 3 層で記録し、workspace に残す

2026-09-27。
利用者から、打鍵をできるだけ記録したい、CLI でもよい、と要望があった。
層ごとに取れるものを示し、利用者はブラウザの拡張、OS 層の CLI、物理層の Spike のすべてを選んだ。
保存先は workspace を選んだ。

## Fact

- R-009 の Spike で、各層に何が取れるかを確かめた（`spikes/r-009-key-observe/README.md`）。
  - 物理層は取れない。内蔵キーボードは Karabiner が seize しており、Karabiner 15.3.0 には `send_user_command` も無い。
  - Karabiner の仮想キーボードの HID と、CGEventTap の OS 層は取れる。2 つの時計は同じである。
- 利用者の実打鍵 21 回（`kakikukeko hahihuheho`）を `fixtures/typing-log/r-009-kakikukeko.jsonl` に固定し、解析のテストに使った。
  - k・h・space の tap はすべて「離してから次を押した」と推定された。
  - 文字の順序は入れ替わらなかった。
- `keysync mac record 2` を workspace の複製に向けて実物で動かした。
  - レコーダーのビルド、2 層の open、`karabiner.json` からの閾値（200ms）の読み取り、ログの書き出しが通った。
  - 打鍵はしていないので、イベントは 0 件である。
- Web UI は headless Chrome で確認した。採点のたびに `keysync/typing-logs/*-browser.jsonl` が書かれ、keyup も含まれていた。
- 作業中に、打鍵テストの採点の整列の誤りを見つけて直した。
  - 打ち終える前に採点すると、`k ⌥A k i` の誤爆が先頭の `ka` ではなく遠くの `ga` に整列されていた。
  - 未入力の末尾をコスト 0 にし、同点では置換より脱落を優先する順にした。
- nix の devShell の `SDKROOT`（apple-sdk 11.3）では Xcode の Swift 6 がビルドできない。ビルド時にだけ外す形にした。
- 利用者の workspace と Karabiner の設定は変えていない。`~/Library/Caches/keysync/` にレコーダーの binary ができた。

## Decision

ADR 0046 に記録した。

## Open Question

- ロールの判定窓（5ms）と合成された tap の上限（20ms）が実測に合うか。意図的にロールした記録で確かめる。
- hold の記録（F を押し続けて U）は、まだ実打鍵で確かめていない。
- 利用者の dotfiles の `config/keysync/.gitignore` に `keysync/typing-logs/` を足すかは、利用者が決める。

## 追記: 課題つき記録

利用者が `mac record` を実行し、何を打てばよいか分からないと指摘した。
さらに、特定の文字列を打たせるべきだと提案した。
既定を課題つきに変え、Web UI と同じ課題をターミナルで順に打たせる形にした。
従来の形は `--free` として残した。

- 記録は通しで 1 本にし、HID の Return で課題ごとに区切って採点する。HID は IME より前の層なので、ターミナルの IME の状態に左右されない。
- ターミナルは cooked mode のまま読む。raw mode にすると Ctrl-C がレコーダーへ届かないためである。
- パイプから入力を流して実物で動かし、入力が尽きたところで記録を閉じて終了することを確かめた。
  - その記録には、並行して利用者が打っていた打鍵が入っていた。
  - scratchpad の複製にだけ書かれたもので、確認後に消した。
