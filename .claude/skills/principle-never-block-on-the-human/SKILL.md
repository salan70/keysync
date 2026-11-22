---
name: principle-never-block-on-the-human
description: "Apply when tempted to ask 'should I do X?' on reversible work."
disable-model-invocation: true
---

# Never Block on the Human

The human supervises asynchronously. Agents must stay unblocked. Make reasonable decisions, proceed, and let the human course-correct after the fact. Since code changes are reversible and reviewable, a wrong decision usually costs less than blocking.

- Proceed, then present. Do the work, show the result. Don't ask "should I do X?" Do X, explain why.
- Make the system self-healing. When you notice a problem, log it and fix it in the next round.
- Irreversible actions (force-push, delete production data, send external messages) still require confirmation.
- Reversible actions (write code, edit notes, split tasks) should proceed without blocking.
- Product direction comes from the human. Execution should not block.

<!-- pstack project overlay: tools/pstack/overlays/principle-never-block-on-the-human.md -->
## Project overrides (keysync)

この原則は、次の操作には当てはめない。\
コードの変更と違って、実機と OS の状態が変わり、レビューでは戻せない。

- `AGENTS.md` の「禁止する操作」の全項目（実機への write、firmware の flash、bootloader / UF2 の操作、reset や clear-peer など）。\
  ユーザーの指示があっても AI は行わない。
- `just mac apply`、sudo を伴う `just linux apply`、kanata のサービスの登録など、`AGENTS.md` の「実機操作の安全性」に挙げた操作。\
  実行の前に毎回、その操作を名指ししたユーザーの承認を取る。

「確認せずに進めてから見せる」は、これらの操作の手前で止まる。\
差分と手順を用意し、ユーザーが実行するか承認するのを待つ。
