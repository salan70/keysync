/**
 * 打鍵テストの採点。期待の token 列と、打鍵から作った出力の token 列を整列して分類する。
 *
 * 整列は編集距離で行う。ただし mod-tap の誤爆を 1 つの出来事として数えるため、
 * 通常の置換・脱落・余分に加えて次の 2 つの操作を持つ（ADR 0045）。
 *
 * - 誤爆（組）: 期待 `k` `a` に対して出力 `⌥A` が 1 つ。前の文字が修飾キーになり、
 *   次の文字と chord になった形。コスト 1
 * - 入れ替わり: 期待 `a` `b` に対して出力 `b` `a`。コスト 1
 */

import type { TrialToken, TypedEvent, TypingTask } from "./types.ts";

/** 修飾キー単独の押下。token にしない。 */
const MODIFIER_KEYS = new Set(["Shift", "Meta", "Control", "Alt", "CapsLock", "Fn", "OS"]);

/**
 * 整列した 1 件。`expected` と `output` のどちらかは空のことがある。
 *
 * @doc docs/specs/typing-trial.md#gradetypingtrial
 */
export interface TrialEntry {
  readonly kind: "ok" | "misfire" | "wrong" | "dropped" | "extra" | "swapped";
  readonly expected: readonly TrialToken[];
  readonly output: readonly TrialToken[];
}

/**
 * 採点の集計。件数は出来事の数で、`ok` だけは合っていた期待 token の数。
 *
 * @doc docs/specs/typing-trial.md#gradetypingtrial
 */
export interface TrialSummary {
  /** 数えた期待 token の数。`unfinished` は含まない。 */
  readonly expected: number;
  readonly ok: number;
  readonly misfire: number;
  readonly wrong: number;
  readonly dropped: number;
  readonly extra: number;
  readonly swapped: number;
  /** 打ち終える前に採点したため数えなかった、末尾の期待 token の数。 */
  readonly unfinished: number;
  /** Backspace の回数。訂正は採点に反映せず、数えるだけにする。 */
  readonly corrections: number;
  /** 誤爆した 2 文字の組と回数。回数の降順。 */
  readonly misfirePairs: readonly (readonly [string, number])[];
}

/**
 * 採点結果。IME の変換中の入力が混ざったら採点しない。
 *
 * @doc docs/specs/typing-trial.md#gradetypingtrial
 */
export type TrialGrade =
  | { readonly kind: "ime" }
  | {
      readonly kind: "graded";
      readonly entries: readonly TrialEntry[];
      readonly summary: TrialSummary;
    };

/** chord の key を正規化する。配列や Option の文字化けに左右されないよう `code` から取る。 */
function chordKey(event: TypedEvent): string {
  const letter = /^Key([A-Z])$/.exec(event.code);
  if (letter?.[1] !== undefined) return letter[1].toLowerCase();
  const digit = /^Digit([0-9])$/.exec(event.code);
  if (digit?.[1] !== undefined) return digit[1];
  if (event.code === "Space") return " ";
  return event.code;
}

/**
 * 打鍵を出力の token 列へ変える。
 *
 * meta / ctrl / alt のどれかを伴う押下は chord にする。それ以外は 1 文字の `key` だけを
 * 文字にし、Enter や矢印などは捨てる。Backspace は訂正として数える。
 *
 * @doc docs/specs/typing-trial.md#gradetypingtrial
 */
export function tokenizeTypedEvents(events: readonly TypedEvent[]): {
  readonly tokens: readonly TrialToken[];
  readonly corrections: number;
} {
  const tokens: TrialToken[] = [];
  let corrections = 0;
  for (const event of events) {
    if (MODIFIER_KEYS.has(event.key)) continue;
    if (event.meta || event.ctrl || event.alt) {
      const { meta, ctrl, alt, shift } = event;
      tokens.push({ kind: "chord", modifiers: { meta, ctrl, alt, shift }, key: chordKey(event) });
      continue;
    }
    if (event.key === "Backspace") {
      corrections += 1;
      continue;
    }
    if ([...event.key].length === 1) tokens.push({ kind: "char", char: event.key });
  }
  return { tokens, corrections };
}

/**
 * token 2 つが同じか。
 *
 * @doc docs/specs/typing-trial.md#gradetypingtrial
 */
export function sameToken(left: TrialToken, right: TrialToken): boolean {
  if (left.kind === "char" || right.kind === "char") {
    return left.kind === "char" && right.kind === "char" && left.char === right.char;
  }
  return (
    left.key === right.key &&
    left.modifiers.meta === right.modifiers.meta &&
    left.modifiers.ctrl === right.modifiers.ctrl &&
    left.modifiers.alt === right.modifiers.alt &&
    left.modifiers.shift === right.modifiers.shift
  );
}

/** 期待の文字 `next` が、前の文字の修飾で chord になった出力か。 */
function isPairMisfire(next: TrialToken | undefined, output: TrialToken | undefined): boolean {
  return (
    next?.kind === "char" && output?.kind === "chord" && output.key === next.char.toLowerCase()
  );
}

interface Step {
  readonly entry: TrialEntry;
  readonly di: number;
  readonly dj: number;
  readonly cost: number;
}

