/**
 * `keysync mac` の検証。
 *
 * `karabiner_cli` には依存しない。CI の macOS runner に入っていないため、
 * lint を通ることの確認はローカルで行う（ADR 0022）。
 */

import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { copyFile, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import { join } from "node:path";
import { test } from "node:test";
import { main } from "./main.ts";
import type { KarabinerCli, KarabinerCliResult } from "../karabiner/node.ts";
import type { KeyRecorder, KeyRecording } from "../mac/key-recorder.ts";
import { parseKeyLog } from "../core/typing-log/format.ts";

const FIXTURES = join(import.meta.dirname, "../../fixtures/mac-keyboard");

/** `mac-keyboard.jis.yaml` と `karabiner.json` を置いた一時 workspace。 */
async function workspace(
  name = "mac-keyboard.jis.yaml",
): Promise<{ readonly root: string; readonly karabiner: string; readonly desired: string }> {
  const root = await mkdtemp(join(tmpdir(), "cornix-mac-"));
  const desired = join(root, name);
  await copyFile(join(FIXTURES, "desired.yaml"), desired);
  const karabiner = join(root, "karabiner.json");
  await copyFile(join(FIXTURES, "karabiner-baseline.json"), karabiner);
  return { root, karabiner, desired };
}

/** 呼び出しを記録するだけの `karabiner_cli`。 */
interface FakeKarabinerCli extends KarabinerCli {
  readonly calls: string[];
}

/**
 * `karabiner_cli` の偽物。
 *
 * **既定で必ず注入する。** 実物を通すと、開発機で test を回しただけで
 * `--select-profile` が走り、動いている Karabiner の profile が切り替わる。
 *
 * `absent` は Karabiner が入っていない環境（CI の macOS runner）を表す。
 */
function fakeKarabinerCli(
  options: {
    readonly lint?: KarabinerCliResult;
    readonly select?: KarabinerCliResult;
    readonly current?: string;
    readonly absent?: boolean;
  } = {},
): FakeKarabinerCli {
  const calls: string[] = [];
  const absent = options.absent === true;
  return {
    calls,
    async lintComplexModifications(path) {
      calls.push(`lint ${path}`);
      return absent ? undefined : (options.lint ?? { ok: true, output: `${path}: ok` });
    },
    async selectProfile(name) {
      calls.push(`select ${name}`);
      return absent ? undefined : (options.select ?? { ok: true, output: "" });
    },
    async currentProfileName() {
      calls.push("current");
      return absent ? undefined : options.current;
    },
  };
}

/** `console.log` を捕まえる。CLI は JSON を stdout へ出すだけなので、これで十分に読める。 */
async function capture(
  argv: readonly string[],
  cli: KarabinerCli = fakeKarabinerCli({ absent: true }),
): Promise<{ code: number; out: string }> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
  try {
    const code = await main([...argv], { karabinerCli: cli });
    return { code, out: lines.join("\n") };
  } finally {
    console.log = original;
  }
}

/** CLI が stdout へ出す JSON のうち、test が読む範囲だけを型にする。 */
interface MacOutput {
  readonly workspace?: string;
  readonly output?: string;
  readonly generated?: string;
  readonly lint?: { readonly ok: boolean } | null;
  readonly selection?: { readonly required: boolean; readonly profile: string };
  readonly selected?: {
    readonly requested: string;
    readonly observed: string | null;
    readonly ok: boolean;
  } | null;
  readonly summary?: { readonly error: number };
  readonly diagnostics?: readonly { readonly code: string }[];
  readonly fingerprint?: string;
  readonly confirm?: string;
  readonly backup?: string;
  readonly diff?: { readonly present: boolean; readonly changed: boolean };
  readonly verify?: { readonly ok: boolean; readonly entries: readonly unknown[] };
}

async function captureJson(
  argv: readonly string[],
  cli?: KarabinerCli,
): Promise<{ readonly code: number; readonly json: MacOutput }> {
  const { code, out } = await capture(argv, cli);
  return { code, json: JSON.parse(out) as MacOutput };
}

