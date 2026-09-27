/**
 * workspace の配置と、content-addressed な definition の名前を扱う。
 *
 * Browser / CLI の adapter が同じ規則を使うための副作用のない境界であり、
 * `src/core/` の意味モデルからは参照しない。
 */

import { TYPING_LOG_DIR } from "../core/typing-log/format.ts";
import { canonicalDefinitionText } from "../core/definition/identity.ts";
import type { MacKeyboardLayout } from "../core/mac-keymap/types.ts";
import type { WorkspaceFileStore } from "./types.ts";

/** @doc docs/specs/workspace-cli.md#配置 */
export const WORKSPACE_LAYOUT = {
  keymap: "keymap.yaml",
  /**
   * Mac の desired state の**旧名**。ADR 0027 以降は `macKeymapPath(layout)` が正で、
   * この名前は読み込み時の後方互換としてだけ残る。どの配列のものかは中の `layout`
   * 宣言で決まる。
   */
  legacyMacKeymap: "mac-keyboard.yaml",
  definitions: "keysync/definitions",
  labels: "keysync/labels.yaml",
  acknowledgements: "keysync/acknowledgements.json",
  backups: "keysync/backups",
  latestBackup: "keysync/backups/latest.vil",
  generated: "keysync/generated",
  /** 打鍵ログ（ADR 0046）。定義元は Core の `TYPING_LOG_DIR`。 */
  typingLogs: TYPING_LOG_DIR,
} as const;

/**
 * 改名前（ADR 0035）の管理ディレクトリ `cornix/` のうち、移すファイル。
 *
 * 読むのは `planLayoutMigration` だけで、通常の読み込みは旧ディレクトリへ倒さない（ADR 0036）。
 * `backups/` と `generated/` は生成物なので移さない。
 *
 * @doc docs/specs/workspace-cli.md#配置
 */
export const LEGACY_WORKSPACE_LAYOUT = {
  definitions: "cornix/definitions",
  labels: "cornix/labels.yaml",
  acknowledgements: "cornix/acknowledgements.json",
} as const;

/**
 * 物理配列ごとの Mac 設定ファイル。
 *
 * 設定の単位は物理配列で（ADR 0026）、配列の違う Mac を 1 つの workspace で扱うため
 * ファイルを分ける（ADR 0027）。どの配列のものかがファイル名で分かるので、
 * 中の `layout` 宣言と食い違っていたら読み込み側が落とす。
 *
 * @doc docs/specs/workspace-cli.md#配置
 */
export function macKeymapPath(layout: MacKeyboardLayout): string {
  return `mac-keyboard.${layout}.yaml`;
}

/**
 * 物理配列ごとの Linux 設定ファイル。Mac の設定とは独立に編集する（ADR 0042）。
 *
 * @doc docs/specs/workspace-cli.md#配置
 */
export function linuxKeymapPath(layout: MacKeyboardLayout): string {
  return `linux-keyboard.${layout}.yaml`;
}

export function definitionPath(digest: string): string {
  if (!/^[0-9a-f]{64}$/i.test(digest)) {
    throw new Error(`definition digest が SHA-256 ではない: ${digest}`);
  }
  return `${WORKSPACE_LAYOUT.definitions}/${digest.slice(0, 16)}.json`;
}

/**
 * definition の digest。CLI import・実機 read・binding 検証はすべてこれを通す。
 *
 * @doc docs/specs/workspace-cli.md#definitiondigest
 */
export async function definitionDigest(text: string, provider: Sha256Provider): Promise<string> {
  return sha256Hex(new TextEncoder().encode(canonicalDefinitionText(text)), provider);
}

/** @doc docs/specs/workspace-cli.md#readdefinitionbinding */
export async function readDefinitionBinding(
  store: Pick<WorkspaceFileStore, "readBytes">,
  path: string,
  digest: string,
  provider: Sha256Provider,
): Promise<string> {
  const expectedPath = definitionPath(digest);
  if (path !== expectedPath) {
    throw new Error(`definition binding pathがdigestと一致しない: ${path}`);
  }
  const bytes = await store.readBytes(path);
  if (bytes === undefined) throw new Error(`${path} が見つからない`);
  const text = new TextDecoder().decode(bytes);
  const actualDigest = await definitionDigest(text, provider);
  if (actualDigest !== digest) {
    throw new Error(`definition digestが一致しない: expected=${digest} actual=${actualDigest}`);
  }
  return text;
}

/**
 * backup の path。既定は Vial の `.vil`。
 *
 * MacBook 内蔵キーボードの backup は `karabiner.json` 1 ファイルなので、
 * 接頭辞と拡張子を差し替えて同じ場所へ置く（ADR 0022）。
 */
export function backupPath(
  date = new Date(),
  options: { readonly prefix?: string; readonly extension?: string } = {},
): string {
  const stamp = date.toISOString().replace(/[:.]/g, "");
  const prefix = options.prefix ?? "";
  const extension = options.extension ?? "vil";
  return `${WORKSPACE_LAYOUT.backups}/${prefix}${stamp}.${extension}`;
}

export function generatedPath(name: string): string {
  if (!/^[a-zA-Z0-9._-]+$/.test(name) || name === "." || name === "..") {
    throw new Error(`generated file name が不正: ${name}`);
  }
  return `${WORKSPACE_LAYOUT.generated}/${name}`;
}

export function isTracked(path: string): boolean {
  return (
    !path.startsWith(`${WORKSPACE_LAYOUT.backups}/`) &&
    !path.startsWith(`${WORKSPACE_LAYOUT.generated}/`)
  );
}

export interface Sha256Provider {
  readonly subtle: {
    digest(algorithm: "SHA-256", data: ArrayBuffer | ArrayBufferView): Promise<ArrayBuffer>;
  };
}

export async function sha256Hex(
  bytes: ArrayBuffer | ArrayBufferView,
  provider: Sha256Provider,
): Promise<string> {
  const digest = await provider.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
