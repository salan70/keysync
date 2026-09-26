/**
 * workspace から物理配列ごとの Linux 設定を読む。
 *
 * `src/core/linux-keymap/` は filesystem に触らないので、名前の解決はここが持つ。
 * Mac 側と違い旧名は無い（ADR 0042）。
 */

import { parseLinuxKeymapYaml } from "../core/linux-keymap/parse.ts";
import type { LinuxKeymapDocument } from "../core/linux-keymap/types.ts";
import type { MacKeyboardLayout } from "../core/mac-keymap/types.ts";
import { linuxKeymapPath } from "./layout.ts";
import type { WorkspaceFileStore } from "./types.ts";

/** 読めた設定 1 件。 */
export interface LinuxKeymapFile {
  readonly path: string;
  readonly document: LinuxKeymapDocument;
}

/**
 * 指定した配列の設定を読む。無ければ `undefined`。中の `layout` 宣言がファイル名と
 * 違えば落とす。
 *
 * @doc docs/specs/workspace-cli.md#readlinuxkeymapfor
 */
export async function readLinuxKeymapFor(
  store: Pick<WorkspaceFileStore, "readText">,
  layout: MacKeyboardLayout,
): Promise<LinuxKeymapFile | undefined> {
  const path = linuxKeymapPath(layout);
  const text = await store.readText(path);
  if (text === undefined) return undefined;
  const document = parseLinuxKeymapYaml(text);
  if (document.layout !== layout) {
    throw new Error(`${path} の layout 宣言が ${document.layout} でファイル名と一致しない`);
  }
  return { path, document };
}
