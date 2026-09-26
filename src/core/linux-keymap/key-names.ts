/**
 * Karabiner の `key_code` 名 → keyd のキー名。
 *
 * 位置と keycode の語彙は Mac 側と同じなので（ADR 0042）、keyd への写像はこの表 1 つで
 * 両方を引く。位置はそのまま、keycode は `karabinerKeyCode` で Karabiner 名へ畳んでから引く。
 *
 * keyd のキー名は Linux の `KEY_*` に対応する（keyd の `src/keys.c`）。HID usage → `KEY_*` の
 * 対応は Linux の `hid-input.c` の表に従う。
 *
 * **閉じた表である。** 載っていない名前は error になる。
 * - `international7`〜`international9` は Linux に対応する `KEY_*` が無い
 * - `backslash` と `non_us_pound` はどちらも `KEY_BACKSLASH` になる。位置として同じ layer に
 *   両方を書くと 1 つのキーへの割り当てが 2 つになるため、`generate.ts` が error にする
 */

import { karabinerKeyCode } from "../mac-keymap/key-codes.ts";

function same(names: readonly string[]): [string, string][] {
  return names.map((name) => [name, name]);
}

function numbered(from: string, to: string, first: number, last: number): [string, string][] {
  const entries: [string, string][] = [];
  for (let index = first; index <= last; index++)
    entries.push([`${from}${index}`, `${to}${index}`]);
  return entries;
}

/** Karabiner の `key_code` 名 → keyd のキー名。 */
export const KEYD_KEY_NAMES: ReadonlyMap<string, string> = new Map<string, string>([
  ...same([..."abcdefghijklmnopqrstuvwxyz1234567890"]),
  ...numbered("f", "f", 1, 24),
  ...[..."1234567890"].map((digit): [string, string] => [`keypad_${digit}`, `kp${digit}`]),
  // JIS。`hid-input.c` の 0x87〜0x8c。
  ["international1", "ro"],
  ["international2", "katakanahiragana"],
  ["international3", "yen"],
  ["international4", "henkan"],
  ["international5", "muhenkan"],
  ["international6", "kpjpcomma"],
  // 英数 / かなは HID の LANG2 / LANG1。Linux では KEY_HANJA / KEY_HANGEUL になる。
  ["japanese_kana", "hangeul"],
  ["japanese_eisuu", "hanja"],
  // 記号・編集
  ["return_or_enter", "enter"],
  ["escape", "esc"],
  ["delete_or_backspace", "backspace"],
  ["tab", "tab"],
  ["spacebar", "space"],
  ["hyphen", "minus"],
  ["equal_sign", "equal"],
  ["open_bracket", "leftbrace"],
  ["close_bracket", "rightbrace"],
  ["backslash", "backslash"],
  ["non_us_pound", "backslash"],
  ["semicolon", "semicolon"],
  ["quote", "apostrophe"],
  ["grave_accent_and_tilde", "grave"],
  ["comma", "comma"],
  ["period", "dot"],
  ["slash", "slash"],
  ["caps_lock", "capslock"],
  ["non_us_backslash", "102nd"],
  // 移動・編集
  ["print_screen", "sysrq"],
  ["scroll_lock", "scrolllock"],
  ["pause", "pause"],
  ["insert", "insert"],
  ["home", "home"],
  ["page_up", "pageup"],
  ["delete_forward", "delete"],
  ["end", "end"],
  ["page_down", "pagedown"],
  ["right_arrow", "right"],
  ["left_arrow", "left"],
  ["down_arrow", "down"],
  ["up_arrow", "up"],
  ["application", "compose"],
  ...same(["help", "menu", "stop", "again", "undo", "cut", "copy", "paste", "find", "cancel"]),
  // keypad
  ["keypad_num_lock", "numlock"],
  ["keypad_slash", "kpslash"],
  ["keypad_asterisk", "kpasterisk"],
  ["keypad_hyphen", "kpminus"],
  ["keypad_plus", "kpplus"],
  ["keypad_enter", "kpenter"],
  ["keypad_period", "kpdot"],
  ["keypad_equal_sign", "kpequal"],
  ["keypad_comma", "kpcomma"],
  // modifier。Option は Alt、Command は Meta として届く。
  ["left_control", "leftcontrol"],
  ["left_shift", "leftshift"],
  ["left_option", "leftalt"],
  ["left_command", "leftmeta"],
  ["right_control", "rightcontrol"],
  ["right_shift", "rightshift"],
  ["right_option", "rightalt"],
  ["right_command", "rightmeta"],
  // media / system。Apple 固有の 2 つは hid-apple が KEY_SCALE / KEY_DASHBOARD へ写す。
  ["mute", "mute"],
  ["volume_increment", "volumeup"],
  ["volume_decrement", "volumedown"],
  ["fastforward", "nextsong"],
  ["rewind", "previoussong"],
  ["play_or_pause", "playpause"],
  ["eject", "ejectcd"],
  ["display_brightness_increment", "brightnessup"],
  ["display_brightness_decrement", "brightnessdown"],
  ["mission_control", "scale"],
  ["launchpad", "dashboard"],
  ["fn", "fn"],
]);

/**
 * mod-tap の `<MOD>`（`LCTL` など）→ keyd の修飾 layer。
 *
 * keyd の修飾 layer は左右を区別しない。右 Alt だけは `altgr` が別にある。
 * `SGUI` のような複合は keyd の `overload` が 1 つの layer しか取れないので載せない。
 */
const KEYD_MODIFIER_LAYERS: ReadonlyMap<string, string> = new Map([
  ["LCTL", "control"],
  ["RCTL", "control"],
  ["LSFT", "shift"],
  ["RSFT", "shift"],
  ["LALT", "alt"],
  ["RALT", "altgr"],
  ["LGUI", "meta"],
  ["RGUI", "meta"],
]);

/**
 * 位置（Karabiner の `key_code` 名）に対応する keyd のキー名。
 *
 * @doc docs/specs/linux-keymap.md#keydkeyname
 */
export function keydPositionName(keyCode: string): string | undefined {
  return KEYD_KEY_NAMES.get(keyCode);
}

/**
 * QMK 表記の keycode に対応する keyd のキー名。
 *
 * @doc docs/specs/linux-keymap.md#keydkeyname
 */
export function keydKeyName(keycode: string): string | undefined {
  const karabiner = karabinerKeyCode(keycode);
  return karabiner === undefined ? undefined : KEYD_KEY_NAMES.get(karabiner);
}

/** mod-tap の `<MOD>`（`LCTL` など）に対応する keyd の修飾 layer。 */
export function keydModifierLayer(modifier: string): string | undefined {
  return KEYD_MODIFIER_LAYERS.get(modifier);
}
