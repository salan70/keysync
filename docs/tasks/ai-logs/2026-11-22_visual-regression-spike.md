# 視覚回帰の Spike と第 0 段（Issue #29）

## 目的

UI の視覚回帰を守る方法を決める。\
Issue #29 のうち、Spike（Playwright で決定論的に撮れるか）と第 0 段（`renderToStaticMarkup` の構造スナップショット）だけを扱う。\
本導入（`toHaveScreenshot` の全面採用）は、この Spike の採否と、Issue #28 の view 分割を待つ。

## 結論

- Playwright の `toHaveScreenshot` は**採用する**。ただし baseline の環境を 1 つに固定することが条件で、Linux 側は本導入の最初の作業で実測する。
- darwin（arm64、macOS 26.5）では、nixpkgs の Playwright ブラウザが動き、起動をまたいで同じ画素を出した。
- nixpkgs の headless shell と公式の `playwright install` は、同じ画素（PNG の hash が一致）を出した。
- Apply の dialog は、縦位置が小数になる中央寄せのままだと、CPU 負荷が高いときに文字の描画が 2 通りに割れた。位置を整数 px に固定すると割れなくなった。
- `FitText` は font の読み込みを待たずに測るため、font の読み込み後に再計測させないと、撮影が実際の最終状態とずれる。
- 第 0 段の構造スナップショットは `pnpm test` に入れた（12 件、約 0.4 秒）。構造の回帰は捕まえるが、寸法と文字の収まりは捕まえられない。

## 事実（Fact）

### 環境

| 項目       | 値                                                                                     |
| ---------- | -------------------------------------------------------------------------------------- |
| OS / chip  | macOS 26.5 / aarch64-darwin                                                            |
| Node       | v24.19.0（flake の `nodejs_24`）                                                       |
| Playwright | 1.64.1（npm）。nixpkgs unstable の `playwright-driver` と同じバージョン                |
| ブラウザ   | Chrome Headless Shell 156.0.8078.4（`chromium_headless_shell-1248`）                   |
| 撮影の条件 | viewport 1280 × 800、DPR 1、ja-JP、Asia/Tokyo、light、`reducedMotion: reduce`          |
| font       | LINE Seed JP（リポジトリ同梱の woff2）。等幅は `ui-monospace, "SF Mono", Menlo` の系統 |

nixos-24.11 の `playwright-driver` は 1.50.1 で、flake が持つ `nixos-unstable` は 1.64.1 だった。\
どちらも `meta.platforms` に `aarch64-darwin` を含む。

### 撮影の構成

`just dev` は実際の Mac 適用 API に繋がるため使わない。\
`spikes/i-027-visual-regression/harness/` が、fixture だけで `CornixBoard`、`MacBoard`、`ApplyDialog` を描画する（API にも WebHID にも繋がない）。\
Vite の開発サーバーを `127.0.0.1:5199` で待ち受けさせ、`localApi` プラグインは載せない。

撮影対象は次の 3 つ。

- `cornix-board`: Cornix LP の盤面（`baseline.vil`、layer 0。選択、差分印、警告印つき）
- `mac-board`: Mac の盤面（`desired.yaml`、layer 1）
- `apply-confirm`: Apply の「確認」段（警告 1 件つき）

### nixpkgs の Playwright ブラウザは darwin で動く

`playwright-driver.browsers` を `withFirefox = false; withWebkit = false; withFfmpeg = false` で上書きして build した。

| 項目                                 | 値                                                |
| ------------------------------------ | ------------------------------------------------- |
| 初回の `nix build`                   | 1 分 43 秒（nixpkgs の stdenv の取得を含む）      |
| closure の大きさ                     | 596 MB（chromium と headless shell）              |
| `chromium.launch()`                  | 動いた。`browser.version()` は 156.0.8078.4       |
| 公式の `playwright install chromium` | 19 秒、586 MB（chromium、headless shell、ffmpeg） |
| 2 つのブラウザの出力                 | 3 画面とも PNG の hash が一致                     |

