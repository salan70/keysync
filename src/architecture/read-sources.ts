import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isTestFile } from "./boundary-rules.ts";
import type { Sources } from "./import-graph.ts";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** `src/` の非テストの `.ts` / `.tsx` を、repo root からの相対パスをキーにして読む。 */
export function readSourceTree(): Sources {
  const sources = new Map<string, string>();
  const entries = readdirSync(join(REPO_ROOT, "src"), { recursive: true, encoding: "utf8" });
  for (const entry of entries.sort()) {
    const path = `src/${entry.split("\\").join("/")}`;
    if (!/\.tsx?$/.test(path) || isTestFile(path)) continue;
    sources.set(path, readFileSync(join(REPO_ROOT, path), "utf8"));
  }
  return sources;
}
