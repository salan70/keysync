# KeySync

複数のキーボードのキーマップを 1 か所で管理し、実機と OS へ同期するローカルファーストなツールです。
対象は Cornix LP と Mac のキーボード（MacBook 内蔵、Magic Keyboard）です。
ブラウザ、CLI、Git、AI から設定の読み取り、編集、検証、可視化、版管理を行えます。

実機の読み取り（read）は設定を変更しません。
実機が変更されるのは、人間が差分を確認して明示的に Apply を実行したときだけです。

## 使い始める

```bash
nix run github:salan70/keysync#install   # 導入（Mac / Omarchy）
just ui                                  # clone したリポジトリで Web UI を起動
```

手順は [利用者ガイド](./docs/user-guide/README.md) を参照してください。

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
