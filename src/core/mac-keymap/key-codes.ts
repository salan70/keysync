/**
 * QMK 表記 → Karabiner の `key_code`。
 *
 * R-006 Spike の必要分だけの表を、MacBook 内蔵キーボード（JIS）で押せる範囲へ広げたもの。
 * 表の key は `canonicalKeycode` が返す長い表記で持ち、引く前に必ず畳む。
 * `classifyKeycode` の語彙が長い表記を正としているため（ADR 0001・0010）。
 *
 * **閉じた表である**。載っていない表記は `mac-keymap/unsupported-keycode`（error）になる。
 * Vial 側は実機が解釈するので warning で済むが、Karabiner は生成器が落とせなければ
 * 機能そのものが無くなるため severity が違う（ADR 0023）。
 *
 */

import { baseOf } from "../keycode/shifted.ts";
import { canonicalKeycode } from "../validation/keycode-vocabulary.ts";
import type { KarabinerKeyEvent } from "./karabiner.ts";
import type { MacKeyboardLayout } from "./types.ts";

/** `from`〜`to` の連番を `KC_<prefix>n` → `<karabiner>n` の対に展開する。 */
function numbered(
  keycodePrefix: string,
  keyCodePrefix: string,
  from: number,
  to: number,
): [string, string][] {
  const entries: [string, string][] = [];
  for (let index = from; index <= to; index++) {
    entries.push([`${keycodePrefix}${index}`, `${keyCodePrefix}${index}`]);
  }
  return entries;
}

const LETTERS: [string, string][] = [..."abcdefghijklmnopqrstuvwxyz"].map((letter) => [
  `KC_${letter.toUpperCase()}`,
  letter,
]);

const DIGITS: [string, string][] = [..."1234567890"].map((digit) => [`KC_${digit}`, digit]);

const FUNCTION_KEYS = numbered("KC_F", "f", 1, 24);

const KEYPAD_DIGITS: [string, string][] = [..."1234567890"].map((digit) => [
  `KC_KP_${digit}`,
  `keypad_${digit}`,
]);

const INTERNATIONAL = numbered("KC_INT", "international", 1, 9);

const LCTL = "left_control";
const LSFT = "left_shift";
const LALT = "left_option";
const LGUI = "left_command";
const RCTL = "right_control";
const RSFT = "right_shift";
const RALT = "right_option";
const RGUI = "right_command";

/**
 * modifier の wrapper 名 → Karabiner の modifier の `key_code` 列。
 *
 * `LSFT(kc)` の修飾と `<MOD>_T(kc)` の hold 側の両方で引く（ADR 0043）。
 * `<MOD>` は `LCTL` のように `KC_` が付かないので、そちらの表記で持つ。
 * 複合の構成は QMK の定義どおり。`classifyKeycode` の `MODIFIER_WRAPPERS` と同じ集合を覆う。
 */
export const KARABINER_MODIFIERS: ReadonlyMap<string, readonly string[]> = new Map<
  string,
  readonly string[]
>([
  ["LCTL", [LCTL]],
  ["LSFT", [LSFT]],
  ["LALT", [LALT]],
  ["LGUI", [LGUI]],
  ["RCTL", [RCTL]],
  ["RSFT", [RSFT]],
  ["RALT", [RALT]],
  ["RGUI", [RGUI]],
  ["HYPR", [LCTL, LSFT, LALT, LGUI]],
  ["ALL", [LCTL, LSFT, LALT, LGUI]],
  ["MEH", [LCTL, LSFT, LALT]],
  ["LCAG", [LCTL, LALT, LGUI]],
  ["RCAG", [RCTL, RALT, RGUI]],
  ["SGUI", [LSFT, LGUI]],
  ["SCMD", [LSFT, LGUI]],
  ["SWIN", [LSFT, LGUI]],
  ["RSG", [RSFT, RGUI]],
  ["RCS", [RCTL, RSFT]],
  ["LCS", [LCTL, LSFT]],
  ["C_S", [LCTL, LSFT]],
  ["LCA", [LCTL, LALT]],
  ["LSA", [LSFT, LALT]],
  ["RSA", [RSFT, RALT]],
  ["LCG", [LCTL, LGUI]],
  ["RCG", [RCTL, RGUI]],
  ["LAG", [LALT, LGUI]],
  ["RAG", [RALT, RGUI]],
]);

