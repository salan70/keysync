/**
 * `keysync mac` の検証。
 *
 * kanata と launchd には依存しない。CI の macOS runner では動かせないため、偽物を注入する。
 * `kanata --check` を通ることの確認は、kanata が入っている開発機の test で行う（ADR 0049）。
 */

import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { main } from "./main.ts";
import type { KanataHost, KanataReload, KanataResult } from "../kanata/node.ts";
import type { ServiceHost, ServiceResult } from "../kanata/service.ts";
import type { KeyRecorder, KeyRecording } from "../mac/key-recorder.ts";
import { parseKeyLog } from "../core/typing-log/format.ts";

const FIXTURES = join(import.meta.dirname, "../../fixtures/mac-keyboard");

/** `mac-keyboard.jis.yaml` と `karabiner.json` を置いた一時 workspace。kanata の設定はまだ無い。 */
async function workspace(name = "mac-keyboard.jis.yaml"): Promise<{
  readonly root: string;
  readonly karabiner: string;
  readonly desired: string;
  readonly config: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "keysync-mac-"));
  const desired = join(root, name);
  await copyFile(join(FIXTURES, "desired.yaml"), desired);
  const karabiner = join(root, "karabiner.json");
  await copyFile(join(FIXTURES, "karabiner-baseline.json"), karabiner);
  return { root, karabiner, desired, config: join(root, "live", "kanata.kbd") };
}

/**
 * kanata の偽物。呼び出しを記録する。
 *
 * **既定で必ず注入する。** 実物を通すと、開発機で test を回しただけで常駐している kanata が
 * reload される。`absent` は kanata が入っていない環境（CI の macOS runner）を表す。
 */
function fakeKanataHost(
  options: {
    readonly check?: KanataResult;
    readonly reload?: KanataReload;
    readonly running?: boolean;
    readonly absent?: boolean;
  } = {},
): KanataHost & { readonly calls: string[] } {
  const calls: string[] = [];
  const absent = options.absent === true;
  return {
    calls,
    async check(path) {
      calls.push(`check ${path}`);
      return absent ? undefined : (options.check ?? { ok: true, output: "config file is valid" });
    },
    async reload() {
      calls.push("reload");
      return options.reload ?? { kind: "reloaded" };
    },
    async reachable() {
      return options.running ?? true;
    },
    async binary() {
      return absent ? undefined : "/opt/homebrew/bin/kanata";
    },
  };
}

/** launchd の偽物。呼び出しを記録する。 */
function fakeServiceHost(
  options: { readonly installed?: boolean; readonly install?: ServiceResult } = {},
): ServiceHost & { readonly calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async installed() {
      return options.installed ?? false;
    },
    async install(source) {
      calls.push(`install ${source}`);
      return options.install ?? { ok: true, output: "" };
    },
    async bootstrap() {
      calls.push("bootstrap");
      return { ok: true, output: "" };
    },
  };
}

/** `console.log` を捕まえる。CLI は JSON を stdout へ出すだけなので、これで十分に読める。 */
async function capture(
  argv: readonly string[],
  host: KanataHost = fakeKanataHost({ absent: true }),
  service: ServiceHost = fakeServiceHost(),
): Promise<{ code: number; out: string }> {
  const lines: string[] = [];
  const original = console.log;
  const originalError = console.error;
  console.log = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
  console.error = () => {};
  try {
    const code = await main([...argv], { kanataHost: host, serviceHost: service });
    return { code, out: lines.join("\n") };
  } finally {
    console.log = original;
    console.error = originalError;
  }
}

/** CLI が stdout へ出す JSON のうち、test が読む範囲だけを型にする。 */
interface MacOutput {
  readonly workspace?: string;
  readonly output?: string;
  readonly generated?: string;
  readonly check?: { readonly ok: boolean } | null;
  readonly summary?: { readonly error: number };
  readonly diagnostics?: readonly { readonly code: string }[];
  readonly fingerprint?: string;
  readonly confirm?: string;
  readonly backup?: string | null;
  readonly changed?: boolean;
  readonly entries?: readonly { readonly layer: number | null; readonly keyCode: string }[];
  readonly verify?: boolean;
  readonly reload?: KanataReload | null;
  readonly next?: string;
  readonly installed?: boolean;
  readonly running?: boolean;
  readonly configPresent?: boolean;
  readonly karabinerGrabsBuiltIn?: boolean;
}

