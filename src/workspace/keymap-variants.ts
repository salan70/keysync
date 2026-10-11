/**
 * 名前を付けて保持したキーマップと、適用対象との入れ替え。
 *
 * 適用対象は固定名（`keymap.yaml`、`mac-keyboard.<layout>.yaml`）のまま変えない。CLI の apply も
 * ローカルサーバーの適用 API も kanata の再起動経路も、この名前だけを読むからである（ADR 0053）。
 * 保持したキーマップは同じ directory に `keymap.<name>.yaml` / `mac-keyboard.<layout>.<name>.yaml`
 * として並べ、切り替えは「保持した内容を適用対象へ書き戻す」操作にする。
 *
 * `src/core/` は filesystem に触らないので、名前の規則と入れ替えはここが持つ。
 */

import { parseKeymapYaml } from "../core/keymap-yaml/parse.ts";
import { serializeKeymapYaml } from "../core/keymap-yaml/serialize.ts";
import { parseMacKeymapYaml } from "../core/mac-keymap/parse.ts";
import { serializeMacKeymapYaml } from "../core/mac-keymap/serialize.ts";
import type { MacKeyboardLayout } from "../core/mac-keymap/types.ts";
import { macKeymapPath, WORKSPACE_LAYOUT } from "./layout.ts";
import type { WorkspaceFileStore } from "./types.ts";

/** 保持と切り替えの単位。Cornix は 1 つ、Mac は物理配列ごと（ADR 0027）。 */
export type KeymapTarget =
  | { readonly kind: "cornix" }
  | { readonly kind: "mac"; readonly layout: MacKeyboardLayout };

/** 保持したキーマップ 1 件。`path` は workspace root からの相対 path。 */
export interface KeymapVariant {
  readonly name: string;
  readonly path: string;
}

/**
 * 名前に使える文字。小文字の英数字とハイフンだけで、`.` を含めない。
 * ファイル名の `.` 区切りで配列と名前を切り出すため、名前に `.` があると曖昧になる。
 */
export const KEYMAP_VARIANT_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** 切り替え先を読めなかった、または現在の内容がどの保持にも無い。 */
export class KeymapVariantError extends Error {}

const ALL_TARGETS: readonly KeymapTarget[] = [
  { kind: "cornix" },
  { kind: "mac", layout: "ansi" },
  { kind: "mac", layout: "jis" },
];

/** 適用対象のファイル。CLI とサーバーが読むのはこれだけである。 */
export function activeKeymapPath(target: KeymapTarget): string {
  return target.kind === "cornix" ? WORKSPACE_LAYOUT.keymap : macKeymapPath(target.layout);
}

/**
 * 保持したキーマップのファイル名。名前が規則に合わなければ落とす。
 *
 * @doc docs/specs/workspace-cli.md#キーマップの保持
 */
export function keymapVariantPath(target: KeymapTarget, name: string): string {
  if (!KEYMAP_VARIANT_NAME.test(name)) {
    throw new KeymapVariantError(
      `キーマップの名前は小文字の英数字とハイフンだけ（64 文字まで）: ${name}`,
    );
  }
  return `${variantPrefix(target)}${name}.yaml`;
}

/**
 * ファイル名から保持したキーマップの名前を取り出す。対象のものでなければ `undefined`。
 *
 * @doc docs/specs/workspace-cli.md#キーマップの保持
 */
export function keymapVariantName(target: KeymapTarget, fileName: string): string | undefined {
  const prefix = variantPrefix(target);
  if (!fileName.startsWith(prefix) || !fileName.endsWith(".yaml")) return undefined;
  const name = fileName.slice(prefix.length, -".yaml".length);
  return KEYMAP_VARIANT_NAME.test(name) ? name : undefined;
}

/** 適用対象か保持したキーマップのファイルか。サーバーが root 直下で触れてよい範囲を決める。 */
export function isKeymapFile(fileName: string): boolean {
  return ALL_TARGETS.some(
    (target) =>
      fileName === activeKeymapPath(target) || keymapVariantName(target, fileName) !== undefined,
  );
}

/** 保持したキーマップか（適用対象は含まない）。削除してよいのはこちらだけである。 */
export function isKeymapVariantFile(fileName: string): boolean {
  return ALL_TARGETS.some((target) => keymapVariantName(target, fileName) !== undefined);
}

/**
 * 対象の保持したキーマップを名前順に並べる。
 *
 * @doc docs/specs/workspace-cli.md#キーマップの保持
 */
