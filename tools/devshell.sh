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

# すでに devShell 内（direnv 済みシェル、nix develop 内）で、コマンドが解決できるなら入り直さない。
if [[ -n "${IN_NIX_SHELL:-}" ]] && command -v "$1" > /dev/null 2>&1; then
  exec "$@"
fi

# path: は使わない。全体を /nix/store へコピーするため git+file:// で参照する。
KEYSYNC_QUIET=1 exec nix develop --no-warn-dirty "git+file://$root" --command "$@"
