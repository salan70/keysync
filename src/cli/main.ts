#!/usr/bin/env node
import { webcrypto } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { parseDefinition } from "../core/definition/parse.ts";
import { canonicalDefinitionText } from "../core/definition/identity.ts";
import { diffDocuments } from "../core/diff/diff.ts";
import { analyzeReachability } from "../core/validation/reachability.ts";
import { validateKeymap } from "../core/validation/validate.ts";
import { parseVil } from "../core/vil/parse.ts";
import { serializeVil } from "../core/vil/serialize.ts";
import { parseKeymapYaml } from "../core/keymap-yaml/parse.ts";
import { serializeKeymapYaml } from "../core/keymap-yaml/serialize.ts";
import { planMacApply } from "../core/mac-keymap/apply.ts";
import { addMacDevice } from "../core/mac-keymap/edit.ts";
import { serializeMacKeymapYaml } from "../core/mac-keymap/serialize.ts";
import { validateMacKeymap } from "../core/mac-keymap/validate.ts";
import type { MacKeyboardLayout, MacKeymapDocument } from "../core/mac-keymap/types.ts";
import { applyMacPlan, planMacApplyAt, writeAndLintAsset } from "../mac/apply-service.ts";
import { detectBuiltInLayout } from "../mac/keyboard-type.ts";
import { readMacKeymapFor } from "../workspace/mac-keymap-file.ts";
import { planLayoutMigration, writeLayoutMigration } from "../workspace/bootstrap.ts";
import {
  createKarabinerCli,
  defaultKarabinerConfigPath,
  KARABINER_DEVICES_PATH,
  readKarabinerConfig,
  readObservedKeyboards,
  type KarabinerCli,
} from "../karabiner/node.ts";
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

