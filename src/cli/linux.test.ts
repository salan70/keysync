/**
 * `keysync linux` の検証。
 *
 * keyd と sudo は必ず偽物を注入する。実物を通すと開発機の `/etc/keyd/` が書き換わる。
 */

import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import { copyFile, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parseInputDevices } from "../linux/input-devices.ts";
import type { KeydHost, KeydResult } from "../linux/keyd.ts";
import { main } from "./main.ts";

const FIXTURES = join(import.meta.dirname, "../../fixtures/linux-keyboard");

interface FakeKeydHost extends KeydHost {
  readonly calls: string[];
}

/** `install` は実際にファイルを置く。verify が読み直せるようにするため。 */
function fakeKeydHost(
  options: {
    readonly check?: KeydResult;
    readonly absent?: boolean;
    readonly reload?: KeydResult;
  } = {},
): FakeKeydHost {
  const calls: string[] = [];
  return {
    calls,
    async check(path) {
      calls.push(`check ${path}`);
      return options.absent === true ? undefined : (options.check ?? { ok: true, output: "" });
    },
    async install(source, target) {
      calls.push(`install ${target}`);
      await writeFile(target, await readFile(source, "utf8"));
      return { ok: true, output: "" };
    },
    async reload() {
      calls.push("reload");
      return options.reload ?? { ok: true, output: "" };
    },
  };
}

async function workspace(): Promise<{ readonly root: string; readonly config: string }> {
  const root = await mkdtemp(join(tmpdir(), "keysync-linux-"));
  await copyFile(join(FIXTURES, "desired.yaml"), join(root, "linux-keyboard.jis.yaml"));
  return { root, config: join(root, "keysync.conf") };
}

/** stdout の JSON を 1 つ取り出す。 */
async function run(argv: readonly string[], host: KeydHost): Promise<{ code: number; out: any }> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (value: unknown) => lines.push(String(value));
  try {
    const code = await main([...argv], { keydHost: host });
    return { code, out: lines.length === 0 ? undefined : JSON.parse(lines.join("\n")) };
  } finally {
    console.log = original;
  }
}

test("/proc/bus/input/devices から kbd を持つデバイスを 1 台 1 件で取り出す", async () => {
  const keyboards = parseInputDevices(await readFile(join(FIXTURES, "input-devices.txt"), "utf8"));
  deepStrictEqual(
    keyboards.map((keyboard) => keyboard.name),
    ["Power Button", "Apple Inc. Apple Internal Keyboard / Trackpad", "Cornix LP Keyboard"],
  );
  deepStrictEqual(keyboards[1], {
    name: "Apple Inc. Apple Internal Keyboard / Trackpad",
    vendorId: 0x05ac,
    productId: 0x027e,
  });
});

test("devices --add は設定が無ければ作り、16 進の id を登録する", async () => {
  const root = await mkdtemp(join(tmpdir(), "keysync-linux-"));
  const host = fakeKeydHost();
  const { code, out } = await run(
    ["linux", "devices", "--workspace", root, "--layout", "jis", "--add", "05ac:027e"],
    host,
  );
  strictEqual(code, 0);
  strictEqual(out.created, true);
  const text = await readFile(join(root, "linux-keyboard.jis.yaml"), "utf8");
  ok(text.includes("- { vendor_id: 1452, product_id: 638 }"));
});

test("devices は観測したキーボードと登録状況を出す", async () => {
  const { root } = await workspace();
  const { out } = await run(
    ["linux", "devices", "--workspace", root, "--devices", join(FIXTURES, "input-devices.txt")],
    fakeKeydHost(),
  );
  const apple = out.observed.find((one: any) => one.identifier === "05ac:027e");
  strictEqual(apple.registered, true);
  strictEqual(out.layout, "jis");
});

test("apply は --confirm が無ければ書かずに fingerprint を出す", async () => {
  const { root, config } = await workspace();
  const host = fakeKeydHost();
  const { code, out } = await run(
    ["linux", "apply", "--workspace", root, "--config", config],
    host,
  );
  strictEqual(code, 0);
  strictEqual(out.present, false);
  ok(out.confirm.startsWith("keysync linux apply --confirm v1-"));
  deepStrictEqual(host.calls, [`check ${join(root, "keysync/generated/keyd.conf")}`]);
  strictEqual(
    await readFile(join(root, "keysync/generated/keyd.conf"), "utf8"),
    await readFile(join(FIXTURES, "keysync.conf"), "utf8"),
  );
});

test("apply --confirm は backup → install → reload → verify の順で適用する", async () => {
  const { root, config } = await workspace();
  await writeFile(config, "# 以前の設定\n[ids]\n\nk:05ac:027e\n");
  const host = fakeKeydHost();
  const planned = await run(["linux", "apply", "--workspace", root, "--config", config], host);
  const { code, out } = await run(
    [
      "linux",
      "apply",
      "--workspace",
      root,
      "--config",
      config,
      "--confirm",
      planned.out.fingerprint,
    ],
    host,
  );
  strictEqual(code, 0);
  strictEqual(out.verify, true);
  deepStrictEqual(host.calls.slice(-3), [
    `check ${join(root, "keysync/generated/keyd.conf")}`,
    `install ${config}`,
    "reload",
  ]);
  const backups = await readdir(join(root, "keysync/backups"));
  strictEqual(backups.length, 1);
  ok(backups[0]?.startsWith("keyd-"));
  strictEqual(
    await readFile(config, "utf8"),
    await readFile(join(FIXTURES, "keysync.conf"), "utf8"),
  );
});

test("fingerprint が違う・keyd が無い・check が落ちるときは書かない", async () => {
  const { root, config } = await workspace();
  const base = ["linux", "apply", "--workspace", root, "--config", config];
  const planned = await run(base, fakeKeydHost());

  const wrong = fakeKeydHost();
  strictEqual((await run([...base, "--confirm", "v1-0-0"], wrong)).code, 1);
  const absent = fakeKeydHost({ absent: true });
  strictEqual((await run([...base, "--confirm", planned.out.fingerprint], absent)).code, 1);
  const failing = fakeKeydHost({ check: { ok: false, output: "bad" } });
  strictEqual((await run([...base, "--confirm", planned.out.fingerprint], failing)).code, 1);
  for (const host of [wrong, absent, failing]) {
    ok(!host.calls.includes("reload"));
  }
});

test("reload が失敗したら非 0 で終わる", async () => {
  const { root, config } = await workspace();
  const base = ["linux", "apply", "--workspace", root, "--config", config];
  const planned = await run(base, fakeKeydHost());
  const host = fakeKeydHost({ reload: { ok: false, output: "failed" } });
  strictEqual((await run([...base, "--confirm", planned.out.fingerprint], host)).code, 1);
});

test("devices が空の設定は適用しない", async () => {
  const root = await mkdtemp(join(tmpdir(), "keysync-linux-"));
  await writeFile(
    join(root, "linux-keyboard.jis.yaml"),
    "schema: keysync/linux-keymap@1\nlayout: jis\ndevices:\nlayers:\n  0:\n",
  );
  const host = fakeKeydHost();
  const { code } = await run(["linux", "apply", "--workspace", root], host);
  strictEqual(code, 1);
  deepStrictEqual(host.calls, []);
});
