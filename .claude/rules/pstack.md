# このリポジトリの pstack

複数の手順がある作業では、`.claude/skills/poteto-mode/SKILL.md` を末尾の「Project overrides」まで読み、使う Playbook と Principle を選ぶ。\
読む Skill は作業に要るものだけにする。\
文脈から答えられる質問、1 行で決まる編集、ユーザーが不要と言ったときは読まない。

`.claude/skills/` にある pstack の Skill は、Cursor のプラグインから本文を変えずに取り込んだもの（一覧は `tools/pstack/manifest.json`）。\
この規則は、poteto-mode を通さずに Skill を直接使うときも含めて、Skill の本文より優先する。\
`AGENTS.md` の「指示の優先順位」に従い、実機操作の安全性、ユーザーの指示、`AGENTS.md` の既定は、この規則より優先する。

## パスとツールの読み替え

- `.cursor/skills/`、`~/.cursor/skills/`、`pstack/skills/` は `.claude/skills/` を指す。\
  `pstack/docs/` は `tools/pstack/upstream/docs/` を指す。\
  Claude Code でのツール名は `tools/pstack/upstream/docs/harness/claude-code.md` で読み替える。
- モデルは `.claude/rules/pstack-models.md` と git 管理外の上書きから決める。\
  `~/.cursor/rules/pstack-models.mdc` と Skill に書かれた slug は使わない。
- cloud agent は使わない。\
  worker はすべて手元で動かし、`environment: "cloud"` と `cloud_base_branch` は無視し、分離が要る worker には別の worktree を渡す。
- 会話の履歴は、`~/.claude/projects/<slug>/` の Claude Code のセッションファイルと、T3 Code のスレッド（`t3_thread_read` で読む）。\
  このプロジェクトの履歴だけを読む。
- 一時的な出力は `/tmp` ではなく、セッションの scratchpad に置く。

## 使えないものと代わり

次は使えない。\
要る手順は、飛ばしたことを 1 行で書くか、表の代わりを使う。

- Bugbot、Cursor Automations、Origin、Graphite
- `poteto-mode/scripts/`（`watch-pr`、`worktree-audit.sh`）
- 取り込んでいない Skill: `unslop`、`technical-writing`、`setup-pstack`、`poteto-help`、`create-skill`、`deslop`、`control-ui`、`control-cli`、`ketchup`、`automate-me`、`statechart`、`make-bot-ui`
- Linear、Slack、Datadog、Sentry、Databricks のコネクタ

| 上流                                          | 代わり                                                                                                   |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `unslop`、`technical-writing`                 | `AGENTS.md` の「文章規範」と、ユーザーの全体環境の `yomiyasu`                                            |
| `deslop`                                      | 自分の diff を `principle-laziness-protocol` で見直す                                                    |
| `control-ui`、`control-cli`、`verify-<app>`   | `just lint`、`pnpm test`、`pnpm typecheck`。Web UI は `just ui` か開発サーバーを T3 の preview で開く    |
| `create-skill`                                | `poteto-mode/playbooks/authoring-a-skill.md` に従い、プロジェクトの Skill を直接直す                     |
| `setup-pstack`                                | 日々の切り替えは `python3 tools/pstack/pstack.py models set`。既定の表は `pstack-models.md` を PR で直す |
| `watch-pr`、`check-plan`、`worktree-audit.sh` | `gh` と T3 の PR のツール、または手で確かめる                                                            |
| チームの tracker                              | GitHub Issue（`gh`）。ユーザーが頼んだときだけ使う                                                       |

## スタック

TypeScript と React の Web UI、Node.js の CLI とローカルサーバーで、Vite でビルドする。\
上流の TypeScript と React の例はそのまま当てはめ、Electron の例はローカルサーバーと CLI に読み替える。\
コマンドは justfile が定義し、ツールチェーンは direnv か `nix develop -c` で呼ぶ。\
文書とコメントは日本語で書く。

test は実機、WebHID、launchd、keyd、sudo に触れず、偽物を注入する。\
上流の「Don't mock what you can run」より、こちらを優先する。

## Git と PR

- commit の粒度と手順は、`AGENTS.md` の「コミット方針」と `git-operations` に従う。
- push と PR の作成は、依頼に書かれたときだけ行う。
- push 済みの branch を rebase せず、force-push もしない。\
  自分が作っていない作業のある branch で `git reset --hard` しない。
- merge、auto-merge、squash はしない。

## 自律と費用

- 取り消せる作業は確認せずに進める。\
  `AGENTS.md` の「禁止する操作」は行わず、「実機操作の安全性」に挙げた操作は毎回ユーザーの承認を取る。\
  merge、release、リポジトリの外への書き込み（Issue、PR、コメント）も、依頼に書かれていなければ承認を取る。\
  この項は `principle-never-block-on-the-human` と poteto-mode の **Autonomy** より優先する。
- 製品の仕様と見た目は、ユーザーが決める。\
  推奨を先頭にした選択肢で聞く。
- `~/.cursor`、`~/.claude`、`~/.codex` の全体の設定を書かず、プラグインを入れない。
- pstack の Skill を直すときは本文を変えず、`tools/pstack/overlays/` に書いて `python3 tools/pstack/pstack.py sync` を実行する。\
  直す前にユーザーの承認を取る。
- 必須のファンアウト、パネル、別のモデルによるレビューは、役に立つ最小の数で動かす。\
  リスクが見合わなければ subagent は 1 つにする。\
  別の provider のレビューは、上書きが `cross-provider: on` のときか、ユーザーが頼んだときだけ行う。
- ユーザーが頼まなければ、繰り返し動く loop を仕掛けない。
- 引き継ぎと中断のメモは `backlog` に残す。

## 委譲

- spawn では、`pstack-models.md` と上書きから決めた provider、model、effort を必ず書く。\
  native の subagent と T3 の `delegate_task` は、省くと親のモデルを継ぐ。
- Claude Code の fork は親の model を継ぐので使わない。
- 続き、修正、次の段は、範囲をまとめ直して新しい委譲先に渡す。\
  終わった委譲先のスレッドに「続けて」と足さない。
- 実装役は、調査、変更、その検証までの 1 単位を受け持つ。\
  位置の調査と出力の長い検証は `low` の subagent（`Explore`、`Verify`）に任せてよい。\
  入れ子は `low` の 1 段までにする。