async function captureJson(
  argv: readonly string[],
  host?: KanataHost,
  service?: ServiceHost,
): Promise<{ readonly code: number; readonly json: MacOutput }> {
  const { code, out } = await capture(argv, host, service);
  return { code, json: JSON.parse(out) as MacOutput };
}

test("mac generate はkeysync/generated/へkanataの設定を書き、kanataがあればcheckする", async () => {
  const { root } = await workspace();
  const host = fakeKanataHost();
  const { code, json } = await captureJson(
    ["mac", "generate", "--layout", "jis", "--workspace", root],
    host,
  );

  strictEqual(code, 0);
  strictEqual(json.output, "keysync/generated/kanata.kbd");
  deepStrictEqual(json.diagnostics, []);
  deepStrictEqual(host.calls, [`check ${join(root, "keysync/generated/kanata.kbd")}`]);
  const text = await readFile(join(root, String(json.output)), "utf8");
  strictEqual(text.includes("(deflayermap (base)"), true);
  strictEqual(text.includes("caps (tap-hold-opposite-hand-release"), true);
});

test("kanata --checkが通らなければgenerateは1で終わる", async () => {
  const { root } = await workspace();
  const { code, json } = await captureJson(
    ["mac", "generate", "--layout", "jis", "--workspace", root],
    fakeKanataHost({ check: { ok: false, output: "error" } }),
  );
  strictEqual(code, 1);
  strictEqual(json.check?.ok, false);
});

test("errorのあるdesired stateはgenerateしない", async () => {
  const { root, desired } = await workspace();
  await writeFile(
    desired,
    'schema: keysync/mac-keymap@1\nprofile: "KeySync"\nlayers:\n  0:\n    "a": "TD(0)"\n',
    "utf8",
  );
  const { code, json } = await captureJson([
    "mac",
    "generate",
    "--layout",
    "jis",
    "--workspace",
    root,
  ]);
  strictEqual(code, 1);
  strictEqual(json.summary?.error, 1);
  deepStrictEqual(await readdir(join(root)), ["karabiner.json", "mac-keyboard.jis.yaml"]);
});

test("mac diffはkanataの設定を書かず、Karabinerが内蔵キーボードを掴むことを診断に出す", async () => {
  const { root, karabiner, config } = await workspace();
  const { code, json } = await captureJson([
    "mac",
    "diff",
    "--layout",
    "jis",
    "--workspace",
    root,
    "--karabiner",
    karabiner,
    "--config",
    config,
  ]);

  strictEqual(code, 0);
  strictEqual(json.changed, true);
  strictEqual((json.entries?.length ?? 0) > 0, true);
  strictEqual(
    json.diagnostics?.some((one) => one.code === "mac-keymap/karabiner-grabs-built-in"),
    true,
  );
  deepStrictEqual(await readdir(root), ["karabiner.json", "mac-keyboard.jis.yaml"]);
});

test("mac applyは--confirmが無ければ書かない", async () => {
  // 人間が中身を見てから同じfingerprintを渡したときだけ書き込む。
  const { root, karabiner, config } = await workspace();
  const host = fakeKanataHost();
  const { code, json } = await captureJson(
    [
      "mac",
      "apply",
      "--layout",
      "jis",
      "--workspace",
      root,
      "--karabiner",
      karabiner,
      "--config",
      config,
    ],
    host,
  );

  strictEqual(code, 0);
  strictEqual(json.confirm, `keysync mac apply --confirm ${json.fingerprint}`);
  strictEqual(json.check?.ok, true);
  deepStrictEqual(await readdir(root), ["karabiner.json", "keysync", "mac-keyboard.jis.yaml"]);
  strictEqual(host.calls.includes("reload"), false);
});

test("fingerprintが一致しないapplyは書かずに落ちる", async () => {
  const { root, karabiner, config } = await workspace();
  const { code } = await capture(
    [
      "mac",
      "apply",
      "--layout",
      "jis",
      "--workspace",
      root,
      "--karabiner",
      karabiner,
      "--config",
      config,
      "--confirm",
      "v1-00000000-00000000",
    ],
    fakeKanataHost(),
  );
  strictEqual(code, 1);
  deepStrictEqual(await readdir(root), ["karabiner.json", "keysync", "mac-keyboard.jis.yaml"]);
});

