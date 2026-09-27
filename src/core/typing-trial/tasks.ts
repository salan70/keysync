/**
 * 打鍵テストの課題。既定のロール集、keymap から作る hold 課題、自由入力の 3 種類がある。
 */

import { KARABINER_MODIFIERS } from "../mac-keymap/key-codes.ts";
import { macPhysicalLayout } from "../mac-keymap/physical-layout.ts";
import type { MacKeymapDocument } from "../mac-keymap/types.ts";
import { classifyKeycode } from "../validation/keycode-vocabulary.ts";
import type { ModifierSet, TrialToken, TypingTask } from "./types.ts";

function textTask(id: string, text: string): TypingTask {
  return { kind: "text", id, text, expected: [...text].map((char) => ({ kind: "char", char })) };
}

/**
 * 既定のロール集。前のキーを離す前に次のキーを押しやすい並びを集めた。
 *
 * ホームロウ mod の誤爆はローマ字の子音 → 母音で起きやすいため、`k` `h` `j` `s` `d` `g`
 * の行を並べる。mod-tap 同士の重なり（`df` など）で文字が消える事例も含める（ADR 0044）。
 *
 * @doc docs/specs/typing-trial.md#roll-tasks
 */
export const ROLL_TASKS: readonly TypingTask[] = [
  textTask("roll-kahaja", "kakikukeko hahihuheho jajijujejo"),
  textTask("roll-sadaga", "sasisuseso dadidudedo gagigugego"),
  textTask("roll-words", "flask dash glad self jog kiss"),
  textTask("roll-pairs", "df fd jk kj sd ds kl lk fg gh"),
];

/**
 * 自由入力の課題。
 *
 * @doc docs/specs/typing-trial.md#roll-tasks
 */
export function customTask(text: string): TypingTask {
  return textTask("custom", text);
}

/**
 * hold 課題 1 つで繰り返す回数。1 回では偶然と区別できない。
 *
 * @doc docs/specs/typing-trial.md#holdtasksfor
 */
export const HOLD_REPEAT = 3;

/**
 * 押し続けている間に押す文字の候補。手ごとに、押しても危険の少ない順に並べる。
 *
 * ⌘Q・⌘W・⌘T・⌘N・⌘H・⌘M はブラウザや OS が先に取り、ページで止められないため避ける。
 */
const PARTNERS = {
  left: ["e", "r", "x", "c", "v"],
  right: ["u", "i", "o", "p", "y"],
} as const;

const MODIFIER_FIELDS: Readonly<Record<string, keyof ModifierSet>> = {
  left_command: "meta",
  right_command: "meta",
  left_control: "ctrl",
  right_control: "ctrl",
  left_option: "alt",
  right_option: "alt",
  left_shift: "shift",
  right_shift: "shift",
};

function modifierSet(modifiers: readonly string[]): ModifierSet {
  const set = { meta: false, ctrl: false, alt: false, shift: false };
  for (const modifier of modifiers) {
    const field = MODIFIER_FIELDS[modifier];
    if (field !== undefined) set[field] = true;
  }
  return set;
}

/** Shift だけなら大文字、それ以外は chord。ブラウザが受け取る形に合わせる。 */
function heldToken(modifiers: ModifierSet, partner: string): TrialToken {
  if (!modifiers.meta && !modifiers.ctrl && !modifiers.alt) {
    return { kind: "char", char: modifiers.shift ? partner.toUpperCase() : partner };
  }
  return { kind: "chord", modifiers, key: partner };
}

/**
 * layer 0 の mod-tap ごとに hold 課題を 1 つ作る。期待は同じ chord の `HOLD_REPEAT` 回。
 *
 * 押し続けるキーの反対の手から、layer 0 に割り当ての無い文字キーを 1 つ選ぶ。
 * 割り当てがあると、押したキー自体が変換されて期待が定まらないためである。
 * 手の左右は物理盤面の中心で分ける。候補がすべて割り当て済みならその mod-tap は出さない。
 *
 * @doc docs/specs/typing-trial.md#holdtasksfor
 */
export function holdTasksFor(document: MacKeymapDocument): readonly TypingTask[] {
  const base = document.layers.get(0);
  if (base === undefined) return [];
  const keys = macPhysicalLayout(document.layout);
  const right = Math.max(...keys.map((key) => key.x + key.width));
  const tasks: TypingTask[] = [];

  for (const [holdKeyCode, keycode] of [...base.entries()].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    const lexeme = classifyKeycode(keycode);
    if (lexeme.kind !== "modTap") continue;
    const modifiers = KARABINER_MODIFIERS.get(lexeme.modifier);
    const key = keys.find((one) => one.keyCode === holdKeyCode);
    if (modifiers === undefined || key === undefined) continue;
    const hand = key.x + key.width / 2 < right / 2 ? "right" : "left";
    const partner = PARTNERS[hand].find((candidate) => !base.has(candidate));
    if (partner === undefined) continue;
    tasks.push({
      kind: "hold",
      id: `hold-${holdKeyCode}`,
      holdKeyCode,
      partner,
      expected: Array.from({ length: HOLD_REPEAT }, () =>
        heldToken(modifierSet(modifiers), partner),
      ),
    });
  }
  return tasks;
}
