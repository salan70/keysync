# AGENTS.md

このファイルは Claude Code / Codex がこのリポジトリで作業する際のガイダンスを提供します。
`CLAUDE.md` は置きません。

## プロジェクト

KeySyncは複数のキーボードのキーマップを1か所で管理し、実機とOSへ同期するツールです。
対象はCornix LPとMacのキーボード（MacBook内蔵、Magic Keyboard）です。

## クイックリファレンス

開発環境は Nix flake + direnv で固定します。初回は `direnv allow` を実行してください。

`.envrc` は Git 管理対象で、秘匿情報を含めません。マシン固有の設定や秘匿情報が必要に
なったら、`.envrc.local` を gitignore 対象として追加する方式を検討します。

コマンドは justfile が唯一の定義元です。`flake.nix` はツールチェーンの固定と、clone 前に動く
導入の入口（`nix run .#install`、`tools/install.sh`）だけを担うため、新しいコマンドは justfile に追加してください。

```bash
nix develop            # direnv 未設定の場合の devShell
just                   # コマンド一覧（just --list）
just setup             # pre-commit / pre-push フックの導入
just lint              # pre-commit を全ファイルへ適用
just format            # oxfmt
just test              # pnpm test
just docbridge-check   # コードとdocs/specs/のリンク検証
just docbridge-audit   # 未ドキュメント / 未リンクの監査
```

ツールチェーンは必ずピン留め環境経由で呼び出します（direnv 済みシェル、または `nix develop -c <cmd>`）。
システムの `node` は要件を満たさない場合があるため直接使わないでください。

## 指示の優先順位

1. **ユーザーの指示**（最優先） — 会話内での直接的な指示
2. **Skills** — Skill ツール経由で呼び出された場合
3. **このファイルのデフォルト**（最低）

## ワークフロー

すべての依頼に対し、該当する skill があれば使用します。
例外はユーザーが明示的にスキル不要と指示した場合のみです。
開発系タスクの開始時・失敗診断時は `verifying-environment` を使用します。

## スキル

以下の共通Skillは dotfiles の `infra/ai/sync-ai-assets.sh` で `.claude/skills/` へ配備されます。

| Skill                     | 用途                            |
| ------------------------- | ------------------------------- |
| `git-operations`          | ローカルGit操作とコミット規約   |
| `collaborating-on-github` | Issue、PR、レビュー操作         |
| `verifying-environment`   | Nix、PATH、キャッシュ差異の診断 |

次のSkillはこのプロジェクト固有で、正本の同期対象外です。

| Skill       | 用途                                    |
| ----------- | --------------------------------------- |
| `docbridge` | コードと`docs/specs/`の双方向リンク維持 |
| `grilling`  | 計画・設計のストレステスト              |

## 文章規範