test("mac generate はkeysync/generated/へassetを書く", async () => {
  const { root } = await workspace();
  const { code, json } = await captureJson([
    "mac",
    "generate",
    "--layout",
    "jis",
    "--workspace",
    root,
  ]);

  strictEqual(code, 0);
  strictEqual(json.output, "keysync/generated/karabiner-complex-modifications.json");
  deepStrictEqual(json.diagnostics, []);

  const asset = JSON.parse(await readFile(join(root, String(json.output)), "utf8")) as {
    title: string;
    rules: { description: string }[];
  };
  strictEqual(asset.title, "KeySync");
  deepStrictEqual(
    asset.rules.map((rule) => rule.description),
    ["KeySync layer 3", "KeySync layer 2", "KeySync layer 1", "KeySync layer 0"],
  );
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

test("mac diffはkarabiner.jsonを書き換えない", async () => {
  const { root, karabiner } = await workspace();
  const before = await readFile(karabiner, "utf8");

  const { code, json } = await captureJson([
    "mac",
    "diff",
    "--layout",
    "jis",
    "--workspace",
    root,
    "--karabiner",
    karabiner,
  ]);

  strictEqual(code, 0);
  strictEqual(json.diff?.present, true);
  strictEqual(json.diff?.changed, true);
  strictEqual(await readFile(karabiner, "utf8"), before);
});

test("mac applyは--confirmが無ければ書かない", async () => {
  // 人間が中身を見てから同じfingerprintを渡したときだけ書き込む（ADR 0022）。
  const { root, karabiner } = await workspace();
  const before = await readFile(karabiner, "utf8");

  const { code, json } = await captureJson([
    "mac",
    "apply",
    "--layout",
    "jis",
    "--workspace",
    root,
    "--karabiner",
    karabiner,
  ]);

  strictEqual(code, 0);
  strictEqual(json.confirm, `keysync mac apply --confirm ${json.fingerprint}`);
  strictEqual(await readFile(karabiner, "utf8"), before);
});

test("--no-selectはfingerprintを変え、確認文字列にもフラグが入る", async () => {
  // 診断が warning へ変わり、診断 id は指紋に入る。取り違えたまま確認できないようにする。
  const { root, karabiner } = await workspace();
  const before = await readFile(karabiner, "utf8");
  const plan = await captureJson([
    "mac",
    "apply",
    "--layout",
    "jis",
    "--workspace",
    root,
    "--karabiner",
    karabiner,
  ]);
  const noSelect = await captureJson([
    "mac",
    "apply",
    "--layout",
    "jis",
    "--workspace",
    root,
    "--karabiner",
    karabiner,
    "--no-select",
  ]);

  strictEqual(
    noSelect.json.diagnostics?.some((one) => one.code === "mac-keymap/profile-not-selected"),
    true,
  );
  strictEqual(
    plan.json.diagnostics?.some((one) => one.code === "mac-keymap/profile-will-be-selected"),
    true,
  );
  strictEqual(noSelect.json.fingerprint === plan.json.fingerprint, false);
  strictEqual(
    noSelect.json.confirm,
    `keysync mac apply --no-select --confirm ${noSelect.json.fingerprint}`,
  );

  // 他方の fingerprint では書かない。
  const { code } = await capture([
    "mac",
    "apply",
    "--layout",
    "jis",
    "--workspace",
    root,
    "--karabiner",
    karabiner,
    "--no-select",
    "--confirm",
    String(plan.json.fingerprint),
  ]);
  strictEqual(code, 1);
  strictEqual(await readFile(karabiner, "utf8"), before);
});

test("fingerprintが一致しないapplyは書かずに落ちる", async () => {
  const { root, karabiner } = await workspace();
  const before = await readFile(karabiner, "utf8");

  const { code } = await capture([
    "mac",
    "apply",
    "--layout",
    "jis",
    "--workspace",
    root,
    "--karabiner",
    karabiner,
    "--confirm",
    "v1-dead-beef",
  ]);

  strictEqual(code, 1);
  strictEqual(await readFile(karabiner, "utf8"), before);
});

test("applyはbackupを取り、所有profile以外を保ち、verifyとprofile選択まで通す", async () => {
  const { root, karabiner } = await workspace();
  const before = await readFile(karabiner, "utf8");
  const cli = fakeKarabinerCli({ current: "KeySync" });
  const plan = await captureJson(
    ["mac", "apply", "--layout", "jis", "--workspace", root, "--karabiner", karabiner],
    cli,
  );

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
      "--confirm",
      String(plan.json.fingerprint),
    ],
    cli,
  );

  strictEqual(code, 0);
  deepStrictEqual(json.verify, { ok: true, entries: [] });

  // 選択は karabiner_cli に任せる。karabiner.json の selected は書き換えない（ADR 0028）。
  deepStrictEqual(json.selected, {
    requested: "KeySync",
    observed: "KeySync",
    ok: true,
    output: "",
  });
  strictEqual(cli.calls.includes("select KeySync"), true);

  // backupは読んだテキストをそのまま置く。再serializeするとKarabiner独自の整形が落ちる。
  strictEqual(await readFile(join(root, String(json.backup)), "utf8"), before);

  const applied = JSON.parse(await readFile(karabiner, "utf8")) as {
    global: unknown;
    profiles: { name: string; selected?: boolean }[];
  };
  const original = JSON.parse(before) as typeof applied;
  deepStrictEqual(applied.global, original.global);
  deepStrictEqual(applied.profiles[0], original.profiles[0]);
  strictEqual(applied.profiles[1]?.selected, undefined);

  // 同じdesiredをもう一度当てても差分は出ない。
  const again = await captureJson([
    "mac",
    "diff",
    "--layout",
    "jis",
    "--workspace",
    root,
    "--karabiner",
    karabiner,
  ]);
  strictEqual(again.json.diff?.changed, false);
});