nixpkgs 版は、公式の zip を hash 固定で取得して展開したものと推測する（derivation の中身は確認していない）。\
画素が一致したので、nixpkgs 版を選んでも見た目の再現性は失われない。

### 再現性（起動をまたぐ）

ブラウザを 10 回起動し直し、起動ごとに 3 画面を撮って PNG の SHA-256 を比べた（計 30 枚）。

| 条件                                                       | cornix-board | mac-board    | apply-confirm |
| ---------------------------------------------------------- | ------------ | ------------ | ------------- |
| settled（font 読込と FitText の再計測を待つ）              | 1 通り       | 1 通り       | 1 通り        |
| 同じプロセスで 10 回連続                                   | 1 通り       | -            | -             |
| DPR 2、5 回起動                                            | 1 通り       | -            | -             |
| Chromium の flag（`--disable-gpu`、hinting、LCD の無効化） | 変化なし     | 変化なし     | 変化なし      |
| full Chromium（`channel: chromium`）                       | **別の画素** | **別の画素** | **別の画素**  |

- flag では画素が変わらなかった。変わったのは、起動する Chromium の種類（headless shell か full か）だった。baseline では種類を固定する。
- full Chromium は起動に約 2.4 秒かかり、headless shell（約 0.1 秒）より遅い。

### Apply の dialog が割れる

初回の計測（10 起動）では 1 回、`apply-confirm` が別の画素になった（3798 画素、step の chip の行）。\
原因を切り分けた。

| 条件                                                     | 結果                                   |
| -------------------------------------------------------- | -------------------------------------- |
| 待機なし、60 起動を順に                                  | 60 / 60 が同じ                         |
| 6 プロセス並列（CPU 負荷）、30 起動ずつ（計 180）        | 21 / 180 が別の画素（2 通りだけ）      |
| 同じ条件で 500 ms 待ってから撮る                         | 割れる（待ちでは直らない）             |
| 同じ条件で GPU と LCD text を無効化                      | 割れる（flag では直らない）            |
| 同じ条件で `box-shadow` と backdrop を外す               | 割れる                                 |
| 2 通りの DOM の矩形（chip の位置と幅）                   | 同一（layout ではなく rasterize の差） |
| dialog を `position: fixed; top: 100px`（整数 px）に固定 | 180 / 180 が同じ                       |
| 同じ負荷で盤面 2 画面（各 180）                          | 0 / 180（割れない）                    |

中央寄せの dialog は縦位置が小数になる（chip の y が 257.703 など）。\
その小数位置の文字の rasterize が、負荷に応じて 2 通りに割れたと読める。\
harness は dialog の位置を整数 px に固定して避ける（`?pin=0` で外せる）。

### FitText は font の読込を待たない

`FitText` は layout effect で測り、再計測の契機は `fit-text-bus`（盤面の倍率、window の resize、container の resize）だけで、font の読込完了は含まない。\
`font-display: swap` のため、初回描画は fallback の font で測られる。

| 画面          | FitText の要素数 | 縮んだ要素（settled） | 縮んだ要素（naive） | naive と settled の差 |
| ------------- | ---------------- | --------------------- | ------------------- | --------------------- |
| cornix-board  | 63               | 4                     | 5                   | 847 画素              |
| mac-board     | 79               | 6                     | 6                   | 265 画素              |
| apply-confirm | 0                | 0                     | 0                   | 0 画素                |

naive は描画直後に撮り、settled は `document.fonts.ready` のあとに `resize` を発火して再計測させてから撮る。\
どちらも起動をまたいで 1 通りに安定したので、**決定論的だが、実際の最終状態ではない**。\
撮影側で settled の手順を踏む必要がある。アプリ側は、font の読込後に `notifyFit()` を呼べば同じ問題を避けられるが、この作業では変更していない。

`renderToStaticMarkup` の結果には `--fit-scale` が 1 件も出ない（SSR は effect を実行しない）。\
構造スナップショットは、文字の収まりを見られない。

### 検出力

settled の盤面と dialog に、意図的な見た目の変更を `?inject=` で差し込み、画素の差を数えた。\
画素の比較は完全一致（許容 0）。

