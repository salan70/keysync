/**
 * `keysync mac record` の課題つき記録（ADR 0046）を採点するための変換。
 *
 * 課題はターミナルで打ち、Enter で次へ進む。記録は通しで 1 本なので、HID の Enter の押下で
 * 課題ごとに区切る。区切った HID の出力を、Web UI と同じ `gradeTypingTrial` が読む形へ変える。
 * HID は IME より前の層なので、IME の状態に左右されずに採点できる。
 */

import type { TypedEvent } from "../typing-trial/types.ts";
import { hidUsageName, isModifierUsage } from "./hid-usage.ts";
import type { HidLogEvent, KeyLogEvent } from "./types.ts";

/** Return キーの usage。課題の区切りに使う。 */
const RETURN_USAGE = 0x28;

const MODIFIER_FIELDS: Readonly<Record<string, "meta" | "ctrl" | "alt" | "shift">> = {
  left_command: "meta",
  right_command: "meta",
  left_control: "ctrl",
  right_control: "ctrl",
  left_option: "alt",
  right_option: "alt",
  left_shift: "shift",
  right_shift: "shift",
};

function hidEvents(events: readonly KeyLogEvent[]): HidLogEvent[] {
  return events
    .filter((event): event is HidLogEvent => event.type === "hid")
    .sort((a, b) => a.ns - b.ns);
}

/**
 * HID の出力を、打鍵テストの採点が読む `TypedEvent` の列へ変える。
 *
 * 修飾キーは押下と離しで状態を追い、それ以外の押下 1 回を 1 件にする。英字・数字・空白は
 * 文字にし、Shift が押されていれば英字を大文字にする。それ以外のキーは `key_code` 名を
 * そのまま `key` に置く（採点は 1 文字の `key` だけを文字として扱うので捨てられる）。
 *
 * @doc docs/specs/typing-log.md#課題つき記録の採点
 */
export function typedEventsFromHid(events: readonly KeyLogEvent[]): TypedEvent[] {
  const held = new Map<string, number>();
  const result: TypedEvent[] = [];
  for (const event of hidEvents(events)) {
    const name = hidUsageName(event.usage);
    if (isModifierUsage(event.usage)) {
      const field = MODIFIER_FIELDS[name];
      if (field !== undefined) held.set(name, event.down ? 1 : 0);
      continue;
    }
    if (!event.down) continue;
    const on = (field: "meta" | "ctrl" | "alt" | "shift") =>
      Object.entries(MODIFIER_FIELDS).some(
        ([modifier, one]) => one === field && held.get(modifier) === 1,
      );
    const modifiers = { meta: on("meta"), ctrl: on("ctrl"), alt: on("alt"), shift: on("shift") };
    const letter = /^[a-z]$/.test(name);
    const key = letter
      ? modifiers.shift
        ? name.toUpperCase()
        : name
      : /^[0-9]$/.test(name)
        ? name
        : name === "spacebar"
          ? " "
          : name;
    const code = letter
      ? `Key${name.toUpperCase()}`
      : /^[0-9]$/.test(name)
        ? `Digit${name}`
        : name === "spacebar"
          ? "Space"
          : name;
    result.push({ key, code, ...modifiers, composing: false });
  }
  return result;
}

/**
 * HID の出力を、Return の押下ごとに区切る。
 *
 * 区切りの Return の押下は、その区間の最後に入れる。採点では 1 文字でない `key` として
 * 捨てられ、判定の推定では最後の tap の「次の押下」として使える。Return の離しは捨てる。
 * 最後の Return より後の出力は `rest` に返す。
 *
 * @doc docs/specs/typing-log.md#課題つき記録の採点
 */
export function splitAtReturn(events: readonly KeyLogEvent[]): {
  readonly segments: readonly (readonly HidLogEvent[])[];
  readonly rest: readonly HidLogEvent[];
} {
  const segments: HidLogEvent[][] = [];
  let current: HidLogEvent[] = [];
  for (const event of hidEvents(events)) {
    if (event.usage === RETURN_USAGE) {
      if (event.down) {
        segments.push([...current, event]);
        current = [];
      }
      continue;
    }
    current.push(event);
  }
  return { segments, rest: current };
}
