/**
 * HID の Keyboard/Keypad page（0x07）の usage → Karabiner の `key_code` 名。
 *
 * 打鍵ログ（ADR 0046）は Karabiner の仮想キーボードが出した usage を記録する。
 * 解析で desired state の位置（`key_code` 名）と突き合わせるために引く。
 * 名前は Karabiner の語彙に合わせ、`lang1` / `lang2` は KeySync が使う `japanese_kana` /
 * `japanese_eisuu` と書く。表に無い usage は `usage_0x..` にする。
 */

const letters = [..."abcdefghijklmnopqrstuvwxyz"].map((name, index) => [0x04 + index, name]);
const digits = [..."1234567890"].map((name, index) => [0x1e + index, name]);
const functions = Array.from({ length: 12 }, (_, index) => [0x3a + index, `f${index + 1}`]);
const functionsHigh = Array.from({ length: 12 }, (_, index) => [0x68 + index, `f${index + 13}`]);
const keypadDigits = [..."123456789"].map((name, index) => [0x59 + index, `keypad_${name}`]);

const USAGE_NAMES = new Map<number, string>(
  [
    ...letters,
    ...digits,
    [0x28, "return_or_enter"],
    [0x29, "escape"],
    [0x2a, "delete_or_backspace"],
    [0x2b, "tab"],
    [0x2c, "spacebar"],
    [0x2d, "hyphen"],
    [0x2e, "equal_sign"],
    [0x2f, "open_bracket"],
    [0x30, "close_bracket"],
    [0x31, "backslash"],
    [0x32, "non_us_pound"],
    [0x33, "semicolon"],
    [0x34, "quote"],
    [0x35, "grave_accent_and_tilde"],
    [0x36, "comma"],
    [0x37, "period"],
    [0x38, "slash"],
    [0x39, "caps_lock"],
    ...functions,
    [0x49, "insert"],
    [0x4a, "home"],
    [0x4b, "page_up"],
    [0x4c, "delete_forward"],
    [0x4d, "end"],
    [0x4e, "page_down"],
    [0x4f, "right_arrow"],
    [0x50, "left_arrow"],
    [0x51, "down_arrow"],
    [0x52, "up_arrow"],
    [0x54, "keypad_slash"],
    [0x55, "keypad_asterisk"],
    [0x56, "keypad_hyphen"],
    [0x57, "keypad_plus"],
    [0x58, "keypad_enter"],
    ...keypadDigits,
    [0x62, "keypad_0"],
    [0x63, "keypad_period"],
    [0x64, "non_us_backslash"],
    [0x67, "keypad_equal_sign"],
    ...functionsHigh,
    [0x85, "keypad_comma"],
    [0x87, "international1"],
    [0x88, "international2"],
    [0x89, "international3"],
    [0x90, "japanese_kana"],
    [0x91, "japanese_eisuu"],
    [0xe0, "left_control"],
    [0xe1, "left_shift"],
    [0xe2, "left_option"],
    [0xe3, "left_command"],
    [0xe4, "right_control"],
    [0xe5, "right_shift"],
    [0xe6, "right_option"],
    [0xe7, "right_command"],
  ].map(([usage, name]) => [Number(usage), String(name)] as const),
);

/**
 * usage の `key_code` 名。
 *
 * @doc docs/specs/typing-log.md#hidusagename
 */
export function hidUsageName(usage: number): string {
  return USAGE_NAMES.get(usage) ?? `usage_0x${usage.toString(16).padStart(2, "0")}`;
}

/**
 * 修飾キーの usage か（0xE0〜0xE7）。
 *
 * @doc docs/specs/typing-log.md#hidusagename
 */
export function isModifierUsage(usage: number): boolean {
  return usage >= 0xe0 && usage <= 0xe7;
}
