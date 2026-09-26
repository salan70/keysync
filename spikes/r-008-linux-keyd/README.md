# R-008 Linux（Omarchy）の keyd と WebHID の実機観測

ADR 0042 の Open Question を、Omarchy を入れた JIS 配列の MacBook Pro で観測します。
スクリプトは読み取りだけを行い、`/etc/keyd/` への書き込みと `keyd reload` はしません。

## 手順

```bash
bash spikes/r-008-linux-keyd/observe.sh > r-008.txt 2>&1
sudo keyd monitor
```

`keyd monitor` では、スクリプトの最後に出る「手で確かめること」のキーを押して名前を記録します。

## 確かめること

| 問い                                                           | 見る場所                         | 期待（Inference）                             |
| -------------------------------------------------------------- | -------------------------------- | --------------------------------------------- |
| 内蔵キーボードの `vendor:product`                              | `/proc/bus/input/devices` の出力 | `05ac:xxxx`、名前に `Apple Internal Keyboard` |
| 英数 / かなのキー名                                            | `keyd monitor`                   | `hanja` / `hangeul`                           |
| `¥` / `_` のキー名                                             | `keyd monitor`                   | `yen` / `ro`                                  |
| `fn` と最上段                                                  | `keyd monitor` と `fnmode`       | `fnmode` 次第で `f1` かメディアキー           |
| 他の設定が `[ids]` に `*` を持つとき `keysync.conf` が勝つか   | `[ids]` の一覧と適用後の動作     | 明示 id が優先                                |
| 生成物が `keyd check` を通るか                                 | 「生成物の keyd check」          | ok                                            |
| Cornix LP の hidraw に Vial の serial が見えるか（BLE を含む） | 「hidraw と Vial の serial」     | USB では見える。BLE は不明                    |
| udev rule の後に Chromium から接続できるか                     | Web UI の `接続（機器を選ぶ）`   | 一覧に出る                                    |

結果は `docs/tasks/ai-logs/` の作業ログに Fact として残します。
期待と違ったものは ADR 0042 の Open Question を更新します。
