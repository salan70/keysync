## Project overrides (keysync)

- worker の数は、作業の範囲を覆う最小の分割から決める。
- worker のモデルは `swarm workers` の行ではなく、`.claude/rules/pstack-models.md` の `low` か `mid` から選び、spawn のたびに明示する。
