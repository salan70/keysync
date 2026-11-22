## Project overrides (keysync)

- worker の数は、作業の範囲を覆う最小の分割から決める。
- worker のモデルは `swarm workers` の行ではなく、`.claude/rules/pstack-models.md` の `low` か `mid` から選び、spawn のたびに明示する。
- `devin` の行で動く worker は free モデルの同時セッション数の rate limit を受け、上限と再投入の手順は `.claude/rules/pstack.md` の自律と費用に従う。\
  上限の計上には swarm の外で動くほかの Devin セッションも含め、Claude か Codex の worker は数えない。
