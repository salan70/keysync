/**
 * kanata の設定ファイル（`kanata.kbd`）への適用を組み立てる純関数。
 *
 * KeySync はこのファイル全体を所有し、kanata は設定ファイルを書き戻さない。したがって
 * diff と verify はテキストで行う（ADR 0042 の keyd と同じ、ADR 0049）。表示用の diff だけは
 * layer とキーの単位に分けて出す。filesystem・kanata・Karabiner には触らない。
 */

import { createDiagnostic, summarize, type Diagnostic } from "../validation/types.ts";
import { generateKanataConfig, kanataLayerName, TAPPING_TERM_VARIABLE } from "./kanata/generate.ts";
import { KANATA_KEY_NAMES } from "./kanata/key-names.ts";
import type { MacKeymapDocument } from "./types.ts";
import { validateMacKeymap, type MacValidationResult } from "./validate.ts";

/**
 * 差分 1 件。キーの割り当ては layer と位置（Karabiner の `key_code` 名）で指す。
 * layer の外の設定（閾値や手の割り当て）は `layer` が `null` で、`keyCode` に設定の名前を置く。
 */
export interface MacDiffEntry {
  readonly layer: number | null;
  readonly keyCode: string;
  readonly change: "added" | "removed" | "changed";
  readonly before?: string;
  readonly after?: string;
}

/** 計画を組むときに外から渡す、このマシンの状態。 */
export interface MacApplyEnvironment {
  /** 生成物の先頭に書く元ファイルの名前。 */
  readonly source?: string;
  /**
   * Karabiner-Elements が内蔵キーボードを掴むか。掴むと kanata へ入力が届かない（ADR 0049）。
   * Karabiner が入っていなければ `false`。
   */
  readonly karabinerGrabsBuiltIn?: boolean;
}

/** 適用計画。write は行わない。 */
export interface MacApplyPlan {
  readonly validation: MacValidationResult;
  /** validation に加えて、このマシンの状態から分かることを含む。 */
  readonly diagnostics: readonly Diagnostic[];
  /** 適用前にファイルがあったか。 */
  readonly present: boolean;
  /** 置き換え後のファイルの内容。 */
  readonly text: string;
  readonly changed: boolean;
  readonly entries: readonly MacDiffEntry[];
  /** 人間の確認と適用を結びつける同一性の指紋。表示用ではない。 */
  readonly fingerprint: string;
}

/**
 * 現在のファイルの内容（無ければ `undefined`）と desired state から適用計画を組む。
 *
 * @doc docs/specs/mac-keymap.md#planmacapply
 */
export function planMacApply(
  current: string | undefined,
  document: MacKeymapDocument,
  environment: MacApplyEnvironment = {},
): MacApplyPlan {
  const validation = validateMacKeymap(document);
  const { text } = generateKanataConfig(document, environment.source);
  const diagnostics = [...validation.diagnostics];
  if (environment.karabinerGrabsBuiltIn === true) {
    diagnostics.push(
      createDiagnostic(
        "mac-keymap/karabiner-grabs-built-in",
        "warning",
        { kind: "document" },
        "Karabiner-Elements が内蔵キーボードを掴んでいるので、kanata へ入力が届かない。Karabiner-Elements の Devices で内蔵キーボードの Modify events を切る",
      ),
    );
  }
  if (current !== undefined && includedDevices(current) !== includedDevices(text)) {
    diagnostics.push(
      createDiagnostic(
        "mac-keymap/devices-need-restart",
        "warning",
        { kind: "document" },
        "適用先デバイスが変わる。kanata は掴むデバイスを起動時に決め、Reload では変えないので、適用後に keysync mac service restart で kanata を起動し直す",
      ),
    );
  }
  return {
    validation,
    diagnostics,
    present: current !== undefined,
    text,
    changed: current !== text,
    entries: diffKanataText(current ?? "", text),
    fingerprint: fingerprint(text, diagnostics),
  };
}

/**
 * kanata の設定の `macos-dev-names-include` の行。無ければ `undefined`。
 *
 * kanata は掴むデバイスを起動時に決め、Reload では読み直さない（ADR 0052）。
 */
function includedDevices(text: string): string | undefined {
  return /^ {2}macos-dev-names-include .*$/m.exec(text)?.[0];
}

/**
 * 適用後に読み直したファイルが生成物と一致するか。テキストで比べる。
 *
 * @doc docs/specs/mac-keymap.md#planmacapply
 */
export function verifyMacApply(observed: string | undefined, expected: string): boolean {
  return observed === expected;
}

/**
 * kanata の設定テキストを、layer とキー・設定の単位で突き合わせる。
 *
 * 解釈するのは KeySync が出す形だけで、コメントと閉じ括弧は見ない。`deflayermap` の中は
 * 1 行を 1 キーとし、外は 1 行を 1 設定とする。
 *
 * @doc docs/specs/mac-keymap.md#planmacapply
 */
export function diffKanataText(before: string, after: string): readonly MacDiffEntry[] {
  const left = indexKanata(before);
  const right = indexKanata(after);
  const entries: MacDiffEntry[] = [];
  for (const id of [...new Set([...left.keys(), ...right.keys()])].sort()) {
    const one = left.get(id);
    const other = right.get(id);
    if (one !== undefined && other !== undefined) {
      if (one.value !== other.value) {
        entries.push({ ...place(other), change: "changed", before: one.value, after: other.value });
      }
    } else if (other !== undefined) {
      entries.push({ ...place(other), change: "added", after: other.value });
    } else if (one !== undefined) {
      entries.push({ ...place(one), change: "removed", before: one.value });
    }
  }
  return entries;
}

