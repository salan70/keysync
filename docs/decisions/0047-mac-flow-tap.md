# Mac keyboard の mod-tap に QMK の Flow Tap を足す

状態: 採用（Karabiner での作り方は ADR 0049 が上書き。`flow_tap_term_ms` と文字キーの集合は残る）

2026-09-27 に、MacBook 内蔵キーボードで home mod の誤爆と Shift の反応の悪さが Cornix より目立つという報告を受けて決めた。
Cornix LP と同じ判定へ近づける 2 段階のうち、第 1 段階にあたる。

## 背景

Cornix LP の Vial settings（`keymap.yaml` の `settings`）と、Mac で効いている Karabiner の設定を比べた。

| 項目                               | Cornix（QMK） | Mac（Karabiner） |
| ---------------------------------- | ------------- | ---------------- |
| Tapping Term（qsid 7）             | 180ms         | 200ms            |
| Permissive Hold（qsid 22）         | 有効          | 無し             |
| Hold On Other Key Press（qsid 23） | 無効          | 無し             |
| Chordal Hold（qsid 26）            | 有効          | 無し             |
| Flow Tap（qsid 27）                | 130ms         | 無し             |

qsid 22 と 26 の値は `65281`（0xFF01）だった。
Vial GUI はこれらを幅 1 byte の boolean として読むため、有効な値は下位 byte の 1 である。

調査で確認した事実。

- Fact: QMK の Flow Tap は、直前のキーを押してから `FLOW_TAP_TERM` 未満で押した tap-hold キーを tap にする
- Fact: 既定では、直前のキーと tap-hold キーの tap 側がどちらも `KC_A`〜`KC_Z`、`KC_COMM`、`KC_DOT`、`KC_SCLN`、`KC_SLSH`、`KC_SPC` のときだけ効く
- Fact: QMK の Chordal Hold は tapping term を過ぎると効かない
- Fact: Karabiner 15.6.0 で `expression_if`、`set_variable.expression`、`system.now.milliseconds` が入った
- Fact: 利用者の Mac の Karabiner は 15.3.0 だった

ADR 0044 の形では、閾値より前に次のキーを押すと必ず tap になる。
このため、閾値の中の同じ手のロールは、Chordal Hold が無くても Cornix と同じ結果になる。
Mac で誤爆するのは、閾値を超えて押したまま次のキーを押したときである。
Cornix では、文章を打っている最中のこの場面を Flow Tap が tap にしている（Inference）。

## 選択肢

1. Karabiner のまま、変数と `expression_if` で Flow Tap を作る
2. engine を kanata へ替える（`require-prior-idle` が Flow Tap に相当する）
3. tapping term だけを変える

## 決定

案 1 を採る。

- `mac-keyboard.<layout>.yaml` に `flow_tap_term_ms` を置く。範囲は 0〜1000 の整数で、0 は無効、省略時は 0
- serializer は `flow_tap_term_ms` を常に書き出す。Web UI の Mac の実機パネルで編集できる
- 変数 `keysync_flow_tap_last_ms` に、直前に押したキーの時刻を記録する。文字キーなら `system.now.milliseconds`、それ以外なら 0 を書く
- 文字キーの判定は QMK の既定に合わせる。送るキーが `a`〜`z`、`comma`、`period`、`semicolon`、`slash`、`spacebar` で修飾なしのときだけ文字キーとする。mod-tap と layer-tap は tap 側で判定する
- tap 側が文字キーの mod-tap と layer-tap には、`expression_if` で経過時間を見る manipulator を通常の manipulator の前に置く。当たったら tap 側を `to` でそのまま送る
- どの layer にも割り当ての無い文字キーには、時刻を記録して素通しする manipulator を、layer の rule より後ろの rule に置く
- 利用者の `mac-keyboard.ansi.yaml` は `tapping_term_ms: 180`、`flow_tap_term_ms: 130` にして Cornix にそろえる

ADR 0044 の mod-tap の形は変えない。
Flow Tap が無効なら、生成物は本 ADR より前と同じである。

## 理由

- **誤爆の差を生んでいるのは Flow Tap である。** 閾値の差（180ms と 200ms）は、短いほど hold になりやすい向きの差で、誤爆を減らす方向ではない
- **Karabiner で作れる。** 必要な機能は 15.6.0 で入った。engine の置き換え（案 2）は ADR 0022、0028、0034、0044 を上書きするため、作れない場合まで取っておく
- **既定を無効にする。** この行の無い既存の YAML の挙動を変えない
- **文字以外のキーで記録を 0 に戻す。** QMK は直前のキーが文字キーのときだけ Flow Tap を効かせる。戻さないと、Enter や記号の直後の mod-tap まで tap になる
- **Flow Tap の manipulator は hold を持たない。** 押し続けると tap 側の key repeat になり、QMK と同じ挙動になる

## 影響

- Karabiner 15.6.0 以上が要る。それより古い Karabiner は `expression_if` を読めない
- 文章を打っている最中は、直前のキーから 130ms 未満で押した home mod を hold にできない。修飾キーとして使うには、前のキーから間を空けて押す
- 割り当ての無い文字以外のキー（数字、矢印など）は記録を 0 に戻さない。数字の直後に 130ms 未満で押した mod-tap は tap になり、QMK と差が出る
- manipulator が増える。割り当てのあるキーには `set_variable` が 1 個加わり、割り当ての無い文字キーには素通しの manipulator が加わる
- Shift の反応の悪さはこの ADR では直らない。Shift の tap 側は文字キーではないため、Flow Tap の対象外である
- 解決済み（2026-09-27）: Permissive Hold は Karabiner では作れないと判断した。Shift の扱いは ADR 0048 で決めた
- 解決済み（2026-09-27）: Karabiner 16.3.0 へ更新して適用した。利用者が実機で打ち、割り当て全般、ロール打鍵で誤爆しないこと、間を空けた home mod のショートカットを確かめた。Shift の反応は変わらなかった（想定どおり）
