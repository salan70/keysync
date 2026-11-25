# pstack のモデルの割り当て

作業の難しさでレベル（`high`、`mid`、`low`）を選び、そのレベルの effort の範囲から effort を選ぶ。\
provider は、スレッドを始めたモデルの provider とする（Claude Code は claude、Codex は codex）。\
委譲先は、渡された provider のまま動く。\
メインのモデルはユーザーがスレッドの開始時に選ぶので、この表では決めない。

## 表

`tools/pstack/spawn_guard.py` がこの節の行を読み、spawn の model と effort を照合する。\
書式は `レベル=モデル (effort の下限-上限, *既定)` で、行の先頭の provider 名を変えない。

```text
claude: high=opus (low-high, *medium), mid=sonnet (low-high, *medium), low=haiku (low-max, *xhigh), named=fable (low-high, *medium)
codex: high=sol (low-xhigh, *high), mid=terra (low-high, *medium), low=luna (low-max, *xhigh)
devin: mid=swe-2-high (medium-max, *medium), low=swe-2-flash (medium-max, *medium)
```

- 版を書かないモデル名（opus、sonnet、sol など）は、その系統の最新版を指す。\
  T3 Code では、スレッドごとに 1 回 `orchestrator_capabilities` の `search` に系統名を渡して解決する。
- `named=fable` は、ユーザーがその作業で fable を名指ししたときだけ使う。\
  難しさを理由に選ばない。
- `devin` の行は、ユーザーが会話で Devin を名指ししたときだけ使う。\
  `high` のレベルは置かないので、`high` の作業はスレッドの provider で行う。\
  Devin の基本モデルは `swe-2-max` とするが、acpRegistry が `swe-2-max` を advertise していないため `delegate_task` では `swe-2-max` を選べない（2026-11 に実測）。\
  表の水準ごとの割り当て（`mid` は `swe-2-high`、`low` は `swe-2-flash`）は変えない。\
  swe-2 系の free モデルには同時に動くセッション数の rate limit があり、上限と再投入の手順は `.claude/rules/pstack.md` の自律と費用に従う。
- effort の option の名前は provider ごとに違う。\
  Claude は `effort`、Codex は `reasoningEffort`、Devin は `thought_level` に値を渡す。

## provider の選び方

- もう一方の provider は、ユーザーが会話で指示したとき、または上書きが `provider` を変えるか `cross-provider: on` にしたときだけ使う。
- 選んだ provider の利用枠が尽きたら、そのことを 1 行で伝えて止まる。\
  ユーザーの指示なしに、もう一方の provider へ替えない。

## 上書き

上書きは 2 枚ある。\
マシン共通は `~/.config/pstack/pstack-models.md` に書く任意の preference で、このマシンのすべてのリポジトリに効く。\
リポジトリの上書きは、git の共通ディレクトリにある `pstack-models.local.md` に書く。\
どちらも git 管理外で、リポジトリのほうはすべての worktree が共有する。\
Claude Code では SessionStart の hook が両方の中身を文脈に足し、ほかの agent は `python3 tools/pstack/pstack.py models show` で表示する。

上書きの行は、この表の同じ名前の行を丸ごと置き換える。\
優先順位は、会話でのユーザーの選択、リポジトリの上書き、マシン共通の上書き、この表の順とする。\
マシン共通の上書きは PR に含めず、クラウドやほかのマシンに無ければこの表の既定へ戻る。

## レベルの選び方

- `high`: 設計、見た目が決まっていない UI、原因の分からない不具合、判断と文章、パネルとレビュー。
- `mid`: 決まった仕様への実装と修正。
- `low`: 位置の調査、検証の実行、機械的な書き換え、仕様で決まりきった小さな実装（ファイル、振る舞い、受け入れのコマンドが決まっているもの）。

役割を名指しする pstack の Skill（arena の runner、swarm の worker など）も、同じ基準で当てる。\
判断の役割は `high`、コードの作業は `mid`、定型のファンアウトは `low` にする。

## effort の選び方

既定の値から始める。\
原因が分からない、影響が広い、前に失敗した、判断の幅が大きいときは 1 段上げる。\
手順が決まっている、差分が小さい、安い再試行のときは 1 段下げる。

範囲の上限で足りなければ、範囲を越えずにレベルを上げる。\
委譲するときは、既定から動かした理由を 1 行で書く（「effort: high、1 回失敗したため」）。