/**
 * 所有するファイルに書かれている mod-tap の閾値（ms）。読めなければ `null`。
 *
 * 打鍵ログに「記録した時点で効いていた閾値」を残すのに使う（ADR 0046）。
 *
 * @doc docs/specs/mac-keymap.md#appliedtappingtermms
 */
export function appliedTappingTermMs(text: string): number | null {
  const match = new RegExp(`^\\(defvar ${TAPPING_TERM_VARIABLE} ([0-9]+)\\)$`, "m").exec(text);
  return match?.[1] === undefined ? null : Number(match[1]);
}

/**
 * `karabiner.json` の内容から、Karabiner-Elements が内蔵キーボードを掴むかを判定する。
 *
 * 選択中の profile の `devices` に、内蔵キーボード（vendor / product id を持たないキーボード）を
 * `ignore: true` にした項目があれば掴まない。Karabiner の Devices 画面で Modify events を切ると
 * この項目が書かれる（R-010 で確認）。形が読めなければ掴むとみなす。
 *
 * @doc docs/specs/mac-keymap.md#planmacapply
 */
export function karabinerGrabsBuiltIn(config: unknown): boolean {
  return !ignoredDevices(config).some(
    (identifiers) =>
      identifiers.is_built_in_keyboard === true ||
      (identifiers.is_keyboard === true &&
        identifiers.vendor_id === undefined &&
        identifiers.product_id === undefined),
  );
}

/**
 * `karabiner.json` の内容から、Karabiner-Elements が外付けキーボードを掴むかを判定する。
 *
 * 内蔵と同じく、選択中の profile で vendor / product id が一致する項目が `ignore: true` なら
 * 掴まない。掴んでいると kanata がそのキーボードを開けない（ADR 0052）。
 *
 * @doc docs/specs/mac-keymap.md#planmacapply
 */
export function karabinerGrabsExternal(
  config: unknown,
  vendorId: number,
  productId: number,
): boolean {
  return !ignoredDevices(config).some(
    (identifiers) => identifiers.vendor_id === vendorId && identifiers.product_id === productId,
  );
}

/** 選択中の profile で `ignore: true` の項目の `identifiers`。形が読めなければ空。 */
function ignoredDevices(config: unknown): readonly Record<string, unknown>[] {
  const profiles = record(config)?.profiles;
  if (!Array.isArray(profiles)) return [];
  const selected = profiles.map(record).find((profile) => profile?.selected === true);
  const devices = selected?.devices;
  if (!Array.isArray(devices)) return [];
  return devices
    .map(record)
    .filter((device) => device?.ignore === true)
    .map((device) => record(device?.identifiers))
    .filter((identifiers) => identifiers !== undefined);
}

interface IndexedLine {
  readonly layer: number | null;
  readonly key: string;
  readonly value: string;
}

/** kanata のキー名 → 位置（Karabiner の `key_code` 名）。 */
const POSITION_OF: ReadonlyMap<string, string> = new Map(
  [...KANATA_KEY_NAMES.entries()].map(([keyCode, name]) => [name, keyCode]),
);

function place(line: IndexedLine): { layer: number | null; keyCode: string } {
  return {
    layer: line.layer,
    keyCode: line.layer === null ? line.key : (POSITION_OF.get(line.key) ?? line.key),
  };
}

function layerNumber(name: string): number | null {
  if (name === kanataLayerName(0)) return 0;
  const match = /^l([0-9]+)$/.exec(name);
  return match?.[1] === undefined ? null : Number(match[1]);
}

function indexKanata(text: string): ReadonlyMap<string, IndexedLine> {
  const indexed = new Map<string, IndexedLine>();
  let layer: number | null = null;
  let inLayer = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith(";;") || line === ")") {
      if (line === ")") inLayer = false;
      continue;
    }
    const header = /^\(deflayermap \((.+)\)$/.exec(line);
    if (header?.[1] !== undefined) {
      layer = layerNumber(header[1]);
      inLayer = true;
      continue;
    }
    if (inLayer) {
      if (line === "___ _") continue;
      const separator = line.indexOf(" ");
      const key = separator < 0 ? line : line.slice(0, separator);
      const value = separator < 0 ? "" : line.slice(separator + 1);
      indexed.set(`${layer}\u0000${key}`, { layer, key, value });
      continue;
    }
    // layer の外。`(defvar name value)` は name を、それ以外は先頭の語を設定の名前にする。
    const words = line.replace(/^\(+/, "").replace(/\)+$/, "").split(/\s+/);
    const [first, second, ...rest] = words;
    if (first === undefined || ["defcfg", "defsrc", "defhands"].includes(first)) continue;
    const key = first === "defvar" && second !== undefined ? second : first;
    const value = (first === "defvar" ? rest : [second, ...rest]).filter(Boolean).join(" ");
    indexed.set(`setting\u0000${key}`, { layer: null, key, value });
  }
  return indexed;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

/** 計画の全入力を順序を固定して表現する。表示用ではなく同一性確認用。 */
function fingerprint(text: string, diagnostics: readonly Diagnostic[]): string {
  const source = JSON.stringify([
    "mac-kanata-apply-plan-v1",
    text,
    diagnostics.map((diagnostic) => diagnostic.id),
    summarize(diagnostics),
  ]);

  let first = 0x811c9dc5;
  let second = 5381;
  for (let index = 0; index < source.length; index++) {
    const code = source.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    second = (Math.imul(second, 33) ^ code) >>> 0;
  }
  return `v1-${first.toString(16).padStart(8, "0")}-${second.toString(16).padStart(8, "0")}`;
}
