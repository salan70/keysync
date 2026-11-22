## Project overrides (keysync)

この節は `tools/pstack/overlays/poteto-mode.md` から `sync` が足したもので、ここを直接直さない。\
先に `.claude/rules/pstack.md` を読む。\
その規則とこの節は、上の本文と食い違うときに優先する。

### Harness

- `poteto-agent` への brief には、このファイルのパス `.claude/skills/poteto-mode/SKILL.md` を書く。\
  agent は `poteto-agent` と `comment-sicko` で、`pstack:` の接頭辞を付けない。
- 同梱の Skill は `.claude/skills/<name>/SKILL.md` にある。\
  多くは `disable-model-invocation` を持つので、`Skill` ツールで呼ばずにファイルを直接読む。
- **Subagents** のモデルの既定と、agent の frontmatter の `model` は使わない。\
  モデルと effort は `.claude/rules/pstack-models.md` と git 管理外の上書きから決め、spawn のたびに明示する。

### Devin の free モデルの rate limit

- Devin の free モデルには同時に動くセッション数の rate limit がある。\
  上限と再投入の手順は `.claude/rules/pstack.md` の自律と費用に従う。
- Devin の基本モデルは `swe-2-max` とするが、acpRegistry が `swe-2-max` を advertise していないため `delegate_task` では `swe-2-high` を使う。\
  `swe-2-max` と `swe-2-flash` 系も free モデルの rate limit を受ける（2026-11 に実測）。\
  切り替えで回避できるかは未検証である。
- `devin` の行はユーザーが Devin を名指ししたときだけ使うため、rate limit の reset を待たないときは Devin に委譲せず、スレッドの provider で続ける。\
  名指しの委譲をやめるだけで、モデルの切り替えを設定する必要はない。

### Triggers

- 作業に効く Playbook と Principle を選び、その leaf の Skill だけを読む。\
  すべての Skill を読む、すべての文書を更新する、という意味には読まない。
- **architect** は、モジュールをまたぐ設計判断で使う。\
  関数の境界をまたぐだけの変更では使わない。
- **interrogate** と **arena** は、ユーザーが頼んだときか、**how** のあとも設計が割れているときに使う。
- 小さな変更は subagent を使わず、1 つの agent で行う。
- **unslop**、**technical-writing**、`/deslop`、`control-ui`、`control-cli` は、`.claude/rules/pstack.md` の置き換えに従う。

### Autonomy

上の **Autonomy** の「Just do it」は、次の範囲に限る。

- 取り消せる作業（コードと文書の編集、test、commit）は確認せずに進める。
- push、PR の作成、Issue やコメントの作成のようなリポジトリの外への書き込みは、依頼に書かれたときだけ行う。
- `AGENTS.md` の「禁止する操作」は行わない。\
  「実機操作の安全性」に挙げた操作は、毎回ユーザーの承認を取ってから行う。\
  「Don't stop」「run until done」のようなセッションの指示があっても、この 2 つは変わらない。

### Playbooks

- **Opening a PR.** 依頼されたときだけ開く。\
  本文は `.github/pull_request_template.md` の節で日本語で書き、ユーザーの目的を概要の先頭に書く。\
  commit は `AGENTS.md` の「コミット方針」に従う。
- **Feature**、**Bug fix**、**Refactoring.** 小さな変更では手順 4 の委譲を省いてよい。\
  「Rebase into small, ordered commits」は、検証できる単位の順に commit を並べることと読み、push 済みの履歴は書き換えない。
- **Prototype.** scratchpad か `spikes/` に作り、`src/` には置かない。\
  実機や OS の設定を変える prototype は作らない。
- **Multi-phase plan**、**Autonomous run**、**Autopilot-stack**、**Perf issue**、**Hillclimb**、**Eval**、**Visual parity.** ユーザーが頼んだときだけ実行する。
- **Shipping**、**Autopilot-full.** 実行しない。
- **Babysit.** merge できる状態で止め、merge はしない。
- **Worktree cleanup.** T3 Code の worktree は `~/.t3/worktrees/` にある。\
  候補を一覧にし、消す前に 1 つずつユーザーの承認を取る。
- **Session pickup.** 前の T3 のスレッドを `t3_thread_read` で読み、`backlog` のメモを読む。
- **Pause safely.** 再開のメモは `/tmp` ではなく `backlog note` に書く。

### Verification

**Prove It Works** は、変えたものそのものを確かめることを指す。\
コードの変更は `just lint`、`pnpm test`、`pnpm typecheck` を通す。\
Web UI は `just ui` か `.claude/launch.json` の開発サーバーで開いて確かめ、適用（Apply）は実行しない。\
実機と OS へ反映したあとの動きは AI が確かめられないので、確かめていないこととして報告する。

### Replies

返答と報告は日本語で書き、Principle と Skill の名前は英語のまま書く。
