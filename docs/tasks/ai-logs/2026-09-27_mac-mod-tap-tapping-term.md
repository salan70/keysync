# Mac の mod-tap を閾値で tap と hold に分け、閾値を Web UI から変える

2026-09-27。
利用者から、MacBook 内蔵キーボードのホームロウ mod で asdfghjkl の単押しがショートカットになり、ゆっくり打つことを強いられると報告があった。
原因と対策案を示し、利用者は全 mod-tap を対象にすること、閾値を設定項目にして Web UI から編集できるようにすることを選んだ。

## Fact

- 変更前の生成器は mod-tap を `to: [{ key_code: <modifier>, lazy: true }]` + `to_if_alone` へ落としていた。押している間に別のキーを押すと、時間に関係なく modifier が掛かる。
- 利用者の keymap では、`ka` が ⌥A、`ha` が ⌃A、`ja` が ⌘A になる並びだった。spacebar（`LGUI_T`）と return（`RGUI_T`）も同じ形だった。
- Karabiner の公式ドキュメントで、`to_if_held_down`・`to_delayed_action`・`to_if_alone` の閾値と `halt` の意味を確認した（ADR 0044 の背景に記載）。
- 変更後の生成物は `karabiner_cli --lint-complex-modifications`（15.3.0）を通った。
- Web UI は scratchpad へ複製した workspace で Vite の dev サーバーを起動し、headless Chrome で確認した。確認したのは次の 3 点。
  - 範囲外（`30`、`abc`）は保存されず、欄の下に理由が出る。
  - `180` は `mac-keyboard.ansi.yaml` へ保存される。
  - 理由が出てもカードの高さが変わらない。
- 利用者の workspace の `mac-keyboard.ansi.yaml` と Karabiner の設定は変えていない。

## Decision

ADR 0044 に記録した。
ADR 0043 の Open Question（`lazy` と `modifiers` を併せ持つ `to`）は、mod-tap が `lazy` を使わなくなったため対象が `to_if_held_down` の複合 modifier に移った。

## Open Question

- 割り込んだキーより前に `to_if_canceled` の文字が出るか。実機で `ka` / `ha` / `ja`、d→f のロール、意図したショートカット、`SGUI_T` の hold を確かめる。
- 既定の 200ms が利用者の打鍵速度に合うか。
