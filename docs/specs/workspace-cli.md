# WorkspaceとCLI

workspaceは`$KEYSYNC_WORKSPACE`で指定し、CLIとローカルサーバーが同じ規則で決める（ADR 0038、ADR 0039）。
`keymap.yaml`がdesired stateで、definitionはSHA-256の先頭16文字を使ったcontent-addressed
pathに保存する。`keysync/acknowledgements.json`はApply warningの確認IDを保持する。
`keysync/backups/`と`keysync/generated/`は生成物で、`keysync/typing-logs/`は打鍵ログ（ADR 0046）である。keymapの競合検出は
mtimeだけでなく読み出したcontent hashを優先する。

<!-- @code src/workspace/layout.ts#WORKSPACE_LAYOUT -->
<!-- @code src/workspace/layout.ts#macKeymapPath -->
<!-- @code src/workspace/layout.ts#linuxKeymapPath -->
<!-- @code src/workspace/layout.ts#LEGACY_WORKSPACE_LAYOUT -->

## 配置

```text
keymap.yaml
mac-keyboard.<layout>.yaml
linux-keyboard.<layout>.yaml
keysync/
  definitions/<digest-prefix>.json
  labels.yaml
  acknowledgements.json
  backups/<timestamp>.vil
  backups/latest.vil
  generated/<name>
  typing-logs/<UTC 時刻>-<cli|browser>.jsonl
```

改名前（ADR 0035）の管理ディレクトリは`cornix/`だった。`LEGACY_WORKSPACE_LAYOUT`はそのうち
移すファイル（definition、`labels.yaml`、`acknowledgements.json`）の場所で、移行の計画だけが読む。
通常の読み込みは`cornix/`へ倒さない（ADR 0036）。移行の仕様は`ui.md`の「旧ディレクトリの移行」にある。

`mac-keyboard.<layout>.yaml`（`macKeymapPath`）はMacのdesired stateで、`keymap.yaml`とは別
documentである（ADR 0022）。仕様は`mac-keymap.md`にある。片方だけが存在するworkspaceも
成立するため、CLIのmac系サブコマンドは`keymap.yaml`を要求しない。

設定の単位は物理配列である（ADR 0026）。配列の違うMacを1つのworkspaceで扱うため、
`ansi`と`jis`を別ファイルに分ける（ADR 0027）。ファイル名と中の`layout`宣言が食い違って
いたら読み込み側が落とす。正規形が2つあると、どちらが正か分からないまま生成まで進む。

ADR 0027より前の`mac-keyboard.yaml`は読み込み時の後方互換として残る。どの配列のものかは
中の`layout`宣言で決まり、宣言が求めた配列と違えば「その配列の設定は無い」として扱う。

`linux-keyboard.<layout>.yaml`（`linuxKeymapPath`）はLinuxで使うApple製キーボードのdesired stateで、
Macの設定とは独立に編集する（ADR 0042）。仕様は`linux-keymap.md`にある。旧名は無い。

<!-- @code src/workspace/default-root.ts#defaultWorkspaceRoot -->

## defaultWorkspaceRoot

`--workspace`無しで使うworkspaceです。`$KEYSYNC_WORKSPACE`を絶対pathにして返します。
優先順は`--workspace` > `$KEYSYNC_WORKSPACE`で、どちらも無ければ例外にします（ADR 0039）。
CLIの全サブコマンドと、`just ui`・`just dev`のローカルサーバーがこの規則を使います。

**keysyncリポジトリのrootにもcwdにも倒しません。** 倒すと、変数を付け忘れた起動で
Git管理されない場所へ設定が黙って書かれます。keysyncリポジトリは利用者の設定を持ちません。

既定が暗黙に効くので、`mac`の各サブコマンドは出力へ、ローカルサーバーは起動時のターミナルへ
解決済みの`workspace`を必ず出します。

<!-- @code src/workspace/mac-keymap-file.ts#readMacKeymapFor -->

## readMacKeymapFor