async function planned(
  root: string,
  karabiner: string,
  config: string,
  host: KanataHost,
): Promise<string> {
  const { json } = await captureJson(
    [
      "mac",
      "apply",
      "--layout",
      "jis",
      "--workspace",
      root,
      "--karabiner",
      karabiner,
      "--config",
      config,
    ],
    host,
  );
  return String(json.fingerprint);
}

test("applyは設定を書き、読み直してverifyし、kanataにreloadさせる", async () => {
  const { root, karabiner, config } = await workspace();
  const host = fakeKanataHost();
  const fingerprint = await planned(root, karabiner, config, host);
  const argv = [
    "mac",
    "apply",
    "--layout",
    "jis",
    "--workspace",
    root,
    "--karabiner",
    karabiner,
    "--config",
    config,
    "--confirm",
    fingerprint,
  ];

  const first = await captureJson(argv, host);
  strictEqual(first.code, 0);
  // 初回は置き換える前のファイルが無いので backup も無い。
  strictEqual(first.json.backup, null);
  strictEqual(first.json.verify, true);
  deepStrictEqual(first.json.reload, { kind: "reloaded" });
  const written = await readFile(config, "utf8");
  strictEqual(
    written,
    await readFile(join(root, "keysync/generated/kanata.kbd"), "utf8"),
    "生成物と同じ内容を書く",
  );

  // 2 回目は同じ内容で、置き換える前のファイルを backup する。
  const again = await captureJson(
    argv.slice(0, -1).concat(await planned(root, karabiner, config, host)),
    host,
  );
  strictEqual(again.code, 0);
  strictEqual(again.json.backup?.startsWith("keysync/backups/kanata-"), true);
  strictEqual(await readFile(join(root, String(again.json.backup)), "utf8"), written);
});

test("kanataが常駐していなければ書いたうえで登録を案内する", async () => {
  const { root, karabiner, config } = await workspace();
  const host = fakeKanataHost({ reload: { kind: "not-running" } });
  const fingerprint = await planned(root, karabiner, config, host);
  const { code, json } = await captureJson(
    [
      "mac",
      "apply",
      "--layout",
      "jis",
      "--workspace",
      root,
      "--karabiner",
      karabiner,
      "--config",
      config,
      "--confirm",
      fingerprint,
    ],
    host,
  );
  strictEqual(code, 0);
  deepStrictEqual(json.reload, { kind: "not-running" });
  strictEqual(json.next?.includes("keysync mac service install"), true);
});

test("reloadに失敗したら1で終わる。書いた設定は巻き戻さない", async () => {
  const { root, karabiner, config } = await workspace();
  const host = fakeKanataHost({ reload: { kind: "failed", output: "boom" } });
  const fingerprint = await planned(root, karabiner, config, host);
  const { code } = await capture(
    [
      "mac",
      "apply",
      "--layout",
      "jis",
      "--workspace",
      root,
      "--karabiner",
      karabiner,
      "--config",
      config,
      "--confirm",
      fingerprint,
    ],
    host,
  );
  strictEqual(code, 1);
  strictEqual((await readFile(config, "utf8")).startsWith(";; KeySync"), true);
});

test("kanataが無ければ確認してもapplyしない", async () => {
  const { root, karabiner, config } = await workspace();
  const host = fakeKanataHost({ absent: true });
  const fingerprint = await planned(root, karabiner, config, host);
  const { code } = await capture(
    [
      "mac",
      "apply",
      "--layout",
      "jis",
      "--workspace",
      root,
      "--karabiner",
      karabiner,
      "--config",
      config,
      "--confirm",
      fingerprint,
    ],
    host,
  );
  strictEqual(code, 1);
  deepStrictEqual(await readdir(root), ["karabiner.json", "keysync", "mac-keyboard.jis.yaml"]);
});

