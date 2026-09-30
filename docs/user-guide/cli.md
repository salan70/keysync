# CLI の使い方

CLI はリポジトリの中で `just` から実行します。\
workspace は `KEYSYNC_WORKSPACE` を使い、`--workspace <dir>` で別の場所を指定できます。

## Cornix LP

CLI は Cornix LP へ書き込みません。

| コマンド                                                 | 内容                                       |
| -------------------------------------------------------- | ------------------------------------------ |
| `just keysync validate`                                  | 設定を検証する。error があれば終了コード 1 |
| `just keysync analyze`                                   | 到達できない layer や未使用の定義を探す    |
| `just keysync diff --against <file.vil>`                 | `.vil` との差分を出す                      |
| `just keysync render --format svg --layer <n>`           | layer の図を書き出す（`pdf` も可）         |
| `just keysync import vil <file.vil> --definition <json>` | `.vil` から workspace を作る（上書きする） |
| `just keysync export vil --out <file.vil>`               | `.vil` を書き出す                          |

## Mac

普段の反映は Web UI で行います。

| コマンド                                 | 内容                                      |
| ---------------------------------------- | ----------------------------------------- |
| `just mac apply`                         | 差分と fingerprint を出す（書き換えない） |
| `just mac apply --confirm <fingerprint>` | 反映する                                  |
| `just mac service`                       | kanata の常駐の状態を出す                 |
| `just mac record`                        | 打鍵を記録し、mod-tap の判定を推定する    |

### 戻し方

反映の前の設定は、workspace の `keysync/backups/kanata-<時刻>.kbd` に残っています。\
戻すときは、このファイルを kanata の設定ファイルへコピーし、kanata を起動し直します。

```bash
cp "$KEYSYNC_WORKSPACE/keysync/backups/kanata-<時刻>.kbd" ~/Library/Application\ Support/keysync/kanata.kbd
sudo launchctl kickstart -k system/dev.keysync.kanata
```

kanata を止めるときは `sudo launchctl bootout system/dev.keysync.kanata` を実行します。\
Mac を再起動すると、再び常駐します。

## Linux

[Linux（Omarchy）で使う](./linux.md) を参照します。