/** 位置 (i, j) から取れる操作。並び順が同コストのときの優先順位。 */
function steps(
  expected: readonly TrialToken[],
  output: readonly TrialToken[],
  i: number,
  j: number,
): readonly Step[] {
  const e0 = expected[i];
  const e1 = expected[i + 1];
  const o0 = output[j];
  const o1 = output[j + 1];
  const result: Step[] = [];
  if (e0 !== undefined && o0 !== undefined && sameToken(e0, o0)) {
    result.push({ entry: { kind: "ok", expected: [e0], output: [o0] }, di: 1, dj: 1, cost: 0 });
  }
  if (e0?.kind === "char" && e1 !== undefined && o0 !== undefined && isPairMisfire(e1, o0)) {
    result.push({
      entry: { kind: "misfire", expected: [e0, e1], output: [o0] },
      di: 2,
      dj: 1,
      cost: 1,
    });
  }
  if (
    e0 !== undefined &&
    e1 !== undefined &&
    o0 !== undefined &&
    o1 !== undefined &&
    !sameToken(e0, e1) &&
    sameToken(e0, o1) &&
    sameToken(e1, o0)
  ) {
    result.push({
      entry: { kind: "swapped", expected: [e0, e1], output: [o0, o1] },
      di: 2,
      dj: 2,
      cost: 1,
    });
  }
  if (e0 !== undefined) {
    result.push({ entry: { kind: "dropped", expected: [e0], output: [] }, di: 1, dj: 0, cost: 1 });
  }
  if (e0 !== undefined && o0 !== undefined && !sameToken(e0, o0)) {
    const kind = e0.kind === "char" && o0.kind === "chord" ? "misfire" : "wrong";
    result.push({ entry: { kind, expected: [e0], output: [o0] }, di: 1, dj: 1, cost: 1 });
  }
  if (o0 !== undefined) {
    result.push({ entry: { kind: "extra", expected: [], output: [o0] }, di: 0, dj: 1, cost: 1 });
  }
  return result;
}

/**
 * 期待と出力を最小コストで整列する。後ろから表を埋め、前から優先順位どおりに辿る。
 *
 * 出力を使い切った後に残る期待は、打ち終える前に採点しただけなのでコスト 0 にする。
 * コストを付けると、期待を 2 個消費する組の誤爆を後ろへずらすほど得になり、
 * `ka` の誤爆が遠くの `ga` に整列される。
 */
function align(expected: readonly TrialToken[], output: readonly TrialToken[]): TrialEntry[] {
  const width = output.length + 1;
  const table = Array.from({ length: (expected.length + 1) * width }, () => 0);
  const at = (i: number, j: number) => table[i * width + j] ?? 0;
  for (let i = expected.length; i >= 0; i -= 1) {
    for (let j = output.length - 1; j >= 0; j -= 1) {
      table[i * width + j] = Math.min(
        ...steps(expected, output, i, j).map((step) => step.cost + at(i + step.di, j + step.dj)),
      );
    }
  }

  const entries: TrialEntry[] = [];
  let i = 0;
  let j = 0;
  while (j < output.length) {
    const best = steps(expected, output, i, j).find(
      (step) => step.cost + at(i + step.di, j + step.dj) === at(i, j),
    );
    if (best === undefined) throw new Error("整列の表が壊れている");
    entries.push(best.entry);
    i += best.di;
    j += best.dj;
  }
  // 残りは未入力。呼び出し側が末尾の脱落として数えずに外す。
  for (const token of expected.slice(i)) {
    entries.push({ kind: "dropped", expected: [token], output: [] });
  }
  return entries;
}

function tokenText(token: TrialToken): string {
  return token.kind === "char" ? token.char : token.key;
}

/**
 * 課題と打鍵を採点する。
 *
 * @doc docs/specs/typing-trial.md#gradetypingtrial
 */
export function gradeTypingTrial(task: TypingTask, events: readonly TypedEvent[]): TrialGrade {
  if (events.some((event) => event.composing)) return { kind: "ime" };
  const { tokens, corrections } = tokenizeTypedEvents(events);
  const aligned = align(task.expected, tokens);
  // 末尾に続く脱落は、打ち終える前に採点しただけなので数えない。
  let end = aligned.length;
  while (end > 0 && aligned[end - 1]?.kind === "dropped") end -= 1;
  const entries = aligned.slice(0, end);
  const unfinished = aligned.length - end;

  const counts = { ok: 0, misfire: 0, wrong: 0, dropped: 0, extra: 0, swapped: 0 };
  const pairs = new Map<string, number>();
  let previous: TrialToken | undefined;
  for (const entry of entries) {
    counts[entry.kind] += entry.kind === "ok" ? entry.expected.length : 1;
    if (entry.kind === "misfire") {
      // 組で整列できなかった単独の誤爆は、直前の期待文字と組にして数える。
      const pair = entry.expected.length === 2 ? entry.expected : [previous, ...entry.expected];
      const label = pair
        .filter((token) => token !== undefined)
        .map(tokenText)
        .join("");
      pairs.set(label, (pairs.get(label) ?? 0) + 1);
    }
    previous = entry.expected.at(-1) ?? previous;
  }

  return {
    kind: "graded",
    entries,
    summary: {
      expected: task.expected.length - unfinished,
      ...counts,
      unfinished,
      corrections,
      misfirePairs: [...pairs.entries()].sort(
        ([a, left], [b, right]) => right - left || (a < b ? -1 : a > b ? 1 : 0),
      ),
    },
  };
}
