/**
 * `/proc/bus/input/devices` から Linux が認識しているキーボードを読む。
 *
 * keyd の `[ids]` に書く `vendor:product` の出どころ（ADR 0042）。ファイルは一般ユーザーでも
 * 読めるので root は要らない。解析は純関数に分け、Linux 以外でも test できるようにする。
 */

import { readFile } from "node:fs/promises";

/** Linux の入力デバイス一覧。 */
export const INPUT_DEVICES_PATH = "/proc/bus/input/devices";

/** 観測されたキーボード 1 台。 */
export interface LinuxObservedKeyboard {
  readonly name: string;
  readonly vendorId: number;
  readonly productId: number;
}

/**
 * `/proc/bus/input/devices` のテキストからキーボードを取り出す。
 *
 * handler に `kbd` を持つ block だけを残す。電源ボタンや trackpad は外れる。
 * 1 台のキーボードが複数の event node を持つので、同じ id と名前は 1 件にまとめる。
 *
 * @doc docs/specs/linux-keymap.md#readlinuxkeyboards
 */
export function parseInputDevices(text: string): readonly LinuxObservedKeyboard[] {
  const keyboards: LinuxObservedKeyboard[] = [];
  const seen = new Set<string>();
  for (const block of text.split(/\n\s*\n/)) {
    const ids = /^I: .*Vendor=([0-9a-fA-F]{4}) Product=([0-9a-fA-F]{4})/m.exec(block);
    const name = /^N: Name="(.*)"$/m.exec(block);
    const handlers = /^H: Handlers=(.*)$/m.exec(block);
    if (ids?.[1] === undefined || ids[2] === undefined || name?.[1] === undefined) continue;
    if (!(handlers?.[1] ?? "").split(/\s+/).includes("kbd")) continue;
    const keyboard = {
      name: name[1],
      vendorId: Number.parseInt(ids[1], 16),
      productId: Number.parseInt(ids[2], 16),
    };
    const key = `${keyboard.vendorId}:${keyboard.productId}:${keyboard.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    keyboards.push(keyboard);
  }
  return keyboards;
}

/**
 * キーボードの一覧を読む。ファイルが無ければ（Linux 以外）`undefined`。
 *
 * @doc docs/specs/linux-keymap.md#readlinuxkeyboards
 */
export async function readLinuxKeyboards(
  path: string = INPUT_DEVICES_PATH,
): Promise<readonly LinuxObservedKeyboard[] | undefined> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return undefined;
  }
  return parseInputDevices(text);
}
