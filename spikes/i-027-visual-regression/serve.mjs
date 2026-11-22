/**
 * 撮影 harness だけを配る開発サーバー（使い捨て）。`just dev` の `localApi` プラグインは載せないので、
 * workspace の読み書きにも Mac の適用 API にも繋がらない。127.0.0.1:5199 だけで待ち受ける。
 */
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const server = await createServer({
  root: fileURLToPath(new URL("../../", import.meta.url)),
  configFile: false,
  logLevel: "warn",
  esbuild: { jsx: "automatic" },
  server: { host: "127.0.0.1", port: 5199, strictPort: true },
});
await server.listen();
console.log(
  "harness: http://127.0.0.1:5199/spikes/i-027-visual-regression/harness/index.html?shot=cornix-board",
);
