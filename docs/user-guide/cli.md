# CLI の使い方

CLI は Web UI と同じ Core を共有します。
設定の検証、解析、差分計算、ファイル生成を行います。
CLI には Cornix LP への実機書き込み機能はありません。
MacBook 内蔵キーボードの設定のみ、CLI から差分確認と適用を行えます（macOS は kanata、Linux は keyd）。

## サブコマンド一覧

| コマンド     | 対象       | 主な用途                                              |
| ------------ | ---------- | ----------------------------------------------------- |
| `validate`   | Cornix LP  | workspace 設定の構文や整合性を検証します。            |
| `analyze`    | Cornix LP  | レイヤーの到達性や未参照の項目を解析します。          |
| `diff`       | Cornix LP  | 指定した `.vil` と workspace の意味差分を表示します。 |
| `render`     | Cornix LP  | レイヤー図面を SVG または PDF 形式で書き出します。    |
| `import vil` | Cornix LP  | `.vil` と定義から workspace を新規生成します。        |
| `export vil` | Cornix LP  | workspace の設定を `.vil` 形式で書き出します。        |
| `mac`        | Mac 内蔵   | kanata 設定の生成、差分確認、適用を行います。         |
| `linux`      | Linux 内蔵 | keyd 設定の生成、差分確認、適用を行います。           |

## セットアップ

CLI は clone したリポジトリの Nix 環境から実行します。

```bash
nix run github:salan70/keysync#install
```

導入スクリプトが clone、依存パッケージ、Git フック、OS ごとの準備を行います。
direnv を使わない場合は、先に `nix develop` へ入ってから実行してください。

## 共通規則

基本書式は次のとおりです。

```text
just keysync <command> --workspace <directory>
```

- `--workspace` を省略すると、`$KEYSYNC_WORKSPACE` を対象にします。どちらも無ければエラーで止まります。
- 相対パスは workspace ディレクトリを基準に解決されます。
- エラー時は標準エラーへ理由を出力し、終了コード 1 を返します。
- `validate` と `analyze` は、エラーがあれば終了コード 1、無ければ 0 を返します。

## Cornix LP 向けコマンド

### VIL から workspace を新規作成する

`.vil` と定義ファイルを読み込み、workspace を作成します。

```bash
just keysync import vil baseline.vil \
  --definition vial-definition.json \
  --workspace /path/to/workspace
```

既存ファイルがある場合は上書きされるため、実行前に Git の状態を確認してください。
成功時は作成された `keymap.yaml` のパスを表示します。

### 設定の検証（validate）

workspace の設定を検証し、診断結果を JSON で出力します。

```bash
just keysync validate --workspace /path/to/workspace
```

警告のみの場合は終了コード 0、エラーが 1 件以上ある場合は 1 を返します。
CI や Git フックでの検証に適しています。

### 参照と到達性の解析（analyze）

各レイヤーへの到達性や、参照関係のエッジを解析します。

```bash
just keysync analyze --workspace /path/to/workspace
```

到達できない孤立レイヤーや、未使用の動作定義の検出に使用します。

### VIL との差分計算（diff）

指定した `.vil` と workspace の設定を比較し、意味差分を出力します。

```bash
just keysync diff \
  --against before.vil \
  --workspace /path/to/workspace
```

実機との通信は行わず、ファイル同士の意味差分を計算します。
`--against` オプションは必須です。

### 図面の出力（render）

キーマップ図面をベクター形式（SVG または PDF）で生成します。

```bash
# SVG の出力
just keysync render --format svg --layer 0 --workspace /path/to/workspace

# PDF の出力
just keysync render --format pdf --layer 0 --workspace /path/to/workspace
```

- `--format`: `svg` または `pdf`（既定値: `svg`）。
- `--layer`: 出力対象のレイヤー番号（既定値: `0`）。
- `--out`: 出力ファイル名（既定値: `keymap.svg` または `keymap.pdf`）。

PDF は外部ツールを使わず、ローカルで高品質なベクター PDF を生成します。

### VIL への書き出し（export vil）

workspace の設定を `.vil` ファイルへ書き出します。

```bash
just keysync export vil --out keymap.vil --workspace /path/to/workspace
```

ファイルを生成するのみで、実機へは書き込みません。

## MacBook 内蔵キーボード管理（mac）

Mac のキーボード設定は kanata を介して管理します。
設定は workspace 直下の `mac-keyboard.<layout>.yaml` に置き、Git で管理します。
`$KEYSYNC_WORKSPACE` を設定していれば、`--workspace` は要りません。
対象の配列は実行中の Mac から自動検出するため、`--layout` も要りません。

