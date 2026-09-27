/**
 * 打鍵ログから、mod-tap がどう判定されたかを推定する（ADR 0046）。
 *
 * 見るのは Karabiner の仮想キーボードが出した HID の値（`hid`）だけである。物理的な押下は
 * 記録できないため、Karabiner の出力の形から判定の経路を逆に推す。R-009 で次を確かめた。
 *
 * - Fact: ADR 0044 の mod-tap は、tap 側を数 ms の合成された押下として出す
 * - Fact: mod-tap でないキーは、打鍵どおりの長さで出る
 * - Inference: `to_if_alone` の tap は物理的に離した時点で出る。`to_if_canceled` の tap は
 *   次のキーを押した時点で出るため、その離しの直後に次のキーの押下が続く
 * - Inference: hold の修飾キーは、押下から閾値の後に単独で出る
 */

import { KARABINER_MODIFIERS, karabinerKeyEvent } from "../mac-keymap/key-codes.ts";
import type { MacKeymapDocument } from "../mac-keymap/types.ts";
import { classifyKeycode } from "../validation/keycode-vocabulary.ts";
import { hidUsageName, isModifierUsage } from "./hid-usage.ts";
import type { HidLogEvent, KeyLogEvent } from "./types.ts";

/**
 * 合成された tap とみなす出力の押下時間の上限。R-009 の実測は 3.9〜5.7ms。
 *
 * @doc docs/specs/typing-log.md#analyzemodtapoutput
 */
export const SYNTHETIC_TAP_MAX_MS = 20;

/**
 * tap の離しからこの時間内に次の押下が続けば、ロール（`to_if_canceled`）とみなす。
 * 人が離してから次を押すまでに要する時間より十分短い値にする（Inference）。
 *
 * @doc docs/specs/typing-log.md#analyzemodtapoutput
 */
export const ROLL_WINDOW_MS = 5;

/** 同時に押された修飾キーの組とみなす押下の間隔。複合 modifier は 1 イベントで出る。 */
const MODIFIER_GROUP_MS = 2;

const NS_PER_MS = 1_000_000;

/**
 * mod-tap 1 つの tap の内訳。
 *
 * @doc docs/specs/typing-log.md#analyzemodtapoutput
 */
export interface ModTapTapStats {
  /** mod-tap の位置（Karabiner の `key_code` 名）。 */
  readonly position: string;
  /** tap で出る `key_code`。 */
  readonly tapKey: string;
  /** 離してから次を押した tap。 */
  readonly alone: number;
  /** 押している間に次のキーが押された tap（ロール）。 */
  readonly roll: number;
  /** 合成された長さではない出力。別のキーボードからの入力や、mod-tap が効いていない場合。 */
  readonly passthrough: number;
}

/**
 * hold と判定された 1 回。
 *
 * @doc docs/specs/typing-log.md#analyzemodtapoutput
 */
export interface HoldRecord {
  /** 記録開始からの ns。 */
  readonly ns: number;
  /** 出た修飾キーの組（名前の昇順）。 */
  readonly modifiers: readonly string[];
  /** この組を hold 側に持つ mod-tap の位置。複数あれば出力からは区別できない。 */
  readonly candidates: readonly string[];
  /** 修飾キーを押している間に押されたキー。 */
  readonly chords: readonly string[];
  readonly durationMs: number;
}

/**
 * 解析の結果。
 *
 * @doc docs/specs/typing-log.md#analyzemodtapoutput
 */
export interface ModTapAnalysis {
  readonly hidEvents: number;
  readonly taps: readonly ModTapTapStats[];
  readonly holds: readonly HoldRecord[];
  /** 修飾キー以外の押下どうしの間隔（ms）。打鍵の速さの目安。 */
  readonly intervalsMs: {
    readonly count: number;
    readonly p10: number | null;
    readonly median: number | null;
  };
}

interface ModTapPosition {
  readonly position: string;
  readonly tapKey: string;
  readonly modifiers: readonly string[];
}

function modTapPositions(document: MacKeymapDocument): readonly ModTapPosition[] {
  const result: ModTapPosition[] = [];
  for (const [position, keycode] of document.layers.get(0) ?? []) {
    const lexeme = classifyKeycode(keycode);
    if (lexeme.kind !== "modTap") continue;
    const tapKey = karabinerKeyEvent(lexeme.inner)?.key_code;
    const modifiers = KARABINER_MODIFIERS.get(lexeme.modifier);
    if (tapKey === undefined || modifiers === undefined) continue;
    result.push({ position, tapKey, modifiers: [...new Set(modifiers)].sort() });
  }
  return result.sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0));
}

