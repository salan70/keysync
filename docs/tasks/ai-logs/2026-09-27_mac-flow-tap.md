# Mac の mod-tap に Flow Tap を足し、閾値を Cornix にそろえる

2026-09-27。
利用者から、MacBook 内蔵キーボードで home mod の誤爆と Shift の反応の悪さが Cornix より目立つと報告があった。
設定値の違いを調べ、Cornix の設定と使用感に合う対応を検討するよう依頼された。
実現方法は任された。
利用者は、2 段階で進めること、Karabiner の更新、第 1 段階の実装を承認した。

## Fact

- Cornix の Vial settings は、Tapping Term 180ms、Permissive Hold 有効、Hold On Other Key Press 無効、Chordal Hold 有効、Flow Tap 130ms だった。qsid の対応は vial-gui の `qmk_settings.json` で確かめた。
- Mac で効いていた Karabiner 設定は、全 mod-tap が 200ms の 3 つの閾値だけで、他の判定は無かった。
- Karabiner は 15.3.0 だった。`brew upgrade --cask karabiner-elements` は sudo のパスワードを求めて失敗した。利用者の実行待ちである。
- 15.3.0 の `karabiner_cli --lint-complex-modifications` は、生成物の `set_variable.expression` を `unknown key` として拒んだ。更新するまで適用は lint で止まる。
- 生成物では、`d` に Flow Tap 用と通常用の 2 本が並び、左 Shift は記録を 0 に戻すだけで Flow Tap の対象外になった。
- 利用者の workspace の `mac-keyboard.ansi.yaml` を `tapping_term_ms: 180`、`flow_tap_term_ms: 130` にした。Karabiner へはまだ適用していない。
- 打鍵ログ（R-009 形式）は Karabiner の後の HID を記録するため、物理キーの押下時刻が無い。今回の判定の差の検証には使えなかった。
- `concise-writing` の機械検査スクリプトはこの環境に無く、実行できなかった。

## Decision

ADR 0047 に記録した。

## Open Question

- Permissive Hold と Chordal Hold を Karabiner で作れるか。第 2 段階として Spike で確かめる。
- Karabiner を更新して適用したあと、連続打鍵で Flow Tap が意図どおり効くか。