/** QMK 表記（canonical）→ Karabiner の `key_code`。 */
export const KARABINER_KEY_CODES: ReadonlyMap<string, string> = new Map<string, string>([
  ...LETTERS,
  ...DIGITS,
  ...FUNCTION_KEYS,
  ...KEYPAD_DIGITS,
  ...INTERNATIONAL,
  // 記号・編集
  ["KC_ENTER", "return_or_enter"],
  ["KC_ESCAPE", "escape"],
  ["KC_BSPACE", "delete_or_backspace"],
  ["KC_TAB", "tab"],
  ["KC_SPACE", "spacebar"],
  ["KC_MINUS", "hyphen"],
  ["KC_EQUAL", "equal_sign"],
  ["KC_LBRACKET", "open_bracket"],
  ["KC_RBRACKET", "close_bracket"],
  ["KC_BSLASH", "backslash"],
  ["KC_NONUS_HASH", "non_us_pound"],
  ["KC_SCOLON", "semicolon"],
  ["KC_QUOTE", "quote"],
  ["KC_GRAVE", "grave_accent_and_tilde"],
  ["KC_COMMA", "comma"],
  ["KC_DOT", "period"],
  ["KC_SLASH", "slash"],
  ["KC_CAPSLOCK", "caps_lock"],
  ["KC_NONUS_BSLASH", "non_us_backslash"],
  // 移動・編集
  ["KC_PSCREEN", "print_screen"],
  ["KC_SCROLLLOCK", "scroll_lock"],
  ["KC_PAUSE", "pause"],
  ["KC_INSERT", "insert"],
  ["KC_HOME", "home"],
  ["KC_PGUP", "page_up"],
  ["KC_DELETE", "delete_forward"],
  ["KC_END", "end"],
  ["KC_PGDOWN", "page_down"],
  ["KC_RIGHT", "right_arrow"],
  ["KC_LEFT", "left_arrow"],
  ["KC_DOWN", "down_arrow"],
  ["KC_UP", "up_arrow"],
  ["KC_APPLICATION", "application"],
  ["KC_HELP", "help"],
  ["KC_MENU", "menu"],
  ["KC_STOP", "stop"],
  ["KC_AGAIN", "again"],
  ["KC_UNDO", "undo"],
  ["KC_CUT", "cut"],
  ["KC_COPY", "copy"],
  ["KC_PASTE", "paste"],
  ["KC_FIND", "find"],
  ["KC_CANCEL", "cancel"],
  // keypad
  ["KC_NUMLOCK", "keypad_num_lock"],
  ["KC_KP_SLASH", "keypad_slash"],
  ["KC_KP_ASTERISK", "keypad_asterisk"],
  ["KC_KP_MINUS", "keypad_hyphen"],
  ["KC_KP_PLUS", "keypad_plus"],
  ["KC_KP_ENTER", "keypad_enter"],
  ["KC_KP_DOT", "keypad_period"],
  ["KC_KP_EQUAL", "keypad_equal_sign"],
  ["KC_KP_COMMA", "keypad_comma"],
  // modifier
  ["KC_LCTRL", "left_control"],
  ["KC_LSHIFT", "left_shift"],
  ["KC_LALT", "left_option"],
  ["KC_LGUI", "left_command"],
  ["KC_RCTRL", "right_control"],
  ["KC_RSHIFT", "right_shift"],
  ["KC_RALT", "right_option"],
  ["KC_RGUI", "right_command"],
  // JIS。MacBook 内蔵キーボードの英数 / かなはこれ。
  ["KC_LANG1", "japanese_kana"],
  ["KC_LANG2", "japanese_eisuu"],
  // media / system。Apple 固有の key_code を持つ。
  ["KC_MUTE", "mute"],
  ["KC_VOLU", "volume_increment"],
  ["KC_VOLD", "volume_decrement"],
  ["KC_MNXT", "fastforward"],
  ["KC_MPRV", "rewind"],
  ["KC_MPLY", "play_or_pause"],
  ["KC_EJCT", "eject"],
  ["KC_BRIU", "display_brightness_increment"],
  ["KC_BRID", "display_brightness_decrement"],
  ["KC_MISSION_CONTROL", "mission_control"],
  ["KC_LAUNCHPAD", "launchpad"],
]);

