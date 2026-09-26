import { describeKeycode } from "../core/diff/describe.ts";
import { canonicalKeycode, classifyKeycode } from "../core/validation/keycode-vocabulary.ts";
import type { createKeycodeTable } from "../core/keycode/table.ts";
import { shiftedOf } from "../core/keycode/shifted.ts";
import { keycodeLabel, layerLabel, type WorkspaceLabels } from "../workspace/labels.ts";

export interface KeycodeDisplay {
  readonly primary: string;
  readonly role?: string;
  /** 表示名が設定されている場合の表示名とraw式。 */
  readonly name?: string;
  readonly raw?: string;
}

/** keycap向けの表示option。`compact`はkeycapに収まる長さへ切り詰める。 */
export interface DisplayOptions {
  readonly compact?: boolean;
}

/** keycapに出すlayer名の上限。超えた分は`…`へ畳む。 */
const COMPACT_LABEL_LENGTH = 7;
const PURE_SHIFT_MODIFIERS = new Set(["LSFT", "RSFT"]);

/** @doc docs/specs/ui.md#keycode-labels */
export function keycodeDisplay(
  keycode: string,
  labels: WorkspaceLabels,
  table?: ReturnType<typeof createKeycodeTable>,
  options: DisplayOptions = {},
): KeycodeDisplay {
  const name = keycodeLabel(labels, keycode);
  if (name !== undefined) {
    return { primary: options.compact === true ? shorten(name) : name, name, raw: keycode };
  }
  const lexeme = classifyKeycode(keycode);
  const layerName = (layer: number): string =>
    options.compact === true ? shorten(layerLabel(labels, layer)) : layerLabel(labels, layer);
  switch (lexeme.kind) {
    case "none":
      return options.compact === true ? { primary: "—" } : { primary: "—", role: "No action" };
    case "transparent":
      return options.compact === true ? { primary: "↓" } : { primary: "↓", role: "Transparent" };
    case "basic":
      return { primary: basicLabel(lexeme.name) };
    case "modified":
      if (PURE_SHIFT_MODIFIERS.has(lexeme.modifier)) {
        return { primary: shiftedResultLabel(lexeme.inner, labels, table, options) };
      }
      return {
        primary: keycodeDisplay(lexeme.inner, labels, table, options).primary,
        role: modifierSymbol(lexeme.modifier),
      };
    case "modTap":
      return {
        primary: keycodeDisplay(lexeme.inner, labels, table, options).primary,
        role: modifierSymbol(lexeme.modifier),
      };
    case "oneShotMod":
      return { primary: modifierSymbol(lexeme.modifier), role: "one-shot" };
    case "layerSwitch": {
      const primary =
        lexeme.inner === undefined
          ? layerName(lexeme.layer)
          : keycodeDisplay(lexeme.inner, labels, table, options).primary;
      if (lexeme.inner === undefined && lexeme.action === "momentary") return { primary };
      return {
        primary,
        role:
          lexeme.inner === undefined ? layerActionLabel(lexeme.action) : layerName(lexeme.layer),
      };
    }
    case "tapDance":
      return { primary: `TD ${lexeme.index}`, role: "Tap Dance" };
    case "macro":
      return { primary: `M ${lexeme.index}`, role: "Macro" };
    case "custom": {
      if (table === undefined) return { primary: keycode };
      const resolved = table.resolve(keycode);
      return resolved.kind === "custom"
        ? { primary: shortLabel(resolved.shortName) }
        : { primary: keycode };
    }
    case "numeric":
      return { primary: keycode, role: "Numeric" };
    case "unknown":
      return { primary: keycode, role: "Unknown" };
  }
}

