#!/usr/bin/env node
import { webcrypto } from "node:crypto";
import { access, constants, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { createInterface } from "node:readline";
import { parseDefinition } from "../core/definition/parse.ts";
import { canonicalDefinitionText } from "../core/definition/identity.ts";
import { diffDocuments } from "../core/diff/diff.ts";
import { analyzeReachability } from "../core/validation/reachability.ts";
import { validateKeymap } from "../core/validation/validate.ts";
import { parseVil } from "../core/vil/parse.ts";
import { serializeVil } from "../core/vil/serialize.ts";
import { parseKeymapYaml } from "../core/keymap-yaml/parse.ts";
import { serializeKeymapYaml } from "../core/keymap-yaml/serialize.ts";
import {
  appliedTappingTermMs,
  karabinerGrabsBuiltIn,
  planMacApply,
} from "../core/mac-keymap/apply.ts";
import { validateMacKeymap } from "../core/mac-keymap/validate.ts";
import type { MacKeyboardLayout, MacKeymapDocument } from "../core/mac-keymap/types.ts";
import { analyzeModTapOutput } from "../core/typing-log/analyze.ts";
import { keyLogPath, serializeKeyLog, TYPING_LOG_DIR } from "../core/typing-log/format.ts";
import { splitAtReturn, typedEventsFromHid } from "../core/typing-log/trial.ts";
import { gradeTypingTrial, tokenizeTypedEvents } from "../core/typing-trial/grade.ts";
import { HOLD_REPEAT, holdTasksFor, ROLL_TASKS } from "../core/typing-trial/tasks.ts";
import type { TypingTask } from "../core/typing-trial/types.ts";
import {
  applyMacPlan,
  generateKanataAt,
  KANATA_GENERATED,
  planMacApplyAt,
  readOptional,
} from "../mac/apply-service.ts";
import { createKeyRecorder, type KeyRecorder } from "../mac/key-recorder.ts";
import { detectBuiltInLayout } from "../mac/keyboard-type.ts";
import { readMacKeymapFor } from "../workspace/mac-keymap-file.ts";
import { planLayoutMigration, writeLayoutMigration } from "../workspace/bootstrap.ts";
import { defaultKarabinerConfigPath, readKarabinerConfig } from "../karabiner/node.ts";
import { createKanataHost, defaultKanataConfigPath, type KanataHost } from "../kanata/node.ts";
import {
  createServiceHost,
  KANATA_SERVICE_LABEL,
  KANATA_SERVICE_PLIST,
  kanataServicePlist,
  type ServiceHost,
} from "../kanata/service.ts";
import { planLinuxApply } from "../core/linux-keymap/apply.ts";
import { addLinuxDevice, initialLinuxKeymap } from "../core/linux-keymap/edit.ts";
import { serializeLinuxKeymapYaml } from "../core/linux-keymap/serialize.ts";
import type { LinuxKeymapDocument } from "../core/linux-keymap/types.ts";
import { validateLinuxKeymap } from "../core/linux-keymap/validate.ts";
import { applyLinuxPlan, KEYD_GENERATED, planLinuxApplyAt } from "../linux/apply-service.ts";
import { INPUT_DEVICES_PATH, readLinuxKeyboards } from "../linux/input-devices.ts";
import { createKeydHost, KEYD_CONFIG_PATH, type KeydHost } from "../linux/keyd.ts";
import { readLinuxKeymapFor } from "../workspace/linux-keymap-file.ts";
import { renderPdf, renderSvg } from "../render/keyboard.ts";
import {
  definitionDigest,
  definitionPath,
  generatedPath,
  LEGACY_WORKSPACE_LAYOUT,
  linuxKeymapPath,
  macKeymapPath,
  readDefinitionBinding,
  WORKSPACE_LAYOUT,
} from "../workspace/layout.ts";
import { defaultWorkspaceRoot } from "../workspace/default-root.ts";
import { parseLabelsYaml, EMPTY_LABELS } from "../workspace/labels.ts";
import { CORNIX_LP_V112_SETTINGS } from "../workspace/settings.ts";
import { NodeWorkspaceStore } from "../workspace/node.ts";

/** テストから実物の kanata・launchd と keyd / sudo を外すための注入口。 */
interface CliDeps {
  readonly kanataHost?: KanataHost;
  readonly serviceHost?: ServiceHost;
  readonly keydHost?: KeydHost;
  readonly keyRecorder?: KeyRecorder;
  /** 課題つき記録で行を読む入力。既定は標準入力。 */
  readonly input?: NodeJS.ReadableStream;
  /** 記録を始めた時刻。テストで固定する。 */
  readonly now?: () => Date;
}

/** 読み込んだ Mac の desired state と、どのファイルから来たか。 */
interface LoadedMacKeymap {
  readonly layout: MacKeyboardLayout;
  readonly path: string;
  readonly document: MacKeymapDocument;
}

interface LoadedWorkspace {
  readonly root: string;
  readonly store: NodeWorkspaceStore;
  readonly keymapText: string;
  readonly parsed: ReturnType<typeof parseKeymapYaml>;
  readonly definitionText: string;
  readonly definition: ReturnType<typeof parseDefinition>;
  readonly labels: ReturnType<typeof parseLabelsYaml>;
}

/**
 * CLI の入口。
 *
 * `deps` はテストのための注入口である。kanata と launchd は CI の macOS runner で
 * 動かせず、実物を叩くテストは書けない（ADR 0049）。
 *
 * @doc docs/specs/workspace-cli.md#cli
 */
export async function main(argv = process.argv.slice(2), deps: CliDeps = {}): Promise<number> {
  if (argv[0] === "--") argv = argv.slice(1);
  const [command, ...rest] = argv;
  if (command === undefined || command === "help" || command === "--help") {
    printHelp();
    return 0;
  }
  const args = parseArgs(rest);
  try {
    // 既定は全サブコマンドで同じ `$KEYSYNC_WORKSPACE`。未設定なら止める（ADR 0039）。
    const root =
      args.workspace === undefined ? defaultWorkspaceRoot() : resolve(String(args.workspace));
    if (command === "import" && args._[0] === "vil")
      return await importVil(root, String(args._[1] ?? ""), args);
    // mac 系は keymap.yaml も definition も要らない。loadWorkspace の手前で分ける（ADR 0022）。
    if (command === "mac") return await mac(root, args, deps);
    if (command === "linux") return await linux(root, args, deps);
    // 改名前の `cornix/` を指す workspace は loadWorkspace が読めない。その手前で移す（ADR 0036）。
    if (command === "migrate") return await migrate(root);
    const workspace = await loadWorkspace(root);
    switch (command) {
      case "validate":
        return validate(workspace);
      case "analyze":
        return analyze(workspace);
      case "diff":
        return await diff(workspace, String(args.against ?? ""));
      case "render":
        return await render(workspace, args);
      case "export":
        if (args._[0] === "vil") return await exportVil(workspace, args);
        break;
      default:
        throw new Error(`未知の command: ${command}`);
    }
    throw new Error(`${command} の引数が不正`);
  } catch (error) {
    console.error(`keysync: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

function validate(workspace: LoadedWorkspace): number {
  const result = validateKeymap(workspace.parsed.document, workspace.definition);
  console.log(
    JSON.stringify({ summary: result.summary, diagnostics: result.diagnostics }, null, 2),
  );
  return result.summary.error > 0 ? 1 : 0;
}

function analyze(workspace: LoadedWorkspace): number {
  const result = validateKeymap(workspace.parsed.document, workspace.definition);
  const reachability = analyzeReachability(workspace.parsed.document);
  console.log(
    JSON.stringify(
      {
        summary: result.summary,
        diagnostics: result.diagnostics,
        reachableLayers: [...reachability.reachable].sort((a, b) => a - b),
        edges: reachability.edges,
      },
      null,
      2,
    ),
  );
  return result.summary.error > 0 ? 1 : 0;
}

async function diff(workspace: LoadedWorkspace, against: string): Promise<number> {
  if (against === "") throw new Error("keysync diff --against <file.vil> が必要");
  const before = parseVil(await readFile(resolve(workspace.root, against), "utf8"));
  const result = diffDocuments(before, workspace.parsed.document, workspace.definition, {
    settings: { labels: CORNIX_LP_V112_SETTINGS },
  });
  console.log(JSON.stringify(result, mapReplacer, 2));
  return 0;
}

async function render(workspace: LoadedWorkspace, args: ParsedArgs): Promise<number> {
  const format = String(args.format ?? "svg");
  const layer = args.layer === undefined ? 0 : Number(args.layer);
  const output = String(args.out ?? `${format === "pdf" ? "keymap.pdf" : "keymap.svg"}`);
  if (format === "svg")
    await writeFile(
      resolve(workspace.root, output),
      renderSvg(workspace.parsed.document, workspace.definition, {
        layer,
        labels: workspace.labels,
      }),
      "utf8",
    );
  else if (format === "pdf")
    await writeFile(
      resolve(workspace.root, output),
      renderPdf(workspace.parsed.document, workspace.definition, {
        layer,
        labels: workspace.labels,
      }),
    );
  else throw new Error(`未対応の render format: ${format}`);
  console.log(output);
  return 0;
}

async function exportVil(workspace: LoadedWorkspace, args: ParsedArgs): Promise<number> {
  const output = String(args.out ?? "keymap.vil");
  await writeFile(resolve(workspace.root, output), serializeVil(workspace.parsed.document), "utf8");
  console.log(output);
  return 0;
}

async function importVil(root: string, input: string, args: ParsedArgs): Promise<number> {
  if (input === "") throw new Error("keysync import vil <file.vil> が必要");
  const definitionFile = String(args.definition ?? "");
  if (definitionFile === "")
    throw new Error(".vil importには --definition <definition.json> が必要");
  const document = parseVil(await readFile(resolve(root, input), "utf8"));
  // workspaceへはcanonical表現で置く。実機readが保存するbytesと同じ規則にして、
  // 同じdefinitionが整形の違いだけで別digestにならないようにする。
  const definitionText = canonicalDefinitionText(
    await readFile(resolve(root, definitionFile), "utf8"),
  );
  const digest = await definitionDigest(definitionText, webcrypto);
  const definitionRel = definitionPath(digest);
  const store = new NodeWorkspaceStore(root);
  await store.writeText(definitionRel, definitionText);
  await store.writeText(
    WORKSPACE_LAYOUT.keymap,
    serializeKeymapYaml(document, {
      keyboardUid: document.uid,
      keyboardName: parseDefinition(definitionText).name,
      definitionPath: definitionRel,
      definitionDigest: digest,
    }),
  );
  console.log(WORKSPACE_LAYOUT.keymap);
  return 0;
}

/**
 * 改名前の管理ディレクトリ `cornix/` を `keysync/` へ移す。旧 `cornix/` は消さない（ADR 0036）。
 */
async function migrate(root: string): Promise<number> {
  const store = new NodeWorkspaceStore(root);
  const parsed = parseKeymapYaml(
    required(await store.readText(WORKSPACE_LAYOUT.keymap), WORKSPACE_LAYOUT.keymap),
  );
  const migration = await planLayoutMigration(store, parsed.document, parsed.binding, webcrypto);
  if (migration === undefined) {
    if (parsed.binding.definitionPath.startsWith(`${LEGACY_WORKSPACE_LAYOUT.definitions}/`)) {
      throw new Error(
        `${parsed.binding.definitionPath} が無いか、digest が keymap.yaml と一致しないため移行しない`,
      );
    }
    console.log(JSON.stringify({ workspace: root, migrated: false }, null, 2));
    return 0;
  }
  await writeLayoutMigration(store, migration);
  console.log(
    JSON.stringify(
      {
        workspace: root,
        migrated: true,
        definition: { from: migration.previousPath, to: migration.definitionPath },
        copied: migration.copies.map(({ from, to }) => ({ from, to })),
        keymap: WORKSPACE_LAYOUT.keymap,
        note: "cornix/ は残した。backups/ と generated/ は移さない。確かめてから不要なら削除する",
      },
      null,
      2,
    ),
  );
  return 0;
}

/**
 * MacBook 内蔵キーボードの生成・差分・適用・常駐の登録・記録。
 *
 * 適用は CLI とローカルサーバーの適用 API が行う。Web UI 自身は kanata の設定ファイルに
 * 触れない（ADR 0034・0049）。
 */
async function mac(root: string, args: ParsedArgs, deps: CliDeps): Promise<number> {
  const sub = args._[0];
  const host = deps.kanataHost ?? createKanataHost();
  const loaded = await loadMacKeymap(root, args);
  if (sub === "generate") return await macGenerate(root, loaded, args, host);
  if (sub === "diff") return await macDiff(root, loaded, args);
  if (sub === "apply") return await macApply(root, loaded, args, host);
  if (sub === "service") return await macService(root, args, host, deps);
  if (sub === "record") return await macRecord(root, loaded, args, deps);
  throw new Error("keysync mac generate|diff|apply|service|record が必要");
}

/** `--layout` の明示指定。検出できない環境と、別配列の設定を触りたいときの入口。 */
function layoutArg(args: ParsedArgs): MacKeyboardLayout | undefined {
  const value = args.layout;
  if (value === undefined) return undefined;
  if (value !== "ansi" && value !== "jis") throw new Error(`--layout が未対応: ${String(value)}`);
  return value;
}

/**
 * 実行中の Mac の内蔵配列に対応する設定を読む。
 *
 * 設定は物理配列ごとに分かれている（ADR 0027）。どれを使うかは宣言ではなく
 * **実行しているマシン**が決める。`--layout` があればそちらを優先し、検出できなければ
 * 明示指定を要求する。黙って既定の配列へ倒すと、別配列のマシンへ間違った
 * `keyboard_type_v2` を書き込む。
 */
async function loadMacKeymap(root: string, args: ParsedArgs): Promise<LoadedMacKeymap> {
  const layout = layoutArg(args) ?? (await detectBuiltInLayout());
  if (layout === undefined) {
    throw new Error("内蔵キーボードの配列を検出できない。--layout ansi|jis を指定する");
  }
  const file = await readMacKeymapFor(new NodeWorkspaceStore(root), layout);
  if (file === undefined) {
    throw new Error(`${macKeymapPath(layout)} が見つからない（配列: ${layout}）`);
  }
  return { layout, path: file.path, document: file.document };
}

/** kanata の設定を keysync/generated/ へ書き出す。kanata が入っていれば check も通す。 */
async function macGenerate(
  root: string,
  loaded: LoadedMacKeymap,
  args: ParsedArgs,
  host: KanataHost,
): Promise<number> {
  const result = validateMacKeymap(loaded.document);
  const output = String(args.out ?? KANATA_GENERATED);
  if (result.summary.error > 0) {
    console.log(
      JSON.stringify(
        { workspace: root, summary: result.summary, diagnostics: result.diagnostics },
        null,
        2,
      ),
    );
    return 1;
  }
  const check = await generateKanataAt(root, loaded.document, loaded.path, output, host);
  console.log(
    JSON.stringify(
      {
        workspace: root,
        layout: loaded.layout,
        source: loaded.path,
        output,
        summary: result.summary,
        diagnostics: result.diagnostics,
        check: check ?? null,
      },
      null,
      2,
    ),
  );
  return check !== undefined && !check.ok ? 1 : 0;
}

/** 自由記録（`--free`）の既定の長さ（秒）。Ctrl-C で早く止められる。 */
const DEFAULT_FREE_SECONDS = 30;

/** 課題つき記録の上限（秒）。課題を放置したまま記録し続けないための安全弁。 */
const GUIDED_LIMIT_SECONDS = 1800;

/** 課題の表示に使うキーの名前。刻印の語彙は UI 層にあるため、CLI では最小限の写像にする。 */
function positionLabel(keyCode: string): string {
  if (/^[a-z]$/.test(keyCode)) return keyCode.toUpperCase();
  const named: Readonly<Record<string, string>> = {
    spacebar: "space",
    return_or_enter: "return",
    left_shift: "左 shift",
    right_shift: "右 shift",
    caps_lock: "caps lock",
  };
  return named[keyCode] ?? keyCode;
}

function taskPrompt(task: TypingTask): string {
  if (task.kind === "text") return task.text;
  return `${positionLabel(task.holdKeyCode)} を押し続けて ${task.partner.toUpperCase()} を押し、両方離す。これを ${HOLD_REPEAT} 回`;
}

function describeTask(task: TypingTask, index: number, total: number): string {
  const head = `[${index + 1}/${total}]`;
  if (task.kind === "text") return `\n${head} ${task.title}\n  ${task.focus}\n  > ${task.text}`;
  const expected = task.expected[0];
  const chord =
    expected === undefined
      ? ""
      : expected.kind === "char"
        ? expected.char
        : `${expected.modifiers.ctrl ? "⌃" : ""}${expected.modifiers.alt ? "⌥" : ""}${expected.modifiers.shift ? "⇧" : ""}${expected.modifiers.meta ? "⌘" : ""}${expected.key.toUpperCase()}`;
  return `\n${head} hold: ${taskPrompt(task)}（期待は ${chord}）`;
}

/** `--tasks roll|hold|all` で課題を選ぶ。既定は all。 */
function recordTasks(args: ParsedArgs, document: MacKeymapDocument): readonly TypingTask[] {
  const which = args.tasks ?? "all";
  if (which !== "roll" && which !== "hold" && which !== "all") {
    throw new Error(`--tasks は roll|hold|all（${String(which)} が渡された）`);
  }
  return [
    ...(which === "hold" ? [] : ROLL_TASKS),
    ...(which === "roll" ? [] : holdTasksFor(document)),
  ];
}

/**
 * 打鍵を記録して workspace の `keysync/typing-logs/` へ書き、mod-tap の判定の推定を出す。
 *
 * 既定は課題つきで、Web UI の打鍵テストと同じ課題を 1 つずつ出す。利用者はターミナルで打ち、
 * Enter で次へ進む。記録は通しで 1 本にし、HID の Return で課題ごとに区切って採点する。
 * `--free` は課題を出さずに秒数だけ記録する。
 *
 * 記録するのは kanata が処理した後の入力（HID と OS の 2 層）で、何も書き換えない。
 * kanata の設定ファイルは、記録した時点で効いていた閾値を残すために読むだけ（ADR 0046）。
 */
async function macRecord(
  root: string,
  loaded: LoadedMacKeymap,
  args: ParsedArgs,
  deps: CliDeps,
): Promise<number> {
  // `--free 10` のように秒数を続けて書くと、parseArgs は秒数を `free` の値として取る。
  const free = args.free !== undefined;
  const freeSeconds = typeof args.free === "string" ? args.free : undefined;
  const raw =
    args.seconds ??
    freeSeconds ??
    args._[1] ??
    (free ? DEFAULT_FREE_SECONDS : GUIDED_LIMIT_SECONDS);
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`記録する秒数は正の数（${String(raw)} が渡された）`);
  }
  const tasks = free ? [] : recordTasks(args, loaded.document);
  const applied = await readOptional(kanataConfigPath(args));
  // 閾値が分からなくても記録はできる。ログには null を残す。
  const tappingTermMs = applied === undefined ? null : appliedTappingTermMs(applied);
  const startedAt = (deps.now ?? (() => new Date()))();
  const recorder = deps.keyRecorder ?? createKeyRecorder();

  let stopRecording = () => {};
  const stop = new Promise<void>((resolve) => {
    stopRecording = resolve;
  });
  let markStarted = () => {};
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const recordingPromise = recorder.record({ seconds, stop }, () => {
    if (free) {
      console.error(`${seconds} 秒記録する。Ctrl-C で早く止められる。打鍵を始めてよい。`);
    } else {
      console.error(
        [
          "課題をこのターミナルで打ち、Enter で次へ進む。何も打たずに Enter で飛ばす。Ctrl-C で終える。",
          "IME は英数にする。打ち間違えても直さずに進める。",
        ].join("\n"),
      );
    }
    markStarted();
  });
  const finished = recordingPromise.then(() => undefined);
  await Promise.race([started, finished]);

  const answered: { readonly task: TypingTask; readonly typed: string }[] = [];
  if (!free) {
    // cooked mode のまま読む。raw にすると Ctrl-C がレコーダーへ届かない。
    const lines = createInterface({ input: deps.input ?? process.stdin, terminal: false });
    const iterator = lines[Symbol.asyncIterator]();
    for (const [index, task] of tasks.entries()) {
      console.error(describeTask(task, index, tasks.length));
      const next = await Promise.race([iterator.next(), finished.then(() => undefined)]);
      if (next === undefined || next.done === true) break;
      answered.push({ task, typed: String(next.value) });
    }
    lines.close();
    stopRecording();
  }
  const recording = await recordingPromise;
  if (recording.hidOpened.length === 0 && !recording.tapOk) {
    throw new Error(
      "キーボードの入力を読めない。システム設定の「入力監視」で、この端末アプリを許可する",
    );
  }

  const warnings = [...recording.warnings];
  if (recording.hidOpened.length === 0) warnings.push("HID の層を読めなかった");
  if (!recording.tapOk) warnings.push("OS の層を読めなかった（入力監視の許可を確かめる）");

  const { segments } = splitAtReturn(recording.events);
  if (!free && segments.length !== answered.length) {
    warnings.push(
      `Return の区切り（${segments.length}）と進めた課題（${answered.length}）の数が合わない。先頭から順に対応させた`,
    );
  }
  const trials = answered.map(({ task, typed }, index) => {
    const segment = segments[index] ?? [];
    const events = typedEventsFromHid(segment);
    const skipped = tokenizeTypedEvents(events).tokens.length === 0;
    const grade = skipped ? undefined : gradeTypingTrial(task, events);
    const analysis = analyzeModTapOutput(segment, loaded.document);
    return {
      taskId: task.id,
      prompt: taskPrompt(task),
      typed,
      summary: skipped
        ? { skipped: true }
        : grade?.kind === "graded"
          ? grade.summary
          : { ime: true },
      taps: analysis.taps,
      holds: analysis.holds,
    };
  });

  const path = keyLogPath(startedAt, "cli");
  const store = new NodeWorkspaceStore(root);
  await store.ensureDirectory(TYPING_LOG_DIR);
  await store.writeText(
    path,
    serializeKeyLog(
      {
        type: "meta",
        recorder: "cli",
        startedAt: startedAt.toISOString(),
        layout: loaded.layout,
        tappingTermMs,
        ...(recording.originNs === undefined ? {} : { originNs: recording.originNs }),
        ...(free
          ? {}
          : {
              trials: trials.map(({ taskId, prompt, typed, summary }) => ({
                taskId,
                prompt,
                typed,
                summary,
              })),
            }),
      },
      recording.events,
    ),
  );

  console.log(
    JSON.stringify(
      {
        workspace: root,
        layout: loaded.layout,
        log: path,
        tappingTermMs,
        recorded: {
          hid: recording.events.filter((event) => event.type === "hid").length,
          os: recording.events.filter((event) => event.type === "os").length,
          hidDevices: recording.hidOpened,
          blockedDevices: recording.hidBlocked,
        },
        warnings,
        ...(free ? {} : { trials }),
        analysis: analyzeModTapOutput(recording.events, loaded.document),
      },
      null,
      2,
    ),
  );
  return 0;
}

/** kanata の設定ファイルとの差分を出す。設定ファイルと karabiner.json は読むだけ。 */
async function macDiff(root: string, loaded: LoadedMacKeymap, args: ParsedArgs): Promise<number> {
  const config = kanataConfigPath(args);
  const karabiner = await readKarabinerConfig(karabinerPath(args));
  const plan = planMacApply(await readOptional(config), loaded.document, {
    source: loaded.path,
    karabinerGrabsBuiltIn: karabiner !== undefined && karabinerGrabsBuiltIn(karabiner),
  });
  console.log(
    JSON.stringify(
      {
        workspace: root,
        layout: loaded.layout,
        source: loaded.path,
        config,
        summary: plan.validation.summary,
        diagnostics: plan.diagnostics,
        fingerprint: plan.fingerprint,
        changed: plan.changed,
        entries: plan.entries,
      },
      null,
      2,
    ),
  );
  return plan.validation.summary.error > 0 ? 1 : 0;
}

/**
 * kanata の設定ファイルを置き換え、常駐している kanata に読み直させる。
 *
 * `--confirm` が無いうちは生成と check、diff、fingerprint を出して終わる。人間が中身を
 * 見てから同じ fingerprint を渡したときだけ書く（Apply フロー）。手順はローカルサーバーの
 * 適用 API と共通で、`apply-service.ts` が持つ（ADR 0049）。
 */
async function macApply(
  root: string,
  loaded: LoadedMacKeymap,
  args: ParsedArgs,
  host: KanataHost,
): Promise<number> {
  const config = kanataConfigPath(args);
  const target = {
    root,
    layout: loaded.layout,
    path: loaded.path,
    document: loaded.document,
    config,
    karabiner: karabinerPath(args),
    host,
  };
  const planning = await planMacApplyAt(target);
  const { plan } = planning;
  if (planning.kind === "invalid") {
    console.log(
      JSON.stringify(
        { workspace: root, summary: plan.validation.summary, diagnostics: plan.diagnostics },
        null,
        2,
      ),
    );
    throw new Error("error のある desired state は適用しない");
  }
  const header = { workspace: root, layout: loaded.layout, source: loaded.path, config };

  const confirmed = args.confirm === undefined ? undefined : String(args.confirm);
  if (confirmed === undefined) {
    console.log(
      JSON.stringify(
        {
          ...header,
          diagnostics: plan.diagnostics,
          changed: plan.changed,
          entries: plan.entries,
          generated: planning.generated,
          check: planning.check ?? null,
          fingerprint: plan.fingerprint,
          confirm: `keysync mac apply --confirm ${plan.fingerprint}`,
        },
        null,
        2,
      ),
    );
    return 0;
  }
  if (confirmed !== plan.fingerprint) {
    throw new Error(`fingerprint が一致しない: expected=${plan.fingerprint} actual=${confirmed}`);
  }
  if (planning.check === undefined) {
    throw new Error("kanata が見つからない。brew install --HEAD kanata で入れる");
  }
  if (!planning.check.ok) throw new Error(`kanata --check が通らない: ${planning.check.output}`);

  const applied = await applyMacPlan(target, planning);
  console.log(
    JSON.stringify(
      {
        ...header,
        diagnostics: plan.diagnostics,
        generated: planning.generated,
        ...applied,
        ...(applied.reload?.kind === "not-running"
          ? { next: "kanata が常駐していない。keysync mac service install で登録する" }
          : {}),
      },
      null,
      2,
    ),
  );
  return applied.verify && applied.reload?.kind !== "failed" ? 0 : 1;
}

/**
 * kanata の常駐（launchd）の状態を出し、`install` なら登録する。
 *
 * 登録には root が要る。sudo は端末で認証する（ADR 0049）。kanata の設定ファイルが無いうちは
 * 登録しない。kanata は起動時に設定を読めなければ止まるので、先に `mac apply` を求める。
 */
async function macService(
  root: string,
  args: ParsedArgs,
  host: KanataHost,
  deps: CliDeps,
): Promise<number> {
  const action = args._[1] ?? "status";
  if (action !== "status" && action !== "install") {
    throw new Error("keysync mac service status|install が必要");
  }
  const service = deps.serviceHost ?? createServiceHost();
  const config = kanataConfigPath(args);
  const karabiner = await readKarabinerConfig(karabinerPath(args));
  const status = {
    label: KANATA_SERVICE_LABEL,
    plist: KANATA_SERVICE_PLIST,
    installed: await service.installed(),
    running: await host.reachable(),
    config,
    configPresent: (await readOptional(config)) !== undefined,
    karabinerGrabsBuiltIn: karabiner !== undefined && karabinerGrabsBuiltIn(karabiner),
  };
  if (action === "status") {
    console.log(JSON.stringify({ workspace: root, ...status }, null, 2));
    return 0;
  }

  if (!status.configPresent) {
    throw new Error(`${config} が無い。先に keysync mac apply で設定を置く`);
  }
  const kanata = await host.binary();
  if (kanata === undefined) {
    throw new Error("kanata が見つからない。brew install --HEAD kanata で入れる");
  }
  const binary = await absoluteBinary(kanata);
  const plist = generatedPath(`${KANATA_SERVICE_LABEL}.plist`);
  await new NodeWorkspaceStore(root).writeText(
    plist,
    kanataServicePlist({ kanata: binary, config }),
  );
  const install = await service.install(resolve(root, plist));
  const bootstrap = install.ok ? await service.bootstrap() : null;
  console.log(
    JSON.stringify(
      {
        workspace: root,
        ...status,
        generated: plist,
        kanata: binary,
        install,
        bootstrap,
        next: [
          `システム設定の「入力監視」と「アクセシビリティ」で ${binary} の実体を許可する`,
          "許可したら keysync mac service status で running が true になるのを確かめる",
        ],
      },
      null,
      2,
    ),
  );
  return install.ok && bootstrap?.ok === true ? 0 : 1;
}

/** PATH から探した `kanata` を、launchd に渡せる絶対 path にする。 */
async function absoluteBinary(kanata: string): Promise<string> {
  if (isAbsolute(kanata)) return kanata;
  for (const directory of (process.env.PATH ?? "").split(":")) {
    const candidate = resolve(directory, kanata);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // 次の directory を探す。
    }
  }
  throw new Error(`${kanata} の絶対 path が分からない`);
}

/** 読み込んだ Linux の desired state と、どのファイルから来たか。 */
interface LoadedLinuxKeymap {
  readonly path: string;
  readonly document: LinuxKeymapDocument;
}

/**
 * Linux で使う Apple 製キーボードの一覧・生成・差分・適用（ADR 0042）。
 *
 * 適用は CLI だけが行う。`/etc/keyd/` への書き込みと `keyd reload` は `sudo` を通し、
 * パスワードは端末で入力する。
 */
async function linux(root: string, args: ParsedArgs, deps: CliDeps): Promise<number> {
  const sub = args._[0];
  const host = deps.keydHost ?? createKeydHost();
  const store = new NodeWorkspaceStore(root);
  const layout = await linuxLayout(store, args);
  const file = await readLinuxKeymapFor(store, layout);
  if (sub === "devices") return await linuxDevices(root, layout, file, args);
  if (sub !== "generate" && sub !== "diff" && sub !== "apply") {
    throw new Error("keysync linux devices|generate|diff|apply が必要");
  }
  if (file === undefined) {
    throw new Error(
      `${linuxKeymapPath(layout)} が見つからない。keysync linux devices --layout ${layout} --add <vendor>:<product> で作る`,
    );
  }
  const target = {
    root,
    path: file.path,
    document: file.document,
    config: args.config === undefined ? KEYD_CONFIG_PATH : resolve(String(args.config)),
    host,
  };
  if (sub === "generate") return await linuxGenerate(root, file);
  if (sub === "diff") return await linuxApply(target, undefined);
  return await linuxApply(target, args.confirm === undefined ? undefined : String(args.confirm));
}

/**
 * どの配列の設定を使うか。Linux では内蔵キーボードの配列を検出する手段が無い（ADR 0042）。
 *
 * `--layout` があればそれを使う。無ければ workspace にある `linux-keyboard.*.yaml` が
 * 1 つだけのときに限りそれを使う。どちらでもなければ明示を求めて止める。黙って既定の
 * 配列へ倒さないのは Mac 側（ADR 0027）と同じ理由。
 */
async function linuxLayout(
  store: NodeWorkspaceStore,
  args: ParsedArgs,
): Promise<MacKeyboardLayout> {
  const explicit = layoutArg(args);
  if (explicit !== undefined) return explicit;
  const present: MacKeyboardLayout[] = [];
  for (const layout of ["ansi", "jis"] as const) {
    if ((await store.readText(linuxKeymapPath(layout))) !== undefined) present.push(layout);
  }
  if (present.length === 1 && present[0] !== undefined) return present[0];
  throw new Error("Linux の設定の配列を決められない。--layout ansi|jis を指定する");
}

/** `--add` が受ける `<vendor>:<product>`。`/proc/bus/input/devices` と同じ 16 進 4 桁。 */
function parseHexDeviceArg(value: string): {
  readonly vendorId: number;
  readonly productId: number;
} {
  const match = /^([0-9a-fA-F]{4}):([0-9a-fA-F]{4})$/.exec(value);
  if (match?.[1] === undefined || match[2] === undefined) {
    throw new Error(`--add は 16 進 4 桁の <vendor>:<product> の形（${value} が渡された）`);
  }
  return { vendorId: Number.parseInt(match[1], 16), productId: Number.parseInt(match[2], 16) };
}

function hexId(vendorId: number, productId: number): string {
  const hex = (value: number) => value.toString(16).padStart(4, "0");
  return `${hex(vendorId)}:${hex(productId)}`;
}

/**
 * 適用先デバイスの一覧と登録。
 *
 * `--add` が無ければ観測されたキーボードを出して終わる。見てから明示的に指定したときだけ
 * 書き込む。設定がまだ無ければ `--add` で作る。Cornix LP もここに並ぶので、登録すると
 * firmware keymap と二重に効く（ADR 0022 の隔離）。
 */
async function linuxDevices(
  root: string,
  layout: MacKeyboardLayout,
  file: LoadedLinuxKeymap | undefined,
  args: ParsedArgs,
): Promise<number> {
  const path = file?.path ?? linuxKeymapPath(layout);
  const document = file?.document ?? initialLinuxKeymap(layout);
  if (args.add !== undefined) {
    const next = addLinuxDevice(document, parseHexDeviceArg(String(args.add)));
    await new NodeWorkspaceStore(root).writeText(path, serializeLinuxKeymapYaml(next));
    console.log(
      JSON.stringify(
        { workspace: root, path, layout, created: file === undefined, devices: next.devices },
        null,
        2,
      ),
    );
    return 0;
  }

  const source = args.devices === undefined ? INPUT_DEVICES_PATH : String(args.devices);
  const observed = await readLinuxKeyboards(source);
  const registered = new Set(document.devices.map((one) => hexId(one.vendorId, one.productId)));
  console.log(
    JSON.stringify(
      {
        workspace: root,
        source: observed === undefined ? null : source,
        layout,
        path,
        exists: file !== undefined,
        devices: document.devices,
        observed: (observed ?? []).map((keyboard) => {
          const id = hexId(keyboard.vendorId, keyboard.productId);
          return {
            name: keyboard.name,
            identifier: id,
            registered: registered.has(id),
            add: `keysync linux devices --layout ${layout} --add ${id}`,
          };
        }),
      },
      null,
      2,
    ),
  );
  return 0;
}

/** keyd の設定を workspace の `keysync/generated/` へ書き出す。`/etc/keyd/` には触らない。 */
async function linuxGenerate(root: string, file: LoadedLinuxKeymap): Promise<number> {
  const result = validateLinuxKeymap(file.document);
  if (result.summary.error === 0) {
    const plan = planLinuxApply(undefined, file.document, file.path);
    await new NodeWorkspaceStore(root).writeText(KEYD_GENERATED, plan.text);
  }
  console.log(
    JSON.stringify(
      {
        workspace: root,
        source: file.path,
        output: result.summary.error === 0 ? KEYD_GENERATED : null,
        summary: result.summary,
        diagnostics: result.diagnostics,
      },
      null,
      2,
    ),
  );
  return result.summary.error > 0 ? 1 : 0;
}

/**
 * `/etc/keyd/keysync.conf` を置き換えて keyd を reload する。`confirmed` が無ければ計画だけ出す。
 *
 * 手順は ADR 0042 の Apply フロー。error が 1 件でもあれば生成の手前で止め、
 * `keyd check` が落ちても、keyd が入っていなくても書き込まない。
 */
async function linuxApply(
  target: Parameters<typeof planLinuxApplyAt>[0],
  confirmed: string | undefined,
): Promise<number> {
  const planning = await planLinuxApplyAt(target);
  const { plan } = planning;
  const header = { workspace: target.root, source: target.path, config: target.config };
  if (planning.kind === "invalid") {
    console.log(
      JSON.stringify(
        { ...header, summary: plan.validation.summary, diagnostics: plan.diagnostics },
        null,
        2,
      ),
    );
    throw new Error("error のある desired state は適用しない");
  }

  if (confirmed === undefined) {
    console.log(
      JSON.stringify(
        {
          ...header,
          diagnostics: plan.diagnostics,
          present: plan.present,
          changed: plan.changed,
          diff: plan.entries,
          generated: planning.generated,
          check: planning.check ?? null,
          fingerprint: plan.fingerprint,
          confirm: `keysync linux apply --confirm ${plan.fingerprint}`,
        },
        null,
        2,
      ),
    );
    return 0;
  }
  if (confirmed !== plan.fingerprint) {
    throw new Error(`fingerprint が一致しない: expected=${plan.fingerprint} actual=${confirmed}`);
  }
  if (planning.check === undefined) {
    throw new Error("keyd が見つからない。keyd を入れて systemctl enable --now keyd を実行する");
  }
  if (!planning.check.ok) throw new Error(`keyd check が通らない: ${planning.check.output}`);

  const applied = await applyLinuxPlan(target, planning);
  console.log(
    JSON.stringify(
      { ...header, diagnostics: plan.diagnostics, generated: planning.generated, ...applied },
      null,
      2,
    ),
  );
  return applied.install.ok && applied.reload?.ok === true && applied.verify ? 0 : 1;
}

/** kanata の設定ファイル。`--config` で既定の場所以外も指せる。 */
function kanataConfigPath(args: ParsedArgs): string {
  return args.config === undefined ? defaultKanataConfigPath() : resolve(String(args.config));
}

/** 内蔵キーボードの扱いを確かめるために読む `karabiner.json`。 */
function karabinerPath(args: ParsedArgs): string {
  return args.karabiner === undefined
    ? defaultKarabinerConfigPath()
    : resolve(String(args.karabiner));
}

async function loadWorkspace(root: string): Promise<LoadedWorkspace> {
  const store = new NodeWorkspaceStore(root);
  const keymapText = required(
    await store.readText(WORKSPACE_LAYOUT.keymap),
    WORKSPACE_LAYOUT.keymap,
  );
  const parsed = parseKeymapYaml(keymapText);
  if (parsed.binding.definitionPath.startsWith(`${LEGACY_WORKSPACE_LAYOUT.definitions}/`)) {
    throw new Error("改名前の cornix/ を指している。keysync migrate で keysync/ へ移す");
  }
  const definitionText = await readDefinitionBinding(
    store,
    parsed.binding.definitionPath,
    parsed.binding.definitionDigest,
    webcrypto,
  );
  const definition = parseDefinition(definitionText);
  const labelsText = await store.readText(WORKSPACE_LAYOUT.labels);
  return {
    root,
    store,
    keymapText,
    parsed,
    definitionText,
    definition,
    labels: labelsText === undefined ? EMPTY_LABELS : parseLabelsYaml(labelsText),
  };
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const result: ParsedArgs = { _: [] };
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (token === undefined) continue;
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = argv[index + 1];
      if (next !== undefined && !next.startsWith("--")) {
        result[key] = next;
        index++;
      } else result[key] = true;
    } else result._.push(token);
  }
  return result;
}

type ParsedArgs = { _: string[]; [key: string]: string | boolean | string[] | undefined };
function required(value: string | undefined, name: string): string {
  if (value === undefined) throw new Error(`${name} が見つからない`);
  return value;
}
function mapReplacer(_key: string, value: unknown): unknown {
  return value instanceof Map ? Object.fromEntries(value) : value;
}
function printHelp(): void {
  console.log(
    `keysync validate|analyze|diff|render|export vil\n  --workspace <dir>\n  diff --against <file.vil>\n  render --format svg|pdf --out <file> --layer <n>\n  import vil <file.vil> --definition <definition.json>\n  migrate （改名前の cornix/ を keysync/ へ移す）\n  mac generate [--out <file>]\n  mac diff [--config <kanata.kbd>]\n  mac apply [--confirm <fingerprint>] [--config <kanata.kbd>]\n  mac service status|install （kanata を launchd に登録する。install は sudo を使う）\n  mac record [--tasks roll|hold|all] （課題を打って記録し keysync/typing-logs/ へ書く）\n  mac record --free [秒数] （課題なしで記録する。既定 30 秒）\n  mac ... --layout ansi|jis （既定は実行中のMacの内蔵配列を検出）\n  linux devices [--devices <file>] [--add <vendor>:<product>]\n  linux generate|diff\n  linux apply [--confirm <fingerprint>] [--config <keysync.conf>]\n  linux ... --layout ansi|jis （linux-keyboard.*.yaml が 1 つだけなら省略可）\n  --workspace の既定は $KEYSYNC_WORKSPACE（未設定ならエラー）`,
  );
}

if (import.meta.main) process.exitCode = await main();
