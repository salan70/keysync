/**
 * `@playwright/test` の `toHaveScreenshot` を harness に当てる設定（使い捨て）。
 * repository には `@playwright/test` を入れていないため、別ディレクトリへ入れて実行する（README 参照）。
 */
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const serve = fileURLToPath(new URL("../serve.mjs", import.meta.url));

export default defineConfig({
  testDir: ".",
  testMatch: "shots.spec.mjs",
  // 期待画像は OS 名を付けず 1 環境（baseline 環境）に固定する。
  snapshotPathTemplate: "{testDir}/__screenshots__/{arg}{ext}",
  reporter: [["list"], ["html", { open: "never" }]],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:5199",
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    colorScheme: "light",
    reducedMotion: "reduce",
  },
  expect: {
    // 比較は 0 許容。既定の threshold（0.2）は色の 1 段階の違いを見逃す。
    toHaveScreenshot: { animations: "disabled", caret: "hide", threshold: 0, maxDiffPixels: 0 },
  },
  webServer: {
    command: `node ${serve}`,
    url: "http://127.0.0.1:5199/spikes/i-027-visual-regression/harness/index.html",
    reuseExistingServer: false,
  },
});