/** keycapへ出す短い表記。keycodeの綴りではなく、刻印に近い表記を優先する。 */
const SHORT_LABELS: Readonly<Record<string, string>> = {
  BSPACE: "⌫",
  DELETE: "Del",
  ENTER: "⏎",
  ESCAPE: "Esc",
  GESC: "Esc\n` ~",
  SPACE: "Space",
  TAB: "⇥",
  CAPSLOCK: "⇪",
  LCTRL: "⌃",
  LSHIFT: "⇧",
  LALT: "⌥",
  LGUI: "⌘",
  RCTRL: "⌃",
  RSHIFT: "⇧",
  RALT: "⌥",
  RGUI: "⌘",
  MUTE: "Mute",
  PSCREEN: "Print\nScreen",
  SCROLLLOCK: "Scroll\nLock",
  PAUSE: "Pause",
  NUMLOCK: "Num\nLock",
  INSERT: "Insert",
  APPLICATION: "Menu",
  MINUS: "-",
  EQUAL: "=",
  LBRACKET: "[",
  RBRACKET: "]",
  BSLASH: "\\",
  SCOLON: ";",
  QUOTE: "'",
  GRAVE: "`",
  COMMA: ",",
  DOT: ".",
  SLASH: "/",
  LEFT: "←",
  RIGHT: "→",
  UP: "↑",
  DOWN: "↓",
  HOME: "Home",
  END: "End",
  PGUP: "Page\nUp",
  PGDOWN: "Page\nDown",
  KP_0: "0",
  KP_1: "1",
  KP_2: "2",
  KP_3: "3",
  KP_4: "4",
  KP_5: "5",
  KP_6: "6",
  KP_7: "7",
  KP_8: "8",
  KP_9: "9",
  KP_SLASH: "/",
  KP_ASTERISK: "*",
  KP_MINUS: "-",
  KP_PLUS: "+",
  KP_DOT: ".",
  KP_COMMA: ",",
  KP_EQUAL: "=",
  KP_ENTER: "Num\nEnter",
  TILD: "~",
  EXLM: "!",
  AT: "@",
  HASH: "#",
  DLR: "$",
  PERC: "%",
  CIRC: "^",
  AMPR: "&",
  ASTR: "*",
  LPRN: "(",
  RPRN: ")",
  UNDS: "_",
  PLUS: "+",
  LCBR: "{",
  RCBR: "}",
  PIPE: "|",
  COLN: ":",
  DQUO: '"',
  LT: "<",
  GT: ">",
  QUES: "?",
  LANG1: "LANG1",
  LANG2: "LANG2",
  INT1: "_\n\\",
  INT2: "KANA",
  INT3: "JYEN",
  INT4: "HENK",
  INT5: "MHEN",
  NONUS_HASH: "~\n#",
  NONUS_BSLASH: "|\n\\",
  VOLD: "Vol −",
  VOLU: "Vol +",
  MPRV: "Prev",
  MPLY: "Play",
  MNXT: "Next",
  MSTP: "Stop",
  MRWD: "Rew",
  MFFD: "FF",
  EJCT: "Eject",
  MSEL: "Media\nSelect",
  BRID: "Bri −",
  BRIU: "Bri +",
  MISSION_CONTROL: "Mission\nControl",
  LAUNCHPAD: "Launch\npad",
  ASSISTANT: "Assist",
  PWR: "Power",
  SLEP: "Sleep",
  WAKE: "Wake",
  CALC: "Calc",
  MAIL: "Mail",
  MYCM: "My\nComputer",
  WSCH: "Web\nSearch",
  WHOM: "Web\nHome",
  WBAK: "Web\nBack",
  WFWD: "Web\nForward",
  WSTP: "Web\nStop",
  WREF: "Web\nReload",
  WFAV: "Web\nFavorites",
  MS_UP: "Mouse\n↑",
  MS_DOWN: "Mouse\n↓",
  MS_LEFT: "Mouse\n←",
  MS_RIGHT: "Mouse\n→",
  BTN1: "Click\nLeft",
  BTN2: "Click\nRight",
  BTN3: "Click\nMiddle",
  BTN4: "Button\n4",
  BTN5: "Button\n5",
  WH_U: "Wheel\n↑",
  WH_D: "Wheel\n↓",
  WH_L: "Wheel\n←",
  WH_R: "Wheel\n→",
  ACL0: "Accel\n0",
  ACL1: "Accel\n1",
  ACL2: "Accel\n2",
  CAPS_WORD: "Caps\nWord",
  LEAD: "Leader",
  LOCK: "Lock",
  REPEAT: "Repeat",
  ALT_REPEAT: "Alt\nRepeat",
  LSPO: "⇧ (",
  RSPC: "⇧ )",
  LCPO: "⌃ (",
  RCPC: "⌃ )",
  LAPO: "⌥ (",
  RAPC: "⌥ )",
  SFTENT: "⇧ ⏎",
};

