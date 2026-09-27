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

## 追記: Karabiner 16.3.0 への更新と適用

- Fact: 利用者が Karabiner を 16.3.0 へ更新した直後は、すべての割り当てが効かなくなった。旧版の `karabiner_grabber` が止まり、新版のサービスが起動していなかったためである。
- Fact: 16.x では、キー処理の本体が `Karabiner-Core-Service`（daemon と agent）に替わる。ログは `/var/log/karabiner/core_service.log` である。旧 `karabiner_grabber` の launchd 登録は残るが、起動しない（終了コード 78）。
- Fact: 利用者がシステム設定で許可を与えると、Core Service が `karabiner.json` を読み込み、内蔵キーボードを掴んだ。読み込み時にエラーは出なかった。
- Fact: 16.3.0 の `karabiner_cli --lint-complex-modifications` は、Flow Tap を含む生成物を `ok` とした。
- Fact: `just mac diff` は差分なしで、KeySync profile の mod-tap は閾値 180ms、`expression_if` は 9 個だった。
- 実機の連続打鍵での効き具合は、利用者の確認待ちである。

## 追記: 第 2 段階（Shift）

- 利用者は、Flow Tap の適用後に割り当て全般、ロール打鍵で誤爆しないこと、間を空けた home mod のショートカットを確かめた。Shift の反応は変わらなかった。
- Fact: Karabiner のソースを読み、`to_if_other_key_pressed` が key down だけで判定することと、処理済みのイベントが後ろの manipulator で invalid になることを確かめた。
- Karabiner では Permissive Hold を作れないと判断した（Inference）。利用者は、Shift だけ次のキーを押した時点で hold にする案を選んだ。
- Fact: 生成物は 16.3.0 の lint を通った。Shift の manipulator は先頭の rule に移り、右 Shift には layer 3 の `variable_unless` が付いた。
- 判断は ADR 0048 に記録した。実機での確認は利用者の適用待ちである。