test("errorのあるdesired stateは適用しない", async () => {
  const { root, karabiner, desired, config } = await workspace();
  await writeFile(
    desired,
    'schema: keysync/mac-keymap@1\nprofile: "KeySync"\nlayers:\n  0:\n    "a": "TD(0)"\n',
    "utf8",
  );
  const { code } = await capture(
    [
      "mac",
      "apply",
      "--layout",
      "jis",
      "--workspace",
      root,
      "--karabiner",
      karabiner,
      "--config",
      config,
    ],
    fakeKanataHost(),
  );
  strictEqual(code, 1);
  deepStrictEqual(await readdir(root), ["karabiner.json", "mac-keyboard.jis.yaml"]);
});

test("mac service status は登録と常駐の状態を出し、何も書かない", async () => {
  const { root, karabiner, config } = await workspace();
  const service = fakeServiceHost({ installed: true });
  const { code, json } = await captureJson(
    [
      "mac",
      "service",
      "--layout",
      "jis",
      "--workspace",
      root,
      "--karabiner",
      karabiner,
      "--config",
      config,
    ],
    fakeKanataHost({ running: false }),
    service,
  );
  strictEqual(code, 0);
  strictEqual(json.installed, true);
  strictEqual(json.running, false);
  strictEqual(json.configPresent, false);
  strictEqual(json.karabinerGrabsBuiltIn, true);
  deepStrictEqual(service.calls, []);
});

test("mac service install は設定が無ければ登録しない", async () => {
  const { root, karabiner, config } = await workspace();
  const service = fakeServiceHost();
  const { code } = await capture(
    [
      "mac",
      "service",
      "install",
      "--layout",
      "jis",
      "--workspace",
      root,
      "--karabiner",
      karabiner,
      "--config",
      config,
    ],
    fakeKanataHost(),
    service,
  );
  strictEqual(code, 1);
  deepStrictEqual(service.calls, []);
});

test("mac service install はplistを生成してから登録する", async () => {
  const { root, karabiner, config } = await workspace();
  const host = fakeKanataHost();
  const fingerprint = await planned(root, karabiner, config, host);
  await capture(
    [
      "mac",
      "apply",
      "--layout",
      "jis",
      "--workspace",
      root,
      "--karabiner",
      karabiner,
      "--config",
      config,
      "--confirm",
      fingerprint,
    ],
    host,
  );
  const service = fakeServiceHost();
  const { code } = await capture(
    [
      "mac",
      "service",
      "install",
      "--layout",
      "jis",
      "--workspace",
      root,
      "--karabiner",
      karabiner,
      "--config",
      config,
    ],
    host,
    service,
  );
  strictEqual(code, 0);
  const plist = join(root, "keysync/generated/dev.keysync.kanata.plist");
  deepStrictEqual(service.calls, [`install ${plist}`, "bootstrap"]);
  const text = await readFile(plist, "utf8");
  strictEqual(text.includes(`<string>${config}</string>`), true);
  strictEqual(text.includes("<string>/opt/homebrew/bin/kanata</string>"), true);
});

test("その配列の設定が無ければkeymap.yamlを探さずに落ちる", async () => {
  const root = await mkdtemp(join(tmpdir(), "keysync-mac-"));
  const { code } = await capture(["mac", "generate", "--layout", "jis", "--workspace", root]);
  strictEqual(code, 1);
});

test("旧名のmac-keyboard.yamlはlayout宣言が一致する配列として読む", async () => {
  const { root } = await workspace("mac-keyboard.yaml");
  const jis = await captureJson(["mac", "generate", "--layout", "jis", "--workspace", root]);
  strictEqual(jis.code, 0);
  // 宣言は jis なので、ansi を求められても使わない。
  const ansi = await capture(["mac", "generate", "--layout", "ansi", "--workspace", root]);
  strictEqual(ansi.code, 1);
});

test("ファイル名と食い違うlayout宣言は落ちる", async () => {
  const { root } = await workspace("mac-keyboard.ansi.yaml");
  const { code } = await capture(["mac", "generate", "--layout", "ansi", "--workspace", root]);
  strictEqual(code, 1);
});

test("--layoutが未対応の値なら落ちる", async () => {
  const { root } = await workspace();
  strictEqual((await capture(["mac", "generate", "--layout", "iso", "--workspace", root])).code, 1);
});