| 変更                              | 差のあった画素 | 差の最大（1 channel） |
| --------------------------------- | -------------- | --------------------- |
| key の角丸 +2px                   | 7,757          | 106                   |
| board の gap +1px                 | 11,782         | 238                   |
| key 面の色を R 1 段階             | 68,227         | **1**                 |
| keycap の文字を 1px 下げる        | 5,633          | 238                   |
| Apply の見出しを 1px 右へ         | 1,190          | 221                   |
| Apply の step の色（opacity .98） | 2,441          | 9                     |
| dark テーマ                       | 1,022,079      | 240                   |

7 件すべてを検出した。\
色が 1 段階違うだけの変更も、許容 0 なら検出できる。\
`toHaveScreenshot` の既定の `threshold`（0.2）では、この 1 段階の変更は通ってしまうため、許容を 0 に設定した（後述）。

### 所要時間

| 項目                                           | 値                                                                           |
| ---------------------------------------------- | ---------------------------------------------------------------------------- |
| Vite の起動                                    | 約 20 ms                                                                     |
| `chromium.launch()`（headless shell）          | 中央値 約 100〜145 ms                                                        |
| 1 画面（新しい context、goto から screenshot） | 中央値 約 150〜270 ms                                                        |
| 10 起動 × 3 画面（settled）の wall time        | 約 9〜12 秒（起動のたびに 3 画面）                                           |
| `@playwright/test` の 3 画面                   | 比較 1.3 秒、baseline 生成 2.0 秒。`webServer` と node の起動を含めて約 3 秒 |

撮影対象が約 21 個のとき、全件を 1 worker で撮ると、1 画面 約 0.4 秒として約 10 秒前後と見積もる（実測していない）。

### `toHaveScreenshot` の動作

`@playwright/test` 1.64.1 を別ディレクトリへ入れ、`webServer` で harness を起動して確かめた。

- `--update-snapshots` で baseline の PNG が生成され、別プロセスでの再実行は 3 件とも通った。
- 変更を差し込むと失敗し、期待画像、実際の画像、差分画像、HTML レポートが生成された（key の角丸 +2px で、盤面 2 件が失敗、Apply は通った）。
- 許容は `threshold: 0, maxDiffPixels: 0` を明示して 0 にした。
- 期待画像のパスは OS 名を付けない `snapshotPathTemplate` にし、1 環境に固定する前提とした。

## 推測（Inference）

- 画素の再現性は、同じ Chromium（種類と版）、同じ OS の font の描画、同じ viewport と DPR を揃えれば保てる。darwin 上の flag（hinting、LCD、GPU）は結果を変えなかった。
- OS をまたぐと画素は変わる。理由は、等幅 font（`ui-monospace` 系）が system の font に依存すること、文字の rasterize が OS ごとに違うことである。LINE Seed JP は同梱だが、`⌘`、`⇧`、矢印のような記号は同梱 font に無ければ system の fallback になる。
- したがって baseline は 1 環境に固定し、それ以外の環境では撮影の比較を走らせない。

## 判断（Decision）

1. 視覚回帰は Playwright の `toHaveScreenshot` を採用する。理由は次のとおり。
   - 起動をまたいで同じ画素になることを確かめた。
   - 意図的な変更（1 px の移動、色 1 段階）を検出できた。
   - 所要時間は 21 画面で約 10 秒前後と見積もれ、pre-push に収まる。
   - baseline、差分画像、HTML レポートが内蔵で、独自の機構を作らずに済む。
2. ブラウザは nixpkgs の `playwright-driver.browsers`（unstable。flake の `unstable` を使う）を使う。\
   darwin で動き、公式の取得と画素が一致し、ツールチェーンを flake で固定する方針と合う。\
   npm の `@playwright/test` は、`playwright-driver` と同じバージョンに揃える。
3. 第 0 段の構造スナップショットは今回入れる。視覚回帰の本導入より前に、構造の回帰を依存なしで守れる。

## baseline の環境