function percentile(sorted: readonly number[], ratio: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.floor(ratio * sorted.length));
  return Math.round((sorted[index] ?? 0) * 10) / 10;
}

/** `from` 以降で、同じ usage が離された最初の値。 */
function releaseOf(events: readonly HidLogEvent[], from: number): HidLogEvent | undefined {
  const pressed = events[from];
  if (pressed === undefined) return undefined;
  return events.slice(from + 1).find((one) => !one.down && one.usage === pressed.usage);
}

/**
 * HID の出力から mod-tap の判定を推定する。
 *
 * @doc docs/specs/typing-log.md#analyzemodtapoutput
 */
export function analyzeModTapOutput(
  events: readonly KeyLogEvent[],
  document: MacKeymapDocument,
): ModTapAnalysis {
  const hid = events
    .filter((event): event is HidLogEvent => event.type === "hid")
    .sort((a, b) => a.ns - b.ns);
  const positions = modTapPositions(document);
  const stats = new Map(
    positions.map((one) => [
      one.position,
      { position: one.position, tapKey: one.tapKey, alone: 0, roll: 0, passthrough: 0 },
    ]),
  );
  const holds: HoldRecord[] = [];
  const grouped = new Set<number>();
  const intervals: number[] = [];
  let previousDown: number | undefined;

  for (const [index, event] of hid.entries()) {
    if (!event.down || grouped.has(index)) continue;
    const name = hidUsageName(event.usage);

    if (isModifierUsage(event.usage)) {
      // 同時に出た修飾キーを 1 組にまとめ、全部が離されるまでを hold とする。
      const members = [index];
      for (let next = index + 1; next < hid.length; next += 1) {
        const other = hid[next];
        if (other === undefined || other.ns - event.ns > MODIFIER_GROUP_MS * NS_PER_MS) break;
        if (other.down && isModifierUsage(other.usage)) members.push(next);
      }
      for (const member of members) grouped.add(member);
      const end = Math.max(...members.map((member) => releaseOf(hid, member)?.ns ?? event.ns));
      const modifiers = [
        ...new Set(members.map((member) => hidUsageName(hid[member]?.usage ?? 0))),
      ].sort();
      const chords = hid
        .filter(
          (other) =>
            other.down && !isModifierUsage(other.usage) && other.ns > event.ns && other.ns < end,
        )
        .map((other) => hidUsageName(other.usage));
      holds.push({
        ns: event.ns,
        modifiers,
        candidates: positions
          .filter((one) => one.modifiers.join() === modifiers.join())
          .map((one) => one.position),
        chords,
        durationMs: Math.round(((end - event.ns) / NS_PER_MS) * 10) / 10,
      });
      continue;
    }

    if (previousDown !== undefined) intervals.push((event.ns - previousDown) / NS_PER_MS);
    previousDown = event.ns;

    const owners = positions.filter((one) => one.tapKey === name);
    if (owners.length === 0) continue;
    const release = releaseOf(hid, index);
    const length = release === undefined ? Infinity : (release.ns - event.ns) / NS_PER_MS;
    const kind =
      length > SYNTHETIC_TAP_MAX_MS
        ? "passthrough"
        : (() => {
            // Karabiner が tap を出し終える前に次の押下が来る順序もありうるため、
            // 押下以降の次の押下が「離し + 窓」より前ならロールとみなす。
            const next = hid.find(
              (other) => other.down && other.ns > event.ns && other.usage !== event.usage,
            );
            const limit = (release?.ns ?? event.ns) + ROLL_WINDOW_MS * NS_PER_MS;
            return next !== undefined && next.ns <= limit ? "roll" : "alone";
          })();
    for (const owner of owners) {
      const current = stats.get(owner.position);
      if (current !== undefined) current[kind] += 1;
    }
  }

  const sorted = [...intervals].sort((a, b) => a - b);
  return {
    hidEvents: hid.length,
    taps: [...stats.values()].filter((one) => one.alone + one.roll + one.passthrough > 0),
    holds,
    intervalsMs: {
      count: sorted.length,
      p10: percentile(sorted, 0.1),
      median: percentile(sorted, 0.5),
    },
  };
}