Web UI の `kanata へ適用…` でも同じ手順で適用できます（[Web UI の使い方](./web-ui.md#kanata-へ適用する)）。
ターミナルから適用するときの操作は次の 2 つです。

```bash
just mac apply                          # 差分と確認用 fingerprint を表示（何も書き換えない）
just mac apply --confirm v1-xxxx-yyyy   # 適用して kanata に読み直させる
```

`mac` の出力には、実際に読んだ workspace の絶対パスが必ず含まれます。

### 初回の準備

kanata は root の launchd daemon として常駐させます。
準備は導入スクリプトがまとめて行います。

```bash
nix run github:salan70/keysync#install
```

導入スクリプトは次を行います。
済んでいる手順は飛ばすので、何度実行しても構いません。

1. Karabiner-Elements が無ければ Homebrew で入れ、ドライバの許可を待ちます。kanata は Karabiner の仮想キーボードのドライバを使います。
2. 内蔵キーボードの「Modify events」が切れるまで待ちます。切らないと入力が kanata へ届きません。
3. flake で固定した kanata を build します。安定版 v1.12.0 は Karabiner-Elements 16.x のドライバと通信できないため、開発版の commit に固定しています。
4. kanata の設定ファイルが無ければ、差分を表示し、`y` の入力を受けてから置きます。
5. 常駐を登録します（`just mac service install`）。端末で `sudo` のパスワードを求められます。
6. 「入力監視」と「アクセシビリティ」の画面を開きます。クリップボードにコピーされた kanata の path を追加して許可します。
7. kanata が起動したことを確かめます。

登録に root が要るのは導入時だけです。
以後の適用は、常駐している kanata に設定を読み直させるだけで、`sudo` は求めません。
flake で kanata の commit を上げると実体の path が変わるため、導入スクリプトを実行し直して許可し直します。

### 設定の適用（apply）

`--confirm` が無いうちは、次を行って終わります。kanata の設定ファイルは書き換えません。

1. desired state を検証する。error があればここで止まる。
2. kanata の設定を `keysync/generated/kanata.kbd` へ生成し、`kanata --check` で検査する。
3. 現在の設定とのテキスト差分と、確認用の fingerprint を表示する。

表示された fingerprint をそのまま渡すと、次を行います。

1. kanata が見つからないか `kanata --check` が通らなければ、設定ファイルに触れずに終了する。
2. 現在の設定ファイルを `keysync/backups/kanata-<時刻>.kbd` へ退避する。
3. 一時ファイルを作成後、アトミックにファイルを置き換える。
4. 反映後のファイルを再読み込みし、内容の一致を検証する。
5. 常駐している kanata に設定を読み直させる。

設定ファイルは `~/Library/Application Support/keysync/kanata.kbd` です。
KeySync はこのファイル全体を所有し、`karabiner.json` には書き込みません。
kanata が常駐していなければ、書き込みまで行い、`just mac service install` を案内します。
読み直しが失敗しても、書き込みは巻き戻しません。

### 差分の確認（diff）

現在の kanata の設定ファイルと workspace の設定差分だけを見ます。

```bash
just mac diff
```

ファイルの読み取りのみ行い、書き換えはしません。

### 設定の生成（generate）

kanata の設定ファイルだけを `keysync/generated/kanata.kbd` へ生成します。

```bash
just mac generate
```

kanata が入っていれば `kanata --check` も通します。
`apply` も内部で同じ生成と検査を行うため、通常は単独で実行する必要はありません。
error がある場合、または検査が通らない場合は終了コード 1 を返します。

### 常駐の確認と登録（service）

```bash
just mac service          # 状態を表示（何も書き換えない）
just mac service install  # launchd へ登録（sudo を求める）
```

`status`（既定）は、登録の有無、常駐しているか、設定ファイルの有無、Karabiner が内蔵キーボードを掴んでいるかを出します。
`install` は設定ファイルが無ければ登録しません。先に `just mac apply` で設定を置きます。

### 打鍵の記録（record）

打鍵を記録し、課題ごとの採点と mod-tap の判定の推定を出します。
記録は `keysync/typing-logs/` へ保存します。

```bash
just mac record               # 課題を 1 つずつ表示（既定は --tasks all）
just mac record --tasks roll  # roll、hold、all から選ぶ
just mac record --free 60     # 課題を出さずに 60 秒記録（既定は 30 秒）
```

課題は Web UI の打鍵テストと同じです。
ターミナルで打って Enter で次へ進み、Ctrl-C で終えます。
何も打たずに Enter を押した課題は飛ばします。

### 対象のキーボード

kanata は内蔵キーボードだけを対象にします。
外付けキーボードは kanata から指定できないため、設定に書くと error になります。
`TG(n)` も kanata に同等の動作が無いため error になります。

### 戻し方

以前の設定へ戻すときは、`keysync/backups/kanata-<時刻>.kbd` を
`~/Library/Application Support/keysync/kanata.kbd` へコピーし、kanata を起動し直します。

```bash
sudo launchctl kickstart -k system/dev.keysync.kanata
```

kanata による変換を止めるときは、常駐を解除します。
plist が `/Library/LaunchDaemons/` に残るため、Mac を再起動すると再び常駐します。

```bash
sudo launchctl bootout system/dev.keysync.kanata
```

## Linux の内蔵キーボード管理（linux）

Linux（Omarchy）では、内蔵キーボードの設定を keyd へ適用します。
`just linux devices|generate|diff|apply` の使い方は [Linux（Omarchy）で使う](./linux.md) を参照してください。

## ツール本体の更新

リポジトリを更新した後は、Nix 環境からコマンドを実行してください。

```bash
cd /path/to/keysync
git pull
```
