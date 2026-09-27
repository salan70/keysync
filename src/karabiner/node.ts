/**
 * `karabiner.json` を読む Node adapter。
 *
 * Mac の engine は kanata で（ADR 0049）、KeySync は `karabiner.json` へ書き込まない。
 * Karabiner-Elements は kanata が使うドライバの提供元として入れたままにする。ここで読むのは、
 * Karabiner が内蔵キーボードを掴んで kanata への入力を奪っていないかを確かめるためだけである。
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** Karabiner が読む設定ファイルの既定の場所。 */
export function defaultKarabinerConfigPath(): string {
  return join(homedir(), ".config", "karabiner", "karabiner.json");
}

/**
 * `karabiner.json` を JSON として読む。ファイルが無ければ `undefined`（Karabiner 不在）。
 *
 * @doc docs/specs/mac-keymap.md#readkarabinerconfig
 */
export async function readKarabinerConfig(path: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(
      `${path} を JSON として読めない: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
