/**
 * ローカルサーバーの Mac 適用 API の検証。
 *
 * kanata は必ず偽物を注入する。実物を通すと、test を回しただけで常駐している kanata が
 * reload される。
 */

import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { copyFile, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parseMacKeymapYaml } from "../core/mac-keymap/parse.ts";
import type { MacKeyboardLayout } from "../core/mac-keymap/types.ts";
import type { KanataHost, KanataReload, KanataResult } from "../kanata/node.ts";
import { macKeymapDigest } from "../workspace/mac-keymap-file.ts";
import { createMacApi } from "./mac-api.ts";
import { MAC_API } from "./protocol.ts";

const FIXTURES = join(import.meta.dirname, "../../fixtures/mac-keyboard");

interface Setup {
  readonly root: string;
  readonly config: string;
  readonly digest: string;
  readonly calls: string[];
  readonly api: ReturnType<typeof createMacApi>;
}

async function setup(
  options: {
    readonly machine?: MacKeyboardLayout | undefined;
    readonly check?: KanataResult;
    readonly reload?: KanataReload;
    readonly absent?: boolean;
  } = {},
): Promise<Setup> {
  const root = await mkdtemp(join(tmpdir(), "keysync-mac-api-"));
  await copyFile(join(FIXTURES, "desired.yaml"), join(root, "mac-keyboard.jis.yaml"));
  const karabiner = join(root, "karabiner.json");
  await copyFile(join(FIXTURES, "karabiner-baseline.json"), karabiner);
  const text = await readFile(join(root, "mac-keyboard.jis.yaml"), "utf8");
  const digest = await macKeymapDigest(parseMacKeymapYaml(text), webcrypto);

  const calls: string[] = [];
  const absent = options.absent === true;
  const host: KanataHost = {
    async check(path) {
      calls.push(`check ${path}`);
      return absent ? undefined : (options.check ?? { ok: true, output: "config file is valid" });
    },
    async reload() {
      calls.push("reload");
      return options.reload ?? { kind: "reloaded" };
    },
    async reachable() {
      return !absent;
    },
    async binary() {
      return absent ? undefined : "/opt/homebrew/bin/kanata";
    },
  };
  const machine = "machine" in options ? options.machine : "jis";
  const config = join(root, "live", "kanata.kbd");
  const api = createMacApi({
    root,
    config,
    karabiner,
    host,
    detectLayout: async () => machine,
    crypto: webcrypto,
  });
  return { root, config, digest, calls, api };
}

test("status はこのマシンの配列と workspace を返す", async () => {
  const { api, root } = await setup({ machine: "ansi" });
  deepStrictEqual(await api(MAC_API.status, {}), {
    kind: "status",
    workspace: root,
    layout: "ansi",
  });
});

test("編集中の配列とこのマシンの配列が違えば計画を組まない", async () => {
  const { api, digest, root } = await setup({ machine: "ansi" });
  deepStrictEqual(await api(MAC_API.plan, { layout: "jis", digest }), {
    kind: "layout-mismatch",
    machine: "ansi",
    requested: "jis",
  });
  deepStrictEqual(await readdir(root), ["karabiner.json", "mac-keyboard.jis.yaml"]);
});

test("配列を検出できなければ止める", async () => {
  const { api, digest } = await setup({ machine: undefined });
  const result = await api(MAC_API.plan, { layout: "jis", digest });
  strictEqual(result?.kind, "layout-mismatch");
});

test("画面の内容とディスクの内容が違えば止める", async () => {
  const { api, root } = await setup();
  deepStrictEqual(await api(MAC_API.plan, { layout: "jis", digest: "0".repeat(64) }), {
    kind: "digest-mismatch",
    path: join(root, "mac-keyboard.jis.yaml"),
  });
});

test("コメントや並びが違っても同じ設定なら digest は一致する", async () => {
  const { api, root, digest } = await setup();
  const path = join(root, "mac-keyboard.jis.yaml");
  await writeFile(path, `# 手で足したコメント\n${await readFile(path, "utf8")}`);
  strictEqual((await api(MAC_API.plan, { layout: "jis", digest }))?.kind, "planned");
});

