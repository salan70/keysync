/**
 * `keysync keymaps` と `keysync mac keymaps` の検証。保持・切り替え・削除の CLI 入口だけを見る。
 * 入れ替えの規則は `src/workspace/keymap-variants.ts` の責務である。
 */

import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { access, copyFile, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parseVil } from "../core/vil/parse.ts";
import { planWorkspaceInit } from "../workspace/bootstrap.ts";
import { WORKSPACE_LAYOUT } from "../workspace/layout.ts";
import { NodeWorkspaceStore } from "../workspace/node.ts";
import { main } from "./main.ts";

const MAC_FIXTURES = join(import.meta.dirname, "../../fixtures/mac-keyboard");
const CORNIX_FIXTURES = join(import.meta.dirname, "../../fixtures/cornix-lp");

/** 標準出力を 1 件の JSON として捕まえる。標準エラーは捨てる（失敗の検証は終了コードで行う）。 */
async function captured(
  run: () => Promise<number>,
): Promise<{ readonly code: number; readonly output: Record<string, unknown> }> {
  const lines: string[] = [];
  const log = console.log;
  const error = console.error;
  console.log = (text: string) => lines.push(text);
  console.error = () => {};
  try {
    const code = await run();
    return { code, output: lines.length === 0 ? {} : JSON.parse(lines.join("\n")) };
  } finally {
    console.log = log;
    console.error = error;
  }
}

test("mac keymaps は保持・切り替え・削除をし、適用対象は名前の内容へ書き換える", async () => {
  const root = await mkdtemp(join(tmpdir(), "keysync-keymaps-mac-"));
  const active = join(root, "mac-keyboard.jis.yaml");
  await copyFile(join(MAC_FIXTURES, "desired.yaml"), active);
  const base = await readFile(active, "utf8");
  const edited = base.replace('"k": "KC_UP"', '"k": "KC_DOWN"');
  const args = ["--layout", "jis", "--workspace", root];

  const saved = await captured(() => main(["mac", "keymaps", "save", "base", ...args], {}));
  strictEqual(saved.code, 0);
  strictEqual(await readFile(join(root, "mac-keyboard.jis.base.yaml"), "utf8"), base);

  const listed = await captured(() => main(["mac", "keymaps", "list", ...args], {}));
  strictEqual(listed.code, 0);
  deepStrictEqual(listed.output.current, "base");
  deepStrictEqual(listed.output.variants, [{ name: "base", path: "mac-keyboard.jis.base.yaml" }]);

  await writeFile(active, edited);
  const refused = await captured(() => main(["mac", "keymaps", "switch", "base", ...args], {}));
  strictEqual(refused.code, 1);
  strictEqual(await readFile(active, "utf8"), edited);

  const trial = await captured(() => main(["mac", "keymaps", "save", "trial", ...args], {}));
  strictEqual(trial.code, 0);
  const switched = await captured(() => main(["mac", "keymaps", "switch", "base", ...args], {}));
  strictEqual(switched.code, 0);
  deepStrictEqual(switched.output.from, "trial");
  strictEqual(await readFile(active, "utf8"), base);

  const deleted = await captured(() => main(["mac", "keymaps", "delete", "trial", ...args], {}));
  strictEqual(deleted.code, 0);
  await access(join(root, "mac-keyboard.jis.base.yaml"));
  const rest = await captured(() => main(["mac", "keymaps", "list", ...args], {}));
  deepStrictEqual(rest.output.variants, [{ name: "base", path: "mac-keyboard.jis.base.yaml" }]);
});

test("keymaps は Cornix の keymap.yaml を保持し、一覧の current に名前を出す", async () => {
  const root = await mkdtemp(join(tmpdir(), "keysync-keymaps-cornix-"));
  const plan = await planWorkspaceInit(
    parseVil(await readFile(join(CORNIX_FIXTURES, "baseline.vil"), "utf8")),
    await readFile(join(CORNIX_FIXTURES, "vial-definition-v1.12.json"), "utf8"),
    webcrypto,
  );
  await new NodeWorkspaceStore(root).writeText(WORKSPACE_LAYOUT.keymap, plan.keymapText);

  const saved = await captured(() => main(["keymaps", "save", "v1", "--workspace", root], {}));
  strictEqual(saved.code, 0);
  const listed = await captured(() => main(["keymaps", "list", "--workspace", root], {}));
  strictEqual(listed.code, 0);
  deepStrictEqual(listed.output.current, "v1");
  deepStrictEqual(listed.output.variants, [{ name: "v1", path: "keymap.v1.yaml" }]);
});
