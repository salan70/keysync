/**
 * ローカルサーバーの workspace ファイル API。
 *
 * Web UI は directory を選ばず、サーバーが開いた workspace をこれで読み書きする（ADR 0038）。
 * 中身は `NodeWorkspaceStore` の 4 操作をそのまま HTTP へ出したもので、足すのは path の
 * 制限だけである。
 *
 * HTTP には依存しない。リクエストの防御は `guard.ts`、配線は `main.ts` が持つ。
 */

import { isKeymapFile, isKeymapVariantFile } from "../workspace/keymap-variants.ts";
import { LEGACY_WORKSPACE_LAYOUT, WORKSPACE_LAYOUT } from "../workspace/layout.ts";
import { NodeWorkspaceStore } from "../workspace/node.ts";
import { WORKSPACE_API, type WorkspaceApiResponse } from "./protocol.ts";

/** root 直下で触れてよいファイル。適用対象と保持したキーマップ（ADR 0053）、旧名の Mac 設定。 */
function isRootFile(path: string): boolean {
  return path === WORKSPACE_LAYOUT.legacyMacKeymap || isKeymapFile(path);
}

/** 配下を丸ごと触れてよい管理ディレクトリ。改名前の `cornix/` は移行が読む（ADR 0036）。 */
const MANAGED_DIRECTORIES: ReadonlySet<string> = new Set([
  topSegment(WORKSPACE_LAYOUT.definitions),
  topSegment(LEGACY_WORKSPACE_LAYOUT.definitions),
]);

/**
 * workspace ファイル API を作る。返す関数は path と JSON 本文を受けて応答を返し、
 * 知らない path には `undefined` を返す。
 *
 * @doc docs/specs/local-server.md#createworkspaceapi
 */
export function createWorkspaceApi(deps: {
  readonly root: string;
}): (path: string, body: unknown) => Promise<WorkspaceApiResponse | undefined> {
  const store = new NodeWorkspaceStore(deps.root);
  return async (path, body) => {
    try {
      switch (path) {
        case WORKSPACE_API.status:
          return { kind: "workspace", root: deps.root };
        case WORKSPACE_API.read: {
          const bytes = await store.readBytes(workspacePath(body));
          return {
            kind: "file",
            base64: bytes === undefined ? null : Buffer.from(bytes).toString("base64"),
          };
        }
        case WORKSPACE_API.stat:
          return { kind: "stat", stat: (await store.stat(workspacePath(body))) ?? null };
        case WORKSPACE_API.write:
          await store.writeBytes(
            workspacePath(body),
            new Uint8Array(Buffer.from(stringField(body, "base64"), "base64")),
          );
          return { kind: "done" };
        case WORKSPACE_API.mkdir:
          await store.ensureDirectory(workspacePath(body));
          return { kind: "done" };
        case WORKSPACE_API.list:
          return { kind: "files", names: await store.listFiles(workspaceDirectory(body)) };
        case WORKSPACE_API.remove: {
          const path = workspacePath(body);
          if (!isKeymapVariantFile(path)) {
            throw new Error(`消せるのは保持したキーマップだけ: ${path}`);
          }
          await store.remove(path);
          return { kind: "done" };
        }
        default:
          return undefined;
      }
    } catch (error) {
      return { kind: "failed", message: error instanceof Error ? error.message : String(error) };
    }
  };
}

/**
 * 本文の `path` を、workspace の配置に収まる相対 path として取り出す。
 *
 * `..`、絶対 path、空の区切りは拒否する。配置の外（`justfile` や `src/` など）も拒否し、
 * Web UI の不具合で repository の他のファイルを書き換えないようにする。
 *
 * @doc docs/specs/local-server.md#createworkspaceapi
 */
export function workspacePath(body: unknown): string {
  const path = stringField(body, "path");
  const segments = path.split("/");
  if (
    path.includes("\\") ||
    segments.some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new Error(`workspace の相対 path ではない: ${path}`);
  }
  const [top] = segments;
  const allowed = segments.length === 1 ? isRootFile(path) : MANAGED_DIRECTORIES.has(top ?? "");
  if (!allowed) throw new Error(`workspace の配置の外は扱わない: ${path}`);
  return path;
}

/**
 * 本文の `directory` を、一覧してよい directory として取り出す。
 *
 * `""` は root で、保持したキーマップを並べるために使う。ほかは管理ディレクトリだけを通す。
 *
 * @doc docs/specs/local-server.md#createworkspaceapi
 */
export function workspaceDirectory(body: unknown): string {
  const directory = stringField(body, "directory");
  if (directory === "") return "";
  if (!MANAGED_DIRECTORIES.has(directory)) {
    throw new Error(`一覧できる directory ではない: ${directory}`);
  }
  return directory;
}

function topSegment(path: string): string {
  return path.split("/")[0] ?? path;
}

function stringField(body: unknown, name: string): string {
  const value =
    typeof body === "object" && body !== null ? (body as Record<string, unknown>)[name] : undefined;
  if (typeof value !== "string") throw new Error(`${name} が無い`);
  return value;
}
