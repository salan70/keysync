# pstack の Skill を固定版で取り込み、上書きをリポジトリで持つ

状態: 採用

2026-11-22 に、baseball_player_journey（以下 bpj）で整備した AI の運用の基盤を KeySync へ入れる形を決めた（Issue #26）。\
調査と計画は Issue #26 にまとめてある。

## 背景

KeySync の Skill は 5 本で、作業の進め方の索引も、委譲先のモデルを決める仕組みもなかった。\
bpj は Cursor の pstack（`cursor/plugins` の `pstack/`）を固定した commit から取り込み、プロジェクトの上書きを足して使っている。\
上流の pstack は TypeScript、React、Electron を前提に書かれており、Flutter の bpj よりも KeySync に近い。

## 選択肢

1. bpj の `tool/pstack/`（Python）を複製し、上流の `pstack/` を commit の固定と SHA256 で取り込む。上書きは KeySync 向けに作り直す
2. 1 と同じ仕組みで、取り込み元を上流の `harness/pstack/claude-code/` にする
3. Claude Code のプラグインとして入れる
4. 取り込みの道具を TypeScript で書き直す

## 決定

案 1 を採る。

- **上流の commit を固定し、SHA256 で照合する。** `tools/pstack/manifest.json` が上流の commit（bpj と同じ `2f87c854`）、取り込み先、ファイルごとの SHA256 を持つ。\
  `pstack.py status` が照合し、`sync` が異なるファイルを取り直す。
- **上流の本文は変えず、上書きをリポジトリで持つ。** 全体に効く規則は `.claude/rules/pstack.md`、特定の Skill の手順を変えるものは `tools/pstack/overlays/` に書き、`sync` が本文の末尾に足す。\
  bpj の上書きは複製せず、上流の本文を読んで KeySync 向けに書いた。
- 取り込む Skill は、入口の `poteto-mode`、`principle-*` の 24 本と、次の作業の Skill。\
  `architect`、`arena`、`benchmark-checklist`、`blast-radius`、`correct`、`figure-it-out`、`how`、`in-your-own-words`、`interrogate`、`no-comments`、`recall`、`reflect`、`sharpen`、`show-me-your-work`、`swarm`、`tdd`、`teach`、`why`、`typescript-best-practices`。\
  agent は委譲先の `poteto-agent` と、コメントを監査する `comment-sicko`。
- **取り込み先を Skill ごとのディレクトリに限る。** `sync` は取り込み先のディレクトリにある manifest 外のファイルを消す。\
  dotfiles と DocBridge も `.claude/skills/` へ Skill を置くので、取り込み先は Skill ごとのディレクトリと agent ごとのファイルにする。\
  `test_pstack.py` の `OwnershipTest` が、取り込み先がほかの管理元の Skill に重ならないことを確かめる。
- `.claude/rules/pstack-models.md` のモデルの表に、claude、codex、devin の行を置く。\
  claude と codex の行は bpj の値を使う。\
  fable は `named` という別枠に置き、ユーザーが名指ししたときだけ使う。\
  devin は `high` を持たない `mid` と `low` の行にし、ユーザーが名指ししたときだけ使う。
- 指示の優先順位では、取り込んだ Skill の本文を `AGENTS.md` の既定と上書き規則より下に置く。\
  `principle-never-block-on-the-human` には、実機への write、flash、`just mac apply`、sudo を伴う `just linux apply`、kanata のサービスの登録を対象外とする上書きを付けた。

## 理由

- **案 2 を採らない。** 取り込む 87 ファイルを比べると、72 ファイルは同じで、15 ファイルが違った。\
  13 ファイルは Claude Code の対応表を指す 1 行が足されているが、リンクの `../../docs/harness/claude-code.md` は KeySync の配置では `.claude/docs/` を指し、ファイルが無い。\
  Codex も `.agents/skills` から同じ Skill を読むので、Claude Code だけに向けた 1 行はかえって紛らわしい。\
  残り 2 ファイルは、取り込まないファイルへのリンクを GitHub の `main` に向け直しており、固定した commit からずれる。\
  ツール名の読み替えは `.claude/rules/pstack.md` が両方の環境に向けて 1 か所で行う。
- **案 3 を採らない。** プラグインは利用者の全体の設定に入り、リポジトリで版を固定できない。\
  Codex からは見えず、プロジェクトの上書きも足せない。
- **案 4 を採らない。** 道具が bpj と KeySync で二手に分かれ、両方を保守することになる。
- **`statechart` は取り込まない。** 実行に TLA+ の TLC と Java を mise で入れ、ネットワークにつなぐ必要があり、Nix で固定したツールチェーンの外に出る。\
  Apply の状態の遷移は `src/core/apply/plan.ts` の純粋な関数として test がある。
- **`typescript-best-practices` は取り込む。** KeySync の実装は TypeScript で、内容は `principle-type-system-discipline` と `principle-boundary-discipline` を TypeScript に当てたもの。\
  実行時のスキーマのライブラリが無いことと、test で実機や OS に触れないことは上書きに書いた。
- **ほかは取り込まない。** `create-verification-skill` などの検証の Skill は、KeySync の検証が `just lint`、`pnpm test`、`pnpm typecheck` で足りるため。\
  `setup-pstack` と `poteto-help` は Cursor の全体の設定とプラグインの導入を前提にするため。\
  `unslop` と `technical-writing` は、日本語の推敲をユーザーの全体環境の `yomiyasu` に任せるため。
- **fable と devin を表に置く。** 表に無いモデルは spawn の hook（ADR 0056）が止める。\
  ユーザーが名指ししたときに通すため、難しさで選ぶレベルとは分けて置いた。

## 影響

- 上流を更新するときは `propose-update` で候補の manifest を作り、差分を読んでから置き換える。
- 取り込んだ Skill を直すときは、上書きに書いて `sync` を実行する。
- `tools/pstack/` の Python は標準ライブラリだけを使い、devShell の外の `python3` で動く。\
  test は `just test-tools` で動かす。
- `.claude/rules/` は lint と format の対象に入る。\
  `.claude/skills/`、`.claude/agents/`、`.agents/`、`tools/pstack/upstream/` は vendor 資産として対象外のまま。
