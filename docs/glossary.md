# 用語辞書

KeySync のコード、ADR、仕様で使う keymap、Vial、kanata、Karabiner まわりの用語を 1 行で引けるようにします。
詳細は複製せず、正本へのリンクを添えます。

## keymap

| 用語                        | 意味                                                                                                                                             | 正本                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| keymap                      | キーの位置ごとに、押したときの挙動（keycode）を割り当てた表。layer の重ねで持つ                                                                  | [semantic-model.md](./specs/semantic-model.md)                                                  |
| layer                       | keymap の 1 枚。上の layer が `KC_TRNS`（透過）なら下の layer の割り当てが効く。Mac の layer 番号は Vial と別の番号空間                          | [mac-keymap.md](./specs/mac-keymap.md)                                                          |
| keycode                     | キーへの割り当て 1 件。`KC_A`、`LT1(KC_SPC)` のような QMK 表記の文字列。KeySync は入力された表記のまま保持し、正準形へ畳まない                   | [ADR 0001](./decisions/0001-vil-round-trip.md)                                                  |
| desired state               | 実機や OS に反映したい目標の keymap。Git 管理する `keymap.yaml` と `mac-keyboard.<layout>.yaml`。現在の実機の状態（current）とは別に持つ         | [keymap-yaml.md](./specs/keymap-yaml.md)                                                        |
| semantic diff               | 現在の状態と desired state の差を、キーの位置と挙動の単位で出したもの。挙動が変わらない表記だけの差は `notationOnly` として区別する              | [semantic-diff.md](./specs/semantic-diff.md)                                                    |
| Apply                       | 現在状態の read、backup、検証、semantic diff、人間の確認、差分 write、再 read の verify までを 1 つにした反映手順。実機 write には明示操作が要る | [apply-flow.md](./specs/apply-flow.md)                                                          |
| mod-tap                     | タップで通常のキー、長押しで修飾キーになる割り当て（home row mod など）                                                                          | [ADR 0044](./decisions/0044-mac-mod-tap-tapping-term.md)                                        |
| Tapping Term                | tap と hold を分ける押下時間の閾値（ms）                                                                                                         | [ADR 0044](./decisions/0044-mac-mod-tap-tapping-term.md)                                        |
| Flow Tap                    | 文字を打っている最中は、mod-tap を hold にせず tap として扱う判定                                                                                | [ADR 0047](./decisions/0047-mac-flow-tap.md)                                                    |
| Permissive Hold             | mod-tap の押下中に別のキーを押して離したら、閾値前でも hold とする判定                                                                           | [ADR 0049](./decisions/0049-mac-engine-kanata.md)                                               |
| Semantic Core（`src/core`） | React、filesystem、WebHID に依存しない純粋なドメイン層。依存方向の検査は構造検査テストが持つ                                                     | [ADR 0006](./decisions/0006-semantic-model.md)、[ADR 0054](./decisions/0054-boundary-checks.md) |

## Vial

| 用語                | 意味                                                                                                               | 正本                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| Vial / VIA          | QMK firmware の keymap を実行中に書き換える仕組み。WebHID で実機と通信する。KeySync は外部 adapter として扱う      | [device-adapter.md](./specs/device-adapter.md)             |
| `.vil`              | Vial の保存形式（JSON）。KeySync は raw 構造を保持し、意味の round-trip を保証する                                 | [ADR 0001](./decisions/0001-vil-round-trip.md)             |
| `VilDocument`       | `.vil` を読んだ raw 層。KeySync の状態はこれ 1 つで、意味表現は都度作る派生ビュー                                  | [vil-document.md](./specs/vil-document.md)                 |
| keyboard definition | 実機が申告する物理配列と matrix の定義。`customKeycodes` の並び（`USER00`…）もここで決まる。単一の定義元として扱う | [ADR 0002](./decisions/0002-keyboard-definition-source.md) |
| capacities          | 実機が申告する layer、macro、tap dance、combo の数。firmware build で決まるので定数にしない                        | [ADR 0003](./decisions/0003-device-read-flow.md)           |
| QSID                | Vial の settings の識別子。実機が対応する QSID だけを write の対象にする                                           | [apply-flow.md](./specs/apply-flow.md)                     |
| Cornix LP           | KeySync が Vial で管理するキーボード                                                                               | [README.md](../README.md)                                  |

## kanata

| 用語                         | 意味                                                                                                                     | 正本                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| kanata                       | キー入力を加工するソフトウェア。Mac keyboard の適用の engine。設定ファイル 1 つ（`kanata.kbd`）を KeySync が全体所有する | [ADR 0049](./decisions/0049-mac-engine-kanata.md)         |
| `kanata.kbd`                 | KeySync が `desired state` から生成する kanata の設定。生成は `generateKanataConfig`                                     | [mac-keymap.md](./specs/mac-keymap.md)                    |
| `defhands`                   | opposite-hand 判定のために、キーを左右の手へ割り当てる設定。生成器が固定表で持つ                                         | [ADR 0049](./decisions/0049-mac-engine-kanata.md)         |
| `mac-keyboard.<layout>.yaml` | Mac keyboard の desired state。配列（layout）ごとに 1 ファイル。Cornix の `keymap.yaml` とは別の device class            | [mac-keymap.md](./specs/mac-keymap.md)                    |
| keyd                         | Linux 版の engine。`/etc/keyd/keysync.conf` を KeySync が全体所有する。位置と keycode の語彙は Mac と同じ                | [ADR 0042](./decisions/0042-linux-keyboard-management.md) |

## Karabiner

| 用語                   | 意味                                                                                                                                               | 正本                                                      |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Karabiner-Elements     | macOS のキー入力を変えるソフトウェア。かつての Mac keyboard の engine で、現在は kanata が使う VirtualHIDDevice の daemon の提供元として残っている | [ADR 0049](./decisions/0049-mac-engine-kanata.md)         |
| `key_code` 名          | Karabiner のキー名（`a`、`left_command`）。KeySync は Mac と Linux の位置の語彙として、この名前を流用する                                          | [ADR 0023](./decisions/0023-mac-keycode-syntax-source.md) |
| VirtualHIDDevice       | Karabiner が提供する仮想キーボード。kanata はここへ出力する                                                                                        | [ADR 0049](./decisions/0049-mac-engine-kanata.md)         |
| `is_built_in_keyboard` | Karabiner の device 条件。内蔵キーボードだけを対象にできる。Linux には同等の判定が無いので `vendor:product` で宣言する                             | [ADR 0042](./decisions/0042-linux-keyboard-management.md) |