/** テストから実物の `karabiner_cli` と keyd / sudo を外すための注入口。 */
interface CliDeps {
  readonly karabinerCli?: KarabinerCli;
  readonly keydHost?: KeydHost;
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
 * `deps` はテストのための注入口である。`karabiner_cli` は CI の macOS runner に無く、
 * 実物を叩くテストは書けない（ADR 0022）。
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
 * MacBook 内蔵キーボードの生成・差分・適用。
 *
 * 適用は CLI とローカルサーバーの適用 API が行う。Web UI 自身は `karabiner.json` に触れない
 * （ADR 0034）。
 */
async function mac(root: string, args: ParsedArgs, deps: CliDeps): Promise<number> {
  const sub = args._[0];
  const cli = deps.karabinerCli ?? createKarabinerCli();
  const loaded = await loadMacKeymap(root, args);
  if (sub === "generate") return await macGenerate(root, loaded, args, cli);
  if (sub === "diff") return await macDiff(root, loaded, args);
  if (sub === "apply") return await macApply(root, loaded, args, cli);
  if (sub === "devices") return await macDevices(root, loaded, args);
  throw new Error("keysync mac generate|diff|apply|devices が必要");
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

/** `--add` が受ける `<vendor_id>:<product_id>`。10 進の整数 2 つだけを受ける。 */
function parseDeviceArg(value: string): { readonly vendorId: number; readonly productId: number } {
  const match = /^([0-9]+):([0-9]+)$/.exec(value);
  if (match?.[1] === undefined || match[2] === undefined) {
    throw new Error(`--add は <vendor_id>:<product_id> の形（${value} が渡された）`);
  }
  return { vendorId: Number(match[1]), productId: Number(match[2]) };
}

/**
 * 適用先デバイスの一覧と登録。
 *
 * `--add` が無ければ観測されたキーボードを出して終わる。`mac apply` と同じで、
 * **見てから明示的に指定したときだけ**書き込む。内蔵キーボードは vendor / product id を
 * 申告しないため一覧に id が出ない。既定で対象なので登録も要らない。
 *
 * Cornix LP のような他のキーボードもここに並ぶ。登録すると Mac の keymap がその実機の
 * firmware keymap と二重に効くので、product を見て選ぶ必要がある（ADR 0022 の隔離）。
 */
async function macDevices(
  root: string,
  loaded: LoadedMacKeymap,
  args: ParsedArgs,
): Promise<number> {
  // `--karabiner` と同じく、既定の場所以外も指せるようにする。
  const observed = await readObservedKeyboards(
    args.devices === undefined ? undefined : String(args.devices),
  );
  const add = args.add === undefined ? undefined : parseDeviceArg(String(args.add));

  if (add !== undefined) {
    const next = addMacDevice(loaded.document, add);
    await new NodeWorkspaceStore(root).writeText(loaded.path, serializeMacKeymapYaml(next));
    console.log(
      JSON.stringify(
        {
          workspace: root,
          path: loaded.path,
          layout: loaded.layout,
          devices: next.devices,
          added: add,
        },
        null,
        2,
      ),
    );
    return 0;
  }

  const registered = new Set(
    loaded.document.devices.flatMap((device) =>
      "builtIn" in device ? [] : [`${device.vendorId}:${device.productId}`],
    ),
  );
  const list = (observed ?? []).map((keyboard) => {
    const id =
      keyboard.vendorId === undefined || keyboard.productId === undefined
        ? undefined
        : `${keyboard.vendorId}:${keyboard.productId}`;
    return {
      product: keyboard.product ?? null,
      manufacturer: keyboard.manufacturer ?? null,
      builtIn: keyboard.builtIn,
      identifier: id ?? null,
      registered: keyboard.builtIn
        ? loaded.document.devices.some((device) => "builtIn" in device)
        : id !== undefined && registered.has(id),
      add: id === undefined ? null : `keysync mac devices --layout ${loaded.layout} --add ${id}`,
    };
  });
  console.log(
    JSON.stringify(
      {
        workspace: root,
        source:
          observed === undefined
            ? null
            : args.devices === undefined
              ? KARABINER_DEVICES_PATH
              : String(args.devices),
        layout: loaded.layout,
        path: loaded.path,
        devices: loaded.document.devices,
        observed: list,
      },
      null,
      2,
    ),
  );
  return 0;
}

/** complex_modifications の asset を書き出す。Karabiner が入っていれば lint も通す。 */
async function macGenerate(
  root: string,
  loaded: LoadedMacKeymap,
  args: ParsedArgs,
  cli: KarabinerCli,
): Promise<number> {
  const result = validateMacKeymap(loaded.document);
  const target = String(args.out ?? generatedPath("karabiner-complex-modifications.json"));
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
  const { output, lint } = await writeAndLintAsset(root, loaded.document, target, cli);
  console.log(
    JSON.stringify(
      {
        workspace: root,
        layout: loaded.layout,
        source: loaded.path,
        output,
        summary: result.summary,
        diagnostics: result.diagnostics,
        lint: lint ?? null,
      },
      null,
      2,
    ),
  );
  return lint !== undefined && !lint.ok ? 1 : 0;
}

/** 所有 profile の構造 diff を出す。karabiner.json は読むだけ。 */
async function macDiff(root: string, loaded: LoadedMacKeymap, args: ParsedArgs): Promise<number> {
  const path = karabinerPath(args);
  const { config } = await readKarabinerConfig(path);
  const plan = planMacApply(config, loaded.document, { selectProfile: selectProfileArg(args) });
  console.log(
    JSON.stringify(
      {
        workspace: root,
        layout: loaded.layout,
        source: loaded.path,
        karabiner: path,
        summary: plan.validation.summary,
        diagnostics: plan.diagnostics,
        selection: plan.selection,
        fingerprint: plan.fingerprint,
        diff: plan.diff,
      },
      null,
      2,
    ),
  );
  return plan.validation.summary.error > 0 ? 1 : 0;
}

/**
 * 所有 profile を置き換え、必要なら profile を選択する。
 *
 * `--confirm` が無いうちは asset の生成と lint、diff、fingerprint を出して終わる。人間が
 * 中身を見てから同じ fingerprint を渡したときだけ `karabiner.json` を書く（ADR 0022 の
 * Apply フロー）。手順はローカルサーバーの適用 API と共通で、`apply-service.ts` が持つ。
 */
async function macApply(
  root: string,
  loaded: LoadedMacKeymap,
  args: ParsedArgs,
  cli: KarabinerCli,
): Promise<number> {
  const select = selectProfileArg(args);
  const path = karabinerPath(args);
  const target = {
    root,
    layout: loaded.layout,
    path: loaded.path,
    document: loaded.document,
    karabiner: path,
    cli,
    selectProfile: select,
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

  const confirmed = args.confirm === undefined ? undefined : String(args.confirm);
  if (confirmed === undefined) {
    console.log(
      JSON.stringify(
        {
          workspace: root,
          layout: loaded.layout,
          source: loaded.path,
          karabiner: path,
          diagnostics: plan.diagnostics,
          diff: plan.diff,
          generated: planning.generated,
          lint: planning.lint ?? null,
          selection: plan.selection,
          fingerprint: plan.fingerprint,
          // `--no-select` は診断を変え、診断 id は指紋に入る。フラグを取り違えたまま
          // 確認すると黙って別の計画が通るので、確認文字列にフラグを含める。
          confirm: `keysync mac apply${select ? "" : " --no-select"} --confirm ${plan.fingerprint}`,
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
  if (planning.lint !== undefined && !planning.lint.ok) {
    throw new Error(`lint が通らない: ${planning.lint.output}`);
  }

  const applied = await applyMacPlan(target, planning);
  console.log(
    JSON.stringify(
      {
        workspace: root,
        layout: loaded.layout,
        source: loaded.path,
        karabiner: path,
        backup: applied.backup,
        diagnostics: plan.diagnostics,
        generated: planning.generated,
        lint: planning.lint ?? null,
        verify: applied.verify,
        selected: applied.selected,
      },
      null,
      2,
    ),
  );
  if (!applied.verify.ok) return 1;
  return applied.selected !== null && !applied.selected.ok ? 1 : 0;
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

/** `--no-select` を受ける。既定は選択する（ADR 0028）。 */
function selectProfileArg(args: ParsedArgs): boolean {
  return args["no-select"] === undefined;
}
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
    `keysync validate|analyze|diff|render|export vil\n  --workspace <dir>\n  diff --against <file.vil>\n  render --format svg|pdf --out <file> --layer <n>\n  import vil <file.vil> --definition <definition.json>\n  migrate （改名前の cornix/ を keysync/ へ移す）\n  mac generate --out <file>\n  mac diff --karabiner <karabiner.json>\n  mac apply --karabiner <karabiner.json> --confirm <fingerprint> [--no-select]\n  mac devices [--devices <observed.json>] [--add <vendor_id>:<product_id>]\n  mac ... --layout ansi|jis （既定は実行中のMacの内蔵配列を検出）\n  linux devices [--devices <file>] [--add <vendor>:<product>]\n  linux generate|diff\n  linux apply [--confirm <fingerprint>] [--config <keysync.conf>]\n  linux ... --layout ansi|jis （linux-keyboard.*.yaml が 1 つだけなら省略可）\n  --workspace の既定は $KEYSYNC_WORKSPACE（未設定ならエラー）`,
  );
}

if (import.meta.main) process.exitCode = await main();
