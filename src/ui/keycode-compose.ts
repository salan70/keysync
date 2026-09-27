import {
  classifyKeycode,
  type LayerAction,
  type KeycodeLexeme,
} from "../core/validation/keycode-vocabulary.ts";

export type PickTarget = "whole" | "tap" | "hold";

export interface StructuredValues {
  readonly tap?: string;
  readonly hold?: string;
  readonly layer?: number;
  readonly modifier?: string;
  readonly action?: LayerAction;
}

export const BEHAVIOR_OPTIONS = [
  "basic",
  "modified",
  "modTap",
  "layerSwitch",
  "tapDance",
  "custom",
  "none",
] as const;

/** kanata へ落とせる動作だけ。判定の定義元は `macKeycodeSupport`。 */
export const MAC_BEHAVIOR_OPTIONS = ["basic", "modified", "modTap", "layerSwitch", "none"] as const;

export function macBehaviorOptions(current: string): readonly string[] {
  return (MAC_BEHAVIOR_OPTIONS as readonly string[]).includes(current)
    ? MAC_BEHAVIOR_OPTIONS
    : [...MAC_BEHAVIOR_OPTIONS, current];
}

export function behaviorKind(lexeme: KeycodeLexeme | undefined): string {
  if (lexeme === undefined) return "basic";
  switch (lexeme.kind) {
    case "oneShotMod":
      return "modTap";
    case "unknown":
    case "numeric":
      return "custom";
    default:
      return lexeme.kind === "layerSwitch" ? "layerSwitch" : lexeme.kind;
  }
}

export function structuredValues(keycode: string): StructuredValues {
  const lexeme = classifyKeycode(keycode);
  switch (lexeme.kind) {
    case "modified":
      return { tap: lexeme.inner, modifier: lexeme.modifier };
    case "modTap": {
      const hold = modifierKeycode(lexeme.modifier);
      return hold === undefined
        ? { tap: lexeme.inner, modifier: lexeme.modifier }
        : { tap: lexeme.inner, hold, modifier: lexeme.modifier };
    }
    case "layerSwitch":
      return {
        tap: lexeme.inner ?? "KC_NO",
        layer: lexeme.layer,
        action: lexeme.action,
      };
    case "basic":
      return { tap: keycode };
    case "none":
      return { tap: "KC_NO" };
    default:
      return { tap: keycode };
  }
}

/** 動作 select の値から、既存の wrapper を壊さずに keycode を組み立てる。 */
export function composeKeycode(
  kind: string,
  values: StructuredValues | undefined,
  _legacyLabels?: unknown,
): string {
  const tap = values?.tap ?? "KC_NO";
  switch (kind) {
    case "modified":
      return `${values?.modifier ?? "LGUI"}(${tap})`;
    case "modTap": {
      const modifier = values?.modifier ?? modifierName(values?.hold) ?? "LSFT";
      return `${modifier}_T(${tap})`;
    }
    case "layerSwitch":
      return composeLayerKeycode(values?.action ?? "momentary", values?.layer ?? 0, tap);
    case "tapDance":
      return "TD(0)";
    case "custom":
      return tap;
    case "none":
      return "KC_NO";
    case "basic":
    default:
      return tap;
  }
}

/** picker のキーを、キー全体・Tap・Hold のいずれかへ適用する。 */
/** @doc docs/specs/ui.md#keycode-picker */
export function applyPick(current: string, target: PickTarget, picked: string): string {
  if (target === "whole") return picked;

  const lexeme = classifyKeycode(current);
  if (target === "tap") {
    switch (lexeme.kind) {
      case "modified":
        return `${lexeme.modifier}(${picked})`;
      case "modTap":
        return `${lexeme.modifier}_T(${picked})`;
      case "layerSwitch":
        return lexeme.inner === undefined
          ? picked
          : composeLayerKeycode(lexeme.action, lexeme.layer, picked);
      default:
        return picked;
    }
  }

  const layer = momentaryLayer(picked);
  if (layer !== undefined) return composeLayerKeycode("layerTap", layer, tapValue(lexeme, current));
  const modifier = modifierName(picked);
  if (modifier === undefined) return current;
  return `${modifier}_T(${tapValue(lexeme, current)})`;
}

/** Hold を外した keycode。mod-tap と layer-tap は Tap だけに戻す。Hold が無ければ `undefined`。 */
/** @doc docs/specs/ui.md#side-panel-editing-controls */
export function removeHold(keycode: string): string | undefined {
  const lexeme = classifyKeycode(keycode);
  if (lexeme.kind === "modTap") return lexeme.inner;
  if (lexeme.kind === "layerSwitch" && lexeme.action === "layerTap") return lexeme.inner;
  return undefined;
}

/** 適用先に応じた現在値。Tap は内側の keycode、Hold は modifier の keycode（LT は `MO(n)`）。 */
export function targetValue(keycode: string | undefined, target: PickTarget): string | undefined {
  if (keycode === undefined) return undefined;
  if (target === "whole") return keycode;
  const values = structuredValues(keycode);
  if (target === "tap") return values.tap ?? keycode;
  return values.action === "layerTap" && values.layer !== undefined
    ? `MO(${values.layer})`
    : values.hold;
}

/** Hold に置けるのは modifier と `MO(n)`。`MO(n)` は `LTn(tap)` になる。 */
export function canPick(target: PickTarget, picked: string): boolean {
  return (
    target !== "hold" || modifierName(picked) !== undefined || momentaryLayer(picked) !== undefined
  );
}

function momentaryLayer(keycode: string): number | undefined {
  const lexeme = classifyKeycode(keycode);
  return lexeme.kind === "layerSwitch" && lexeme.action === "momentary" ? lexeme.layer : undefined;
}

export function modifierKeycode(modifier: string): string | undefined {
  return MODIFIER_KEYCODES[modifier];
}

function modifierName(keycode: string | undefined): string | undefined {
  return keycode === undefined ? undefined : MODIFIER_KEYCODES[keycode];
}

const MODIFIER_KEYCODES: Readonly<Partial<Record<string, string>>> = {
  LCTL: "KC_LCTRL",
  LSFT: "KC_LSHIFT",
  LALT: "KC_LALT",
  LGUI: "KC_LGUI",
  RCTL: "KC_RCTRL",
  RSFT: "KC_RSHIFT",
  RALT: "KC_RALT",
  RGUI: "KC_RGUI",
  KC_LCTRL: "LCTL",
  KC_LSHIFT: "LSFT",
  KC_LALT: "LALT",
  KC_LGUI: "LGUI",
  KC_RCTRL: "RCTL",
  KC_RSHIFT: "RSFT",
  KC_RALT: "RALT",
  KC_RGUI: "RGUI",
} as const;

function tapValue(lexeme: KeycodeLexeme, current: string): string {
  switch (lexeme.kind) {
    case "modified":
    case "modTap":
      return lexeme.inner;
    case "layerSwitch":
      return lexeme.inner ?? current;
    default:
      return current;
  }
}

function composeLayerKeycode(action: LayerAction, layer: number, tap: string): string {
  switch (action) {
    case "layerTap":
      return `LT${layer}(${tap})`;
    case "layerMod":
      return `LM(${layer}, ${tap})`;
    case "toggle":
      return `TG(${layer})`;
    case "to":
      return `TO(${layer})`;
    case "tapToggle":
      return `TT(${layer})`;
    case "default":
      return `DF(${layer})`;
    case "oneShot":
      return `OSL(${layer})`;
    case "momentary":
    default:
      return `MO(${layer})`;
  }
}
