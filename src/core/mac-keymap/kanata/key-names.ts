/**
 * Karabiner の `key_code` 名 → kanata のキー名。
 *
 * 位置と keycode の語彙は Karabiner の名前のまま持つ（ADR 0022・0042・0049）。kanata への写像は
 * この表 1 つで両方を引く。位置はそのまま、keycode は `karabinerKeyEvent` で Karabiner 名へ
 * 畳んでから引く。
 *
 * kanata のキー名は `parser/src/keys/mod.rs` の `str_to_oscode`（macOS で有効な名前）に従う。
 * 記号は 1 文字の別名があるが、S 式の区切りと紛れないよう英字の名前を使う。
 *
 * **閉じた表である。** 載っていない名前は error になる。kanata の macOS に対応する名前が
 * 無いもの（`international3`、`print_screen`、`help`、`mission_control` など）は載せない。
 */

import { KARABINER_MODIFIERS, karabinerKeyEvent } from "../key-codes.ts";

function same(names: readonly string[]): [string, string][] {
  return names.map((name) => [name, name]);
}

/** Karabiner の `key_code` 名 → kanata のキー名。 */
export const KANATA_KEY_NAMES: ReadonlyMap<string, string> = new Map<string, string>([
  ...same([..."abcdefghijklmnopqrstuvwxyz1234567890"]),
  ...Array.from({ length: 24 }, (_, index): [string, string] => [`f${index + 1}`, `f${index + 1}`]),
  ...[..."1234567890"].map((digit): [string, string] => [`keypad_${digit}`, `kp${digit}`]),
  // JIS
  ["international1", "ro"],
  ["international4", "henk"],
  ["international5", "mhnk"],
  // 英数 / かなは HID の LANG2 / LANG1。
  ["japanese_kana", "kana"],
  ["japanese_eisuu", "eisu"],
  // 記号・編集
  ["return_or_enter", "ret"],
  ["escape", "esc"],
  ["delete_or_backspace", "bspc"],
  ["tab", "tab"],
  ["spacebar", "spc"],
  ["hyphen", "min"],
  ["equal_sign", "eql"],
  ["open_bracket", "lbrc"],
  ["close_bracket", "rbrc"],
  ["backslash", "bksl"],
  ["non_us_pound", "nuhs"],
  ["semicolon", "scln"],
  ["quote", "apos"],
  ["grave_accent_and_tilde", "grv"],
  ["comma", "comm"],
  ["period", "Period"],
  ["slash", "Slash"],
  ["caps_lock", "caps"],
  ["non_us_backslash", "nubs"],
  // 移動・編集
  ["scroll_lock", "slck"],
  ["pause", "pause"],
  ["insert", "ins"],
  ["home", "home"],
  ["page_up", "pgup"],
  ["delete_forward", "del"],
  ["end", "end"],
  ["page_down", "pgdn"],
  ["right_arrow", "rght"],
  ["left_arrow", "left"],
  ["down_arrow", "down"],
  ["up_arrow", "up"],
  ["application", "comp"],
  // keypad
  ["keypad_num_lock", "nlck"],
  ["keypad_slash", "kp/"],
  ["keypad_asterisk", "kp*"],
  ["keypad_hyphen", "kp-"],
  ["keypad_plus", "kp+"],
  ["keypad_enter", "kprt"],
  ["keypad_period", "kp."],
  ["keypad_equal_sign", "NumpadEqual"],
  ["keypad_comma", "kp,"],
  // modifier
  ["left_control", "lctl"],
  ["left_shift", "lsft"],
  ["left_option", "lalt"],
  ["left_command", "lmet"],
  ["right_control", "rctl"],
  ["right_shift", "rsft"],
  ["right_option", "ralt"],
  ["right_command", "rmet"],
  // media / system
  ["mute", "mute"],
  ["volume_increment", "volu"],
  ["volume_decrement", "voldwn"],
  ["fastforward", "next"],
  ["rewind", "prev"],
  ["play_or_pause", "pp"],
  ["eject", "eject"],
  ["display_brightness_increment", "brup"],
  ["display_brightness_decrement", "brdown"],
  ["fn", "fn"],
]);

/** 修飾キーの Karabiner 名 → kanata の output chord の接頭辞。 */
const CHORD_PREFIXES: ReadonlyMap<string, string> = new Map([
  ["left_control", "C-"],
  ["left_shift", "S-"],
  ["left_option", "A-"],
  ["left_command", "M-"],
  ["right_control", "RC-"],
  ["right_shift", "RS-"],
  ["right_option", "RA-"],
  ["right_command", "RM-"],
]);

/**
 * 位置（Karabiner の `key_code` 名）に対応する kanata のキー名。
 *
 * @doc docs/specs/mac-keymap.md#kanatakeyname
 */
export function kanataPositionName(keyCode: string): string | undefined {
  return KANATA_KEY_NAMES.get(keyCode);
}

/**
 * QMK 表記の keycode を kanata の出力 1 つにする。shift 済み keycode（`KC_EXLM`）は
 * `S-1` のような output chord になる。
 *
 * @doc docs/specs/mac-keymap.md#kanatakeyname
 */
export function kanataKeyName(keycode: string): string | undefined {
  const event = karabinerKeyEvent(keycode);
  if (event === undefined) return undefined;
  return kanataChord(event.modifiers ?? [], event.key_code);
}

/** 修飾キー（Karabiner 名）の組と key_code を output chord にする。 */
export function kanataChord(modifiers: readonly string[], keyCode: string): string | undefined {
  const key = KANATA_KEY_NAMES.get(keyCode);
  if (key === undefined) return undefined;
  let prefix = "";
  for (const modifier of new Set(modifiers)) {
    const part = CHORD_PREFIXES.get(modifier);
    if (part === undefined) return undefined;
    prefix += part;
  }
  return `${prefix}${key}`;
}

/** mod-tap の `<MOD>`（`LCTL` など）→ Karabiner の修飾キー名の組。 */
export function modifierKeyCodes(modifier: string): readonly string[] | undefined {
  return KARABINER_MODIFIERS.get(modifier);
}
