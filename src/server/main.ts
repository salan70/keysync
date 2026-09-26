#!/usr/bin/env node
/**
 * `just ui` が起動するローカルサーバー。
 *
 * Web UI の配布は GitHub Pages ではなく、clone したリポジトリからのこの起動だけにする
 * （ADR 0033）。画面と Node 側の処理が同じ checkout から作られるので、版がずれない。
 */

import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import { defaultWorkspaceRoot } from "../workspace/default-root.ts";
import { createApiHandler, createLocalApi, type ApiHandler } from "./api.ts";
import { serveStatic } from "./static.ts";

/**
 * 固定の port。origin に port が入るため、変わるとテーマの保存と WebHID の device 権限が
 * 起動のたびに消える（ADR 0033）。
 */
export const UI_PORT = 5178;

/** loopback だけに bind する。LAN からは届かない。 */
export const UI_HOST = "127.0.0.1";

/** 利用者が開く URL。origin の比較にも使う。 */
export const UI_ORIGIN = `http://${UI_HOST}:${UI_PORT}`;

/** `src/server/` から 2 つ上が repository root。 */
const DIST = resolve(import.meta.dirname, "..", "..", "dist");

/**
 * サーバーを作る。listen は呼び出し側が行う。
 *
 * `/api/` 配下は `rejectApiRequest` を通ったものだけを `api` へ渡す。それ以外は
 * `dist/` の静的配信で、`GET` と `HEAD` だけを受ける。
 *
 * @doc docs/specs/local-server.md#createuiserver
 */
export function createUiServer(
  options: { readonly dist?: string; readonly api?: ApiHandler; readonly origin?: string } = {},
): Server {
  const dist = options.dist ?? DIST;
  const handleApi = createApiHandler({ origin: options.origin ?? UI_ORIGIN, api: options.api });
  return createServer((request, response) => {
    const path = (request.url ?? "/").split("?")[0] ?? "/";
    if (path.startsWith("/api/")) {
      handleApi(request, response);
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { "content-type": "text/plain; charset=utf-8" });
      response.end("method not allowed");
      return;
    }
    void serveStatic(dist, request.url ?? "/").then((result) => {
      response.writeHead(result.status, result.headers);
      response.end(request.method === "HEAD" ? undefined : result.body);
    });
  });
}

async function main(): Promise<void> {
  let root: string;
  try {
    root = defaultWorkspaceRoot();
  } catch (error) {
    console.error(`keysync ui: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
  const server = createUiServer({ api: createLocalApi(root) });
  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      console.error(
        `keysync ui: port ${UI_PORT} は使用中。すでに起動していれば ${UI_ORIGIN}/ を開く`,
      );
    } else {
      console.error(`keysync ui: ${error.message}`);
    }
    process.exit(1);
  });
  server.listen(UI_PORT, UI_HOST, () => {
    console.log(`keysync ui: ${UI_ORIGIN}/ で起動した（Ctrl+C で終了）`);
    console.log(`keysync ui: workspace は ${root}`);
    // 対象ブラウザは Chromium 系だけ（ADR 0004）。既定ブラウザが Safari でも Chrome で開く。
    // Linux は既定ブラウザで開く（Omarchy の既定は Chromium。ADR 0042）。
    // 開けなければ URL の表示だけで済ませる。
    if (process.platform === "linux") {
      execFile("xdg-open", [`${UI_ORIGIN}/`], () => undefined);
    } else {
      execFile("/usr/bin/open", ["-a", "Google Chrome", `${UI_ORIGIN}/`], () => undefined);
    }
  });
}

if (import.meta.main) await main();
