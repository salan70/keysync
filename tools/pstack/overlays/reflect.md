## Project overrides (keysync)

- 承認された Skill の変更の置き先は、管理元で決まる。\
  pstack から取り込んだ Skill は `tools/pstack/overlays/` に書いて `python3 tools/pstack/pstack.py sync` を実行する。\
  dotfiles が配る Skill（`git-operations`、`collaborating-on-github`、`verifying-environment`）は dotfiles の正本を直すよう提案し、このリポジトリのコピーは直さない。\
  `docbridge` は DocBridge の `docbridge upgrade` で更新する。\
  プロジェクト固有の Skill（`grilling`）は `.claude/skills/` のファイルを直接直す。
- Skill を `~/.cursor`、`~/.claude`、`~/.codex`、プラグインのキャッシュへコピーしない。
