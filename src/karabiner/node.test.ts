import { rejects, strictEqual, deepStrictEqual } from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { defaultKarabinerConfigPath, readKarabinerConfig } from "./node.ts";

async function workDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "keysync-karabiner-"));
}

test("既定のpathはKarabinerが読む場所を指す", () => {
  strictEqual(defaultKarabinerConfigPath().endsWith("/.config/karabiner/karabiner.json"), true);
});

test("karabiner.jsonをJSONとして読み、無ければundefinedを返す", async () => {
  const directory = await workDir();
  const path = join(directory, "karabiner.json");
  strictEqual(await readKarabinerConfig(path), undefined);
  await writeFile(path, '{"profiles":[{"name":"Default profile"}]}', "utf8");
  deepStrictEqual(await readKarabinerConfig(path), { profiles: [{ name: "Default profile" }] });
});

test("壊れたJSONは読まずに落ちる", async () => {
  const directory = await workDir();
  const path = join(directory, "karabiner.json");
  await writeFile(path, "{", "utf8");
  await rejects(readKarabinerConfig(path), /JSON として読めない/);
});
