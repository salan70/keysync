/**
 * UI の構造の回帰を `renderToStaticMarkup` の結果で守る（Issue #29 の第 0 段）。
 *
 * 比べるのは**構造**（要素、class、属性、文言）だけで、見た目は比べない。SSR は effect を実行せず、
 * 盤面の倍率（`useStageScale`）も `FitText` の収まりも DOM の実測に依るため、寸法と文字の縮小は
 * ここに現れない。見た目の回帰は Playwright の撮影で守る（spikes/i-027-visual-regression/README.md）。
 *
 * 期待値は `__snapshots__/*.html` に置く。意図した変更は次で更新し、差分をレビューしてから commit する。
 *
 *     just test-update-snapshots
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { createElement, type ReactElement } from "react";
import { createApplyPlan, createValidatedApplyInput } from "../../core/apply/plan.ts";
import { parseDefinition } from "../../core/definition/parse.ts";
import { diffDocuments } from "../../core/diff/diff.ts";
import { createKeycodeTable } from "../../core/keycode/table.ts";
import { parseMacKeymapYaml } from "../../core/mac-keymap/parse.ts";
import { setEncoderAssignment, setKeyAssignment } from "../../core/model/edit.ts";
import { buildKeymapView } from "../../core/model/keymap-view.ts";
import { evaluateApplyGate, type ApplyGateWithEvidence } from "../../core/validation/gate.ts";
import { createDiagnostic } from "../../core/validation/types.ts";
import { parseVil } from "../../core/vil/parse.ts";
import { EMPTY_LABELS, type WorkspaceLabels } from "../../workspace/labels.ts";
import { buildApplyGate } from "../apply-gate.ts";
import { buildApplyDialogView, type ApplyDialogInput } from "../apply-dialog-view.ts";
import { createComponentLoader, markup } from "../testing/ssr.ts";

const ROOT = join(import.meta.dirname, "../../..");
const SNAPSHOTS = join(import.meta.dirname, "__snapshots__");

const definition = parseDefinition(
  readFileSync(join(ROOT, "fixtures/cornix-lp/vial-definition-v1.12.json"), "utf8"),
);
const baseline = parseVil(readFileSync(join(ROOT, "fixtures/cornix-lp/baseline.vil"), "utf8"));
const macDocument = parseMacKeymapYaml(
  readFileSync(join(ROOT, "fixtures/mac-keyboard/desired.yaml"), "utf8"),
);

const view = buildKeymapView(baseline, definition);
const table = createKeycodeTable(definition, view.capacities);
const labels: WorkspaceLabels = {
  layers: new Map([[0, "基本"]]),
  keycodes: new Map([["KC_A", "あ"]]),
};

// baseline から 3 件を変えた desired。Apply の差分表と盤面の差分印の元にする。
const desired = setEncoderAssignment(
  setKeyAssignment(
    setKeyAssignment(baseline, { layer: 0, row: 0, col: 0 }, "KC_B"),
    { layer: 0, row: 0, col: 1 },
    "KC_TRNS",
  ),
  { layer: 0, index: 0, direction: 1 },
  "KC_MUTE",
);
const changed = diffDocuments(baseline, desired, definition).entries;

const device = {
  document: baseline,
  keyboardUid: baseline.uid,
  capacities: view.capacities,
  supportedQsids: Object.keys(baseline.settings).map(Number),
};
const binding = { definitionPath: "keysync/definitions/abc.json", definitionDigest: "abc" };
const builtGate = buildApplyGate({
  document: desired,
  definition,
  binding,
  device,
  deviceDefinitionDigest: "abc",
  changed,
  acknowledged: [],
});
if (builtGate === undefined) throw new Error("fixture の差分から Apply gate を作れない");
const gate: ApplyGateWithEvidence = builtGate;

const warning = createDiagnostic(
  "layout/unreachable-layer",
  "warning",
  { kind: "layer", layer: 4 },
  "layer 4 へ移る手段が無い",
  { layer: 4 },
);
const fatal = createDiagnostic(
  "compatibility/definition-mismatch",
  "error",
  { kind: "document" },
  "実機 definition が workspace の binding と異なる",
  { workspace: "abc", device: "def" },
);
function withDiagnostics(
  diagnostics: readonly ReturnType<typeof createDiagnostic>[],
  acknowledgedIds: readonly string[] = [],
): ApplyGateWithEvidence {
  return evaluateApplyGate({ ...gate.evidence, diagnostics }, acknowledgedIds);
}

const acknowledgedGate = withDiagnostics([warning], [warning.id]);
// 警告の承認で gate が開いたときと同じ経路（use-apply.ts の confirmation）で plan を作る。
const confirmPlan = createApplyPlan(
  createValidatedApplyInput(acknowledgedGate, {
    keyboardUid: acknowledgedGate.evidence.context.keyboardUid,
    values: new Map([...acknowledgedGate.evidence.desired.keys()].map((key) => [key, [0]])),
    readAt: 0,
  }),
);

const noop = (): void => {};

const loader = await createComponentLoader();
const c = {
  Board: await loader.load<typeof import("./Board.tsx")>("/src/ui/components/Board.tsx"),
  ApplyDialog: await loader.load<typeof import("./ApplyDialog.tsx")>(
    "/src/ui/components/ApplyDialog.tsx",
  ),
  Button: await loader.load<typeof import("./Button.tsx")>("/src/ui/components/Button.tsx"),
  Icon: await loader.load<typeof import("./Icon.tsx")>("/src/ui/components/Icon.tsx"),
  LayerBar: await loader.load<typeof import("./LayerBar.tsx")>("/src/ui/components/LayerBar.tsx"),
  Logo: await loader.load<typeof import("./Logo.tsx")>("/src/ui/components/Logo.tsx"),
  Rail: await loader.load<typeof import("./Rail.tsx")>("/src/ui/components/Rail.tsx"),
  StatusBar: await loader.load<typeof import("./StatusBar.tsx")>(
    "/src/ui/components/StatusBar.tsx",
  ),
};
after(() => loader.close());

/** 名前の `.html` を期待値の置き場へ解決し、markup と比べる。 */
function snapshot(
  name: string,
  render: () => ReactElement,
): [string, (t: import("node:test").TestContext) => Promise<void>] {
  return [
    name,
    async (t) => {
      t.assert.fileSnapshot(markup(render()), join(SNAPSHOTS, `${name}.html`), {
        serializers: [(value: string) => value],
      });
    },
  ];
}

