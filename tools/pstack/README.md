# pstack の取り込み

上流の [cursor/plugins](https://github.com/cursor/plugins) の `pstack/` を、固定した commit から Skill として取り込む。\
取り込む理由と範囲は ADR 0055、AI の実行時の hook は ADR 0056 にある。\
振る舞いの規則は `.claude/rules/pstack.md`、モデルの表は `.claude/rules/pstack-models.md` が受け持つ。

## 置き場所

| 置き場所                                    | 内容                                                                |
| ------------------------------------------- | ------------------------------------------------------------------- |
| `tools/pstack/manifest.json`                | 上流の commit、取り込み先、上書き、ファイルごとの SHA256            |
| `tools/pstack/overlays/`                    | Skill の末尾に足すプロジェクトの上書き（「Project overrides」の節） |
| `tools/pstack/upstream/`                    | 上流の LICENSE、README、導入ガイド、Claude Code の対応表            |
| `.claude/skills/<name>/`、`.claude/agents/` | 取り込んだ Skill と agent。本文は直接直さない                       |

`.claude/skills/` には、ほかの管理元の Skill も並ぶ。\
`sync` は取り込み先のディレクトリにある manifest 外のファイルを消すので、取り込み先は Skill ごとのディレクトリに限る。\
`test_pstack.py` の `OwnershipTest` がこれを確かめる。

| 管理元                                   | Skill                                                                |
| ---------------------------------------- | -------------------------------------------------------------------- |
| dotfiles の `infra/ai/sync-ai-assets.sh` | `git-operations`、`collaborating-on-github`、`verifying-environment` |
| DocBridge の `docbridge upgrade`         | `docbridge`                                                          |
| このリポジトリ                           | `grilling`                                                           |
| pstack（このディレクトリ）               | manifest の `install` にあるもの                                     |

## 照合と更新

リポジトリのルートで実行する。\
Python は標準ライブラリだけを使い、devShell の外の `python3` で動く。

```sh
python3 tools/pstack/pstack.py status   # 取り込んだファイルを上流の SHA256 と照合する
python3 tools/pstack/pstack.py sync     # 異なるファイルを取り直し、manifest 外のファイルを消す
just test-tools                         # pstack と AI の hook の test
```

上書きを直したら `sync` を実行して、取り込み先に反映する。\
上流を更新するときは、候補の commit を決めてから候補の manifest を作り、差分を読んでから置き換える。

```sh
python3 tools/pstack/pstack.py propose-update --pin <40 桁の commit> --output <scratchpad>/manifest.json
git diff --no-index tools/pstack/manifest.json <scratchpad>/manifest.json
```

取り込む Skill を増やすときは、manifest の `install` に上流のディレクトリと取り込み先を足し、`propose-update` で `files` を作り直す。

## モデルの上書き

git 管理外の上書きは 2 枚ある。\
リポジトリの上書きは git の共通ディレクトリの `pstack-models.local.md` に置き、すべての worktree が共有する。\
マシン共通の上書きは `~/.config/pstack/pstack-models.md` に置く任意の preference で、このマシンのすべてのリポジトリに効き、同じ名前の行はリポジトリの上書きが勝つ。

```sh
python3 tools/pstack/pstack.py models show               # 両方の中身を表示する（リポジトリのほうが無ければ雛形から作る）
python3 tools/pstack/pstack.py models set provider codex # リポジトリの上書きの 1 行を書き換える
python3 tools/pstack/pstack.py models set --global mid devin:swe-2-high max # マシン共通の上書きの 1 行を書き換える
python3 tools/pstack/pstack.py models path --global      # マシン共通の場所を表示する（ファイルは作らない）
```
