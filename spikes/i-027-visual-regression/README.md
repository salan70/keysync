# I-027 Spike: Playwright による視覚回帰

Playwright で盤面と Apply の確認画面を決定論的に撮れるかを測る、使い捨てのコードです。\
本実装ではありません。判断と計測結果は `docs/tasks/ai-logs/2026-11-22_visual-regression-spike.md` にあります。

**実機は不要です。** 撮影対象は fixture だけを描画する harness で、`just dev` の `localApi`（Mac の適用 API）にも WebHID にも繋がりません。\
サーバーは `127.0.0.1:5199` だけで待ち受けます。

## 準備

Playwright は repository の依存に入れません。別ディレクトリへ入れて、環境変数で指します。\
ブラウザは nixpkgs unstable の `playwright-driver.browsers` を使います。npm の `playwright` は、nixpkgs の `playwright-driver` と同じ 1.64.1 を使います。

```bash
# ブラウザ（chromium と headless shell のみ。darwin では約 1 分半、/nix/store に約 600 MB）
nix build --impure --no-link --print-out-paths --expr '
  let pkgs = import (builtins.getFlake "github:NixOS/nixpkgs/nixos-unstable") { system = builtins.currentSystem; };
  in pkgs.playwright-driver.browsers.override { withFirefox = false; withWebkit = false; withFfmpeg = false; }'

# Playwright 本体（repository の外）
mkdir -p "$TMPDIR/pw" && cd "$TMPDIR/pw"
echo '{"name":"pw","private":true,"type":"module"}' > package.json
npm i playwright@1.64.1 pngjs
```

## 実行

```bash
export SPIKE_PW_DIR="$TMPDIR/pw"
export PLAYWRIGHT_BROWSERS_PATH=<上の nix build が出力した path>
export PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=true

# 再現性・所要時間・検出力の計測（既定は 10 回起動し直す）
nix develop -c node spikes/i-027-visual-regression/measure.mjs --runs 10 --out "$TMPDIR/i-027-out"
```

`toHaveScreenshot` の動作（baseline の生成、比較、差分画像、HTML レポート）は、`@playwright/test@1.64.1` を別ディレクトリへ入れて確かめます。

```bash
cd "$TMPDIR/pw" && npm i @playwright/test@1.64.1
npx playwright test -c <repository>/spikes/i-027-visual-regression/playwright/playwright.config.mjs --update-snapshots
npx playwright test -c <repository>/spikes/i-027-visual-regression/playwright/playwright.config.mjs
SPIKE_INJECT='.key{border-radius:8px}' npx playwright test -c <repository>/spikes/i-027-visual-regression/playwright/playwright.config.mjs
```

repository の外から config を読むと `@playwright/test` を解決できないため、`playwright/` の 2 ファイルを `$TMPDIR/pw/spec/` へコピーして実行してください。\
その場合、`playwright.config.mjs` の `serve` のパスを `serve.mjs` の絶対パスに直します。

## 構成

| file          | 役割                                                                    |
| ------------- | ----------------------------------------------------------------------- |
| `harness/`    | fixture だけで盤面と Apply を描画する撮影ページ（`?shot=`、`?inject=`） |
| `serve.mjs`   | harness だけを配る Vite 開発サーバー                                    |
| `measure.mjs` | 再起動をまたいだ再現性、所要時間、変更の検出力を測る                    |
| `playwright/` | `toHaveScreenshot` の設定と spec                                        |

baseline の画像は commit しません。環境ごとに違うため、本導入で 1 環境に固定してから置きます。
