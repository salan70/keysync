/**
 * 撮影専用の harness（使い捨て）。fixture だけを描画し、API にも WebHID にも繋がない。
 *
 * `?shot=cornix-board|mac-board|apply-confirm` で画面を選ぶ。
 * `?inject=<css>` は意図的な見た目の変更を差し込む（検出力の確認用）。
 * 描画の完了は `document.documentElement.dataset.rendered` で知らせる。フォントと FitText の
 * 待ちは撮影側（measure.mjs）が決める。
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { parseDefinition } from "../../../src/core/definition/parse.ts";
import { diffDocuments } from "../../../src/core/diff/diff.ts";
import { createKeycodeTable } from "../../../src/core/keycode/table.ts";
import { parseMacKeymapYaml } from "../../../src/core/mac-keymap/parse.ts";
import { setKeyAssignment } from "../../../src/core/model/edit.ts";
import { buildKeymapView } from "../../../src/core/model/keymap-view.ts";
import { createDiagnostic } from "../../../src/core/validation/types.ts";
import {
  evaluateApplyGate,
  type ApplyGateWithEvidence,
} from "../../../src/core/validation/gate.ts";
import { parseVil } from "../../../src/core/vil/parse.ts";
import { CornixBoard, MacBoard } from "../../../src/ui/components/Board.tsx";
import { ApplyDialog } from "../../../src/ui/components/ApplyDialog.tsx";
import { buildApplyGate } from "../../../src/ui/apply-gate.ts";
import { EMPTY_LABELS } from "../../../src/workspace/labels.ts";
import "../../../src/ui/styles/index.css";
import definitionText from "../../../fixtures/cornix-lp/vial-definition-v1.12.json?raw";
import baselineText from "../../../fixtures/cornix-lp/baseline.vil?raw";
import macText from "../../../fixtures/mac-keyboard/desired.yaml?raw";

const params = new URLSearchParams(location.search);
const shot = params.get("shot") ?? "cornix-board";
const inject = params.get("inject");
if (inject !== null) {
  const style = document.createElement("style");
  style.textContent = inject;
  document.head.append(style);
}
if (shot === "apply-confirm" && params.get("pin") !== "0") {
  // 中央寄せの dialog は縦位置が小数になり、CPU 負荷が高いと文字の rasterize が 2 通りに割れる
  // （docs/tasks/ai-logs/2026-11-22_visual-regression-spike.md）。位置を整数 px に固定して避ける。
  const pin = document.createElement("style");
  pin.textContent = ".apply{position:fixed;top:100px;margin:0 auto}";
  document.head.append(pin);
}
document.documentElement.dataset.theme = params.get("theme") ?? "light";

const definition = parseDefinition(definitionText);
const baseline = parseVil(baselineText);
const view = buildKeymapView(baseline, definition);
const table = createKeycodeTable(definition, view.capacities);
const desired = setKeyAssignment(baseline, { layer: 0, row: 0, col: 0 }, "KC_B");
const changed = diffDocuments(baseline, desired, definition).entries;
const built = buildApplyGate({
  document: desired,
  definition,
  binding: { definitionPath: "keysync/definitions/abc.json", definitionDigest: "abc" },
  device: {
    document: baseline,
    keyboardUid: baseline.uid,
    capacities: view.capacities,
    supportedQsids: Object.keys(baseline.settings).map(Number),
  },
  deviceDefinitionDigest: "abc",
  changed,
  acknowledged: [],
});
if (built === undefined) throw new Error("gate を作れない");
const warning = createDiagnostic(
  "layout/unreachable-layer",
  "warning",
  { kind: "layer", layer: 4 },
  "layer 4 へ移る手段が無い",
  { layer: 4 },
);
const gate: ApplyGateWithEvidence = evaluateApplyGate(
  { ...built.evidence, diagnostics: [warning] },
  [],
);
const noop = (): void => {};

function Shot(): React.JSX.Element {
  if (shot === "mac-board") {
    return (
      <section className="stage" style={{ width: 1000, height: 440 }} aria-label="盤面">
        <MacBoard
          document={parseMacKeymapYaml(macText)}
          layer={1}
          labels={EMPTY_LABELS}
          selection={{ kind: "macKey", keyCode: "h" }}
          onSelect={noop}
          onEnter={noop}
          diagnosticMarks={new Map()}
        />
      </section>
    );
  }
  if (shot === "apply-confirm") {
    return (
      <ApplyDialog
        step="confirm"
        backupError={undefined}
        state={undefined}
        changed={changed}
        gate={gate}
        labels={EMPTY_LABELS}
        acknowledged={[]}
        backupRoundTrips={12}
        roundTrips={0}
        roundTripTotal={0}
        onNext={noop}
        onAcknowledge={noop}
        onCancel={noop}
        onWrite={noop}
      />
    );
  }
  return (
    <section className="stage" style={{ width: 1000, height: 440 }} aria-label="盤面">
      <CornixBoard
        view={view}
        table={table}
        layer={0}
        labels={{ layers: new Map([[0, "基本"]]), keycodes: new Map() }}
        selection={{ kind: "key", row: 0, col: 0 }}
        onSelect={noop}
        onEnter={noop}
        diffKeys={new Set(["key:0:0:1"])}
        diagnosticMarks={new Map<string, "error" | "warning">([["key:0:0:2", "warning"]])}
      />
    </section>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Shot />
  </StrictMode>,
);
requestAnimationFrame(() =>
  requestAnimationFrame(() => (document.documentElement.dataset.rendered = "1")),
);
