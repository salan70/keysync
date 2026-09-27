/**
 * 打鍵ログの JSON Lines。1 行目が `KeyLogMeta`、2 行目以降が `KeyLogEvent`。
 *
 * 行ごとに独立した JSON にするのは、記録の途中で止まっても読める部分を残すためと、
 * `grep` や `jq` でそのまま扱えるようにするためである。
 */

import type { KeyLogEvent, KeyLogMeta } from "./types.ts";

/** 打鍵ログを置く workspace 内のディレクトリ。 */
export const TYPING_LOG_DIR = "keysync/typing-logs";

/** 打鍵ログが期待した形をしていないときに投げる。 */
export class KeyLogParseError extends Error {}

/**
 * ログのファイル名。時刻（ローカル時刻ではなく UTC）と記録した側を入れ、並べると時刻順になる。
 *
 * @doc docs/specs/typing-log.md#serializekeylog
 */
export function keyLogPath(startedAt: Date, recorder: KeyLogMeta["recorder"]): string {
  const stamp = startedAt.toISOString().replace(/[:.]/g, "-");
  return `${TYPING_LOG_DIR}/${stamp}-${recorder}.jsonl`;
}

/** @doc docs/specs/typing-log.md#serializekeylog */
export function serializeKeyLog(meta: KeyLogMeta, events: readonly KeyLogEvent[]): string {
  return `${[meta, ...events].map((line) => JSON.stringify(line)).join("\n")}\n`;
}

const EVENT_TYPES = new Set(["hid", "os", "browser"]);

/**
 * ログを読む。形の検査は `type` の判別までで、各 field の値は信じる。
 * 書くのは KeySync 自身だけなので、壊れた行だけを大きな声で拒めば足りる。
 *
 * @doc docs/specs/typing-log.md#serializekeylog
 */
export function parseKeyLog(text: string): {
  readonly meta: KeyLogMeta;
  readonly events: readonly KeyLogEvent[];
} {
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  const parsed = lines.map((line, index) => {
    try {
      return JSON.parse(line) as { readonly type?: unknown };
    } catch {
      throw new KeyLogParseError(`${index + 1} 行目が JSON ではない`);
    }
  });
  const [meta, ...events] = parsed;
  if (meta?.type !== "meta") throw new KeyLogParseError("1 行目が meta ではない");
  for (const [index, event] of events.entries()) {
    if (typeof event.type !== "string" || !EVENT_TYPES.has(event.type)) {
      throw new KeyLogParseError(`${index + 2} 行目の type が未対応: ${String(event.type)}`);
    }
  }
  return {
    meta: meta as unknown as KeyLogMeta,
    events: events as unknown as readonly KeyLogEvent[],
  };
}
