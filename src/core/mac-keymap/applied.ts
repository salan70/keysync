/**
 * `karabiner.json` に書かれている KeySync の設定から、いま効いている値を読む。
 */

import type { KarabinerConfig } from "./karabiner.ts";

const HELD_DOWN_THRESHOLD = "basic.to_if_held_down_threshold_milliseconds";

/**
 * 所有 profile の mod-tap に書かれた閾値（ms）。mod-tap が無い、または読めなければ `null`。
 *
 * 生成器は全 mod-tap に同じ閾値を書く（ADR 0044）。最初に見つかった値を返す。
 * 打鍵ログに「記録した時点で効いていた閾値」を残すのに使う（ADR 0046）。
 *
 * @doc docs/specs/mac-keymap.md#appliedtappingtermms
 */
export function appliedTappingTermMs(config: KarabinerConfig, profile: string): number | null {
  const owned = config.profiles.find((one) => one.name === profile);
  for (const rule of owned?.complex_modifications.rules ?? []) {
    for (const manipulator of rule.manipulators) {
      const value = manipulator.parameters?.[HELD_DOWN_THRESHOLD];
      if (typeof value === "number") return value;
    }
  }
  return null;
}
