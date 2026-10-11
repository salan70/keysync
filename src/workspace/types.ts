/** Browser と Node の workspace adapter が共有する非同期 I/O 契約。 */

export interface WorkspaceFileStore {
  readText(path: string): Promise<string | undefined>;
  writeText(path: string, text: string): Promise<void>;
  readBytes(path: string): Promise<Uint8Array | undefined>;
  writeBytes(path: string, bytes: Uint8Array): Promise<void>;
  stat(
    path: string,
  ): Promise<{ readonly modifiedAt: number; readonly contentHash?: string } | undefined>;
  ensureDirectory(path: string): Promise<void>;
  /** directory 直下のファイル名（directory は含まない）。`""` は root。無ければ空。 */
  listFiles(directory: string): Promise<readonly string[]>;
  /** ファイルを消す。無ければ何もしない。 */
  remove(path: string): Promise<void>;
}

export interface WorkspaceConflictToken {
  readonly modifiedAt: number;
  readonly contentHash?: string;
}

export class WorkspaceConflictError extends Error {}

/** @doc docs/specs/workspace-cli.md#外部変更競合 */
export async function writeTextIfUnchanged(
  store: Pick<WorkspaceFileStore, "writeText" | "stat">,
  path: string,
  text: string,
  expected: WorkspaceConflictToken | undefined,
): Promise<void> {
  const actual = await store.stat(path);
  if (expected !== undefined && !sameToken(actual, expected)) {
    throw new WorkspaceConflictError(`外部変更を検出したため ${path} を上書きしない`);
  }
  await store.writeText(path, text);
}

function sameToken(
  actual: WorkspaceConflictToken | undefined,
  expected: WorkspaceConflictToken,
): boolean {
  if (actual === undefined) return false;
  if (actual.contentHash !== undefined && expected.contentHash !== undefined) {
    return actual.contentHash === expected.contentHash;
  }
  return actual.modifiedAt === expected.modifiedAt;
}
