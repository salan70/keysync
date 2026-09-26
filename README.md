# KeySync

複数のキーボードのキーマップを 1 か所で管理し、実機と OS へ同期するローカルファーストなツールです。
対象は Cornix LP と Mac のキーボード（MacBook 内蔵、Magic Keyboard）です。
ブラウザ、CLI、Git、AI から設定の読み取り、編集、検証、可視化、版管理を行えます。

## 今すぐ使う（Web UI）

Web UI は clone したリポジトリから `just ui` で起動し、<http://127.0.0.1:5178/> で開きます。

- **動作環境**: macOS 上の Chrome または Chromium。Linux（Omarchy）は [利用者ガイド](./docs/user-guide/linux.md) を参照。
- **非対応環境**: Safari と Firefox は WebHID に非対応のため実機接続不可。
- **クイックスタート**: [利用者ガイドの導入手順](./docs/user-guide/README.md#クイックスタート) を参照。

実機の読み取り（read）は設定を変更しません。
実機が変更されるのは、人間が差分を確認して明示的に Apply を実行したときだけです。

## 利用者向けドキュメント

| ドキュメント                                                   | 内容                                                   |
| -------------------------------------------------------------- | ------------------------------------------------------ |
| [利用者ガイド](./docs/user-guide/README.md)                    | 全体概要、対応環境、クイックスタート                   |
| [Web UI の使い方](./docs/user-guide/web-ui.md)                 | 画面構成、各タブの操作、VIL 入出力                     |
| [CLI の使い方](./docs/user-guide/cli.md)                       | 検証、到達性解析、差分確認、Mac 内蔵キーボード管理     |
| [Safe Apply と復旧](./docs/user-guide/safe-apply.md)           | 実機書き込み手順、エラーと警告の基準、バックアップ復元 |
| [workspace と用語](./docs/user-guide/workspace-and-terms.md)   | ファイル配置、Git 管理対象、重要用語の一覧             |
| [トラブルシューティング](./docs/user-guide/troubleshooting.md) | 接続失敗、保存不可、権限エラーなどの対処手順           |

## 開発環境と運用コマンド

依存関係とツールチェーンは Nix flake で固定しています。
コマンドは `just` を唯一の定義元とします。

### 初回セットアップと起動

```bash
git clone https://github.com/salan70/keysync.git
cd keysync
direnv allow     # direnv 未設定の場合は nix develop
just setup       # pre-commit / pre-push フックの導入
just ui          # Web UI をビルドして起動（http://127.0.0.1:5178/）
```

### 日常の検証・運用コマンド

| コマンド               | 用途                                       |
| ---------------------- | ------------------------------------------ |
| `just test`            | 単体テストの実行（Vitest）                 |
| `just typecheck`       | TypeScript の型検査                        |
| `just lint`            | pre-commit による全ファイル検査            |
| `just lint-md`         | Markdown の構文・スタイル検査              |
| `just format`          | oxfmt によるコード整形                     |
| `just docbridge-check` | コードと仕様書（docs/specs/）のリンク検証  |
| `just mac`             | MacBook 内蔵キーボードの設定を適用         |
| `just linux`           | Linux の内蔵キーボードの設定を keyd へ適用 |
| `just ui`              | Web UI のビルドと起動                      |
| `just dev`             | 開発サーバーの起動（UI 開発用）            |

## 設計・運用方針

- Cornix LP を最初の対象とします。
- Vial 表現から独立した Semantic Model を持ちます。
- Git 管理する目標設定（desired state）として `keymap.yaml` を使います。
- Web UI と CLI で同一の Core を共有します。
- 実機書き込みはバックアップと検証を伴い、人間の明示操作に限定します。
- AI は設定編集や検証を行えますが、実機へ直接書き込む権限を持ちません。

## 開発者・運用者向けドキュメント

重要な設計判断は [docs/decisions/](./docs/decisions/README.md)（ADR）に記録します。
コードと 1:1 で対応する実装仕様は [docs/specs/](./docs/specs/README.md) に置きます。
運用の責務分担は [ドキュメントの責務](./docs/README.md) を参照してください。
