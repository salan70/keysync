# Cornix の keymap を MacBook へ移し、修飾付き keycode を Karabiner へ落とす

2026-09-26〜27。
利用者が、Cornix の keymap を MacBook（ANSI）内蔵キーボードへ移す複数案を求めた。
3 案を盤面で見比べるページ（Artifact）を作り、利用者は「位置をそのまま移す」案 A と、生成器の拡張を選んだ。

## Fact

- 案 A の yaml は、変更前の生成器で 31 件の error になった。内訳は `LSFT(..)` などの修飾付き keycode 29 件と、`SGUI_T` の mod-tap 2 件。
- 変更後は error 0 件で、`karabiner_cli --lint-complex-modifications` も通った。
- 案 A を workspace（`KEYSYNC_WORKSPACE`）の `mac-keyboard.ansi.yaml` へ書いた。Karabiner への適用はしていない。
- Cornix にある TD、`LCG` / `RCG` の割り当て、F13、`?`、USER、マウス、エンコーダーは案 A でも移していない。
- 作業中に別セッションが同じリポジトリで Linux 対応とピッカータブを進めていた。ADR 番号が 2 回衝突したため、0043 にした。
  - UI 側の変更（`MAC_BEHAVIOR_OPTIONS` と 2 つの test）は、ピッカータブの commit（0464c3a）に含まれた。
- `mac generate --out` に絶対パスを渡すと、workspace 配下へ連結したパスに書き出される。既存の挙動で、本変更では扱っていない。

## Decision

ADR 0043 に記録した。
`to` イベントの組み立ては `karabinerKeyEvent` に集め、basic、modified、mod-tap と layer-tap の tap 側で共有した。

## Open Question

- `lazy` と `modifiers` を併せ持つ `to` が、実機で Shift+Cmd の hold として働くか。
- 生成器の mod-tap には押下時間のしきい値が無い。ホームロウ 8 キーの mod-tap が、速い打鍵で誤発火しないか。