test("未知のmacサブコマンドは落ちる", async () => {
  const { root } = await workspace();
  strictEqual((await capture(["mac", "devices", "--layout", "jis", "--workspace", root])).code, 1);
});

test("macの出力は解決済みのworkspaceを必ず載せる", async () => {
  const { root, karabiner, config } = await workspace();
  for (const argv of [
    ["mac", "generate", "--layout", "jis", "--workspace", root],
    [
      "mac",
      "diff",
      "--layout",
      "jis",
      "--workspace",
      root,
      "--karabiner",
      karabiner,
      "--config",
      config,
    ],
    [
      "mac",
      "apply",
      "--layout",
      "jis",
      "--workspace",
      root,
      "--karabiner",
      karabiner,
      "--config",
      config,
    ],
    [
      "mac",
      "service",
      "--layout",
      "jis",
      "--workspace",
      root,
      "--karabiner",
      karabiner,
      "--config",
      config,
    ],
  ]) {
    const { json } = await captureJson(argv);
    strictEqual(json.workspace, root);
  }
});

/** 固定の打鍵を返すレコーダー。実物は入力監視の許可と実際の打鍵が要る。 */
function fakeKeyRecorder(
  recording: Partial<KeyRecording> = {},
  options: { readonly waitForStop?: boolean } = {},
): KeyRecorder & {
  readonly calls: number[];
} {
  const calls: number[] = [];
  return {
    calls,
    async record({ seconds, stop }, onStart) {
      calls.push(seconds);
      onStart();
      // 課題つき記録は、課題を進め終えて CLI が止めるまで記録し続ける。
      if (options.waitForStop === true) await stop;
      return {
        originNs: "1000",
        hidOpened: ["Karabiner DriverKit VirtualHIDKeyboard 1.8.0"],
        hidBlocked: ["Apple Internal Keyboard / Trackpad"],
        hidNotPermitted: false,
        tapOk: true,
        warnings: [],
        events: [
          // caps_lock の mod-tap（LCTL_T(KC_ESC)）の tap が 4ms の合成で出た。
          { type: "hid", ns: 0, usage: 0x29, down: true, device: "Karabiner" },
          { type: "hid", ns: 4_000_000, usage: 0x29, down: false, device: "Karabiner" },
          { type: "os", ns: 0, kind: "down", keycode: 53, flags: 256, chars: "", repeat: false },
        ],
        ...recording,
      };
    },
  };
}

async function captureRecord(
  argv: readonly string[],
  recorder: KeyRecorder,
  input?: NodeJS.ReadableStream,
): Promise<{ readonly code: number; readonly json: Record<string, unknown> }> {
  const lines: string[] = [];
  const original = console.log;
  const originalError = console.error;
  console.log = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
  console.error = () => {};
  try {
    const code = await main([...argv], {
      kanataHost: fakeKanataHost({ absent: true }),
      keyRecorder: recorder,
      now: () => new Date("2026-09-27T01:02:03.456Z"),
      ...(input === undefined ? {} : { input }),
    });
    return { code, json: JSON.parse(lines.join("\n")) as Record<string, unknown> };
  } finally {
    console.log = original;
    console.error = originalError;
  }
}

test("mac record --free は打鍵ログを typing-logs/ へ書き、効いている閾値と判定の推定を出す", async () => {
  const { root, karabiner, config } = await workspace();
  const recorder = fakeKeyRecorder();
  const { code, json } = await captureRecord(
    [
      "mac",
      "record",
      "--free",
      "5",
      "--layout",
      "jis",
      "--workspace",
      root,
      "--karabiner",
      karabiner,
      "--config",
      config,
    ],
    recorder,
  );
  strictEqual(code, 0);
  deepStrictEqual(recorder.calls, [5]);
  strictEqual(json.log, "keysync/typing-logs/2026-09-27T01-02-03-456Z-cli.jsonl");
  // kanata の設定がまだ無いので、効いている閾値は分からない。
  strictEqual(json.tappingTermMs, null);
  // 設定があれば、そこに書かれた閾値を効いている閾値として残す。
  await mkdir(dirname(config), { recursive: true });
  await writeFile(config, "(defvar tapping-term 170)\n", "utf8");
  const again = await captureRecord(
    ["mac", "record", "--free", "5", "--layout", "jis", "--workspace", root, "--config", config],
    fakeKeyRecorder(),
  );
  strictEqual(again.json.tappingTermMs, 170);
  const log = parseKeyLog(await readFile(join(root, String(json.log)), "utf8"));
  strictEqual(log.meta.recorder, "cli");
  strictEqual(log.meta.originNs, "1000");
  strictEqual(log.events.length, 3);
  const analysis = json.analysis as { readonly taps: readonly { readonly position: string }[] };
  deepStrictEqual(
    analysis.taps.map((one) => one.position),
    ["caps_lock"],
  );
});

