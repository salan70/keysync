/**
 * 打鍵テスト（mod-tap の閾値を実測で調整する）の型。
 *
 * ブラウザが受け取るのは Karabiner が処理した**後**の入力である（ADR 0045）。ここでは
 * 押下時間を扱わず、出てきた文字と chord だけを採点する。DOM の `KeyboardEvent` には
 * 依存せず、UI 側が `TypedEvent` へ写す。
 */

/**
 * 修飾キーの組。左右は区別しない。ブラウザの `KeyboardEvent` が左右を持たないため。
 *
 * @doc docs/specs/typing-trial.md#typing-trial-types
 */
export interface ModifierSet {
  readonly meta: boolean;
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
}

/**
 * 打鍵 1 回。`keydown` から写した値。
 *
 * @doc docs/specs/typing-trial.md#typing-trial-types
 */
export interface TypedEvent extends ModifierSet {
  /** `KeyboardEvent.key`。 */
  readonly key: string;
  /** `KeyboardEvent.code`。chord の key は配列や Option の文字化けに左右されない code で見る。 */
  readonly code: string;
  /** IME の変換中か。変換中の入力は採点できない。 */
  readonly composing: boolean;
}

/**
 * 期待または出力の 1 単位。修飾キーの無い文字（Shift による大文字を含む）か、
 * meta / ctrl / alt のどれかを伴う chord。
 *
 * @doc docs/specs/typing-trial.md#typing-trial-types
 */
export type TrialToken =
  | { readonly kind: "char"; readonly char: string }
  | {
      readonly kind: "chord";
      readonly modifiers: ModifierSet;
      /** 小文字の英字・数字、またはそれ以外の `code`。 */
      readonly key: string;
    };

/**
 * 課題 1 つ。`text` は文章を打つ課題、`hold` は mod-tap を押し続けて chord を出す課題。
 *
 * `hold` の表示名（キャップの刻印）は配列に依存する UI の語彙なので、ここでは位置
 * （Karabiner の `key_code` 名）だけを持つ。
 *
 * @doc docs/specs/typing-trial.md#typing-trial-types
 */
export type TypingTask =
  | {
      readonly kind: "text";
      readonly id: string;
      /** 課題の名前。選択肢に出す。 */
      readonly title: string;
      /** この課題で何を確かめるか。自由入力では空。 */
      readonly focus: string;
      readonly text: string;
      readonly expected: readonly TrialToken[];
    }
  | {
      readonly kind: "hold";
      readonly id: string;
      /** 押し続ける mod-tap の位置。 */
      readonly holdKeyCode: string;
      /** 押し続けている間に押す、反対の手の文字キーの位置。 */
      readonly partner: string;
      readonly expected: readonly TrialToken[];
    };
