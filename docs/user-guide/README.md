# KeySync 利用者ガイド

KeySync は Cornix LP と Mac のキーボードの設定を 1 か所で編集するツールです。
設定は `KEYSYNC_WORKSPACE` で指定したディレクトリ（workspace）へ保存し、Web UI や CLI で編集・検証します。
Web UI では実機状態を読み取り、確認した差分だけを実機へ反映（Apply）できます。

Web UI は clone したリポジトリで `just ui` を実行して起動します。

## 対応環境

確認済みの利用環境は次のとおりです。

- macOS
- Chrome または Chromium
- Vial protocol に対応した Cornix LP

Linux（Omarchy）でも使えます。
準備と内蔵キーボードの扱いは [Linux（Omarchy）で使う](./linux.md) を参照してください。
Linux での動作は実機で確認中です。

Edge や Brave でも動作しますが、確認済み環境には含めません。
Safari と Firefox は WebHID に非対応のため、実機接続を利用できません。
Web UI と CLI はどちらも、リポジトリを clone した Nix 環境から実行します。
更新は `git pull` のあと `just ui` を起動し直して受け取ります。

## 安全の基本原則

実機の誤設定や故障を防ぐため、以下の原則で動作します。

- 実機の読み取り（full read）は、実機の設定を変更しません。
- Web UI での編集内容は、まずローカルの `keymap.yaml` へ保存されます。
- 実機が変更されるのは、差分を確認して `実機へ Apply…` を実行したときだけです。
- Apply の直前には、必ず自動でバックアップが保存されます。
- CLI には Cornix LP への書き込み機能はありません（読み取り・検証・ファイル生成のみ）。

## クイックスタート

実機に接続しなくても、workspace の編集や各種ファイルの書き出しは利用できます。

### 設定の置き場所を決める

設定は keysync リポジトリには置きません。
dotfiles などの Git 管理しているディレクトリを決め、シェルの設定で `KEYSYNC_WORKSPACE` に指定します。

```bash
export KEYSYNC_WORKSPACE="$HOME/dotfiles/config/keysync"
```

未設定のまま `just ui` や `just keysync` を実行すると、エラーで止まります。
生成物を Git から外す設定は [workspace と用語](./workspace-and-terms.md#ファイル配置と-git-管理) を参照してください。

### 設定を編集する

1. リポジトリで `just ui` を実行します。Chrome で <http://127.0.0.1:5178/> が開き、workspace の設定が読み込まれます。
2. 盤面のキーを選択し、盤面の下の keycode picker や右側の編集パネルで設定を変更します。
3. 編集パネルの下と画面下部に `ローカル保存済み` と表示されたことを確認します。
4. 実機と同期する場合は、左端の `実機` を開き、`接続（機器を選ぶ）`、`実機から読み込む` の順に実行します。
5. 差分を確認し、問題がなければ `実機へ Apply…` へ進みます。
6. workspace の変更を、そのディレクトリのリポジトリで commit します。

### 実機読み取りから Cornix LP の設定を作る

1. `just ui` で開き、ヘッダーで `Cornix LP` を選びます。
2. `keymap.yaml が無い` と表示されたら、`実機 read で workspace を作成` を選びます。
3. デバイス選択画面で、対象の Cornix LP を選びます。
4. 読み取りが完了するまで接続を外さずに待ちます。
5. workspace 直下に `keymap.yaml`、`keysync/definitions/` に definition ファイルができたことを確認します。

この操作は実機の状態を読み取るだけであり、実機の設定は変更しません。

## 目的別ガイド

用途に合わせて以下のドキュメントを参照してください。

| ドキュメント                                   | 主な内容                                               |
| ---------------------------------------------- | ------------------------------------------------------ |
| [Web UI の使い方](./web-ui.md)                 | 画面構成、各タブの編集機能、VIL や画像の入出力         |
| [CLI の使い方](./cli.md)                       | 検証、到達性解析、差分確認、Mac 内蔵キーボード管理     |
| [Linux（Omarchy）で使う](./linux.md)           | udev rule、keyd による内蔵キーボードの設定と適用       |
| [Safe Apply と復旧](./safe-apply.md)           | 実機書き込み手順、エラーと警告の基準、バックアップ復元 |
| [workspace と用語](./workspace-and-terms.md)   | ファイル配置、Git 管理対象、重要用語の一覧             |
| [トラブルシューティング](./troubleshooting.md) | 接続失敗、保存不可、権限エラーなどの対処手順           |
