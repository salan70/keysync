# トラブルシューティング

押せないボタンは、横に理由が表示されます。\
まずその表示に従ってください。

## 起動と保存

### `KEYSYNC_WORKSPACE が未設定` と表示される

シェルの設定で `KEYSYNC_WORKSPACE` を export し、新しいターミナルで `just ui` を起動し直します。

### `just` が見つからない

direnv を使っていないシェルでは、リポジトリで `nix develop -c just ui` を実行します。

### サーバーに接続できない、またはサーバーが古いと表示される

`just ui` のターミナルで Ctrl+C を押し、`just ui` で起動し直します。

### 外部で変更されたため保存できないと表示される

Web UI の外でファイルが変わると、Web UI は上書きせず、未保存の編集は失われます。\
`ファイル` の `再読込` で読み直してから、編集し直します。

## Cornix LP

### 接続の一覧に出ない

- Chrome か Chromium で開きます。\
  Safari と Firefox は接続できません。
- ケーブルと給電を確かめて、接続し直します。
- Linux では、導入コマンドを実行し直してから Cornix LP を挿し直します。

### 接続したのに差分が 0 件のまま

`実機` の `実機から読み込む` を押します。\
接続しただけでは読み込みません。

### definition の digest が一致しない

`keymap.yaml` か `keysync/definitions/` が変わっています。\
Git で正しい commit に戻し、`ファイル` の `再読込` を押します。

## Mac

### 反映したのに効かない

1. `nix run github:salan70/keysync#install` を実行し直します。\
   kanata の常駐、許可、Karabiner の設定を確かめ、足りないものを案内します。
2. それでも効かないときは、`/var/log/keysync-kanata.log` を確かめます。

### 外付けキーボードにだけ効かない

`just mac service restart` で kanata を起動し直します。\
それでも効かないときは、[外付けキーボードに効かせる](./cli.md#外付けキーボードに効かせる) の手順を確かめます。
