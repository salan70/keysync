import { ok, strictEqual } from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { parseVil } from "../core/vil/parse.ts";
import { planWorkspaceInit } from "../workspace/bootstrap.ts";
import { macKeymapPath } from "../workspace/layout.ts";
import type { UiWorkspaceStore } from "./workspace-probe.ts";
import { defaultEditTarget, probeStore } from "./workspace-probe.ts";

const jisYaml =
  'schema: keysync/mac-keymap@1\nlayout: jis\nprofile: "KeySync"\nlayers:\n  0:\n    "a": "KC_B"\n';

function fakeStore(files: Readonly<Record<string, string | undefined>>): UiWorkspaceStore {
  return {
    root: "/ws",
    readText: (path) => Promise.resolve(files[path]),
    writeText: () => Promise.reject(new Error("write not used")),
    readBytes: (path) => {
      const text = files[path];
      return Promise.resolve(text === undefined ? undefined : new TextEncoder().encode(text));
    },
    writeBytes: () => Promise.reject(new Error("write not used")),
    stat: (path) => Promise.resolve(files[path] === undefined ? undefined : { modifiedAt: 1000 }),
    ensureDirectory: () => Promise.resolve(),
    listFiles: () => Promise.resolve(Object.keys(files).filter((path) => !path.includes("/"))),
    remove: () => Promise.reject(new Error("remove not used")),
  };
}

test("keymap.yamlが無くてもworkspaceは開きMacを読む", async () => {
  const probe = await probeStore(fakeStore({ [macKeymapPath("jis")]: jisYaml }));
  ok(probe.kind === "ready");
  strictEqual(probe.model.cornix.kind, "missing");
  ok(probe.model.mac.jis.kind === "ready");
  strictEqual(probe.model.mac.ansi.kind, "missing");
  const target = defaultEditTarget(probe.model);
  ok(target.kind === "mac");
  strictEqual(target.layout, "jis");
});

test("壊れたkeymap.yamlはcornix errorに閉じMac編集を止めない", async () => {
  const probe = await probeStore(
    fakeStore({
      "keymap.yaml": "not: valid: yaml: [",
      [macKeymapPath("jis")]: jisYaml,
    }),
  );
  ok(probe.kind === "ready");
  ok(probe.model.cornix.kind === "error");
  ok(probe.model.mac.jis.kind === "ready");
});

test("改名前のcornix/を指すkeymap.yamlはlegacy-layoutとして移行を提示する", async () => {
  const plan = await planWorkspaceInit(
    parseVil(readFileSync("fixtures/cornix-lp/baseline.vil", "utf8")),
    readFileSync("fixtures/cornix-lp/vial-definition-v1.12.json", "utf8"),
    webcrypto,
  );
  const legacyPath = plan.definitionPath.replace("keysync/definitions/", "cornix/definitions/");
  const probe = await probeStore(
    fakeStore({
      "keymap.yaml": plan.keymapText.replace(plan.definitionPath, legacyPath),
      [legacyPath]: plan.definitionText,
      [macKeymapPath("jis")]: jisYaml,
    }),
  );
  ok(probe.kind === "ready");
  ok(probe.model.cornix.kind === "legacy-layout");
  strictEqual(probe.model.cornix.migration.previousPath, legacyPath);
  strictEqual(probe.model.cornix.migration.definitionPath, plan.definitionPath);
  ok(probe.model.mac.jis.kind === "ready");
});
