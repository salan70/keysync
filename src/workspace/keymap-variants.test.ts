import { deepStrictEqual, rejects, strictEqual, throws } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { serializeKeymapYaml } from "../core/keymap-yaml/serialize.ts";
import { parseVil } from "../core/vil/parse.ts";
import {
  activeKeymapPath,
  deleteKeymapVariant,
  isKeymapFile,
  isKeymapVariantFile,
  KeymapVariantError,
  keymapVariantName,
  keymapVariantPath,
  listKeymapVariants,
  matchKeymapVariant,
  saveKeymapVariant,
  switchKeymapVariant,
  type KeymapTarget,
} from "./keymap-variants.ts";
import type { WorkspaceFileStore } from "./types.ts";

const ANSI: KeymapTarget = { kind: "mac", layout: "ansi" };
const JIS: KeymapTarget = { kind: "mac", layout: "jis" };
const CORNIX: KeymapTarget = { kind: "cornix" };

const macYaml = (layout: string, key: string, extra = ""): string =>
  `schema: keysync/mac-keymap@1\nlayout: ${layout}\n${extra}layers:\n  0:\n    "a": "${key}"\n`;

const cornixYaml = serializeKeymapYaml(
  parseVil(readFileSync("fixtures/cornix-lp/baseline.vil", "utf8")),
  {
    keyboardUid: "1",
    keyboardName: "Cornix LP",
    definitionPath: "keysync/definitions/0123456789abcdef.json",
    definitionDigest: "0".repeat(64),
  },
);

function memoryStore(
  seed: Readonly<Record<string, string>>,
): WorkspaceFileStore & { readonly files: Map<string, string> } {
  const files = new Map(Object.entries(seed));
  return {
    files,
    readText: (path) => Promise.resolve(files.get(path)),
    writeText: (path, text) => {
      files.set(path, text);
      return Promise.resolve();
    },
    readBytes: () => Promise.reject(new Error("not used")),
    writeBytes: () => Promise.reject(new Error("not used")),
    stat: () => Promise.resolve(undefined),
    ensureDirectory: () => Promise.resolve(),
    listFiles: (directory) =>
      Promise.resolve(
        [...files.keys()].filter((path) =>
          directory === "" ? !path.includes("/") : path.startsWith(`${directory}/`),
        ),
      ),
    remove: (path) => {
      files.delete(path);
      return Promise.resolve();
    },
  };
}

test("名前はファイル名の中に埋め、規則に合わない名前は落とす", () => {
  strictEqual(keymapVariantPath(ANSI, "home-row"), "mac-keyboard.ansi.home-row.yaml");
  strictEqual(keymapVariantPath(CORNIX, "v2"), "keymap.v2.yaml");
  for (const bad of ["", "Home", "a.b", "a/b", "-a", "a".repeat(65), "日本"]) {
    throws(() => keymapVariantPath(ANSI, bad), KeymapVariantError, bad);
  }
});

test("ファイル名から名前を取り出し、対象の違うものと適用対象は含めない", () => {
  strictEqual(keymapVariantName(ANSI, "mac-keyboard.ansi.home-row.yaml"), "home-row");
  strictEqual(keymapVariantName(ANSI, "mac-keyboard.jis.home-row.yaml"), undefined);
  strictEqual(keymapVariantName(ANSI, "mac-keyboard.ansi.yaml"), undefined);
  strictEqual(keymapVariantName(ANSI, "mac-keyboard.yaml"), undefined);
  strictEqual(keymapVariantName(ANSI, "linux-keyboard.ansi.x.yaml"), undefined);
  strictEqual(keymapVariantName(CORNIX, "keymap.v2.yaml"), "v2");
  strictEqual(keymapVariantName(CORNIX, "keymap.yaml"), undefined);
  strictEqual(keymapVariantName(CORNIX, "keymap.a.b.yaml"), undefined);
});

test("サーバーが root 直下で触れてよい範囲は適用対象と保持だけ", () => {
  for (const path of [
    "keymap.yaml",
    "keymap.v2.yaml",
    "mac-keyboard.jis.yaml",
    "mac-keyboard.ansi.x.yaml",
  ]) {
    strictEqual(isKeymapFile(path), true, path);
  }
  for (const path of [
    "linux-keyboard.jis.yaml",
    "justfile",
    "mac-keyboard.yaml",
    "keymap.Yes.yaml",
  ]) {
    strictEqual(isKeymapFile(path), false, path);
  }
  strictEqual(isKeymapVariantFile("keymap.v2.yaml"), true);
  strictEqual(isKeymapVariantFile("keymap.yaml"), false);
  strictEqual(isKeymapVariantFile("mac-keyboard.ansi.yaml"), false);
});