test("mac record はどちらの層も読めなければ、入力監視の許可を案内して止まる", async () => {
  const { root, karabiner, config } = await workspace();
  const lines: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
  try {
    const code = await main(
      [
        "mac",
        "record",
        "--free",
        "--layout",
        "jis",
        "--workspace",
        root,
        "--karabiner",
        karabiner,
        "--config",
        config,
      ],
      {
        kanataHost: fakeKanataHost({ absent: true }),
        keyRecorder: fakeKeyRecorder({ hidOpened: [], tapOk: false, events: [] }),
      },
    );
    strictEqual(code, 1);
    strictEqual(
      lines.some((line) => line.includes("入力監視")),
      true,
    );
  } finally {
    console.error = originalError;
  }
});

test("mac record は課題を順に出し、Return で区切った区間を課題ごとに採点する", async () => {
  const { root, karabiner, config } = await workspace();
  const hid = (ms: number, usage: number, down: boolean) =>
    ({ type: "hid", ns: ms * 1_000_000, usage, down, device: "Karabiner" }) as const;
  // 1 つ目の課題は「ka」を ⌥A と誤爆してから「ki」を打ち、2 つ目は何も打たずに飛ばした。
  const events = [
    hid(0, 0xe2, true),
    hid(10, 0x04, true),
    hid(20, 0x04, false),
    hid(30, 0xe2, false),
    hid(40, 0x0e, true),
    hid(44, 0x0e, false),
    hid(50, 0x0c, true),
    hid(60, 0x0c, false),
    hid(100, 0x28, true),
    hid(104, 0x28, false),
    hid(200, 0x28, true),
    hid(204, 0x28, false),
  ];
  const recorder = fakeKeyRecorder({ events }, { waitForStop: true });
  const { code, json } = await captureRecord(
    [
      "mac",
      "record",
      "--tasks",
      "roll",
      "--layout",
      "jis",
      "--workspace",
      root,
      "--karabiner",
      karabiner,
      "--config",
      config,
    ],
    recorder,
    Readable.from(["åki\n", "\n"]),
  );
  strictEqual(code, 0);
  deepStrictEqual(recorder.calls, [1800]);
  const trials = json.trials as readonly {
    readonly taskId: string;
    readonly typed: string;
    readonly summary: {
      readonly misfire?: number;
      readonly ok?: number;
      readonly skipped?: boolean;
    };
  }[];
  deepStrictEqual(
    trials.map((one) => one.taskId),
    ["romaji-kg", "romaji-sdh"],
  );
  strictEqual(trials[0]?.typed, "åki");
  strictEqual(trials[0]?.summary.misfire, 1);
  strictEqual(trials[0]?.summary.ok, 2);
  strictEqual(trials[1]?.summary.skipped, true);
  const log = parseKeyLog(await readFile(join(root, String(json.log)), "utf8"));
  strictEqual(log.meta.trials?.length, 2);
});

test("mac record の --tasks は roll|hold|all だけを受ける", async () => {
  const { root, karabiner, config } = await workspace();
  const originalError = console.error;
  console.error = () => {};
  try {
    const code = await main(
      [
        "mac",
        "record",
        "--tasks",
        "some",
        "--layout",
        "jis",
        "--workspace",
        root,
        "--karabiner",
        karabiner,
        "--config",
        config,
      ],
      { kanataHost: fakeKanataHost({ absent: true }), keyRecorder: fakeKeyRecorder() },
    );
    strictEqual(code, 1);
  } finally {
    console.error = originalError;
  }
});