export function basicLabel(keycode: string): string {
  const canonical = keycode.startsWith("KC_") ? keycode : `KC_${keycode}`;
  const name = canonical.replace(/^KC_/, "");
  const shifted = shiftedOf(canonical);
  if (shifted !== undefined) return `${shortLabel(shifted)}\n${shortLabel(canonical)}`;
  const explicit = SHORT_LABELS[name];
  if (explicit !== undefined) return explicit;
  return shortLabel(name);
}

function shiftedResultLabel(
  inner: string,
  labels: WorkspaceLabels,
  table: ReturnType<typeof createKeycodeTable> | undefined,
  options: DisplayOptions,
): string {
  const shifted = shiftedOf(canonicalKeycode(inner));
  return shifted === undefined
    ? keycodeDisplay(inner, labels, table, options).primary
    : shortLabel(shifted);
}

/** `KC_`を外した名前、またはcustom keycodeのshort nameを短い表記へ寄せる。 */
export function shortLabel(name: string): string {
  const normalized = name.replace(/^KC_/, "");
  return SHORT_LABELS[normalized] ?? normalized;
}

function shorten(label: string): string {
  return label.length <= COMPACT_LABEL_LENGTH ? label : `${label.slice(0, COMPACT_LABEL_LENGTH)}…`;
}

export function modifierSymbol(modifier: string): string {
  if (["LGUI", "RGUI", "SGUI", "LCMD", "RCMD", "SCMD", "SWIN"].includes(modifier)) return "⌘";
  if (["LALT", "RALT", "LAG", "RAG"].includes(modifier)) return "⌥";
  if (["LCTL", "RCTL", "LCG", "RCG", "LCA", "RCA"].includes(modifier)) return "⌃";
  if (["LSFT", "RSFT", "LSA", "RSA"].includes(modifier)) return "⇧";
  if (modifier === "HYPR") return "⌘⌥⌃⇧";
  if (modifier === "MEH") return "⌥⌃⇧";
  return modifier;
}

export function layerActionLabel(action: string): string {
  switch (action) {
    case "momentary":
    case "layerTap":
    case "layerMod":
      return "hold";
    case "toggle":
      return "toggle";
    case "to":
      return "stay";
    case "tapToggle":
      return "tap-toggle";
    case "default":
      return "default";
    case "oneShot":
      return "one-shot";
    default:
      return action;
  }
}

export function describeDisplayKeycode(
  keycode: string,
  table?: ReturnType<typeof createKeycodeTable> | undefined,
): string {
  return describeKeycode(keycode, table);
}

/** keycodeの語彙から意味別のclassを決める。盤面とOverviewで同じ分類を使う。 */
export function keycodeClass(keycode: string): string {
  const lexeme = classifyKeycode(keycode);
  switch (lexeme.kind) {
    case "modified":
      return "mod";
    case "modTap":
    case "oneShotMod":
      return "mod-tap";
    case "layerSwitch":
      return lexeme.inner === undefined ? "layer" : "layer-tap";
    case "tapDance":
      return "tapdance";
    case "custom":
    case "macro":
    case "numeric":
    case "unknown":
      return "custom";
    case "none":
      return "none";
    case "basic":
    case "transparent":
      return "basic";
  }
}
