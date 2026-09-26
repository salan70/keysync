/** Picker に置く 1 個の keycode。表示名は keycodeDisplay に委譲する。 */
export interface PickerKey {
  readonly keycode: string;
  /** 物理配列上の幅。省略時は 1u。 */
  readonly u?: number;
}

/** keycode を置かない物理的な空き。省略時は 1u。 */
export interface Spacer {
  readonly kind: "spacer";
  readonly u?: number;
}

export type PickerEntry = PickerKey | Spacer;

export interface PickerRow {
  readonly main: readonly PickerEntry[];
  readonly nav?: readonly PickerEntry[];
  readonly numpad?: readonly PickerEntry[];
}

/** pickerを26uの固定座標へ配置する各groupの開始位置。 */
export const PICKER_GROUP_OFFSETS = {
  main: 0,
  nav: 18,
  numpad: 22,
} as const;

export const PICKER_TOTAL_UNITS = 26;

function key(keycode: string, u = 1): PickerKey {
  return u === 1 ? { keycode } : { keycode, u };
}

function spacer(u = 1): Spacer {
  return u === 1 ? { kind: "spacer" } : { kind: "spacer", u };
}

const functionKeys = Array.from({ length: 12 }, (_, index) => key(`KC_F${index + 1}`));

/**
 * Vial の ISO/JIS 面に相当する keycode picker の物理配列。
 *
 * main は ISO/JIS の本体、nav と numpad は同じ行高で右側へ置く cluster である。
 * keycap のラベルはここへ複製せず、既存の keycodeDisplay を使う。
 */
export const ISO_JIS_ROWS: readonly PickerRow[] = [
  {
    main: [
      key("KC_ESCAPE"),
      spacer(),
      ...functionKeys.slice(0, 4),
      spacer(),
      ...functionKeys.slice(4, 8),
      spacer(),
      ...functionKeys.slice(8),
    ],
    nav: [key("KC_PSCREEN"), key("KC_SCROLLLOCK"), key("KC_PAUSE")],
  },
  {
    main: [
      key("KC_GRAVE"),
      ...Array.from({ length: 9 }, (_, index) => key(`KC_${index + 1}`)),
      key("KC_0"),
      key("KC_MINUS"),
      key("KC_EQUAL"),
      key("KC_INT3"),
      key("KC_BSPACE", 2),
    ],
    nav: [key("KC_INSERT"), key("KC_HOME"), key("KC_PGUP")],
    numpad: [key("KC_NUMLOCK"), key("KC_KP_SLASH"), key("KC_KP_ASTERISK"), key("KC_KP_MINUS")],
  },
  {
    main: [
      key("KC_TAB", 1.75),
      ...["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"].map((letter) => key(`KC_${letter}`)),
      key("KC_LBRACKET"),
      key("KC_RBRACKET"),
      key("KC_ENTER", 2.25),
    ],
    nav: [key("KC_DELETE"), key("KC_END"), key("KC_PGDOWN")],
    numpad: [key("KC_KP_7"), key("KC_KP_8"), key("KC_KP_9"), key("KC_KP_PLUS")],
  },
  {
    main: [
      key("KC_CAPSLOCK", 1.75),
      ...["A", "S", "D", "F", "G", "H", "J", "K", "L"].map((letter) => key(`KC_${letter}`)),
      key("KC_SCOLON"),
      key("KC_QUOTE"),
      key("KC_NONUS_HASH"),
      spacer(2.25),
    ],
    numpad: [key("KC_KP_4"), key("KC_KP_5"), key("KC_KP_6"), key("KC_KP_COMMA")],
  },
  {
    main: [
      key("KC_LSHIFT", 2.25),
      key("KC_NONUS_BSLASH"),
      ...["Z", "X", "C", "V", "B", "N", "M"].map((letter) => key(`KC_${letter}`)),
      key("KC_COMMA"),
      key("KC_DOT"),
      key("KC_SLASH"),
      key("KC_INT1"),
      key("KC_RSHIFT", 1.75),
    ],
    nav: [spacer(), key("KC_UP"), spacer()],
    numpad: [key("KC_KP_1"), key("KC_KP_2"), key("KC_KP_3"), key("KC_KP_EQUAL")],
  },
  {
    main: [
      key("KC_LCTRL", 1.25),
      key("KC_LGUI", 1.25),
      key("KC_LALT", 1.25),
      key("KC_INT5", 1.25),
      key("KC_SPACE", 3.5),
      key("KC_INT4", 1.25),
      key("KC_INT2", 1.25),
      key("KC_RALT", 1.25),
      key("KC_RGUI", 1.25),
      key("KC_APPLICATION", 1.25),
      key("KC_RCTRL", 1.25),
    ],
    nav: [key("KC_LEFT"), key("KC_DOWN"), key("KC_RIGHT")],
    numpad: [key("KC_KP_0", 2), key("KC_KP_DOT"), key("KC_KP_ENTER")],
  },
];