指定した配列の設定を読みます。新しい名前を先に見て、無ければ旧名を`layout`宣言で
解決します。`src/core/mac-keymap/`はfilesystemに触らないため、名前の解決はworkspace層が
持ちます。

<!-- @code src/workspace/linux-keymap-file.ts#readLinuxKeymapFor -->

## readLinuxKeymapFor

指定した配列のLinux設定を読みます。ファイル名と中の`layout`宣言が食い違っていたら落とします。

## 表示用labels

`keysync/labels.yaml`は実機へ送らない表示用sidecarである。layer名に加えて、Anyキーなどのraw keycode式へ
workspace共通の表示名を付けられる。表示名のkeyはraw式の完全一致で、keymapのraw値やvalidation、diff、
Applyの入力には影響しない。

`labels@1`はlayer名だけのlegacy形式として読み込み、保存時は`labels@2`へシリアライズする。
改名前の`cornix-bonsai/labels@1`と`cornix-bonsai/labels@2`も読み込み、保存時は`keysync/labels@2`で書く（ADR 0036）。

```yaml
schema: keysync/labels@2
layers:
  0: "Base"
keycodes:
  "LCG(KC_Q)": "アプリ終了"
```

<!-- @code src/workspace/labels.ts#parseLabelsYaml -->
<!-- @code src/workspace/labels.ts#serializeLabelsYaml -->
<!-- @code src/workspace/labels.ts#keycodeLabel -->

## 表示名の仕様

表示名はUIの編集パネル（Inspector）から編集し、空欄でそのraw式のentryを削除する。名前が無い場合はkeycodeの既定表示へ
fallbackする。SVG/PDFでは名前とraw式を併記する。

<!-- @code src/workspace/layout.ts#definitionDigest -->

## definitionDigest

definitionのcontent-addressingに使う唯一のdigestである。JSONとして読んでキーを辞書順へ
揃え、2 space整形 + 末尾改行にした表現のSHA-256を取る（ADR 0007）。

`.vil` importと実機full readはどちらもこの関数を通し、workspaceへもcanonical表現で書く。
raw bytesを対象にすると、firmwareが配るpayloadとGit管理下のdefinitionが同じ内容でも
整形の違いだけで別digestになり、実機接続時にdefinition mismatchでApplyが止まる。

<!-- @code src/workspace/layout.ts#readDefinitionBinding -->

## readDefinitionBinding

`keymap.yaml`のdefinition pathがdigestから導出したcontent-addressed pathと一致すること、
実ファイルのdigestがbinding digestと一致することをBrowser / CLIの両方で検証する。
不一致や欠落はdefinitionを解釈せずエラーにする。

<!-- @code src/workspace/types.ts#writeTextIfUnchanged -->

## 外部変更競合

保存直前に現在のstatを取得し、読み込み時のtokenとcontent hashまたはmtimeが異なれば上書き
しない。file watchingは行わず、ユーザーの明示的な再読み込みで外部変更を取り込む。

<!-- @code src/workspace/save-queue.ts#createSaveQueue -->

## 保存の直列化

UIの編集state更新とfilesystemへのwriteを分ける。編集は入力ごとにstateへ即時反映し、
writeはこのqueueが1本の列で行う。競合検査に使うtokenは、成功したwriteごとにqueueだけが
更新する。

入力ごとに非同期saveを並行させると、先行saveの書き込みを後続saveが外部変更と誤検出するか、
同じtokenで競合検査を通った複数のwriteの順序が入れ替わり、古い内容が最後に残る。

待ち中の内容は常に最新の1つへ畳む。中間状態は捨ててよいが、最後の入力は必ず残る。
`onSaved`はqueueが空になり、当該runで失敗が発生していない場合だけ通知する。
競合を検出した時点で待ち中の予約も捨て、取り込みは明示的な再読み込みに任せる。

<!-- @code src/cli/main.ts#main -->

## CLI

同じCore表現を使い、`keysync validate`、`keysync analyze`、`keysync diff --against`、
`keysync render --format svg|pdf`、`keysync export vil`を提供する。`.vil` importは
`keysync import vil <file> --definition <definition.json>`でworkspaceへ初期化する。

