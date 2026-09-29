# KeySync 利用者ガイド

KeySync は Cornix LP と Mac のキーボードの割り当てを 1 か所で編集し、反映するツールです。
設定は `KEYSYNC_WORKSPACE` で指定したディレクトリ（workspace）に置き、Git で管理します。

## 導入

`KEYSYNC_WORKSPACE` をシェルの設定で export してから、次を実行します。
Nix が入った Mac と Omarchy で使えます。

```bash
nix run github:salan70/keysync#install
```

リポジトリは `~/Projects/Tools/keysync` に clone されます（`KEYSYNC_REPO` で変更できます）。
途中で許可や確認を求められたら、表示に従います。
何度実行しても構いません。

## 使い方

1. リポジトリで `just ui` を実行し、Chrome で <http://127.0.0.1:5178/> を開きます。
2. ヘッダーで編集対象を選び、キーを割り当てます。編集はすぐ workspace へ保存されます。
3. 反映します。Cornix LP は `実機へ Apply…`、Mac は `kanata へ適用…` を押し、差分を確かめて実行します。
4. workspace の変更を commit します。

別の端末では、workspace を `git pull` してから手順 3 で反映します。
ツールを更新するときは、リポジトリで `git pull` してから `just ui` を起動し直します。

反映を実行するまで、キーボードの設定は変わりません。
反映の直前には、元の状態が `keysync/backups/` へ自動で保存されます。

## workspace のファイル

| パス                           | 内容                   |
| ------------------------------ | ---------------------- |
| `keymap.yaml`、`keysync/`      | Cornix LP の設定       |
| `mac-keyboard.<layout>.yaml`   | Mac の設定             |
| `linux-keyboard.<layout>.yaml` | Linux の内蔵キーボード |

次の生成物は Git で管理しないため、workspace の `.gitignore` に書きます。

```gitignore
keysync/backups/
keysync/generated/
keysync/typing-logs/
```

## 目的別ガイド

| ドキュメント                                   | 内容                                 |
| ---------------------------------------------- | ------------------------------------ |
| [Web UI の使い方](./web-ui.md)                 | 割り当て、反映、元に戻す             |
| [CLI の使い方](./cli.md)                       | 検証や書き出し、Mac の常駐と戻し方   |
| [Linux（Omarchy）で使う](./linux.md)           | 内蔵キーボードを keyd で設定する     |
| [トラブルシューティング](./troubleshooting.md) | 接続できない、保存できない、効かない |
