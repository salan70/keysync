/**
 * `/api/` 配下の受け口。`just ui` のサーバーと `just dev` の Vite 開発サーバーが共有する
 * （ADR 0038）。
 */

import { webcrypto } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { defaultKarabinerConfigPath } from "../karabiner/node.ts";
import { createKanataHost, defaultKanataConfigPath } from "../kanata/node.ts";
import { detectBuiltInLayout } from "../mac/keyboard-type.ts";
import { rejectApiRequest } from "./guard.ts";
import { createMacApi } from "./mac-api.ts";
import { createWorkspaceApi } from "./workspace-api.ts";

/**
 * API の本文の上限。workspace へ書く PDF と definition が載るため、1 ファイルを base64 に
 * した大きさを見込む（ADR 0038）。
 */
const MAX_BODY = 16 * 1024 * 1024;

/** path と JSON 本文を受けて応答を返す API。知らない path には `undefined` を返す。 */
export type ApiHandler = (
  path: string,
  body: unknown,
) => Promise<{ readonly kind: string } | undefined>;

/**
 * workspace のファイル API と Mac の適用 API を 1 つにまとめる。
 *
 * @doc docs/specs/local-server.md#createlocalapi
 */
export function createLocalApi(root: string): ApiHandler {
  const workspace = createWorkspaceApi({ root });
  const mac = createMacApi({
    root,
    config: defaultKanataConfigPath(),
    karabiner: defaultKarabinerConfigPath(),
    host: createKanataHost(),
    detectLayout: detectBuiltInLayout,
    crypto: webcrypto,
  });
  return async (path, body) => (await workspace(path, body)) ?? (await mac(path, body));
}

/**
 * `/api/` 配下のリクエストを受ける関数を作る。`rejectApiRequest` を通ったものだけを
 * `api` へ渡す。
 *
 * `origin` は `http://127.0.0.1:5178` の形で、開いたページの origin と一致させる。
 *
 * @doc docs/specs/local-server.md#createapihandler
 */
export function createApiHandler(options: {
  readonly origin: string;
  readonly api: ApiHandler | undefined;
}): (request: IncomingMessage, response: ServerResponse) => void {
  return (request, response) => {
    void handleApi(request, response, options.origin, options.api);
  };
}

async function handleApi(
  request: IncomingMessage,
  response: ServerResponse,
  origin: string,
  api: ApiHandler | undefined,
): Promise<void> {
  const path = (request.url ?? "/").split("?")[0] ?? "/";
  const reason = rejectApiRequest(request, origin);
  if (reason !== undefined) {
    send(response, 403, { kind: "rejected", reason });
    request.resume();
    return;
  }
  let body: unknown;
  try {
    body = JSON.parse(await readBody(request));
  } catch (error) {
    send(response, 400, {
      kind: "failed",
      message: error instanceof Error ? error.message : String(error),
    });
    return;
  }
  const result = api === undefined ? undefined : await api(path, body);
  if (result === undefined) {
    send(response, 404, { kind: "failed", message: `未知の API: ${path}` });
    return;
  }
  send(response, result.kind === "failed" ? 500 : 200, result);
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY) throw new Error("本文が大きすぎる");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}
