# workspace と用語

KeySync の設定ファイル構造と重要用語を説明します。

## 用語一覧

| 用語          | 意味                                                               |
| ------------- | ------------------------------------------------------------------ |
| workspace     | 設定ファイルを置くディレクトリ。`KEYSYNC_WORKSPACE` で指定します。 |
| desired state | workspace に保存された、実機へ反映したい目標設定です。             |
| current state | 最後の読み取りで取得した、実機の現在設定です。                     |
| full read     | キーマップや定義など、実機状態を一括取得する操作です。             |
| definition    | キーの物理配置やカスタムキーコードを解釈する定義データです。       |
| VIL           | Vial が扱うキーマップファイル（`.vil`）の形式です。                |
| validation    | 設定の構造、キーコード、参照関係、整合性を検証する処理です。       |
| semantic diff | 単なる文字列比較ではなく、意味単位で算出する設定差分です。         |
| Apply         | 差分を実機へ書き込み、直後の再読み込みで検証する操作です。         |
| WebHID        | ブラウザから USB / BLE HID 機器へ接続する Web API です。           |
| UID           | キーボード個体を識別し、別機器への誤書き込みを防ぐ値です。         |
| digest        | definition ファイルの内容から計算する SHA-256 値です。             |

## MacBook 内蔵キーボードの設定

Mac の設定も Cornix LP と同じく、workspace 直下に置きます。

| パス                     | 内容                              | Git 管理 |
| ------------------------ | --------------------------------- | -------- |
| `mac-keyboard.ansi.yaml` | ANSI 配列の Mac 向け目標設定      | 管理対象 |
| `mac-keyboard.jis.yaml`  | JIS 配列の Mac 向け目標設定       | 管理対象 |
| `keysync/generated/`     | Karabiner 向けに書き出した JSON   | 管理外   |
| `keysync/backups/`       | 適用前に退避した `karabiner.json` | 管理外   |

どちらのファイルを使うかは、実行している Mac の内蔵配列から自動で決まります。
workspace は `$KEYSYNC_WORKSPACE` で指定し、keysync リポジトリには置きません。
改名前の `$CORNIX_WORKSPACE` は読まないため、設定していた場合は名前を変えます。

## ファイル配置と Git 管理

workspace の推奨ディレクトリ構成です。

```text
<workspace>/
├── keymap.yaml
└── keysync/
    ├── definitions/<digest>.json
    ├── labels.yaml
    ├── acknowledgements.json
    ├── backups/<timestamp>.vil
    ├── backups/latest.vil
    └── generated/<name>
```

| パス                            | 内容                                  | Git 管理 |
| ------------------------------- | ------------------------------------- | -------- |
| `keymap.yaml`                   | 目標設定と definition への紐付け情報  | 管理対象 |
| `keysync/definitions/`          | キーマップ解釈に必要な定義ファイル    | 管理対象 |
| `keysync/labels.yaml`           | レイヤー名やキーコードの表示用別名    | 管理対象 |
| `keysync/acknowledgements.json` | 承認済み警告の記録 ID                 | 管理対象 |
| `keysync/backups/`              | Apply 前に退避した実機状態            | 管理外   |
| `keysync/generated/`            | 書き出した VIL、SVG、PDF などの成果物 | 管理外   |
| `keysync/typing-logs/`          | 打鍵テストと `mac record` の打鍵ログ  | 管理外   |

workspace を Git 管理するときは、workspace 直下の `.gitignore` へ以下を追加してください。

```gitignore
keysync/backups/
keysync/generated/
keysync/typing-logs/
```

### 改名前の workspace（`cornix/`）

KeySync へ改名する前に作った workspace は、定義ファイルなどを `cornix/` に置いています。
Web UI で開くと Cornix LP の位置に移行のカードが出るので、`keysync/ へ移行する` を押します。
CLI では `just keysync migrate` で同じ移行を行えます。

移行では定義ファイル、`labels.yaml`、`acknowledgements.json` を `keysync/` へ写し、`keymap.yaml` の参照先を書き直します。
`cornix/` は削除しません。
`backups/` と `generated/` は写さないため、移行後に内容を確かめ、不要なら `cornix/` を削除します。

改名後に初めて Web UI を開くと、テーマとアイコンの見た目の設定は既定に戻ります。

## `keymap.yaml` が正本である理由

Web UI で編集した内容は、まずローカルの `keymap.yaml` へ保存されます。
実機ではなく workspace を正本とすることで、以下の利点が得られます。

- Git で変更履歴や差分を正確に追跡できる。
- CLI と Web UI の両方で同一設定を検証できる。
- 実機へ書き込む前に意味単位の差分を確認できる。
- 複数台の PC 間でキーマップを安全に同期できる。
- AI にファイル編集や検証だけを任せ、実機への書き込みは人間に限定できる。

## 補助ファイルの役割

### Definition binding

`keymap.yaml` は対応する definition のパスと digest を保持します。
読み込み時と Apply 前に照合し、取り違えや意図しない変更を防止します。
ファイルや binding の記述を手作業で書き換えないでください。

### 表示名（`keysync/labels.yaml`）

レイヤー名やキーコード表示名は、画面や書き出し画像を読みやすくする情報です。
実機へ書き込む値には含まれません。
表示名だけを変更しても実機との差分は生じません。

### 警告承認の記録（`keysync/acknowledgements.json`）

Apply 時に承認した警告はここに保存されます。
承認 ID には警告の根拠情報が含まれます。
設定や実機状態が変化すると、同じ警告でも再度の確認が求められます。
