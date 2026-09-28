# Linux keyboard の mod-tap と LT を keyd の overloadt2 と lettermod で作る

状態: 採用

2026-09-28 に、Linux の内蔵キーボードへ Cornix LP の割り当て（home mod を含む）を移すために決めた。

## 背景

ADR 0042 では、mod-tap と `LT` を keyd の `overload` へ落としていた。
keyd の man（v2.6.0）で確認した事実。

- Fact: `overload(<layer>, <action>)` は、押している間 layer を有効にし、単独で離したときだけ `<action>` を送る。時間の閾値を持たない
- Fact: `overloadt2(<layer>, <action>, <timeout>)` は、`<timeout>` ms 押し続けるか、押している間に別のキーを押して離すと layer を有効にする。重なったキーは判定が決まるまで待たせる
- Fact: `overloadi(<action 1>, <action 2>, <idle timeout>)` は、直前の文字キー（action を持たないキー）を打ってから `<idle timeout>` ms 未満なら `<action 1>` を選ぶ
- Fact: `lettermod(<layer>, <key>, <idle timeout>, <hold timeout>)` は `overloadi(<key>, overloadt2(<layer>, <key>, <hold timeout>), <idle timeout>)` の別名である
- Fact: 利用者の Omarchy は Super+W（ウィンドウを閉じる）、Super+Q（アプリの終了）、Super+T など、Super と文字の組を多く持つ

`overload` では、`f` を押したまま `w` を押して `f` を先に離すロール打鍵が Super+W になる。
閾値が無いので、文章を打つ速さのロールでも hold になる（Inference）。

Cornix LP は Tapping Term 180ms、Permissive Hold、Chordal Hold、Flow Tap 130ms である（ADR 0047）。
Mac は kanata で同じ判定にした（ADR 0049）。

## 選択肢

1. keyd のまま、`overloadt2` と `lettermod` を使う
2. Linux の engine も kanata へ替える
3. `overload` のまま、home mod を置かない

## 決定

案 1 を採る。

- `linux-keyboard.<layout>.yaml` に `tapping_term_ms` と `flow_tap_term_ms` を置く。範囲、既定、書き出し方は Mac 側（ADR 0044、0047）と同じにする
- 判定の写像は次のとおりにする

  | QMK                                      | keyd                                                               |
  | ---------------------------------------- | ------------------------------------------------------------------ |
  | mod-tap、`LT`                            | `overloadt2(<layer>, <tap>, <tapping_term_ms>)`                    |
  | 上のうち Flow Tap の対象（tap 側が文字） | `lettermod(<layer>, <tap>, <flow_tap_term_ms>, <tapping_term_ms>)` |
  | Chordal Hold                             | 無し                                                               |

- Flow Tap の対象は Mac と同じ集合（`a`〜`z`、`comma`、`period`、`semicolon`、`slash`、`spacebar`）にする。`flow_tap_term_ms` が 0 なら `lettermod` を使わない
- hold が Shift の mod-tap も同じ形にする。kanata の `tap-hold-release`（手を問わない Permissive Hold）と同じ判定になる

ADR 0042 の展開規則のうち、`LT` と mod-tap の行を上書きする。

## 理由

- **keyd で Cornix の判定の大半を作れる。** `overloadt2` が Tapping Term と Permissive Hold に、`overloadi` が Flow Tap に当たる。Chordal Hold だけが無い
- **engine を替えるほどの差ではない。** 案 2 は ADR 0042 の導入手順と適用の流れ（sudo、`keyd reload`）を作り直す。Chordal Hold が効くのは、閾値の中で同じ手のキーを入れ子に打った場面に限られる
- **案 3 は割り当てを移せない。** 利用者が Linux へ持ち込みたいのは Cornix の home mod である
- **閾値の語彙を Mac と揃える。** 同じ物理キーボードで、同じ Cornix の値を書く。Web UI が Linux の設定を扱うときに、Mac の編集部品をそのまま使える

## 影響

- 生成物が変わる。既存の `linux-keyboard.*.yaml` は `tapping_term_ms: 200` として読まれ、`overload` が `overloadt2` になる
- keyd は `overloadt2` と `lettermod` を持つ版が要る（v2.6.0 で確認）
- 閾値の中で、同じ手のキーを mod-tap の押下中に押して離すと hold になる。Cornix（Chordal Hold）では tap になる
- keyd の `overloadi` は、直前のキーが文字キー以外（数字、記号、Enter など）でも Flow Tap を効かせる。QMK は直前のキーも文字キーのときだけ効かせる
- tap 側が文字キーでない mod-tap（Shift とかな・英数、Ctrl と Esc など）は Flow Tap の対象外で、kanata と同じである
- Open Question: 利用者が実機でロール打鍵と home mod のショートカットを打ち、誤爆と反応を確かめる
