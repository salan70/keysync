import { expect, test } from "@playwright/test";

const SHOTS = ["cornix-board", "mac-board", "apply-confirm"];
const PATH = "/spikes/i-027-visual-regression/harness/index.html";

for (const shot of SHOTS) {
  test(shot, async ({ page }) => {
    const query = new URLSearchParams({ shot });
    // 検出力の確認用。環境変数で意図的な見た目の変更を差し込む。
    if (process.env.SPIKE_INJECT) query.set("inject", process.env.SPIKE_INJECT);
    await page.goto(`${PATH}?${query}`);
    await page.waitForSelector("html[data-rendered='1']", { state: "attached" });
    // FitText は font の読込を待たずに測るため、読込後に再計測させてから撮る。
    await page.evaluate(async () => {
      await document.fonts.ready;
      window.dispatchEvent(new Event("resize"));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    await expect(page).toHaveScreenshot(`${shot}.png`);
  });
}