test("plan は差分と fingerprint を返し、kanata の設定に触れない", async () => {
  const { api, digest, root } = await setup();
  const result = await api(MAC_API.plan, { layout: "jis", digest });
  strictEqual(result?.kind, "planned");
  if (result?.kind !== "planned") return;
  ok(result.fingerprint.startsWith("v1-"));
  ok(result.entries.some((entry) => entry.layer === 0 && entry.keyCode === "caps_lock"));
  strictEqual(result.running, true);
  // baseline の karabiner.json は内蔵キーボードを ignore していない。
  ok(result.diagnostics.some((one) => one.code === "mac-keymap/karabiner-grabs-built-in"));
  deepStrictEqual((await readdir(root)).includes("live"), false);
});

test("kanata が入っていなければ計画の段階で止める", async () => {
  const { api, digest } = await setup({ absent: true });
  deepStrictEqual(await api(MAC_API.plan, { layout: "jis", digest }), {
    kind: "kanata-missing",
  });
});

test("kanata --check が通らなければ止める", async () => {
  const { api, digest } = await setup({ check: { ok: false, output: "bad config" } });
  deepStrictEqual(await api(MAC_API.plan, { layout: "jis", digest }), {
    kind: "check-failed",
    output: "bad config",
  });
});

test("fingerprint が違えば書かずに新しい計画を返す", async () => {
  const { api, digest, root } = await setup();
  const result = await api(MAC_API.apply, { layout: "jis", digest, fingerprint: "v1-0-0" });
  strictEqual(result?.kind, "fingerprint-mismatch");
  deepStrictEqual((await readdir(root)).includes("live"), false);
});

async function applyPlanned(setupResult: Setup) {
  const { api, digest } = setupResult;
  const planned = await api(MAC_API.plan, { layout: "jis", digest });
  if (planned?.kind !== "planned") throw new Error(planned?.kind);
  return await api(MAC_API.apply, { layout: "jis", digest, fingerprint: planned.fingerprint });
}

test("同じ fingerprint なら書き込み、reload させる。2 回目は前の設定を backup する", async () => {
  const context = await setup();
  const first = await applyPlanned(context);
  deepStrictEqual(first, { kind: "applied", backup: null, reloaded: true });
  const written = await readFile(context.config, "utf8");
  ok(written.includes("(deflayermap (base)"));
  ok(context.calls.includes("reload"));

  const second = await applyPlanned(context);
  strictEqual(second?.kind, "applied");
  if (second?.kind !== "applied" || second.backup === null) throw new Error("backup が無い");
  strictEqual(await readFile(join(context.root, second.backup), "utf8"), written);
});

test("kanata が常駐していなければ書いたうえで reloaded を false にする", async () => {
  const context = await setup({ reload: { kind: "not-running" } });
  deepStrictEqual(await applyPlanned(context), { kind: "applied", backup: null, reloaded: false });
});

test("reload だけが失敗したら巻き戻さない", async () => {
  const context = await setup({ reload: { kind: "failed", output: "reload failed" } });
  deepStrictEqual(await applyPlanned(context), {
    kind: "reload-failed",
    backup: null,
    output: "reload failed",
  });
  ok((await readFile(context.config, "utf8")).startsWith(";; KeySync"));
});

test("error のある設定は適用しない", async () => {
  const { api, root } = await setup();
  const path = join(root, "mac-keyboard.jis.yaml");
  const text = (await readFile(path, "utf8")).replace('"KC_HOME"', '"NOT_A_KEYCODE"');
  await writeFile(path, text);
  const digest = await macKeymapDigest(parseMacKeymapYaml(text), webcrypto);
  const result = await api(MAC_API.plan, { layout: "jis", digest });
  strictEqual(result?.kind, "invalid");
});

test("本文が壊れていれば failed を返し、知らない path には undefined を返す", async () => {
  const { api } = await setup();
  strictEqual((await api(MAC_API.plan, { layout: "iso", digest: "x" }))?.kind, "failed");
  strictEqual(await api("/api/mac/unknown", {}), undefined);
});