export async function listKeymapVariants(
  store: Pick<WorkspaceFileStore, "listFiles">,
  target: KeymapTarget,
): Promise<readonly KeymapVariant[]> {
  const names = await store.listFiles("");
  return names
    .map((fileName) => ({ name: keymapVariantName(target, fileName), path: fileName }))
    .filter((entry): entry is KeymapVariant => entry.name !== undefined)
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/**
 * 正規形へ直したテキスト。手で書いたコメントや並び順の違いを同じ内容として扱うために使う。
 * parse できなければ Core の例外をそのまま出す。
 */
export function canonicalKeymapText(target: KeymapTarget, text: string): string {
  if (target.kind === "cornix") {
    const parsed = parseKeymapYaml(text);
    return serializeKeymapYaml(parsed.document, parsed.binding);
  }
  const document = parseMacKeymapYaml(text);
  if (document.layout !== target.layout) {
    throw new KeymapVariantError(
      `layout 宣言が ${document.layout} で、対象の配列 ${target.layout} と一致しない`,
    );
  }
  return serializeMacKeymapYaml(document);
}

/**
 * 適用対象の内容と同じ保持の名前。無ければ `undefined`。
 *
 * 適用対象が無い、または parse できないときも `undefined`。読めない保持は比較から外す。
 *
 * @doc docs/specs/workspace-cli.md#キーマップの保持
 */
export async function matchKeymapVariant(
  store: Pick<WorkspaceFileStore, "readText" | "listFiles">,
  target: KeymapTarget,
  variants?: readonly KeymapVariant[],
): Promise<string | undefined> {
  const activeText = await store.readText(activeKeymapPath(target));
  if (activeText === undefined) return undefined;
  let active: string;
  try {
    active = canonicalKeymapText(target, activeText);
  } catch {
    return undefined;
  }
  for (const variant of variants ?? (await listKeymapVariants(store, target))) {
    const text = await store.readText(variant.path);
    if (text === undefined) continue;
    try {
      if (canonicalKeymapText(target, text) === active) return variant.name;
    } catch {
      // 読めない保持は切り替え先にできないだけで、他の保持との照合は続ける。
    }
  }
  return undefined;
}

/**
 * 適用対象の内容を名前を付けて保持する。
 *
 * テキストはそのまま写し、コメントも残す。同じ名前があれば `overwrite` 無しでは落とす。
 *
 * @doc docs/specs/workspace-cli.md#キーマップの保持
 */
export async function saveKeymapVariant(
  store: Pick<WorkspaceFileStore, "readText" | "writeText">,
  target: KeymapTarget,
  name: string,
  options: { readonly overwrite?: boolean } = {},
): Promise<KeymapVariant> {
  const path = keymapVariantPath(target, name);
  const activePath = activeKeymapPath(target);
  const text = await store.readText(activePath);
  if (text === undefined) {
    throw new KeymapVariantError(`${activePath} が無いため保持できない`);
  }
  if (options.overwrite !== true && (await store.readText(path)) !== undefined) {
    throw new KeymapVariantError(`${path} は既にある。上書きするなら overwrite を指定する`);
  }
  await store.writeText(path, text);
  return { name, path };
}

/**
 * 保持したキーマップを適用対象へ書き戻す。
 *
 * 現在の適用対象の内容が、どの保持とも一致しないときは落とす。黙って上書きすると
 * 未保持の編集が消えるためで、先に `saveKeymapVariant` で名前を付けさせる。
 * 切り替え先は parse を通してから書く。壊れたファイルを適用対象へ写さない。
 * 戻り値の `from` は切り替え前の内容と一致していた保持の名前で、適用対象が無ければ `undefined`。
 *
 * @doc docs/specs/workspace-cli.md#キーマップの保持
 */
export async function switchKeymapVariant(
  store: Pick<WorkspaceFileStore, "readText" | "writeText" | "listFiles">,
  target: KeymapTarget,
  name: string,
): Promise<{ readonly from: string | undefined; readonly path: string }> {
  const path = keymapVariantPath(target, name);
  const text = await store.readText(path);
  if (text === undefined) throw new KeymapVariantError(`${path} が見つからない`);
  canonicalKeymapText(target, text);

  const activePath = activeKeymapPath(target);
  const activeText = await store.readText(activePath);
  let from: string | undefined;
  if (activeText !== undefined) {
    from = await matchKeymapVariant(store, target);
    if (from === undefined) {
      throw new KeymapVariantError(
        `${activePath} の現在の内容はどの保持とも一致しない。先に名前を付けて保持する`,
      );
    }
  }
  await store.writeText(activePath, text);
  return { from, path: activePath };
}

/**
 * 保持したキーマップを削除する。適用対象は消せない。
 *
 * @doc docs/specs/workspace-cli.md#キーマップの保持
 */
export async function deleteKeymapVariant(
  store: Pick<WorkspaceFileStore, "readText" | "remove">,
  target: KeymapTarget,
  name: string,
): Promise<void> {
  const path = keymapVariantPath(target, name);
  if ((await store.readText(path)) === undefined) {
    throw new KeymapVariantError(`${path} が見つからない`);
  }
  await store.remove(path);
}

function variantPrefix(target: KeymapTarget): string {
  return target.kind === "cornix" ? "keymap." : `mac-keyboard.${target.layout}.`;
}