baseline は**Linux container（公式の Playwright image を版固定）の 1 環境**に固定することを推奨する。\
CI（GitHub Actions の ubuntu）と手元の Docker で同じ image を使えば、環境の食い違いを避けられる。

選ぶ理由は次のとおり。

- CI で動かすには Linux が現実的で、macOS runner は高価。
- system font（等幅、記号の fallback）を container に閉じ込められる。
- 手元の Mac の OS 更新で baseline が壊れない。

代わりに、手元の Mac（nixpkgs のブラウザ）を baseline にする案もある。\
セットアップは最小で、今回の実測がそのまま使える（3 画面で約 3 秒）。\
ただし CI で比較できず、OS の更新と別の Mac で画素が変わるかを確かめていない。\
次の条件のうち 1 つでも当てはまるなら、この案を選べる。

- 比較を手元の pre-push だけで足りるとする。
- 開発機が 1 台で、OS の更新時に baseline を撮り直す運用を許容する。

どちらにするかは、本導入の Issue で決める。

## 未検証（Open Question）

- **Linux container での再現性**: Docker の daemon が停止していたため実行していない（起動もしていない）。本導入の最初の作業で、同じ `measure.mjs` を container で走らせ、再現性と darwin との差を測る。
- OS の再起動をまたぐ再現性。今回の「再起動」はブラウザの起動し直しで、OS の再起動は含まない。
- macOS の更新（26.5 以外）と別の Mac での画素の差。
- 本導入の対象（約 21 個の view）での所要時間と flake の率。Issue #28 の view 分割が先に要る。
- `FitText` を font の読込後に再計測させる修正。`document.fonts.ready` のあとに `notifyFit()` を呼ぶ案があり、実際の画面でも初回描画のずれを防ぐ可能性がある。別の Issue として扱うことを提案する（この作業では変更していない。起票は承認後）。

## 本導入への引き継ぎ

- config は許容 0（`threshold: 0`、`maxDiffPixels: 0`）、`animations: "disabled"`、`caret: "hide"`、viewport、DPR、locale、timezone を固定する。
- 撮影の前に、`document.fonts.ready` のあと `resize` を発火して `FitText` を再計測させる（または app 側で直す）。
- dialog は位置を整数 px に固定する。
- Chromium は headless shell に固定する（full Chromium は別の画素になる）。
- 撮影定義の強制は fs 走査テスト 1 本で行う（Issue #29 の方針どおり）。
- main への push を含めた実行条件を決める。main 直コミット運用のため、CI で比較して失敗したときの扱い（baseline の更新手順）を先に決める。
- `@playwright/test` と `playwright-driver` のバージョンは同じに保つ。flake の更新でずれると起動に失敗するため、一致を確かめる検査を足すことを検討する。

## 第 0 段の実装

`src/ui/components/structure-snapshot.test.ts` が、盤面（Cornix、Mac）、Apply（差分、確認の警告あり・error あり、完了、中断）、`CornixLayerBar`、`Rail`、`StatusBar`、`Button`、`Logo` と `Icon` を、fixture から `renderToStaticMarkup` して `src/ui/components/__snapshots__/*.html` と比べる。

- コンポーネントは `import.meta.glob`（`Icon.tsx`）と JSX に依存するため、node 単体では読めない。Vite の `ssrLoadModule`（middlewareMode、HTTP は待ち受けない）で読む（`src/ui/testing/ssr.ts`）。依存は増えない（`vite` は既存）。
- 比較は node:test の `assert.fileSnapshot`（Node 24）。期待値は生の HTML で、タグの境界で改行して差分を読みやすくした。
- 更新は `just test-update-snapshots`。`pnpm test --test-update-snapshots` は、glob のあとに flag が付くため効かない。
- fixture は `fixtures/cornix-lp`（baseline と definition）と `fixtures/mac-keyboard/desired.yaml`。実機にも workspace にも触れない。
- 変更の検出を確かめた。`Button` の class を 1 つ書き換えると 7 件が失敗し、戻すと全件通る。

守れないもの: 寸法（盤面の倍率は DOM の実測）、`FitText` の縮小、CSS の変更、font。\
これらは Playwright の撮影が守る。