/** picker 下部の 1 行ストリップ。main/nav/numpad の grid とは独立に描く。 */
export const EXTRA_ROW: readonly PickerEntry[] = [
  key("KC_NO"),
  spacer(),
  key("KC_TRNS"),
  key("KC_TILD"),
  key("KC_EXLM"),
  key("KC_AT"),
  key("KC_HASH"),
  key("KC_DLR"),
  key("KC_PERC"),
  key("KC_CIRC"),
  key("KC_AMPR"),
  key("KC_ASTR"),
  key("KC_LPRN"),
  key("KC_RPRN"),
  key("KC_UNDS"),
  key("KC_PLUS"),
  key("KC_LCBR"),
  key("KC_RCBR"),
  key("KC_LT"),
  key("KC_GT"),
  key("KC_COLN"),
  key("KC_PIPE"),
  key("KC_QUES"),
  key("KC_DQUO"),
  key("KC_LANG1"),
  key("KC_LANG2"),
];

/** picker のタブ。基本は 26u の物理配列、他は見出し付きの行で列を揃えて並べる。 */
export const PICKER_TABS = [
  { id: "basic", label: "基本" },
  { id: "layer", label: "レイヤー" },
  { id: "media", label: "メディア・マウス" },
  { id: "special", label: "特殊" },
] as const;

export type PickerTabId = (typeof PICKER_TABS)[number]["id"];

/** 基本以外のタブの 1 行。先頭に見出しを置き、keycode は同じ幅で左から並べる。 */
export interface PickerLabeledRow {
  readonly label: string;
  /** 見出しの下に添える、その行の動きの短い説明。 */
  readonly description?: string;
  readonly keycodes: readonly string[];
}

/** 見出しの幅。keycode は見出しの右から並べる。 */
export const PICKER_LABEL_UNITS = 3;

/** 基本以外のタブの keycode の幅。全行で同じ幅にして列を縦に揃え、長い行は 26u に収まるまで縮める。 */
export function labeledKeyUnits(rows: readonly PickerLabeledRow[]): number {
  const longest = Math.max(1, ...rows.map((row) => row.keycodes.length));
  return Math.min(2, (PICKER_TOTAL_UNITS - PICKER_LABEL_UNITS) / longest);
}

/** レイヤータブの行。LT は Hold 選択中に MO を押して作る（`applyPick`）。 */
const LAYER_PICKER_WRAPPERS = [
  ["MO", "押している間"],
  ["TG", "オン・オフ切替"],
  ["TT", "押す間・連打で固定"],
  ["TO", "その layer へ移る"],
  ["DF", "既定の layer にする"],
  ["OSL", "次の 1 打だけ"],
] as const;

export function layerPickerRows(layers: readonly number[]): readonly PickerLabeledRow[] {
  return LAYER_PICKER_WRAPPERS.map(([wrapper, description]) => ({
    label: wrapper,
    description,
    keycodes: layers.map((layer) => `${wrapper}(${layer})`),
  }));
}

const range = (prefix: string, from: number, to: number): string[] =>
  Array.from({ length: to - from + 1 }, (_, offset) => `${prefix}${from + offset}`);

export const MEDIA_ROWS: readonly PickerLabeledRow[] = [
  { label: "音量", keycodes: ["KC_MUTE", "KC_VOLD", "KC_VOLU"] },
  {
    label: "再生",
    keycodes: [
      "KC_MPRV",
      "KC_MPLY",
      "KC_MNXT",
      "KC_MSTP",
      "KC_MRWD",
      "KC_MFFD",
      "KC_EJCT",
      "KC_MSEL",
    ],
  },
  {
    label: "画面",
    keycodes: ["KC_BRID", "KC_BRIU", "KC_MISSION_CONTROL", "KC_LAUNCHPAD", "KC_ASSISTANT"],
  },
  {
    label: "電源・アプリ",
    keycodes: ["KC_PWR", "KC_SLEP", "KC_WAKE", "KC_CALC", "KC_MAIL", "KC_MYCM"],
  },
  {
    label: "ブラウザ",
    keycodes: ["KC_WSCH", "KC_WHOM", "KC_WBAK", "KC_WFWD", "KC_WSTP", "KC_WREF", "KC_WFAV"],
  },
  {
    label: "マウス",
    keycodes: ["KC_MS_UP", "KC_MS_DOWN", "KC_MS_LEFT", "KC_MS_RIGHT", ...range("KC_BTN", 1, 5)],
  },
  {
    label: "ホイール",
    keycodes: ["KC_WH_U", "KC_WH_D", "KC_WH_L", "KC_WH_R", ...range("KC_ACL", 0, 2)],
  },
];

/**
 * 特殊タブ。`RESET` / `QK_BOOT` / `EE_CLR` / `DEBUG` は置かない。
 * 押すだけで bootloader 移行や EEPROM 消去が起きるため、選ぶなら raw keycode で明示させる（ADR 0041）。
 */
export const SPECIAL_ROWS: readonly PickerLabeledRow[] = [
  { label: "F13〜F24", keycodes: range("KC_F", 13, 24) },
  {
    label: "機能",
    keycodes: ["KC_GESC", "CAPS_WORD", "KC_LEAD", "KC_LOCK", "KC_REPEAT", "KC_ALT_REPEAT"],
  },
  {
    label: "Space Cadet",
    keycodes: ["KC_LSPO", "KC_RSPC", "KC_LCPO", "KC_RCPC", "KC_LAPO", "KC_RAPC", "KC_SFTENT"],
  },
  { label: "言語", keycodes: range("KC_LANG", 3, 9) },
  { label: "国際", keycodes: range("KC_INT", 6, 9) },
];
