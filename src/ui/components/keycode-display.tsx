import type { JSX } from "react";
import { keycodeClass, type KeycodeDisplay } from "../keycode-labels.ts";
import { FitText } from "./FitText.tsx";

export {
  basicLabel,
  describeDisplayKeycode,
  keycodeClass,
  keycodeDisplay,
  layerActionLabel,
  modifierSymbol,
  shortLabel,
} from "../keycode-labels.ts";
export type { DisplayOptions, KeycodeDisplay } from "../keycode-labels.ts";

/** keycode の種類の class。割り当てが無い Mac のキー（素通し）は `kind-passthrough`。 */
export function kindClass(keycode: string | undefined): string {
  return keycode === undefined ? "kind-passthrough" : `kind-${keycodeClass(keycode)}`;
}

export function renderKeycode(display: KeycodeDisplay, prefix = ""): JSX.Element {
  return (
    <>
      <FitText className="keycap-main">
        {prefix}
        {display.primary}
      </FitText>
      {display.role === undefined ? null : (
        <FitText as="small" className="keycap-sub">
          {display.role}
        </FitText>
      )}
    </>
  );
}

/** keycap の title。表示と raw 式を併記する。 */
export function keycapTitle(display: KeycodeDisplay, keycode: string): string {
  const head =
    display.role === undefined ? display.primary : `${display.primary} / ${display.role}`;
  return `${head.replace(/\n/g, " ")}  (${keycode})`;
}