test("errorのあるdesired stateは適用しない", async () => {
  const { root, karabiner, desired } = await workspace();
  const before = await readFile(karabiner, "utf8");
  await writeFile(
    desired,
    'schema: keysync/mac-keymap@1\nprofile: "KeySync"\nlayers:\n  0:\n    "a": "TD(0)"\n',
    "utf8",
  );

  const { code } = await capture([
    "mac",
    "apply",
    "--layout",
    "jis",
    "--workspace",
    root,
    "--karabiner",
    karabiner,
  ]);

  strictEqual(code, 1);
  strictEqual(await readFile(karabiner, "utf8"), before);
});

test("その配列の設定が無ければkeymap.yamlを探さずに落ちる", async () => {
  const root = await mkdtemp(join(tmpdir(), "cornix-mac-"));
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
  strictEqual((await capture(["mac", "publish", "--workspace", root])).code, 1);
});

const DEVICES = join(FIXTURES, "karabiner-devices.json");

test("mac devices は観測されたキーボードを出し、書き換えない", async () => {
  const { root, desired } = await workspace();
  const before = await readFile(desired, "utf8");
  const { code, out } = await capture([
    "mac",
    "devices",
    "--layout",
    "jis",
    "--workspace",
    root,
    "--devices",
    DEVICES,
  ]);
  strictEqual(code, 0);
  const json = JSON.parse(out) as {
    observed: readonly { product: string; identifier: string | null; registered: boolean }[];
  };
  deepStrictEqual(
    json.observed.map((entry) => [entry.product, entry.identifier, entry.registered]),
    [
      ["Apple Internal Keyboard / Trackpad", null, true],
      ["Magic Keyboard", "1452:630", false],
    ],
  );
  strictEqual(await readFile(desired, "utf8"), before, "--add が無ければ書き換えない");
});

test("mac devices --add は devices へ足して書き戻す", async () => {
  const { root, desired } = await workspace();
  const { code } = await capture([
    "mac",
    "devices",
    "--layout",
    "jis",
    "--workspace",
    root,
    "--add",
    "1452:630",
  ]);
  strictEqual(code, 0);
  const text = await readFile(desired, "utf8");
  strictEqual(
    text.includes("  - { built_in: true }\n  - { vendor_id: 1452, product_id: 630 }\n"),
    true,
  );

  // 二重に足さない。
  await capture(["mac", "devices", "--layout", "jis", "--workspace", root, "--add", "1452:630"]);
  strictEqual(await readFile(desired, "utf8"), text);
});

test("mac devices --add が <vendor>:<product> の形でなければ落ちる", async () => {
  const { root } = await workspace();
  const { code } = await capture([
    "mac",
    "devices",
    "--layout",
    "jis",
    "--workspace",
    root,
    "--add",
    "abc",
  ]);
  strictEqual(code, 1);
});

