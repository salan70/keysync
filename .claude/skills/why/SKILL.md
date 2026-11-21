---
name: why
description: "Use for 'why does X work this way', 'why we picked Y', design rationale, regressions, postmortems, or data-backed thresholds. Returns a cited read on decisions and tradeoffs. Use how for runtime behavior."
disable-model-invocation: true
---

# Why

Answer from the record, not the code: read the commits and PR discussions that introduced the target and each later change, and other sources if the trail is thin. Cite what the authors wrote, mark your own inferences as inferences, and say what the record does not answer.

<!-- pstack project overlay: tools/pstack/overlays/why.md -->
## Project overrides (keysync)

- 情報源は、git の履歴、GitHub（`gh`）、`docs/decisions/` の ADR、`docs/tasks/ai-logs/` の作業ログ。\
  使えなかった情報源（Notion など）は、記録の欠けとして書く。
