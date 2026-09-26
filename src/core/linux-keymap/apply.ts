/**
 * `/etc/keyd/keysync.conf` への適用を組み立てる純関数。
 *
 * KeySync はこのファイル全体を所有し、keyd は設定ファイルを書き戻さない。したがって
 * diff と verify はテキストで行う（ADR 0042）。表示用の diff だけは section とキーの
 * 単位に分けて出す。filesystem・sudo・keyd には触らない。
 */

import { summarize, type Diagnostic } from "../validation/types.ts";
import type { MacValidationResult } from "../mac-keymap/validate.ts";
import { generateKeydConfig } from "./generate.ts";
import type { LinuxKeymapDocument } from "./types.ts";
import { validateLinuxKeymap } from "./validate.ts";

/** binding 1 件の差分。`[ids]` の行は key が id、値が空文字。 */
export interface KeydBindingDiff {
  readonly section: string;
  readonly key: string;
  readonly change: "added" | "removed" | "changed";
  readonly before?: string;
  readonly after?: string;
}

/** 適用計画。write は行わない。 */
export interface LinuxApplyPlan {
  readonly validation: MacValidationResult;
  readonly diagnostics: readonly Diagnostic[];
  /** 適用前にファイルがあったか。 */
  readonly present: boolean;
  /** 置き換え後のファイルの内容。 */
  readonly text: string;
  readonly changed: boolean;
  readonly entries: readonly KeydBindingDiff[];
  /** 人間の確認と適用を結びつける同一性の指紋。表示用ではない。 */
  readonly fingerprint: string;
}

/**
 * 現在のファイルの内容（無ければ `undefined`）と desired state から適用計画を組む。
 *
 * @doc docs/specs/linux-keymap.md#planlinuxapply
 */
export function planLinuxApply(
  current: string | undefined,
  document: LinuxKeymapDocument,
  source: string,
): LinuxApplyPlan {
  const validation = validateLinuxKeymap(document);
  const { text } = generateKeydConfig(document, source);
  const entries = diffKeydText(current ?? "", text);
  return {
    validation,
    diagnostics: validation.diagnostics,
    present: current !== undefined,
    text,
    changed: current !== text,
    entries,
    fingerprint: fingerprint(text, validation.diagnostics),
  };
}

/**
 * 適用後に読み直したファイルが生成物と一致するか。テキストで比べる。
 *
 * @doc docs/specs/linux-keymap.md#planlinuxapply
 */
export function verifyLinuxApply(observed: string | undefined, expected: string): boolean {
  return observed === expected;
}

/**
 * keyd の設定テキストを section とキーの単位で突き合わせる。
 *
 * 解釈するのは KeySync が出す形（`[section]`、`key = action`、`[ids]` の id 行）だけで、
 * コメントと空行は見ない。手で書かれた別の構文は 1 行を 1 キーとして扱う。
 *
 * @doc docs/specs/linux-keymap.md#planlinuxapply
 */
export function diffKeydText(before: string, after: string): readonly KeydBindingDiff[] {
  const left = indexKeyd(before);
  const right = indexKeyd(after);
  const entries: KeydBindingDiff[] = [];
  for (const id of [...new Set([...left.keys(), ...right.keys()])].sort()) {
    const one = left.get(id);
    const other = right.get(id);
    if (one !== undefined && other !== undefined) {
      if (one.value !== other.value) {
        entries.push({ ...pick(other), change: "changed", before: one.value, after: other.value });
      }
    } else if (other !== undefined) {
      entries.push({ ...pick(other), change: "added", after: other.value });
    } else if (one !== undefined) {
      entries.push({ ...pick(one), change: "removed", before: one.value });
    }
  }
  return entries;
}

interface IndexedBinding {
  readonly section: string;
  readonly key: string;
  readonly value: string;
}

function pick(binding: IndexedBinding): { section: string; key: string } {
  return { section: binding.section, key: binding.key };
}

function indexKeyd(text: string): ReadonlyMap<string, IndexedBinding> {
  const indexed = new Map<string, IndexedBinding>();
  let section = "";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const header = /^\[(.+)\]$/.exec(line);
    if (header?.[1] !== undefined) {
      section = header[1];
      continue;
    }
    const separator = line.indexOf("=");
    const key = separator < 0 ? line : line.slice(0, separator).trim();
    const value = separator < 0 ? "" : line.slice(separator + 1).trim();
    indexed.set(`${section}\u0000${key}`, { section, key, value });
  }
  return indexed;
}

/** 計画の全入力を順序を固定して表現する。表示用ではなく同一性確認用。 */
function fingerprint(text: string, diagnostics: readonly Diagnostic[]): string {
  const source = JSON.stringify([
    "linux-apply-plan-v1",
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