test("所有profileがまだ無い初回applyでも選択が要ることを診断に出す", async () => {
  // 初回は profile を末尾へ足す。ここを「profile が既存か」で判定すると無診断で通り、
  // apply は成功したのに何も効かない状態になる（ADR 0028）。
  const { root } = await workspace();
  const karabiner = join(root, "karabiner-fresh.json");
  await copyFile(join(FIXTURES, "karabiner-no-owned-profile.json"), karabiner);

  const { json } = await captureJson([
    "mac",
    "apply",
    "--layout",
    "jis",
    "--workspace",
    root,
    "--karabiner",
    karabiner,
  ]);

  strictEqual(json.diff?.present, false);
  deepStrictEqual(json.selection, { required: true, profile: "KeySync" });
  strictEqual(
    json.diagnostics?.some((one) => one.code === "mac-keymap/profile-will-be-selected"),
    true,
  );

  const noSelect = await captureJson([
    "mac",
    "apply",
    "--layout",
    "jis",
    "--workspace",
    root,
    "--karabiner",
    karabiner,
    "--no-select",
  ]);
  strictEqual(
    noSelect.json.diagnostics?.some((one) => one.code === "mac-keymap/profile-not-selected"),
    true,
  );
});

test("lintが通らなければkarabiner.jsonへ書かない", async () => {
  const { root, karabiner } = await workspace();
  const before = await readFile(karabiner, "utf8");
  const cli = fakeKarabinerCli({ lint: { ok: false, output: "error: unknown key_code" } });
  const plan = await captureJson(
    ["mac", "apply", "--layout", "jis", "--workspace", root, "--karabiner", karabiner],
    cli,
  );
  strictEqual(plan.json.lint?.ok, false);

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
      "--confirm",
      String(plan.json.fingerprint),
    ],
    cli,
  );
  strictEqual(code, 1);
  strictEqual(await readFile(karabiner, "utf8"), before);
});

test("Karabinerが入っていなければlintを保留して適用まで進む", async () => {
  const { root, karabiner } = await workspace();
  const plan = await captureJson([
    "mac",
    "apply",
    "--layout",
    "jis",
    "--workspace",
    root,
    "--karabiner",
    karabiner,
  ]);
  strictEqual(plan.json.lint, null);

  const { code, json } = await captureJson([
    "mac",
    "apply",
    "--layout",
    "jis",
    "--workspace",
    root,
    "--karabiner",
    karabiner,
    "--confirm",
    String(plan.json.fingerprint),
  ]);
  strictEqual(code, 0);
  strictEqual(json.verify?.ok, true);
  strictEqual(json.selected, null);
});

test("profileを選べたか読み戻して確かめる", async () => {
  const { root, karabiner } = await workspace();
  const cli = fakeKarabinerCli({ current: "Default profile" });
  const plan = await captureJson(
    ["mac", "apply", "--layout", "jis", "--workspace", root, "--karabiner", karabiner],
    cli,
  );

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
      "--confirm",
      String(plan.json.fingerprint),
    ],
    cli,
  );

  // write と verify は通っている。食い違うのは選択だけで、それでも成功にはしない。
  strictEqual(json.verify?.ok, true);
  strictEqual(json.selected?.ok, false);
  strictEqual(json.selected?.observed, "Default profile");
  strictEqual(code, 1);
});

test("macの出力は解決済みのworkspaceを必ず載せる", async () => {
  const { root, karabiner } = await workspace();
  for (const argv of [
    ["mac", "generate", "--layout", "jis", "--workspace", root],
    ["mac", "diff", "--layout", "jis", "--workspace", root, "--karabiner", karabiner],
    ["mac", "apply", "--layout", "jis", "--workspace", root, "--karabiner", karabiner],
    [
      "mac",
      "devices",
      "--layout",
      "jis",
      "--workspace",
      root,
      "--devices",
      join(FIXTURES, "karabiner-devices.json"),
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
      karabinerCli: fakeKarabinerCli({ absent: true }),
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
  const { root, karabiner } = await workspace();
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
    ],
    recorder,
  );
  strictEqual(code, 0);
  deepStrictEqual(recorder.calls, [5]);
  strictEqual(json.log, "keysync/typing-logs/2026-09-27T01-02-03-456Z-cli.jsonl");
  // baseline の karabiner.json は mod-tap に閾値を持たない（ADR 0044 以前の形）。
  strictEqual(json.tappingTermMs, null);
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
  const { root, karabiner } = await workspace();
  const lines: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
  try {
    const code = await main(
      ["mac", "record", "--free", "--layout", "jis", "--workspace", root, "--karabiner", karabiner],
      {
        karabinerCli: fakeKarabinerCli({ absent: true }),
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
  const { root, karabiner } = await workspace();
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
  const { root, karabiner } = await workspace();
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
      ],
      { karabinerCli: fakeKarabinerCli({ absent: true }), keyRecorder: fakeKeyRecorder() },
    );
    strictEqual(code, 1);
  } finally {
    console.error = originalError;
  }
});
