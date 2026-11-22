# SWE-2 の rate limit に合わせた委譲規則（Issue #34）

## 目的

`devin:` 行で動かす swe-2 系の free モデルには、同時に動くセッション数への rate limit がある（2026-11 に実測）。\
委譲が失敗しないよう、同時実行数の上限と再投入の手順を pstack の規則に書く。

## 結論

- 課金上の無制限はそのままに、1 スレッドで同時に動かす Devin のセッションは 3 まで、超える分は直列にする規則を `.claude/rules/pstack.md` の自律と費用に足した。
- rate limit で失敗した委譲は、エラーが示す reset 時刻まで待ち、直列に 1 本ずつ再投入する。\
  失敗した子を並列で立て直さない。
- Devin の基本モデルは `swe-2-max` としたが、acpRegistry が advertise していないため `delegate_task` では `swe-2-high` を使う（実測）。\
  `swe-2-max` と `swe-2-flash` 系も同じ free モデルの制限を受けるため、モデルの切り替えで回避できるかは未検証とした。
- `devin` の行は名指しのときだけ動くので、reset を待たない退避は「Devin に委譲しない」で足り、専用の上書き設定は足さなかった。

## 事実（Fact）

- 失敗の実測は別リポジトリ（baseball_player_journey）の T3・Devin CLI ログとセッション DB で確認した。\
  エラー文は `Reached free model rate limit` で、reset 時刻を示す。
- `swe-2-max` が `delegate_task` で選べないことは、T3 の acpRegistry_devin の advertise 一覧と、実際の `model_unavailable` の拒否で確認した。

## 検証

- `python3 tools/pstack/pstack.py sync` が valid で、両 SKILL.md に overlay が反映されたことを diff で確認した。
- 上限の 3 はユーザー報告と実測の失敗を踏まえた運用上の初期値で、厳密な安全値は未計測。
