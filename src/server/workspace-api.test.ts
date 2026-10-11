/**
 * workspace ファイル API の検証。一時 directory を workspace にする。
 */

import { deepStrictEqual, match, strictEqual } from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { WORKSPACE_API } from "./protocol.ts";
import { createWorkspaceApi, workspaceDirectory, workspacePath } from "./workspace-api.ts";

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "keysync-workspace-api-"));
  return { root, api: createWorkspaceApi({ root }) };
}

test("status は workspace の絶対 path を返す", async () => {
  const { root, api } = await setup();
  deepStrictEqual(await api(WORKSPACE_API.status, {}), { kind: "workspace", root });
});

test("書いたファイルを読み戻せ、無いファイルは null になる", async () => {
  const { root, api } = await setup();
  const base64 = Buffer.from("layers:\n").toString("base64");
  deepStrictEqual(await api(WORKSPACE_API.write, { path: "keysync/labels.yaml", base64 }), {
    kind: "done",
  });
  strictEqual(await readFile(join(root, "keysync/labels.yaml"), "utf8"), "layers:\n");
  deepStrictEqual(await api(WORKSPACE_API.read, { path: "keysync/labels.yaml" }), {
    kind: "file",
    base64,
  });
  deepStrictEqual(await api(WORKSPACE_API.read, { path: "keymap.yaml" }), {
    kind: "file",
    base64: null,
  });
});

test("stat は content hash を返し、無いファイルは null になる", async () => {
  const { root, api } = await setup();
  await writeFile(join(root, "mac-keyboard.jis.yaml"), "x");
  const result = await api(WORKSPACE_API.stat, { path: "mac-keyboard.jis.yaml" });
  strictEqual(result?.kind, "stat");
  if (result?.kind !== "stat" || result.stat === null) throw new Error("stat が無い");
  strictEqual(
    result.stat.contentHash,
    "2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881",
  );
  deepStrictEqual(await api(WORKSPACE_API.stat, { path: "keymap.yaml" }), {
    kind: "stat",
    stat: null,
  });
});

test("mkdir は管理ディレクトリの下に directory を作る", async () => {
  const { root, api } = await setup();
  deepStrictEqual(await api(WORKSPACE_API.mkdir, { path: "keysync/backups" }), { kind: "done" });
  strictEqual((await stat(join(root, "keysync/backups"))).isDirectory(), true);
});

test("配置の外と相対 path でないものは failed にし、書かない", async () => {
  const { api } = await setup();
  for (const path of [
    "../x",
    "/etc/hosts",
    "keysync/../justfile",
    "justfile",
    "src/a.ts",
    "keysync//a",
    "keysync\\a",
    "",
  ]) {
    const result = await api(WORKSPACE_API.write, { path, base64: "" });
    strictEqual(result?.kind, "failed", path);
  }
});

test("list は root と管理ディレクトリの直下のファイル名を返し、remove は保持したキーマップだけを消す", async () => {
  const { root, api } = await setup();
  await writeFile(join(root, "keymap.yaml"), "a");
  await writeFile(join(root, "keymap.v1.yaml"), "a");
  await writeFile(join(root, "justfile"), "a");
  await api(WORKSPACE_API.mkdir, { path: "keysync/definitions" });
  deepStrictEqual(await api(WORKSPACE_API.list, { directory: "" }), {
    kind: "files",
    names: ["justfile", "keymap.v1.yaml", "keymap.yaml"],
  });
  deepStrictEqual(await api(WORKSPACE_API.list, { directory: "keysync" }), {
    kind: "files",
    names: [],
  });
  strictEqual((await api(WORKSPACE_API.list, { directory: "src" }))?.kind, "failed");
  strictEqual(workspaceDirectory({ directory: "" }), "");

  strictEqual((await api(WORKSPACE_API.remove, { path: "keymap.yaml" }))?.kind, "failed");
  strictEqual((await api(WORKSPACE_API.remove, { path: "justfile" }))?.kind, "failed");
  deepStrictEqual(await api(WORKSPACE_API.remove, { path: "keymap.v1.yaml" }), { kind: "done" });
  deepStrictEqual(await api(WORKSPACE_API.list, { directory: "" }), {
    kind: "files",
    names: ["justfile", "keymap.yaml"],
  });
});

test("配置の中は通す", () => {
  for (const path of [
    "keymap.yaml",
    "keymap.v2.yaml",
    "mac-keyboard.yaml",
    "mac-keyboard.ansi.yaml",
    "mac-keyboard.ansi.home-row.yaml",
    "mac-keyboard.jis.yaml",
    "keysync/definitions/0123456789abcdef.json",
    "cornix/labels.yaml",
  ]) {
    strictEqual(workspacePath({ path }), path);
  }
  match(String(safe(() => workspacePath({}))), /path が無い/);
});

test("知らない path には undefined を返す", async () => {
  const { api } = await setup();
  strictEqual(await api("/api/mac/status", {}), undefined);
});

function safe(run: () => unknown): unknown {
  try {
    return run();
  } catch (error) {
    return error instanceof Error ? error.message : error;
  }
}
