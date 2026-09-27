# Mac keyboard の engine を Karabiner-Elements から kanata へ替える

状態: 採用

2026-09-27 に、MacBook 内蔵キーボードの home mod を Cornix LP と同じ判定にしたいという要望を受けて決めた。
Spike は R-010（`spikes/r-010-kanata-macos/`）。

## 背景

Cornix LP の Vial settings は、Tapping Term 180ms、Permissive Hold、Chordal Hold、Flow Tap 130ms である（ADR 0047）。
Mac では Karabiner-Elements で近づけてきた。

- ADR 0047 で Flow Tap を作り、文章を打っている最中の誤爆が消えた
- ADR 0048 で、Shift だけを「次のキーを押した時点で hold」にした

home mod のショートカットは、閾値まで押し続けないと効かないままだった。

Karabiner のソースで確認した事実（ADR 0048）。

- Fact: Karabiner は、キーを押した時点で選んだ manipulator が出力を決める
- Fact: `to_if_alone` と `to_if_other_key_pressed` は、押している間に別のキーが押されたかだけを見る

Permissive Hold は「反対の手のキーを先に離したら hold、mod-tap を先に離したら tap」で分ける。
押す順が同じで離す順だけが違うので、Karabiner では作れない（Inference）。

R-010 で確かめた事実。

- Fact: kanata の `tap-hold-opposite-hand-release` は Chordal Hold と Permissive Hold に、`require-prior-idle` は Flow Tap に当たる
- Fact: kanata の安定版 v1.12.0 は、Karabiner-Elements 16.x の VirtualHIDDevice v8 と通信できない。`brew install --HEAD kanata` の build は通信できた
- Fact: Karabiner-Elements の「Modify events」を内蔵キーボードだけ切ると、Karabiner は内蔵キーボードを手放す。kanata は Karabiner の VirtualHIDDevice daemon へつながり、Karabiner-Elements を入れたまま動いた
- Fact: 利用者が実機で打って、次を確かめた
  - home mod の tap と、f を押したまま c での ⌘C
  - ロール打鍵で誤爆しない
  - Shift、かな・英数、各 layer が Karabiner のときと同じ
- Fact: kanata は root で動く。`--port` で待ち受ける TCP server は `{"Reload":{"wait":true}}` を受けて設定を読み直し、`ReloadResult` を返す

## 選択肢

1. Karabiner のまま、Permissive Hold を手の込んだ variable の組み合わせで近似する
2. engine を kanata へ替える
3. home mod の閾値だけを下げる

## 決定

案 2 を採る。
利用者が選んだ。

- desired state（`mac-keyboard.<layout>.yaml`、QMK 表記、位置の語彙、`tapping_term_ms`、`flow_tap_term_ms`）は変えない
- 生成物は kanata の設定 1 ファイルにする。KeySync はこのファイル全体を所有し、置き場所は `~/Library/Application Support/keysync/kanata.kbd` とする
- 判定の写像は次のとおりにする

  | QMK                           | kanata                                                                                         |
  | ----------------------------- | ---------------------------------------------------------------------------------------------- |
  | mod-tap（hold が Shift だけ） | `tap-hold-release`（手を問わない Permissive Hold）                                             |
  | それ以外の mod-tap、`LT`      | `tap-hold-opposite-hand-release` と `(timeout hold)`                                           |
  | `MO`                          | `layer-while-held`                                                                             |
  | Flow Tap                      | `defcfg` の `tap-hold-require-prior-idle`。tap 側が文字キーでなければ `(require-prior-idle 0)` |
  | `TG`                          | error（kanata に同等が無い）                                                                   |

- 手の割り当て（`defhands`）は生成器の固定表で持つ。Cornix で同じ役割のキーと同じ手にし、spacebar と英数は左、かなは右とする
- 対象デバイスは `macos-dev-names-include ("Apple Internal Keyboard / Trackpad")` で指す。外付けの vendor / product id は kanata が指せないので error にする
- 適用は keyd（ADR 0042）の形に合わせる。流れは「生成 → `kanata --check` → テキスト diff → 確認 → backup → atomic write → verify → TCP の Reload」である。書き込みと Reload に root は要らないので、Web UI からの適用（ADR 0034）を保つ
- kanata は root の launchd daemon（`dev.keysync.kanata`）として常駐させる。登録は `keysync mac service install` が端末の sudo で 1 回だけ行う
- KeySync は `karabiner.json` へ書き込まない。Karabiner-Elements は VirtualHIDDevice の提供元として入れたままにする。`karabiner.json` は、内蔵キーボードを掴んでいないかを確かめるためにだけ読み、掴んでいれば warning を出す
- YAML の `profile` 行は読み捨て、書き出さない
- `keysync mac devices` を廃止する。Karabiner の観測ファイルに依存し、kanata で id を使えないため

次を上書きする。

- ADR 0022: engine の選択、manipulator の展開規則、Karabiner profile の所有
- ADR 0028: lint を kanata の check に、profile の選択を Reload に置き換える
- ADR 0034: Karabiner を前提にした部分（Karabiner が無ければ止める、profile の切り替えの失敗）
- ADR 0044: mod-tap の manipulator の形。`tapping_term_ms` の持ち方は残す
- ADR 0047: Flow Tap の Karabiner での作り方。`flow_tap_term_ms` と文字キーの集合は残す
- ADR 0048: 全体

## 理由

- **Cornix と同じ判定になる。** 利用者の要望はこれであり、案 1 と案 3 では Permissive Hold の差が残る
- **Karabiner を消さない。** kanata は Karabiner の VirtualHIDDevice を使う。Karabiner-Elements がそれを入れて最新に保つので、単体の driver を別に管理しなくてよい
- **Reload を TCP で行う。** 設定ファイルを利用者の所有に置けば、root が要るのは常駐の登録だけになる。適用のたびに sudo を求めずに済み、Web UI から適用できる
- **テキストで diff する。** kanata は設定ファイルを書き戻さない。keyd と同じく、構造で比べる理由が無い
- **`TG` と外付けは error にする。** 利用者の設定は使っていない。黙って捨てると効かない割り当てが静かに残る（ADR 0023）

## 影響

- kanata の開発版（HEAD）が要る。v1.13.0 が出たら安定版へ移れる
- kanata を Homebrew で入れ直すと実体の path が変わり、入力監視とアクセシビリティの許可を与え直す必要がある
- Karabiner の「Modify events」を内蔵キーボードで切っておく必要がある。切っていなければ plan が warning を出す
- Karabiner で使っていた KeySync profile の complex_modifications は残るが、内蔵キーボードには効かない。KeySync は消さない
- `TG(n)` と外付けキーボードの設定は使えなくなる
- Linux（ADR 0042）は keyd のまま変えない
- 打鍵ログの `analyzeModTapOutput` は Karabiner の合成 tap（4〜6ms）を前提にしている。kanata の出力で判定が崩れるかは、移行後に記録して確かめる
- Open Question: launchd から起動した kanata が、入力監視の許可を得たうえで起動時から内蔵キーボードを掴めるか。常駐の登録後に確かめ、結果をこの ADR へ追記する
