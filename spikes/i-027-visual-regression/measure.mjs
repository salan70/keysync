/**
 * I-027 Spike: Playwright で盤面と Apply の確認画面を決定論的に撮れるかを測る（使い捨て）。
 *
 * 前提: fixture 専用の harness（harness/）だけを撮る。`just dev` と実機 API には繋がない。
 * Playwright は repository の依存に入れない。別ディレクトリへ入れ、次の環境変数で指す。
 *
 *   SPIKE_PW_DIR              playwright と pngjs を入れたディレクトリ
 *   PLAYWRIGHT_BROWSERS_PATH  ブラウザの置き場（nixpkgs の playwright-driver.browsers など）
 *   SPIKE_CHROMIUM_ARGS       Chromium の起動 flag（空白区切り。任意）
 *   SPIKE_CHROMIUM_CHANNEL    `chromium` で headless shell ではなく full Chromium を使う（任意）
 *
 * 使い方: node spikes/i-027-visual-regression/measure.mjs [--runs 10] [--out <dir>] [--port 5199]
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const requirePw = createRequire(join(process.env.SPIKE_PW_DIR ?? "", "package.json"));
const { chromium } = requirePw("playwright");
const { PNG } = requirePw("pngjs");

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};
const RUNS = Number(opt("runs", "10"));
const OUT = opt("out", join(tmpdir(), "keysync-i-027"));
mkdirSync(OUT, { recursive: true });

const PORT = Number(opt("port", "5199"));
const BASE = `http://127.0.0.1:${PORT}/spikes/i-027-visual-regression/harness/index.html`;
const SHOTS = ["cornix-board", "mac-board", "apply-confirm"];
const VIEWPORT = { width: 1280, height: 800 };

const sha = (buffer) => createHash("sha256").update(buffer).digest("hex").slice(0, 12);
const ms = (start) => Math.round(performance.now() - start);

function pixelDiff(a, b) {
  const left = PNG.sync.read(a);
  const right = PNG.sync.read(b);
  if (left.width !== right.width || left.height !== right.height) {
    return { size: `${left.width}x${left.height} vs ${right.width}x${right.height}`, pixels: -1 };
  }
  let pixels = 0;
  let maxChannel = 0;
  let minX = Infinity,
    minY = Infinity,
    maxX = -1,
    maxY = -1;
  for (let y = 0; y < left.height; y++) {
    for (let x = 0; x < left.width; x++) {
      const i = (y * left.width + x) * 4;
      let worst = 0;
      for (let c = 0; c < 4; c++)
        worst = Math.max(worst, Math.abs(left.data[i + c] - right.data[i + c]));
      if (worst > 0) {
        pixels++;
        maxChannel = Math.max(maxChannel, worst);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }
  return { pixels, maxChannel, bbox: pixels === 0 ? null : [minX, minY, maxX, maxY] };
}

/** mode: naive は描画直後、settled は font 読込と FitText の再計測を待つ。 */
async function shoot(browser, shot, { mode = "settled", dpr = 1, inject, theme } = {}) {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: dpr,
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    colorScheme: "light",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const query = new URLSearchParams({ shot });
  if (inject) query.set("inject", inject);
  if (theme) query.set("theme", theme);
  const t0 = performance.now();
  await page.goto(`${BASE}?${query}`, { waitUntil: "load" });
  await page.waitForSelector("html[data-rendered='1']", { state: "attached" });
  if (mode === "settled") {
    await page.evaluate(async () => {
      await document.fonts.ready;
      window.dispatchEvent(new Event("resize")); // fit-text-bus が再計測する
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
  }
  const fit = await page.evaluate(() => {
    const scaled = [...document.querySelectorAll("*")].filter((el) => {
      const value = el.style?.getPropertyValue("--fit-scale");
      return value !== undefined && value !== "" && value !== "1";
    });
    return {
      fitTotal: [...document.querySelectorAll("*")].filter(
        (el) => el.style?.getPropertyValue("--fit-scale") !== "",
      ).length,
      fitShrunk: scaled.length,
      fontsLoaded: [...document.fonts].filter((f) => f.status === "loaded").length,
    };
  });
  const png = await page.screenshot({ animations: "disabled", caret: "hide" });
  const elapsed = ms(t0);
  await context.close();
  return { png, elapsed, fit };
}

const report = {
  runs: RUNS,
  node: process.version,
  platform: `${process.platform}-${process.arch}`,
};
const timings = {};
const firstByMode = {};

let t = performance.now();
const vite = await createServer({
  root: REPO,
  configFile: false,
  logLevel: "silent",
  esbuild: { jsx: "automatic" },
  server: { host: "127.0.0.1", port: PORT, strictPort: true },
});
await vite.listen();
timings.viteStartMs = ms(t);

async function launchMs() {
  const start = performance.now();
  const browser = await chromium.launch({
    args: (process.env.SPIKE_CHROMIUM_ARGS ?? "").split(" ").filter(Boolean),
    channel: process.env.SPIKE_CHROMIUM_CHANNEL || undefined,
  });
  return { browser, ms: ms(start) };
}

// E1/E2: 起動をまたいだ再現性。毎回ブラウザを起動し直す。
for (const mode of ["settled", "naive"]) {
  const hashes = Object.fromEntries(SHOTS.map((s) => [s, []]));
  const first = {};
  const launches = [];
  const shootMs = [];
  const fits = {};
  const wallStart = performance.now();
  for (let run = 0; run < RUNS; run++) {
    const { browser, ms: launch } = await launchMs();
    launches.push(launch);
    for (const shot of SHOTS) {
      const result = await shoot(browser, shot, { mode });
      shootMs.push(result.elapsed);
      const hash = sha(result.png);
      hashes[shot].push(hash);
      first[shot] ??= result.png;
      if (hash !== sha(first[shot])) {
        (report[`diffs_${mode}`] ??= []).push({
          run,
          shot,
          hash,
          ...pixelDiff(first[shot], result.png),
        });
      }
      fits[shot] = result.fit;
      if (run === 0)
        writeFileSync(join(OUT, `${shot}${mode === "naive" ? ".naive" : ""}.png`), result.png);
    }
    await browser.close();
  }
  firstByMode[mode] = first;
  report[mode] = {
    distinctHashes: Object.fromEntries(SHOTS.map((s) => [s, new Set(hashes[s]).size])),
    sampleHashes: Object.fromEntries(SHOTS.map((s) => [s, [...new Set(hashes[s])]])),
    launchMsMedian: launches.toSorted((a, b) => a - b)[Math.floor(launches.length / 2)],
    shootMsMedian: shootMs.toSorted((a, b) => a - b)[Math.floor(shootMs.length / 2)],
    wallMs: ms(wallStart),
    fit: fits,
  };
}

// FitText が font の読込前に測った結果（naive）と、読込後に測り直した結果（settled）の差。
report.naiveVsSettled = Object.fromEntries(
  SHOTS.map((shot) => [shot, pixelDiff(firstByMode.settled[shot], firstByMode.naive[shot])]),
);

// E3: 同一プロセス内で連続して撮る。
{
  const { browser } = await launchMs();
  const hashes = [];
  for (let i = 0; i < RUNS; i++) hashes.push(sha((await shoot(browser, "cornix-board")).png));
  report.sameProcessDistinct = new Set(hashes).size;
  await browser.close();
}

// E4: DPR 2。
{
  const hashes = [];
  for (let i = 0; i < Math.min(RUNS, 5); i++) {
    const { browser } = await launchMs();
    hashes.push(sha((await shoot(browser, "cornix-board", { dpr: 2 })).png));
    await browser.close();
  }
  report.dpr2Distinct = new Set(hashes).size;
}

// E5: 意図的な見た目の変更を検出できるか。
{
  const { browser } = await launchMs();
  const base = (await shoot(browser, "cornix-board")).png;
  const baseApply = (await shoot(browser, "apply-confirm")).png;
  const mutations = [
    ["key の角丸 +2px", "cornix-board", ".key{border-radius:calc(var(--radius-key) + 2px)}"],
    ["board の gap +1px", "cornix-board", ".board-fit{gap:calc(var(--space-300) + 1px)}"],
    ["key 面の色を R 1 段階", "cornix-board", ".kind-basic{--key-bg:rgb(255,254,254)}"],
    ["keycap の文字を 1px 下げる", "cornix-board", ".keycap-main{position:relative;top:1px}"],
    ["Apply の見出しを 1px 右へ", "apply-confirm", "#apply-title{margin-left:1px}"],
    ["Apply の step の色", "apply-confirm", ".apply-steps .is-current{opacity:.98}"],
    ["ダークテーマ", "cornix-board", "", "dark"],
  ];
  report.mutations = [];
  for (const [label, shot, inject, theme] of mutations) {
    const result = await shoot(browser, shot, { inject, theme });
    const diff = pixelDiff(shot === "apply-confirm" ? baseApply : base, result.png);
    report.mutations.push({ label, ...diff });
  }
  await browser.close();
}

report.timings = timings;
report.version = await (async () => {
  const { browser } = await launchMs();
  const version = browser.version();
  await browser.close();
  return version;
})();
await vite.close();
writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
