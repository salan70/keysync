# AI の実行時の hook で、モデル未指定の spawn と nix の path: を止める

状態: 採用

2026-11-22 に、AI の実行時の hook を使わない方針を改めた（Issue #26）。\
従来の方針は `.pre-commit-config.yaml` の冒頭の「機械的強制は pre-commit と CI が担う（AI hooks は使わない）」だった。

## 背景

pre-commit と CI が見るのはファイルの差分だけである。\
次の 2 つは AI のツール呼び出しの時点で起き、ファイルに差分を残さない。

- **spawn のモデルの継承。** native の subagent と T3 の `delegate_task` は、model と effort を省くと親のモデルを継ぐ。\
  bpj では Opus の入力の 54% が、文脈が 20 万 token を超えた呼び出しで消費されていた。\
  委譲の規則は ADR 0055 のモデルの表で決めたが、文章だけでは省いた spawn を止められない。
- **nix の `path:` 参照。** `path:` は gitignore 対象の `node_modules` を含む worktree 全体を `/nix/store` へコピーし、内容が変わるたびにコピーが増える。

## 選択肢

1. Claude Code の hook（`.claude/settings.json` の SessionStart と PreToolUse）を使う
2. 規則の文章だけで守る
3. 1 に加えて、Codex にも `.codex/hooks.json` を置く

## 決定

案 1 を採る。\
リポジトリの内容の機械的強制は、従来どおり pre-commit と CI が担う。\
AI の実行時の hook は、ファイルの差分に現れないツール呼び出しを止めることと、文脈を足すことに限って使う。

| hook         | 対象                                   | 動き                                                               |
| ------------ | -------------------------------------- | ------------------------------------------------------------------ |
| SessionStart | セッションの開始                       | `pstack.py models show` で、git 管理外のモデルの上書きを文脈に足す |
| PreToolUse   | `Agent`、`mcp__t3-code__delegate_task` | `tools/pstack/spawn_guard.py` が model と effort を表と照合する    |
| PreToolUse   | `Bash`                                 | `tools/hooks/nix_path_guard.py` が nix の `path:` 参照を止める     |

- hook は Python の標準ライブラリで書き、`just test-tools` の test を持つ。\
  内部の失敗では止めずに通す（fail open）。
- `spawn_guard.py` には、bpj のものに次の 3 点を足した。\
  T3 の effort の option の名前は provider ごとに違う（Claude は `effort`、Codex は `reasoningEffort`、Devin は `thought_level`）ので、3 つとも読む。\
  表の `devin:` の行を読む。\
  Claude Code の fork は親の model と effort を継ぎ、指定しても無視されるので止める。
- Codex には hook を置かない。

## 理由

- **案 2 では止まらない。** 規則の文章は spawn の前に読み返されるとは限らず、省いた spawn には実行されてから気づくことになる。
- **案 3 を採らない。** Codex 0.166.0 は `hooks` の機能を持ち、プロジェクトの `.codex/hooks.json` を読む。\
  一方で、hook ごとの信頼の記録を `~/.codex/config.toml` の `hooks.state."<絶対パス>:pre_tool_use:0:0"` に持つ。\
  T3 Code は作業ごとに別のパスの worktree を作るので、worktree のたびに承認が要り、全体の設定はリポジトリから書かない。\
  Codex の PreToolUse が `spawn_agent` と MCP の `delegate_task` で動くかも確かめていない。
- **bpj の `spawn_guard.py` のままでは、Codex への委譲を止めてしまう。** bpj のものは option の `effort` だけを読む。\
  T3 の `orchestrator_capabilities` では Codex の option は `reasoningEffort` なので、effort を正しく渡した Codex への委譲も「effort が未指定」で止まる。
- **ツール名は Claude Code での表記に合わせる。** Claude Code の T3 のツール名は `mcp__t3-code__delegate_task` で、計画のレビューで Codex のセッションが報告した `mcp__t3_code__delegate_task` とは違う。\
  Claude Code の hook が受け取るのは前者である。

## 確かめたこと

2026-11-22 に Claude Code 2.1.330 を `claude -p`（haiku）でこの worktree に起動し、hook の動きを確かめた。\
T3 の `delegate_task` は、同じ名前の MCP サーバー（呼ばれた引数を記録するだけのもの）で置き換えた。

| 呼び出し                                                        | 結果                                         |
| --------------------------------------------------------------- | -------------------------------------------- |
| `Agent`（model と effort なし）                                 | 止まった（model が未指定）                   |
| `Agent`（`haiku`、`low`）                                       | 通り、subagent が動いた                      |
| `Agent`（`subagent_type: fork`、`haiku`、`low`）                | 止まった（fork）                             |
| `delegate_task`（Codex の `gpt-6.1-terra`、option なし）        | 止まり、MCP サーバーに呼び出しが届かなかった |
| `delegate_task`（同じ model、`reasoningEffort: medium`）        | 通った                                       |
| `delegate_task`（Devin の `swe-2-high`、`thought_level: high`） | 通った                                       |
| `Bash`（`nix flake metadata path:/存在しないパス`）             | 止まった                                     |
| SessionStart                                                    | 上書きの内容が文脈に入った                   |

T3 から起動した Claude Code のセッションでも、`.claude/settings.json` を書き換えたあとの Bash の呼び出しが `nix_path_guard.py` に止められた。\
T3 の実物の `delegate_task` と、Codex と Devin のスレッドからの spawn は確かめていない。

## 影響

- Claude Code の spawn は、model と effort を表の範囲で書かないと止まる。\
  ユーザーが会話で表の外のモデルを指定したときは、上書きに 1 行足す（`.claude/rules/pstack-models.md`）。
- Codex と Devin のスレッドでは hook が効かない。\
  委譲の規則は `.claude/rules/pstack.md` と `AGENTS.md` を読んで守る。
- hook は devShell の外の `python3` で動く。\
  `python3` が無い環境では hook が失敗し、spawn と Bash は止まらない。
- 複数行のコマンドで引用符が行をまたぐと、`nix_path_guard.py` は字句解析を諦め、同じ区間に `nix` と `path:` があれば止める。\
  プロンプトの文字列に `nix ... path:` を含めるだけでも止まることがある。