- 結論と必要な行動を先に書き、前置き、賛辞、定型の報告枠を使わない。
- 承認依頼、失敗、未完了、破壊的操作の予告は必ず明示する。
- 静的な Markdown は 1 文 1 行で書く。同じ段落やリスト項目で次の文が続く行は、末尾に `\` を付けて GitHub の表示でも改行させる。
- Issue、PR、コメントは「。」のあとで改行する。回答は段落内で改行しない。
- 上の 2 つは利用者の指示であり、`collaborating-on-github` の改行の基準より優先する。
- 日本語と英数字やインラインコードの間には半角スペースを入れる。全角括弧の内外には入れない。

## ブランチ戦略

main ブランチへの直接コミットが可能です。feature branch は任意。

## コミット方針

**ユーザーの指示を待たずに、作業単位ごとに commit します。** 完了報告のたびに commit の
可否を確認する必要はありません。手順は `git-operations` スキルに従います。

粒度は**判断 1 つ = commit 1 つ**です。ADR・`docs/specs/`・実装・test・fixture・作業ログを
1 つの commit にまとめ、判断とその根拠が 1 か所で追えるようにします。Spike が判断の
根拠になっている場合は同じ commit へ含めます。既存の history がこの粒度で並んでいます。

commit しないもの:

- test・typecheck・lint のいずれかが通らない状態
- 依頼スコープ外の変更（別 commit に分けるのではなく、そもそも行わない）

`push` と pull request の作成は依頼された場合のみ行います。

pre-commit フックはピン留めした toolchain を要求するため、**`nix develop -c git commit`**
（または direnv 済みシェル）で実行します。素の `git commit` は oxfmt が見つからず失敗します。

## 許可する操作

- プロジェクトのソースコード・ドキュメントを編集する
- workspace fixtureやexampleがある場合に`keymap.yaml`を編集する
- validation、analysis、diff、render、exportを実行する
- test・fixtureを作成、更新する
- 作業単位ごとにcommitする（「コミット方針」を参照）
- 依頼された場合にpull requestを作成する

## 禁止する操作

- 物理キーボードへ設定を直接writeする
- firmwareをflashする
- bootloader / UF2状態へ移行・操作する
- reset、clear-peerなど破壊的な実機操作を行う

## 設計ルール

- Semantic CoreをReact、filesystem、WebHIDの詳細から独立させる
- Vial / WebHIDを外部adapterとして扱う
- 調査ではFact / Inference / Decision / Open Questionを区別する
- 不確実な外部挙動は、設計を固定する前に調査または最小Spikeで検証する
- 重要な設計判断は`docs/decisions/`へADRとして残す
- README、Issue、ADR、その他ドキュメント間で詳細情報を重複させない
- プロジェクト内の文章・ドキュメント・Issueは日本語を基本とする。コード識別子、CLIコマンド、プロトコル名などは必要に応じて英語表記を維持する

## 実機操作の安全性

実機writeには人間の明示操作を必要とします。想定するApplyフローは以下です。

```text
現在状態をread
→ backup
→ strict validation
→ semantic diff
→ 人間が確認
→ 差分write
→ 再readしてverify
```

## ドキュメントの責務

| 置き場所          | 責務                                                               |
| ----------------- | ------------------------------------------------------------------ |
| Notion            | 現在の仕様・方針・調査進捗                                         |
| GitHub Issue      | 実行する調査・実装作業                                             |
| `docs/decisions/` | 確定した重要判断とその理由（ADR）                                  |
| `docs/specs/`     | コードと1:1で対応する実装仕様。DocBridgeでコードと双方向リンクする |
| Tests / fixtures  | 実際に成立することの検証                                           |

同じ情報を複数箇所へ詳細に複製しないでください。

`docs/specs/` のセクションとコードの対応は DocBridge が機械検証します。コードに `@doc`、
Markdown に `@code` のアンカーを張り、`docbridge` スキルで維持します。

検証は自動で走ります。`docbridge check`（リンク切れ）は pre-commit と CI でブロックし、
`related-gate`（リンク先の未更新）は pre-push と CI で報告のみ行います。
DocBridge のバージョンは `.docbridge-version` が単一の定義元で、flake・CI・フックが
すべてこれを参照します。

## 対話原則

- 共感は一切不要。正しさと合理性を重視すること。
- お世辞・同意の前置き・感情的な共感表現を避け、結論と根拠を直接示す。
- ユーザーの主張に誤りや論理的破綻があれば、忖度せず率直に指摘する。
- 不確実な事項は推測で断定せず、確認手段または根拠を提示する。

## AI作業上の禁止事項

- Skills で定義済みの手順をこのファイルに複製することを禁止する。スキルの内容を転記せず、スキル名で参照すること。
- 依頼スコープ外の「ついでに改善」を禁止する。
- 将来の仮想要件に備えたコードを禁止する。

## 作業ログ規約

作業ログは`docs/tasks/ai-logs/YYYY-MM-DD_{slug}.md`に保存します。
