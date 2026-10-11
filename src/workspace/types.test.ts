import { rejects, strictEqual } from "node:assert/strict";
import { test } from "node:test";
import { WorkspaceConflictError, type WorkspaceFileStore, writeTextIfUnchanged } from "./types.ts";

function storeWith(current: {
  readonly modifiedAt: number;
  readonly contentHash: string;
}): WorkspaceFileStore & { readonly writes: string[] } {
  const writes: string[] = [];
  return {
    writes,
    async readText() {
      return undefined;
    },
    async writeText(_path, text) {
      writes.push(text);
    },
    async readBytes() {
      return undefined;
    },
    async writeBytes() {
      return undefined;
    },
    async stat() {
      return current;
    },
    async ensureDirectory() {
      return undefined;
    },
    async listFiles() {
      return [];
    },
    async remove() {
      return undefined;
    },
  };
}

test("workspace外部変更をcontent hashで検出して上書きしない", async () => {
  const store = storeWith({ modifiedAt: 2, contentHash: "new" });

  await rejects(
    writeTextIfUnchanged(store, "keymap.yaml", "next", {
      modifiedAt: 1,
      contentHash: "old",
    }),
    WorkspaceConflictError,
  );
  strictEqual(store.writes.length, 0);
});

test("workspace tokenが一致すると保存する", async () => {
  const store = storeWith({ modifiedAt: 1, contentHash: "same" });

  await writeTextIfUnchanged(store, "keymap.yaml", "next", {
    modifiedAt: 1,
    contentHash: "same",
  });
  strictEqual(store.writes[0], "next");
});
