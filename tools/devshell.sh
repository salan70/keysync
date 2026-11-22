#!/usr/bin/env bash
# 引数のコマンドをピン留め済みの devShell（flake.nix）内で実行する。
# direnv が無い環境でも、素の `git commit` / `git push` から pre-commit の hook が
# oxlint / oxfmt / pnpm などを見つけられるようにするためのラッパー。
#
# 使い方: tools/devshell.sh <コマンド> [引数...]
set -euo pipefail

if [[ $# -eq 0 ]]; then
  echo '使い方: tools/devshell.sh <コマンド> [引数...]' >&2
  exit 2
fi

# cwd に依存しない。hook からは cwd がリポジトリのルートだが、スクリプトの位置から求める。
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)

# すでにこの flake の devShell 内（direnv 済みシェル、nix develop 内）で、
# コマンドが解決できるなら入り直さない。
# IN_NIX_SHELL は他プロジェクトの nix shell でも立つため、flake.nix の shellHook が
# 設定する KEYSYNC_DEVSHELL で判定する。
if [[ -n "${KEYSYNC_DEVSHELL:-}" ]] && command -v "$1" > /dev/null 2>&1; then
  exec "$@"
fi

if ! command -v nix > /dev/null 2>&1; then
  echo "nix が必要です: tools/devshell.sh は flake.nix の devShell でコマンドを実行します。README.md の導入手順で nix を導入してください。" >&2
  exit 127
fi

# git は hook の実行中に GIT_DIR / GIT_INDEX_FILE / GIT_WORK_TREE を設定する。
# `git commit -a` や `git commit <path>` では一時 index を指し、nix の git fetcher が
# 参照先を取り違えるため、nix に入る前に外す。
unset GIT_DIR GIT_INDEX_FILE GIT_WORK_TREE

# path: は使わない。全体を /nix/store へコピーするため git+file:// で参照する。
KEYSYNC_QUIET=1 exec nix develop --no-warn-dirty "git+file://$root" --command "$@"
