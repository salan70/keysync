/**
 * 打鍵テストの課題。既定のロール集、keymap から作る hold 課題、自由入力の 3 種類がある。
 */

import { KARABINER_MODIFIERS } from "../mac-keymap/key-codes.ts";
import { macPhysicalLayout } from "../mac-keymap/physical-layout.ts";
import type { MacKeymapDocument } from "../mac-keymap/types.ts";
import { classifyKeycode } from "../validation/keycode-vocabulary.ts";
import type { ModifierSet, TrialToken, TypingTask } from "./types.ts";

function textTask(id: string, title: string, focus: string, text: string): TypingTask {
  return {
    kind: "text",
    id,
    title,
    focus,
    text,
    expected: [...text].map((char) => ({ kind: "char", char })),
  };
}

/**
 * 既定のロール集。誤爆の起き方ごとに分けてある。
 *
 * mod-tap は「押している間に次のキーが押された」ときに判定が割れる（ADR 0044）。
 * 次の場面を 1 課題ずつ切り出し、どこで崩れるかを課題の単位で比べられるようにする。
 *
 * - ローマ字の子音 → 母音（利用者の主な入力。`k` `s` `d` `g` `h` `j` が子音になる）
 * - 拗音と促音（`sh` `ky` `j` の連続、同じキーの連打）
 * - スペースの前後（spacebar も mod-tap なので、語の頭が chord になりうる）
 * - 同じ手の mod-tap 同士の重なり（`sdf` `jkl` の内向き・外向き）
 * - 左右交互（反対の手の mod-tap が同時に押し下げられている）
 * - 大文字（Shift も mod-tap で、tap は かな / 英数）
 * - 英単語（ローマ字と違う指の並び）
 *
 * @doc docs/specs/typing-trial.md#roll-tasks
 */
export const ROLL_TASKS: readonly TypingTask[] = [
  textTask(
    "romaji-kg",
    "ローマ字: か行・が行",
    "k と g が修飾キーになり、次の母音と chord にならないか",
    "kakikukeko gagigugego kokoro kagami kangaeru kaigi",
  ),
  textTask(
    "romaji-sdh",
    "ローマ字: さ行・だ行・は行",
    "s・d・h の子音が母音と重なっても文字で出るか",
    "sasisuseso dadidudedo hahihuheho sukoshi hajimete dekiru",
  ),
  textTask(
    "romaji-youon",
    "ローマ字: 拗音・じゃ行",
    "sh・ky・j など子音が続く並びで、mod-tap 同士が重なっても消えないか",
    "jajijujejo shigoto kyoukasho daijoubu shukudai jikan",
  ),
  textTask(
    "romaji-sokuon",
    "ローマ字: 促音（同じキーの連打）",
    "同じ mod-tap を素早く 2 回叩いたとき、2 文字とも出るか",
    "gakkou kitto zasshi hokkaidou issho kekkou",
  ),
  textTask(
    "romaji-sentence",
    "ローマ字: 文（スペースを挟む）",
    "語の終わり → スペース → 次の語の頭が続けて押されても、⌘ 付きにならないか",
    "ashita ha kaisha de kaigi ga aru node hayaku deru",
  ),
  textTask(
    "space-short",
    "短い語とスペース",
    "スペースの mod-tap と直後の文字の重なりを集中して起こす",
    "a ha ga ni de to ka mo so ja ne yo sa hi",
  ),
  textTask(
    "same-hand",
    "同じ手の mod-tap 同士",
    "隣り合う mod-tap を内向き・外向きに転がしたとき、前の文字が消えないか",
    "sd ds df fd fg gf sdf fds hj jh jk kj kl lk jkl lkj",
  ),
  textTask(
    "cross-hand",
    "左右交互",
    "反対の手の mod-tap が押されたままでも、互いに修飾しないか",
    "fj jf dk kd sl ls gh hg fjdk slgh",
  ),
  textTask(
    "capitals",
    "大文字（Shift の mod-tap）",
    "Shift を押し続けて大文字が出るか。短すぎると tap（かな / 英数）になり IME が切り替わる",
    "Tokyo Osaka Kyoto Sapporo Hakata Kobe",
  ),
  textTask(
    "english",
    "英単語",
    "ローマ字と違う指の並び（sk・sh・lf・ld）で崩れないか",
    "desk ask dish shelf flask glad folks skills held",
  ),
];

/**
 * 自由入力の課題。
 *
 * @doc docs/specs/typing-trial.md#roll-tasks
 */
export function customTask(text: string): TypingTask {
  return textTask("custom", "自由入力", "", text);
}

/**
 * 文章課題が押す mod-tap の位置。layer 0 で mod-tap が割り当てられた位置だけを返す。
 *
 * 英字は同名の位置、空白は `spacebar`、大文字は左右の Shift を押すとみなす。
 * 利用者の keymap で、その課題が何を試しているかを示すのに使う。
 *
 * @doc docs/specs/typing-trial.md#roll-tasks
 */
export function modTapPositionsIn(
  task: TypingTask,
  document: MacKeymapDocument,
): readonly string[] {
  if (task.kind !== "text") return [];
  const base = document.layers.get(0);
  if (base === undefined) return [];
  const pressed = new Set<string>();
  for (const char of task.text) {
    if (char === " ") pressed.add("spacebar");
    else if (/^[a-z]$/.test(char)) pressed.add(char);
    else if (/^[A-Z]$/.test(char)) {
      pressed.add(char.toLowerCase());
      pressed.add("left_shift");
      pressed.add("right_shift");
    }
  }
  return [...pressed]
    .filter((keyCode) => {
      const keycode = base.get(keyCode);
      return keycode !== undefined && classifyKeycode(keycode).kind === "modTap";
    })
    .sort();
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
