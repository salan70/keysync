## Project overrides (keysync)

- worker の数は、作業の範囲を覆う最小の分割から決める。
- worker のモデルは `swarm workers` の行ではなく、`.claude/rules/pstack-models.md` の `low` か `mid` から選び、spawn のたびに明示する。
- `devin` の行で動く worker には free モデルの同時セッション数の rate limit がある（`.claude/rules/pstack.md` の自律と費用を参照）。\
  Devin の worker は一度に 3 までしか出さず、残りは実行中の worker が終わってから出す。\
  上限の 3 には swarm の外で動くほかの Devin セッションも含め、Claude か Codex の worker は数えない。\
  rate limit で失敗した worker は、エラーが示す reset 時刻まで待って直列に 1 本ずつ生やし直す。
