import { ok, strictEqual } from "node:assert/strict";
import { test } from "node:test";

import { parseMacKeymapYaml } from "../core/mac-keymap/parse.ts";
import { macKeymapPath, WORKSPACE_LAYOUT } from "../workspace/layout.ts";
import {
  initialMacKeymapYaml,
  macScopeLabel,
  probeMacKeymap,
  probeMacKeymaps,
} from "./mac-workspace.ts";

function fakeStore(files: Readonly<Record<string, string | undefined>>, modifiedAt = 1000) {
  return {
    readText: (path: string) => Promise.resolve(files[path]),
    stat: (path: string) => Promise.resolve(files[path] === undefined ? undefined : { modifiedAt }),
  };
}

const jisYaml =
  'schema: keysync/mac-keymap@1\nlayout: jis\nprofile: "KeySync"\nlayers:\n  0:\n    "a": "KC_B"\n';
const ansiYaml =
  'schema: keysync/mac-keymap@1\nlayout: ansi\nprofile: "KeySync"\nlayers:\n  0:\n    "a": "KC_C"\n';

test("新名の配列ファイルがあればreadyとpathを返す", async () => {
  const state = await probeMacKeymap(fakeStore({ [macKeymapPath("jis")]: jisYaml }), "jis");
  ok(state.kind === "ready");
  strictEqual(state.path, macKeymapPath("jis"));
  strictEqual(state.document.layers.get(0)?.get("a"), "KC_B");
  strictEqual(state.token?.modifiedAt, 1000);
});

test("無い配列はmissingになる", async () => {
  const state = await probeMacKeymap(fakeStore({}), "ansi");
  strictEqual(state.kind, "missing");
});

test("旧名は中のlayout宣言で解決する", async () => {
  const jis = await probeMacKeymap(
    fakeStore({ [WORKSPACE_LAYOUT.legacyMacKeymap]: jisYaml }),
    "jis",
  );
  ok(jis.kind === "ready");
  strictEqual(jis.path, WORKSPACE_LAYOUT.legacyMacKeymap);
  const ansi = await probeMacKeymap(
    fakeStore({ [WORKSPACE_LAYOUT.legacyMacKeymap]: jisYaml }),
    "ansi",
  );
  strictEqual(ansi.kind, "missing");
});

test("parse失敗はerrorに閉じ込め、例外を外へ出さない", async () => {
  const state = await probeMacKeymap(
    fakeStore({ [macKeymapPath("jis")]: "schema: keysync/mac-keymap@1\nlayout: dvorak\n" }),
    "jis",
  );
  ok(state.kind === "error");
  ok(state.reason.length > 0);
});

test("readTextの例外もerrorに畳む", async () => {
  const state = await probeMacKeymap(
    {
      readText: () => Promise.reject(new Error("permission denied")),
      stat: () => Promise.resolve(undefined),
    },
    "ansi",
  );
  ok(state.kind === "error");
  strictEqual(state.reason, "permission denied");
});

test("ansiとjisを独立に読む", async () => {
  const mac = await probeMacKeymaps(
    fakeStore({
      [macKeymapPath("ansi")]: ansiYaml,
      [macKeymapPath("jis")]: jisYaml,
    }),
  );
  ok(mac.ansi.kind === "ready");
  ok(mac.jis.kind === "ready");
  strictEqual(mac.ansi.document.layers.get(0)?.get("a"), "KC_C");
  strictEqual(mac.jis.document.layers.get(0)?.get("a"), "KC_B");
});

test("作成導線の初期YAMLは渡した配列の空layer 0としてparseできる", async () => {
  const ansi = parseMacKeymapYaml(initialMacKeymapYaml("ansi"));
  strictEqual(ansi.layout, "ansi");
  strictEqual(ansi.layers.get(0)?.size, 0);
  const jis = parseMacKeymapYaml(initialMacKeymapYaml("jis"));
  strictEqual(jis.layout, "jis");
});

test("適用先ラベルはdevicesから組む", () => {
  strictEqual(macScopeLabel({ kind: "missing" }), "未作成");
  strictEqual(macScopeLabel({ kind: "error", reason: "x" }), "読み込み失敗");
  const base = parseMacKeymapYaml(initialMacKeymapYaml("ansi"));
  strictEqual(
    macScopeLabel({ kind: "ready", document: base, path: macKeymapPath("ansi"), token: undefined }),
    "内蔵",
  );
  strictEqual(
    macScopeLabel({
      kind: "ready",
      document: {
        ...base,
        devices: [{ builtIn: true }, { vendorId: 1452, productId: 630 }],
        tappingTermMs: 200,
      },
      path: macKeymapPath("ansi"),
      token: undefined,
    }),
    "内蔵 + 外付け",
  );
});
