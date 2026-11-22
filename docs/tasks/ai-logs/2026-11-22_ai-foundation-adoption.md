# AI の運用の基盤を入れる（pstack、Skill、hook）

## 依頼

Issue #26 を実装する。\
bpj の pstack、Skill、hook を KeySync へ入れ、指示の優先順位と pre-commit の対象を直す。\
PR の作成は依頼に含まれない。

## 判断

判断は ADR 0055（pstack の取り込み）と ADR 0056（AI の実行時の hook）にある。\
ADR に書いていない小さな判断は次のとおり。

- Issue は「実機安全の規則を最上位に据える」としているので、指示の優先順位で実機操作の安全性を 1 位、ユーザーの指示を 2 位に置いた。\
  「禁止する操作」はユーザーが会話で指示しても AI は行わず、`just mac apply` などは、その操作を名指しした承認があれば行う。
- pstack の上流の commit は、bpj と同じ `2f87c854` にした。\
  上流の `main` は進んでいるが、更新は `propose-update` で差分を読む別の判断とする。
- bpj の上書きのファイルの雛形にある `ui: claude` の行は、bpj の利用者が UI の担当を決めた行なので、KeySync の雛形には入れない。
- pre-commit では `.claude/skills/`、`.claude/agents/`、`.agents/`、`tools/pstack/upstream/` を除外に残し、`.claude/rules/` と `.claude/settings.json` を対象に入れた。\
  justfile の `lint-ts`、`lint-md`、`format` の除外も同じ範囲にそろえた。\
  上書きのファイルは oxfmt が先頭の空行を消すので、空行なしで書いた。
- Python の test の入口として `just test-tools` を足した。\
  CI と pre-push への組み込みは、hook の実行環境と push 前の検査を扱う Issue #27 に任せる。

## 対応

- `tools/pstack/` に bpj の `pstack.py`、`local_models.py`、`spawn_guard.py` と test を複製し、パスを `tools/` に直した。
- `manifest.json` を `propose-update` で作り、87 ファイルを `sync` で取り込んだ。\
  上書きは 11 本（`poteto-mode`、`poteto-agent`、`comment-sicko`、`no-comments`、`principle-never-block-on-the-human`、`reflect`、`recall`、`why`、`show-me-your-work`、`swarm`、`typescript-best-practices`）。
- `.claude/rules/pstack.md` と `pstack-models.md` を書いた。
- `spawn_guard.py` に、provider ごとの effort の option の名前、`devin:` の行、fork の停止を足した。
- `tools/hooks/nix_path_guard.py` を bpj から複製し、案内の文を KeySync の入口に直した。
- `.claude/settings.json` に SessionStart と PreToolUse の hook を 3 本書いた。

## 確認

- `python3 tools/pstack/pstack.py status` が `valid: true` を返す。
- `just test-tools`（49 件）が Python 3.14 と macOS 標準の Python 3.9 の両方で通る。
- `just lint`、`pnpm test`、`pnpm typecheck` が通る。
- hook の実ランタイムでの動きは ADR 0056 の「確かめたこと」にある。\
  T3 の実物の `delegate_task` と、Codex と Devin のスレッドからの spawn は確かめていない。
- 確認の `claude -p` の SessionStart が、git の共通ディレクトリに `pstack-models.local.md` の雛形を作った。\
  git 管理外で、以後のセッションも同じファイルを読む。

## 残課題

- `just test-tools` は pre-push（`verify`）と CI（typecheck.yml）の両方に組み込み済み。\
  #27・#29 との文字上の衝突（justfile の `test-tools` の位置、`.pre-commit-config.yaml` 冒頭）は rebase で解消した。
- `check-doc-links` の vendor 除外は pstack の取り込み先に合わせた。\
  `tools/pstack` のバージョンを上げるとき、upstream の文書が変わっても除外範囲を見直す必要はないが、\
  取り込み先の構成を変えた場合は除外と併せて見直す。