`keysync migrate`は改名前の`cornix/`を指すworkspaceを`keysync/`へ移す（ADR 0036）。
Web UIの移行と同じ`planLayoutMigration`と`writeLayoutMigration`を通る。
移す必要が無ければ`migrated: false`を返して何も書かない。
`cornix/`を指したままのworkspaceへ他のcommandを使うと、`keysync migrate`を案内して止まる。

MacBook内蔵キーボードは`keysync mac generate|diff|apply|devices`で扱う。仕様は
`mac-keymap.md`にある。`keymap.yaml`もdefinitionも要らないため、`import vil`と同じく
**workspaceを読み込む手前で分岐**する。`--karabiner <path>`の既定は
`~/.config/karabiner/karabiner.json`。

日常の操作は`--workspace`も`--layout`も要らない。配列は実行しているMacから検出し
（ADR 0027）、workspaceは`$KEYSYNC_WORKSPACE`から決める（ADR 0039）。`mac`の全出力へ
解決済みの`workspace`を載せる。

適用はCLIとローカルサーバーの適用APIが行う（ADR 0034）。`keysync mac apply`は`--confirm`が無いうちはasset生成と
lint、構造diff、fingerprintを出して終わり、人間が同じfingerprintを渡したときだけ
`karabiner.json`を書く。手順は`mac-keymap.md`の「適用の境界」にある。error diagnosticが
1件でもあれば適用せず、lintが落ちても書き込まない。

Linuxで使うApple製キーボードは`keysync linux devices|generate|diff|apply`で扱う（ADR 0042）。
仕様は`linux-keymap.md`にある。`mac`と同じくworkspaceを読み込む手前で分岐する。
配列は検出できないため、`--layout`か、workspaceに`linux-keyboard.*.yaml`が1つだけあることで決める。
`linux devices --add <vendor>:<product>`は設定が無ければ作る。
`linux apply`は`--confirm`が無いうちは生成と`keyd check`、差分、fingerprintを出して終わる。
`--config <path>`の既定は`/etc/keyd/keysync.conf`。

`keysync mac record`は打鍵を記録して`keysync/typing-logs/`へ書く（ADR 0046）。
既定は課題つきで、Web UIの打鍵テストと同じ課題を1つずつstderrへ出す。利用者はターミナルで打ち、Enterで次へ進む。
何も打たずにEnterを押した課題は飛ばしたものとして扱い、入力が尽きるかCtrl-Cで終える。
`--tasks roll|hold|all`で課題を選ぶ（既定はall）。記録の上限は1800秒である。
`--free [秒数]`は課題を出さずに秒数だけ記録する（既定30秒）。
`karabiner.json`は、記録した時点で効いていた閾値を残すために読むだけである。
出力は記録した件数、開けたキーボードと開けなかったキーボード、警告、課題ごとの採点と判定の推定、全体の判定の推定である。
仕様は`typing-log.md`にある。

`--no-select`を渡すとprofileの選択を行わない。診断が変わるのでfingerprintも変わり、
確認文字列はフラグを含む形で返る（ADR 0028）。

exit codeは他のコマンドと揃える。errorが1件でもあれば1、それ以外は0。

<!-- @code src/workspace/mac-keymap-file.ts#macKeymapDigest -->

## macKeymapDigest

Mac設定の同一性を表すdigestです。`serializeMacKeymapYaml`の正規形へserializeしてから
SHA-256を取ります。Web UIが編集中の内容と、ローカルサーバーがディスクから読んだ内容を
突き合わせるために使います（ADR 0034）。ファイルのテキストではなく正規形を比べるので、
手で書いたコメントや並び順の違いは同じ設定として扱います。

<!-- @code src/render/keyboard.ts#renderSvg -->
<!-- @code src/render/keyboard.ts#renderPdf -->

## Rendering

SVGとPDFは同じdefinition由来の物理座標を使う別rendererで、HTML editorのmarkupは共有しない。
PDFは外部サービスへ送らず、CLIが1ページのベクターPDFを生成する。
