# KeySync

複数のキーボードのキーマップを 1 か所で管理し、実機と OS へ同期するローカルファーストなツールです。
対象は Cornix LP と Mac のキーボード（MacBook 内蔵、Magic Keyboard）です。
ブラウザ、CLI、Git、AI から設定の読み取り、編集、検証、可視化、版管理を行えます。

実機の読み取り（read）は設定を変更しません。
実機が変更されるのは、人間が差分を確認して明示的に Apply を実行したときだけです。

## 使い始める

Nix が必要です。
設定は keysync リポジトリの外のディレクトリ（workspace）に置き、`KEYSYNC_WORKSPACE` で指定します。

```bash
export KEYSYNC_WORKSPACE="$HOME/dotfiles/config/keysync"   # 普段はシェルの設定に書く
nix run github:salan70/keysync#install   # clone から OS ごとの準備まで行う
cd ~/Projects/Tools/keysync
just ui          # Web UI をビルドして起動（http://127.0.0.1:5178/）
```

- **導入**: `install` は Mac と Omarchy に対応し、何度実行しても構いません。clone 先は `KEYSYNC_REPO` で変えられます。OS ごとに行う内容は [Mac の初回の準備](./docs/user-guide/cli.md#初回の準備) と [Linux（Omarchy）で使う](./docs/user-guide/linux.md#準備) を参照。
- **起動**: direnv を使わない場合は `nix develop -c just ui` で起動する。
- **動作環境**: macOS 上の Chrome または Chromium。Linux（Omarchy）は [Linux（Omarchy）で使う](./docs/user-guide/linux.md) を参照。
- **非対応環境**: Safari と Firefox は WebHID に非対応のため実機接続不可。
- **更新**: `git pull` のあと `just ui` を起動し直す。

編集から Apply までの手順は [利用者ガイドのクイックスタート](./docs/user-guide/README.md#クイックスタート) を参照してください。

## 利用者向けドキュメント

| ドキュメント                                                   | 内容                                                   |
| -------------------------------------------------------------- | ------------------------------------------------------ |
| [利用者ガイド](./docs/user-guide/README.md)                    | 全体概要、対応環境、クイックスタート                   |
| [Web UI の使い方](./docs/user-guide/web-ui.md)                 | 画面構成、各タブの操作、VIL 入出力                     |
| [CLI の使い方](./docs/user-guide/cli.md)                       | 検証、到達性解析、差分確認、Mac 内蔵キーボード管理     |
| [Linux（Omarchy）で使う](./docs/user-guide/linux.md)           | udev rule、keyd による内蔵キーボードの設定と適用       |
| [Safe Apply と復旧](./docs/user-guide/safe-apply.md)           | 実機書き込み手順、エラーと警告の基準、バックアップ復元 |
| [workspace と用語](./docs/user-guide/workspace-and-terms.md)   | ファイル配置、Git 管理対象、重要用語の一覧             |
| [トラブルシューティング](./docs/user-guide/troubleshooting.md) | 接続失敗、保存不可、権限エラーなどの対処手順           |

## 開発

依存関係とツールチェーンは Nix flake で固定しています。
コマンドは justfile が唯一の定義元で、`just` で一覧を表示できます。
pre-commit / pre-push フック（`just setup`）は導入スクリプトが入れます。

| コマンド               | 用途                                                 |
| ---------------------- | ---------------------------------------------------- |
| `just ui`              | Web UI のビルドと起動                                |
| `just dev`             | 開発サーバーの起動（UI 開発用）                      |
| `just test`            | 単体テストの実行（Vitest）                           |
| `just typecheck`       | TypeScript の型検査                                  |
| `just lint`            | pre-commit による全ファイル検査                      |
| `just format`          | oxfmt によるコード整形                               |
| `just docbridge-check` | コードと仕様書（docs/specs/）のリンク検証            |
| `just mac …`           | Mac のキーボードの設定を扱う（例: `just mac apply`） |
| `just linux …`         | Linux の内蔵キーボードの設定を扱う（keyd へ適用）    |

## 設計方針

- Vial 表現から独立した Semantic Model を持ちます。
- Git 管理する目標設定（desired state）として `keymap.yaml` を使います。
- Web UI と CLI で同一の Core を共有します。
- 実機書き込みはバックアップと検証を伴い、人間の明示操作に限定します。
- AI は設定編集や検証を行えますが、実機へ直接書き込む権限を持ちません。

重要な設計判断は [docs/decisions/](./docs/decisions/README.md)（ADR）に記録します。
コードと 1:1 で対応する実装仕様は [docs/specs/](./docs/specs/README.md) に置きます。
ドキュメントの責務分担は [docs/README.md](./docs/README.md) を参照してください。