const apply = (props: Partial<ApplyDialogInput>): ReactElement =>
  createElement(c.ApplyDialog.ApplyDialog, {
    view: buildApplyDialogView({
      step: "diff",
      backupError: undefined,
      state: undefined,
      changed,
      gate,
      labels,
      acknowledged: [],
      backupRoundTrips: 12,
      roundTrips: 0,
      roundTripTotal: 0,
      ...props,
    }),
    onNext: noop,
    onAcknowledge: noop,
    onCancel: noop,
    onWrite: noop,
  });

test(
  ...snapshot("cornix-board", () =>
    createElement(c.Board.CornixBoard, {
      view,
      table,
      layer: 0,
      labels,
      selection: { kind: "key", row: 0, col: 0 },
      onSelect: noop,
      onEnter: noop,
      diffKeys: new Set(["key:0:0:1", "encoder:0:0:cw"]),
      diagnosticMarks: new Map<string, "error" | "warning">([
        ["key:0:0:2", "warning"],
        ["key:0:0:3", "error"],
      ]),
    }),
  ),
);

test(
  ...snapshot("mac-board-layer-1", () =>
    createElement(c.Board.MacBoard, {
      document: macDocument,
      layer: 1,
      labels: EMPTY_LABELS,
      selection: { kind: "macKey", keyCode: "h" },
      onSelect: noop,
      onEnter: noop,
      diagnosticMarks: new Map(),
    }),
  ),
);

test(...snapshot("apply-diff", () => apply({ step: "diff" })));

test(
  ...snapshot("apply-confirm-warning", () =>
    apply({ step: "confirm", gate: withDiagnostics([warning]) }),
  ),
);

test(
  ...snapshot("apply-confirm-acknowledged", () =>
    apply({
      step: "confirm",
      gate: acknowledgedGate,
      acknowledged: [warning.id],
      state: { phase: "awaitingConfirmation", plan: confirmPlan },
    }),
  ),
);

test(
  ...snapshot("apply-confirm-fatal", () =>
    apply({ step: "confirm", gate: withDiagnostics([warning, fatal]) }),
  ),
);

test(
  ...snapshot("apply-completed", () =>
    apply({
      step: "confirm",
      state: {
        phase: "completed",
        verified: [
          {
            target: { kind: "key", layer: 0, row: 0, col: 0 },
            command: "key",
            before: [4],
            after: [5],
          },
        ],
      },
    }),
  ),
);

test(
  ...snapshot("apply-aborted", () =>
    apply({
      step: "confirm",
      state: { phase: "aborted", reason: "verify-mismatch", verified: 2 },
    }),
  ),
);

test(
  ...snapshot("layer-bar", () =>
    createElement(c.LayerBar.CornixLayerBar, {
      layerCount: view.capacities.layerCount,
      hiddenLayers: [5, 6, 7],
      layer: 1,
      labels,
      onLayer: noop,
    }),
  ),
);

test(
  ...snapshot("rail", () =>
    createElement(c.Rail.Rail, {
      panel: "validation",
      onPanel: noop,
      unavailable: { device: "実機に接続していない" },
      counts: { validation: 3 },
    }),
  ),
);

test(
  ...snapshot("status-bar", () =>
    createElement(c.StatusBar.StatusBar, {
      summary: { error: 1, warning: 2, information: 0 },
      onSeverity: noop,
      save: { kind: "saved" },
      savePath: "keysync/keymap.yaml",
      message: "実機を読み込んだ",
      progress: undefined,
      mode: {
        kind: "cornix",
        read: true,
        changedCount: changed.length,
        applyBlockedReason: undefined,
        onApply: noop,
      },
    }),
  ),
);

test(
  ...snapshot("buttons", () =>
    createElement(
      "div",
      null,
      (["primary", "secondary", "quiet", "danger"] as const).flatMap((appearance) =>
        (["small", "medium", "large"] as const).map((size) =>
          createElement(
            c.Button.Button,
            { key: `${appearance}-${size}`, appearance, size },
            `${appearance} ${size}`,
          ),
        ),
      ),
    ),
  ),
);

test(
  ...snapshot("logo-and-icons", () =>
    createElement(
      "div",
      null,
      createElement(c.Logo.Logo, { size: "lg" }),
      createElement(c.Icon.Icon, { name: "check" }),
      createElement(c.Icon.Icon, { name: "error", size: "md" }),
    ),
  ),
);
