import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat as fsStat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { WorkspaceFileStore } from "./types.ts";

export class NodeWorkspaceStore implements WorkspaceFileStore {
  readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  async readText(path: string): Promise<string | undefined> {
    try {
      return await readFile(join(this.root, path), "utf8");
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw error;
    }
  }

  async writeText(path: string, text: string): Promise<void> {
    await this.writeBytes(path, new TextEncoder().encode(text));
  }

  async readBytes(path: string): Promise<Uint8Array | undefined> {
    try {
      return new Uint8Array(await readFile(join(this.root, path)));
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw error;
    }
  }

  async writeBytes(path: string, bytes: Uint8Array): Promise<void> {
    const absolute = join(this.root, path);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, bytes);
  }

  async stat(
    path: string,
  ): Promise<{ readonly modifiedAt: number; readonly contentHash?: string } | undefined> {
    try {
      const absolute = join(this.root, path);
      const [metadata, bytes] = await Promise.all([fsStat(absolute), readFile(absolute)]);
      return {
        modifiedAt: metadata.mtimeMs,
        contentHash: createHash("sha256").update(bytes).digest("hex"),
      };
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw error;
    }
  }

  async ensureDirectory(path: string): Promise<void> {
    await mkdir(join(this.root, path), { recursive: true });
  }

  async listFiles(directory: string): Promise<readonly string[]> {
    try {
      const entries = await readdir(join(this.root, directory), { withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .sort();
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
  }

  async remove(path: string): Promise<void> {
    await rm(join(this.root, path), { force: true });
  }
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}
