# KeySync のコマンド定義。
# ツールチェーンは flake.nix が固定し、コマンドはこのファイルが唯一の定義元。
# direnv 済みシェル、または `nix develop -c just <recipe>` で実行する。

# 引数なしで一覧を表示する
default:
    @just --list

# pre-commit / pre-push フックを導入する（初回のみ）
setup:
    pre-commit install --hook-type pre-commit --hook-type pre-push --hook-type commit-msg

# ツールチェーンのバージョンを表示する
versions:
    @node --version
    @pnpm --version
    @echo "docbridge: $(tr -d '[:space:]' < .docbridge-version)"

# すべての検証を実行する（pre-commit 全体）
lint:
    pre-commit run --all-files

# TypeScript / JavaScript を lint する
lint-ts:
    oxlint --ignore-pattern '.direnv/**' --ignore-pattern '.claude/skills/**' --ignore-pattern '.claude/agents/**' --ignore-pattern '.agents/**' --ignore-pattern 'tools/pstack/upstream/**' .

# .direnv（flake inputs）と vendor 資産（.claude/skills、.claude/agents、.agents、tools/pstack/upstream）は対象外。
# pre-commit 側の exclude と範囲を揃えている。
[doc('Markdown を lint する')]
lint-md:
    markdownlint-cli2 "**/*.md" "!.direnv/**" "!node_modules/**" "!.claude/skills/**" "!.claude/agents/**" "!.agents/**" "!tools/pstack/upstream/**"

# 日常の起動はこれだけ。GitHub Pages では配布しない（ADR 0033）。
[doc('Web UI をビルドしてローカルサーバーで開く（http://127.0.0.1:5178/）')]
ui:
    pnpm build
    pnpm exec tsx src/server/main.ts

# ローカル開発サーバーを起動する
dev:
    pnpm dev

# production buildを作成する
build:
    pnpm build

# CLIを実行する
[positional-arguments]
keysync *ARGS:
    pnpm run keysync -- "$@"

# workspaceは$KEYSYNC_WORKSPACE。設定していれば --workspace も --layout も要らない。
[doc('MacBook内蔵キーボードの設定を扱う（例: just mac apply）')]
[positional-arguments]
mac *ARGS:
    pnpm run keysync -- mac "$@"

# 適用は keyd へ行い、書き込みと reload で sudo のパスワードを求める（ADR 0042）。
[doc('Linux で使う Apple 製キーボードの設定を扱う（例: just linux apply）')]
[positional-arguments]
linux *ARGS:
    pnpm run keysync -- linux "$@"

# .claude/skills、.claude/agents、.agents、tools/pstack/upstream は正本からコピーした vendor 資産のため整形しない。
# 整形すると正本との差分が生まれ、再同期のたびに衝突する。
[doc('コードを整形する')]
format:
    oxfmt --write . '!.claude/skills/**' '!.claude/agents/**' '!.agents/**' '!tools/pstack/upstream/**'

# 型を検査する
typecheck:
    pnpm typecheck

# テストを実行する
test:
    pnpm test

# UI の構造 snapshot（src/ui/components/__snapshots__）を更新する。差分をレビューしてから commit する
test-update-snapshots:
    node --test --test-update-snapshots "src/**/*.test.ts"

# I-027 Spike の計測。SPIKE_PW_DIR と PLAYWRIGHT_BROWSERS_PATH が要る（spikes/i-027-visual-regression/README.md）
[positional-arguments]
spike-visual-regression *ARGS:
    node spikes/i-027-visual-regression/measure.mjs "$@"

# tools/ の Python（pstack）のテストを実行する。devShell の外の python3 で動く
test-tools:
    python3 -m unittest discover -s tools -p 'test_*.py'

# 任意の docbridge サブコマンドを実行する（例: just docbridge graph）
docbridge *ARGS:
    ./tools/docbridge.sh {{ARGS}}

# コードと docs/specs/ のリンク切れを検証する
docbridge-check:
    ./tools/docbridge.sh check

# 未ドキュメントのsymbol・未リンクのsectionを監査する
docbridge-audit:
    ./tools/docbridge.sh check --audit

# push 対象の変更セットに対して related-gate を実行する
docbridge-related:
    ./tools/docbridge-related.sh

# Markdown 同士の相対リンクと #anchor の実在を検査する
check-doc-links:
    pnpm exec tsx tools/check-doc-links.ts

# 型検査とテストを全量で実行する（pre-push と同じ）
verify: typecheck test