/**
 * desired state の位置として書ける `key_code` 名。
 *
 * 表の値そのものに、QMK 側に対応の無い `fn` を足したもの。MacBook 内蔵キーボードの
 * `fn` は押せるが QMK には対応する keycode が無い。
 */
export const KARABINER_POSITIONS: ReadonlySet<string> = new Set<string>([
  ...KARABINER_KEY_CODES.values(),
  "fn",
]);

/**
 * 物理配列に存在しない位置。`KARABINER_POSITIONS` の部分集合（ADR 0024）。
 *
 * ansi の根拠は 2 種で、区別して保守する。
 * - Fact: `japanese_kana` / `japanese_eisuu` は US 配列 MacBook に無い（2026-09-06 実機確認）
 * - Inference: `international*` / `non_us_*` は HID usage の定義上 JIS / ISO 配列専用で、
 *   ANSI 物理配列に対応キーが無い
 *
 * jis の根拠は 1 種。
 * - Inference: `grave_accent_and_tilde` / `right_option` は MacBook の JIS 盤面
 *   （`physical-layout.ts`）に無い。盤面自体が Apple 公開画像からの読み取りで、
 *   実機 Fact ではない（ADR 0025 の Open Question）
 *
 * **この集合は盤面の差を覆っていなければならない。** 片方の盤面にあって
 * もう片方に無い位置が漏れると、その割り当てが無診断で静かに失われる。
 * `physical-layout.test.ts` が両方向で検証する。
 *
 * なお両方の盤面に無い位置（`keypad_*` / `f13`〜`f24` / メディアキーなど）はここへ
 * 入れない。物理キーが fn の状態で別 usage を送るため、盤面に無いことが
 * 「発火しない」の根拠にならない。
 */
export const LAYOUT_MISSING_POSITIONS: ReadonlyMap<
  MacKeyboardLayout,
  ReadonlySet<string>
> = new Map<MacKeyboardLayout, ReadonlySet<string>>([
  [
    "ansi",
    new Set<string>([
      // Fact
      "japanese_kana",
      "japanese_eisuu",
      // Inference
      ...INTERNATIONAL.map(([, keyCode]) => keyCode),
      "non_us_pound",
      "non_us_backslash",
    ]),
  ],
  [
    "jis",
    new Set<string>([
      // Inference
      "grave_accent_and_tilde",
      "right_option",
    ]),
  ],
]);

/**
 * QMK 表記に対応する Karabiner の `key_code`。無ければ `undefined`。
 *
 * @doc docs/specs/mac-keymap.md#karabinerkeycode
 */
export function karabinerKeyCode(keycode: string): string | undefined {
  return KARABINER_KEY_CODES.get(canonicalKeycode(keycode));
}

/**
 * QMK 表記を Karabiner の `to` イベント 1 個へ写す。無ければ `undefined`。
 *
 * `KC_EXLM` のような shift 済み keycode は base の `key_code` に `left_shift` を付けて表す。
 * Karabiner に `!` 単体の `key_code` は無いため（ADR 0043）。
 *
 * @doc docs/specs/mac-keymap.md#karabinerkeycode
 */
export function karabinerKeyEvent(keycode: string): KarabinerKeyEvent | undefined {
  const canonical = canonicalKeycode(keycode);
  const direct = KARABINER_KEY_CODES.get(canonical);
  if (direct !== undefined) return { key_code: direct };
  const base = baseOf(canonical);
  const shifted = base === undefined ? undefined : KARABINER_KEY_CODES.get(base);
  return shifted === undefined ? undefined : { key_code: shifted, modifiers: [LSFT] };
}