test("一覧は対象のものだけを名前順に並べる", async () => {
  const store = memoryStore({
    "mac-keyboard.ansi.yaml": macYaml("ansi", "KC_A"),
    "mac-keyboard.ansi.zeta.yaml": macYaml("ansi", "KC_Z"),
    "mac-keyboard.ansi.alpha.yaml": macYaml("ansi", "KC_B"),
    "mac-keyboard.jis.other.yaml": macYaml("jis", "KC_C"),
    "keymap.v1.yaml": cornixYaml,
    "keysync/labels.yaml": "",
  });
  deepStrictEqual(await listKeymapVariants(store, ANSI), [
    { name: "alpha", path: "mac-keyboard.ansi.alpha.yaml" },
    { name: "zeta", path: "mac-keyboard.ansi.zeta.yaml" },
  ]);
  deepStrictEqual(await listKeymapVariants(store, CORNIX), [
    { name: "v1", path: "keymap.v1.yaml" },
  ]);
  deepStrictEqual(await listKeymapVariants(memoryStore({}), JIS), []);
});

test("保持は適用対象のテキストをそのまま写し、同名は overwrite 無しで落とす", async () => {
  const text = `# memo\n${macYaml("ansi", "KC_A")}`;
  const store = memoryStore({ "mac-keyboard.ansi.yaml": text });
  deepStrictEqual(await saveKeymapVariant(store, ANSI, "base"), {
    name: "base",
    path: "mac-keyboard.ansi.base.yaml",
  });
  strictEqual(store.files.get("mac-keyboard.ansi.base.yaml"), text);

  await rejects(saveKeymapVariant(store, ANSI, "base"), KeymapVariantError);
  await saveKeymapVariant(store, ANSI, "base", { overwrite: true });
  await rejects(saveKeymapVariant(store, JIS, "base"), /mac-keyboard.jis.yaml が無い/);
});

test("照合は正規形で行い、コメントや並び順の違いは同じ内容とみなす", async () => {
  const store = memoryStore({
    "mac-keyboard.ansi.yaml": macYaml("ansi", "KC_A"),
    "mac-keyboard.ansi.same.yaml": `# comment\n${macYaml("ansi", "KC_A")}`,
    "mac-keyboard.ansi.other.yaml": macYaml("ansi", "KC_B"),
    "mac-keyboard.ansi.broken.yaml": "schema: nope\n",
  });
  strictEqual(await matchKeymapVariant(store, ANSI), "same");
  strictEqual(await matchKeymapVariant(memoryStore({}), ANSI), undefined);
  strictEqual(
    await matchKeymapVariant(
      memoryStore({ "keymap.yaml": cornixYaml, "keymap.v1.yaml": cornixYaml }),
      CORNIX,
    ),
    "v1",
  );
});

test("切り替えは保持を適用対象へ書き戻し、切り替え前の保持名を返す", async () => {
  const store = memoryStore({
    "mac-keyboard.ansi.yaml": macYaml("ansi", "KC_A"),
    "mac-keyboard.ansi.base.yaml": macYaml("ansi", "KC_A"),
    "mac-keyboard.ansi.trial.yaml": macYaml("ansi", "KC_T"),
  });
  deepStrictEqual(await switchKeymapVariant(store, ANSI, "trial"), {
    from: "base",
    path: "mac-keyboard.ansi.yaml",
  });
  strictEqual(store.files.get("mac-keyboard.ansi.yaml"), macYaml("ansi", "KC_T"));
  strictEqual(store.files.get("mac-keyboard.ansi.base.yaml"), macYaml("ansi", "KC_A"));
});

test("現在の内容がどの保持とも一致しなければ切り替えない", async () => {
  const store = memoryStore({
    "mac-keyboard.ansi.yaml": macYaml("ansi", "KC_X"),
    "mac-keyboard.ansi.trial.yaml": macYaml("ansi", "KC_T"),
  });
  await rejects(switchKeymapVariant(store, ANSI, "trial"), /どの保持とも一致しない/);
  strictEqual(store.files.get("mac-keyboard.ansi.yaml"), macYaml("ansi", "KC_X"));
});

test("適用対象が無ければ照合せずに書き、無い保持や壊れた保持や別配列の保持は書かない", async () => {
  const store = memoryStore({
    "mac-keyboard.ansi.trial.yaml": macYaml("ansi", "KC_T"),
    "mac-keyboard.ansi.broken.yaml": "schema: nope\n",
    "mac-keyboard.ansi.wrong.yaml": macYaml("jis", "KC_T"),
  });
  await rejects(switchKeymapVariant(store, ANSI, "missing"), /見つからない/);
  await rejects(switchKeymapVariant(store, ANSI, "broken"));
  await rejects(switchKeymapVariant(store, ANSI, "wrong"), /対象の配列 ansi と一致しない/);
  strictEqual(store.files.has("mac-keyboard.ansi.yaml"), false);
  deepStrictEqual(await switchKeymapVariant(store, ANSI, "trial"), {
    from: undefined,
    path: activeKeymapPath(ANSI),
  });
  strictEqual(store.files.get("mac-keyboard.ansi.yaml"), macYaml("ansi", "KC_T"));
});

test("削除は保持だけを消し、無ければ落とす", async () => {
  const store = memoryStore({
    "keymap.yaml": cornixYaml,
    "keymap.v1.yaml": cornixYaml,
  });
  await deleteKeymapVariant(store, CORNIX, "v1");
  strictEqual(store.files.has("keymap.v1.yaml"), false);
  strictEqual(store.files.has("keymap.yaml"), true);
  await rejects(deleteKeymapVariant(store, CORNIX, "v1"), /見つからない/);
});
