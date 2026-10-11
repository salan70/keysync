/**
 * ローカルサーバーが開いた workspace を読み書きする store。
 *
 * Web UI は directory を選ばない。workspace はサーバーが起動時に決めた 1 つで、ファイルの
 * 読み書きはすべて workspace API を通す（ADR 0038）。
 */

import {
  WORKSPACE_API,
  type MacApiFailure,
  type WorkspaceDoneResponse,
  type WorkspaceListResponse,
  type WorkspaceReadResponse,
  type WorkspaceStatResponse,
  type WorkspaceStatusResponse,
} from "../server/protocol.ts";
import type { WorkspaceFileStore } from "../workspace/types.ts";
import { post, type Fetch, type Reached } from "./mac-server.ts";

export class ServerWorkspaceStore implements WorkspaceFileStore {
  /** サーバーが読む workspace の絶対 path。表示にだけ使う。 */
  readonly root: string;
  private readonly fetcher: Fetch;

  constructor(root: string, fetcher: Fetch = fetch) {
    this.root = root;
    this.fetcher = fetcher;
  }

  async readText(path: string): Promise<string | undefined> {
    const bytes = await this.readBytes(path);
    return bytes === undefined ? undefined : new TextDecoder().decode(bytes);
  }

  async writeText(path: string, text: string): Promise<void> {
    await this.writeBytes(path, new TextEncoder().encode(text));
  }

  async readBytes(path: string): Promise<Uint8Array | undefined> {
    const result = settle(
      await post<WorkspaceReadResponse | MacApiFailure>(this.fetcher, WORKSPACE_API.read, {
        path,
      }),
      "file",
    );
    return result.base64 === null ? undefined : fromBase64(result.base64);
  }

  async writeBytes(path: string, bytes: Uint8Array): Promise<void> {
    settle(
      await post<WorkspaceDoneResponse | MacApiFailure>(this.fetcher, WORKSPACE_API.write, {
        path,
        base64: toBase64(bytes),
      }),
      "done",
    );
  }

  async stat(
    path: string,
  ): Promise<{ readonly modifiedAt: number; readonly contentHash?: string } | undefined> {
    const result = settle(
      await post<WorkspaceStatResponse | MacApiFailure>(this.fetcher, WORKSPACE_API.stat, {
        path,
      }),
      "stat",
    );
    return result.stat ?? undefined;
  }

  async ensureDirectory(path: string): Promise<void> {
    settle(
      await post<WorkspaceDoneResponse | MacApiFailure>(this.fetcher, WORKSPACE_API.mkdir, {
        path,
      }),
      "done",
    );
  }

  async listFiles(directory: string): Promise<readonly string[]> {
    return settle(
      await post<WorkspaceListResponse | MacApiFailure>(this.fetcher, WORKSPACE_API.list, {
        directory,
      }),
      "files",
    ).names;
  }

  async remove(path: string): Promise<void> {
    settle(
      await post<WorkspaceDoneResponse | MacApiFailure>(this.fetcher, WORKSPACE_API.remove, {
        path,
      }),
      "done",
    );
  }
}

/** サーバーの workspace を開いた結果。 */
export type OpenedWorkspace =
  | { readonly kind: "opened"; readonly store: ServerWorkspaceStore }
  | { readonly kind: "unreachable" }
  | { readonly kind: "failed"; readonly message: string };

/** @doc docs/specs/ui.md#workspace入口 */
export async function openServerWorkspace(fetcher: Fetch = fetch): Promise<OpenedWorkspace> {
  const status = await post<WorkspaceStatusResponse | MacApiFailure>(
    fetcher,
    WORKSPACE_API.status,
    {},
  );
  switch (status.kind) {
    case "workspace":
      return { kind: "opened", store: new ServerWorkspaceStore(status.root, fetcher) };
    case "unreachable":
      return status;
    // 今のサーバーは status で失敗しない。失敗するのは workspace API を持たない古いサーバーで、
    // 起動中に `dist/` だけが作り直されたときに起きる。
    case "failed":
      return {
        kind: "failed",
        message: `サーバーが古い可能性がある。just ui を起動し直す（${status.message}）`,
      };
    case "rejected":
      return { kind: "failed", message: status.reason };
  }
}

/** 期待した応答だけを通し、それ以外は理由を持った例外にする。 */
function settle<T extends { readonly kind: string }, K extends T["kind"]>(
  result: Reached<T>,
  kind: K,
): Extract<T, { kind: K }> {
  if (result.kind === kind) return result as Extract<T, { kind: K }>;
  const detail = result as { kind: string; message?: string; reason?: string };
  if (detail.kind === "unreachable") {
    throw new Error("ローカルサーバーに接続できない。just ui で起動する");
  }
  throw new Error(detail.message ?? detail.reason ?? `想定外の応答: ${detail.kind}`);
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
