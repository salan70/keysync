import { useEffect, useMemo, useRef, useState } from "react";
import { createKeycodeTable } from "../core/keycode/table.ts";
import {
  addMacLayer,
  clearMacAssignment,
  setMacAssignment,
  setMacFlowTapTerm,
  setMacTappingTerm,
} from "../core/mac-keymap/edit.ts";
import { macKeycodeSupport } from "../core/mac-keymap/generate.ts";
import {
  isMacFlowTapTerm,
  isMacTappingTerm,
  MAC_FLOW_TAP_TERM_RANGE,
  MAC_TAPPING_TERM_RANGE,
  type MacKeyboardLayout,
} from "../core/mac-keymap/types.ts";
import type { TrialRecord } from "../core/typing-trial/history.ts";
import { validateMacKeymap } from "../core/mac-keymap/validate.ts";
import { setEncoderAssignment, setKeyAssignment } from "../core/model/edit.ts";
import { buildKeymapView } from "../core/model/keymap-view.ts";
import type { Diagnostic, Severity } from "../core/validation/types.ts";
import { validateKeymap } from "../core/validation/validate.ts";
import { planWorkspaceInit, writeWorkspacePlan } from "../workspace/bootstrap.ts";
import type { WorkspaceLabels } from "../workspace/labels.ts";
import { macKeymapPath, WORKSPACE_LAYOUT } from "../workspace/layout.ts";
import { applyBlockedReason, applyRoundTripTotal } from "./apply-gate.ts";
import {
  editComboField,
  editSettingValue,
  editTapDanceField,
  type BehaviorEdit,
} from "./behavior-edit.ts";
import { boardDiagnosticMarks, boardSubjectKey, diagnosticSelection } from "./diagnostics.ts";
import { applyPick } from "./keycode-compose.ts";
import { macLayerNumbers, nextMacLayer } from "./mac-board.ts";
import { macKeycapLabel } from "./mac-keycap-labels.ts";
import { buildOverviewModel } from "./overview-model.ts";
import { chooseSaveCandidate } from "./save-state.ts";
import { useApply } from "./state/use-apply.ts";
import { useApplyGate } from "./state/use-apply-gate.ts";
import { useCursor } from "./state/use-cursor.ts";
import { useDevice, type DeviceReadContext } from "./state/use-device.ts";
import { errorMessage, useStatus } from "./state/use-status.ts";
import { useIconStyle } from "./state/use-icon-style.ts";
import { useTheme } from "./state/use-theme.ts";
import { useWorkspace } from "./state/use-workspace.ts";
import type { ThemePreference } from "./theme.ts";
import type { PanelId, Selection } from "./types.ts";
import { cornixIssue, defaultEditTarget, type UiWorkspaceStore } from "./workspace-probe.ts";
import { ApplyDialog } from "./components/ApplyDialog.tsx";
import { MacApplyDialog } from "./components/MacApplyDialog.tsx";
import { macApplyBlockedReason } from "./mac-apply-gate.ts";
import { useMacApply } from "./state/use-mac-apply.ts";
import { CornixBoard, focusBoard, MacBoard } from "./components/Board.tsx";
import { Header, type DevicePhase, type TargetLoadState } from "./components/Header.tsx";
import { Inspector, type InspectorSave } from "./components/Inspector.tsx";
import { CornixLayerBar, MacLayerBar } from "./components/LayerBar.tsx";
import { PanelDialog, type PanelSize } from "./components/PanelDialog.tsx";
import { Picker } from "./components/Picker.tsx";
import { PANELS, Rail } from "./components/Rail.tsx";
import { StatusBar } from "./components/StatusBar.tsx";
import { CornixRecovery, MacRecovery, WorkspaceGate } from "./components/Workspace.tsx";
import { BehaviorsPanel } from "./components/panels/BehaviorsPanel.tsx";
import { CornixDevicePanel, MacDevicePanel } from "./components/panels/DevicePanel.tsx";
import { FilesPanel } from "./components/panels/FilesPanel.tsx";
import { IconStyleContext } from "./components/Icon.tsx";
import { OverviewPanel } from "./components/panels/OverviewPanel.tsx";
import { TypingPanel, type TrialLog } from "./components/panels/TypingPanel.tsx";
import { keyLogPath, serializeKeyLog, TYPING_LOG_DIR } from "../core/typing-log/format.ts";
import {
  CornixReferences,
  MacReferences,
  ValidationPanel,
} from "./components/panels/ValidationPanel.tsx";

const NO_ACKNOWLEDGEMENTS: readonly string[] = [];
const NO_DIAGNOSTICS: readonly Diagnostic[] = [];
const EMPTY_SUMMARY = { error: 0, warning: 0, information: 0 } as const;
const TARGET_LABEL = { cornix: "Cornix LP", ansi: "Mac ANSI", jis: "Mac JIS" } as const;
const PANEL_TONE: Readonly<Record<PanelId, string>> = {
  overview: "tone-overview",
  behaviors: "tone-behaviors",
  validation: "tone-validation",
  device: "tone-device",
  typing: "tone-typing",
  files: "tone-files",
};

/**
 * Web UI の全体。関心ごとの状態 hook を組み合わせ、部品へ値と操作を渡すだけにする。
 *
 * 盤面・picker・編集パネルを常設し、それ以外の作業は左端の入口から画面中央のパネルで開く。
 * Apply だけは段階を終えるまで他の作業へ移れない modal として分ける。
 */
export function App({
  initialTheme,
}: {
  readonly initialTheme: ThemePreference;
}): React.JSX.Element {
  const status = useStatus("workspaceを開いている");
  const { say } = status;
  const theme = useTheme(initialTheme);
  const iconStyle = useIconStyle();
  const cursor = useCursor();
  const apply = useApply({ say, setProgress: status.setProgress });
  const macApply = useMacApply();
  const device = useDevice({ say, setProgress: status.setProgress, onStale: apply.reset });
  const ws = useWorkspace({
    say,
    onAdopt: (model, preserveTarget) => {
      if (!preserveTarget) cursor.setTarget(defaultEditTarget(model));
    },
  });
  const [panel, setPanel] = useState<PanelId | undefined>();
  const [panelSizes, setPanelSizes] = useState<Readonly<Partial<Record<PanelId, PanelSize>>>>({});
  // 打鍵テストの試行。パネルを閉じても残し、再読込で消える（ADR 0045）。
  const [trials, setTrials] = useState<readonly TrialRecord[]>([]);
  const [validationFilter, setValidationFilter] = useState<Severity | undefined>();
  const inspectorHeading = useRef<HTMLHeadingElement>(null);
  const afterPanelClose = useRef<(() => void) | undefined>(undefined);

  const { workspace, cornix } = ws;
  const isCornix = cursor.target.kind === "cornix";
  const macLayout = cursor.target.kind === "mac" ? cursor.target.layout : undefined;
  const macState =
    macLayout === undefined || workspace === undefined ? undefined : workspace.mac[macLayout];
  const macReady = macState?.kind === "ready" ? macState : undefined;
  const acknowledged = workspace?.acknowledged ?? NO_ACKNOWLEDGEMENTS;

  const view = useMemo(
    () => (cornix === undefined ? undefined : buildKeymapView(cornix.document, cornix.definition)),
    [cornix],
  );
  const table = useMemo(
    () =>
      cornix === undefined || view === undefined
        ? undefined
        : createKeycodeTable(cornix.definition, view.capacities),
    [cornix, view],
  );
  const validation = useMemo(
    () => (cornix === undefined ? undefined : validateKeymap(cornix.document, cornix.definition)),
    [cornix],
  );
  const macValidation = useMemo(
    () => (macReady === undefined ? undefined : validateMacKeymap(macReady.document)),
    [macReady],
  );
  const overview = useMemo(
    () => (cornix === undefined ? undefined : buildOverviewModel(cornix.document)),
    [cornix],
  );
  // Vial の layer 名を Mac の layer 番号空間へ誤適用しないため、layer 名だけ剥がす。
  const macLabels = useMemo<WorkspaceLabels>(
    () => ({ layers: new Map(), keycodes: workspace?.labels.keycodes ?? new Map() }),
    [workspace],
  );
  const { changed, gate } = useApplyGate({
    cornix,
    deviceRead: device.read,
    deviceDefinitionDigest: device.definitionDigest,
    acknowledged,
  });

  const diagnostics = isCornix
    ? (validation?.diagnostics ?? NO_DIAGNOSTICS)
    : (macValidation?.diagnostics ?? NO_DIAGNOSTICS);
  const summary = (isCornix ? validation?.summary : macValidation?.summary) ?? EMPTY_SUMMARY;
  const marks = useMemo(() => boardDiagnosticMarks(diagnostics), [diagnostics]);
  const diffKeys = useMemo(
    () =>
      new Set(
        changed
          .map((entry) => boardSubjectKey(entry.subject))
          .filter((key): key is string => key !== undefined),
      ),
    [changed],
  );

  useEffect(() => {
    if (panel !== undefined) return;
    const next = afterPanelClose.current;
    afterPanelClose.current = undefined;
    next?.();
  }, [panel]);

  /** パネルを閉じる。背後は開いている間 inert なので、focus の移動は閉じた描画の後で行う。 */
  function closePanel(then?: () => void): void {
    const opened = panel;
    afterPanelClose.current =
      then ??
      (() => {
        if (opened !== undefined)
          document.querySelector<HTMLElement>(`[data-panel="${opened}"]`)?.focus();
      });
    setPanel(undefined);
  }

  function openPanel(next: PanelId | undefined): void {
    if (next === undefined) {
      if (panel === undefined) focusBoard();
      else closePanel(focusBoard);
      return;
    }
    setPanel(next);
  }

  // ---------- 編集 ----------

  const selection = cursor.selection;
  const layer = cursor.layer;
  const cornixKeycode =
    view === undefined
      ? undefined
      : selection?.kind === "key"
        ? view.keys.find(
            (key) =>
              key.position.layer === layer &&
              key.position.row === selection.row &&
              key.position.col === selection.col,
          )?.keycode
        : selection?.kind === "encoder"
          ? view.encoders.find(
              (encoder) =>
                encoder.layer === layer &&
                encoder.index === selection.index &&
                encoder.direction === selection.direction,
            )?.keycode
          : undefined;
  const macKeycode =
    macReady !== undefined && selection?.kind === "macKey"
      ? macReady.document.layers.get(layer)?.get(selection.keyCode)
      : undefined;
  const currentKeycode = isCornix ? cornixKeycode : macKeycode;

  function editSelected(keycode: string): void {
    if (isCornix) {
      if (selection?.kind === "key")
        ws.updateCornix((document) =>
          setKeyAssignment(document, { layer, row: selection.row, col: selection.col }, keycode),
        );
      else if (selection?.kind === "encoder")
        ws.updateCornix((document) =>
          setEncoderAssignment(
            document,
            { layer, index: selection.index, direction: selection.direction === "ccw" ? 0 : 1 },
            keycode,
          ),
        );
      return;
    }
    if (macLayout === undefined || selection?.kind !== "macKey") return;
    ws.updateMac(macLayout, (document) =>
      setMacAssignment(document, layer, selection.keyCode, keycode),
    );
  }

  function clearSelected(): void {
    if (macLayout === undefined || selection?.kind !== "macKey") return;
    ws.updateMac(macLayout, (document) => clearMacAssignment(document, layer, selection.keyCode));
  }

  function pick(picked: string): void {
    if (selection === undefined) return;
    const current = currentKeycode ?? "KC_NO";
    const next = applyPick(current, cursor.pickTarget, picked);
    if (next === currentKeycode) return;
    editSelected(next);
  }

  function behavior(result: BehaviorEdit): string | undefined {
    if (result.kind === "ok") {
      ws.saveCornix(result.document);
      return undefined;
    }
    if (result.kind === "invalid") {
      say(result.message);
      return result.message;
    }
    return undefined;
  }

  function jumpToDiagnostic(diagnostic: Diagnostic): void {
    const next = diagnosticSelection(diagnostic.subject);
    if (next.layer !== undefined && isCornix) cursor.setLayer(next.layer);
    if (next.macLayer !== undefined && !isCornix) cursor.setLayer(next.macLayer);
    cursor.setSelection(next.selection);
    closePanel(focusBoard);
  }

  function select(next: Selection): void {
    cursor.setSelection(next);
  }

  // ---------- 実機 ----------

  function readContext(): DeviceReadContext | undefined {
    return workspace === undefined || cornix === undefined
      ? undefined
      : {
          store: workspace.store,
          definitionDigest: cornix.binding.definitionDigest,
          keyboardUid: cornix.document.uid,
        };
  }

  async function initializeWorkspace(store: UiWorkspaceStore): Promise<void> {
    try {
      const connection = device.connection ?? (await device.acquire());
      if (connection === undefined) return;
      const result = await device.fullRead(connection);
      const plan = await planWorkspaceInit(
        result.document,
        result.definitionText,
        globalThis.crypto,
      );
      await writeWorkspacePlan(store, plan);
      device.adoptRead(result, plan.definitionDigest);
      await ws.adoptStore(store, "実機のfull readからworkspaceを作成した");
    } catch (error) {
      say(errorMessage(error));
    } finally {
      status.setProgress(undefined);
    }
  }

  const blockedReason = applyBlockedReason({
    cornixReady: cornix !== undefined,
    connected: device.connection !== undefined,
    read: device.read !== undefined,
    changedCount: changed.length,
    fatalCount: gate?.fatal.length ?? 0,
  });

  function startApply(): void {
    if (blockedReason !== undefined || workspace === undefined) return;
    if (device.read === undefined || gate === undefined) return;
    void apply.begin({ store: workspace.store, deviceRead: device.read, gate });
  }

  const macBlockedReason =
    macLayout === undefined
      ? undefined
      : macApplyBlockedReason({
          machine: macApply.machine,
          layout: macLayout,
          ready: macReady !== undefined,
          save: ws.macSaves[macLayout] ?? { kind: "idle" },
          errors: macValidation?.summary.error ?? 0,
        });

  /** mod-tap の閾値を保存する。保存できなければ理由を返す（実機パネルと打鍵テストで共有）。 */
  function editTappingTerm(value: string): string | undefined {
    if (macLayout === undefined) return undefined;
    const ms = /^[0-9]+$/.test(value) ? Number(value) : Number.NaN;
    if (!isMacTappingTerm(ms)) {
      return `${MAC_TAPPING_TERM_RANGE.min}〜${MAC_TAPPING_TERM_RANGE.max}の整数が必要`;
    }
    ws.updateMac(macLayout, (document) => setMacTappingTerm(document, ms));
    return undefined;
  }

  /** Flow Tap の閾値を保存する。保存できなければ理由を返す（ADR 0047）。 */
  function editFlowTapTerm(value: string): string | undefined {
    if (macLayout === undefined) return undefined;
    const ms = /^[0-9]+$/.test(value) ? Number(value) : Number.NaN;
    if (!isMacFlowTapTerm(ms)) {
      return `${MAC_FLOW_TAP_TERM_RANGE.min}〜${MAC_FLOW_TAP_TERM_RANGE.max}の整数が必要`;
    }
    ws.updateMac(macLayout, (document) => setMacFlowTapTerm(document, ms));
    return undefined;
  }

  /** 打鍵テストの試行を `keysync/typing-logs/` へ保存する（ADR 0046）。 */
  async function saveTrialLog(layout: MacKeyboardLayout, log: TrialLog): Promise<void> {
    const startedAt = new Date();
    const path = keyLogPath(startedAt, "browser");
    const store = workspace?.store;
    if (store === undefined) return;
    const applied = macApply.effective;
    const effective = applied?.layout === layout ? applied.tappingTermMs : null;
    try {
      await store.ensureDirectory(TYPING_LOG_DIR);
      await store.writeText(
        path,
        serializeKeyLog(
          {
            type: "meta",
            recorder: "browser",
            startedAt: startedAt.toISOString(),
            layout,
            tappingTermMs: effective,
            trial: { taskId: log.taskId, prompt: log.prompt, summary: log.summary },
          },
          log.events,
        ),
      );
      status.say(`打鍵ログを ${path} へ保存した`);
    } catch (error) {
      status.say(`打鍵ログを保存できない: ${errorMessage(error)}`);
    }
  }

  function startMacApply(): void {
    if (macBlockedReason !== undefined || macLayout === undefined || macReady === undefined) return;
    void macApply.open(macLayout, macReady.document);
  }

  function writeApply(): void {
    const connection = device.connection;
    if (connection === undefined || device.read === undefined) return;
    const context = readContext();
    void apply.write({
      connection,
      deviceRead: device.read,
      gate,
      reread: async () => {
        await device.readInto(connection, context);
      },
    });
  }

  // ---------- 保存状態 ----------

  const cornixSave = chooseSaveCandidate([
    { target: "keymap", state: ws.keymapSave, path: WORKSPACE_LAYOUT.keymap },
    { target: "labels", state: ws.labelsSave, path: WORKSPACE_LAYOUT.labels },
  ]);
  const save: InspectorSave = isCornix
    ? {
        state: cornixSave.state,
        path: cornixSave.path,
        onRetry: cornixSave.target === "keymap" ? () => ws.saveCornix() : ws.retryLabels,
        onReload: () => void ws.reload(),
      }
    : {
        state: (macLayout === undefined ? undefined : ws.macSaves[macLayout]) ?? { kind: "idle" },
        path: macReady?.path ?? (macLayout === undefined ? "" : macKeymapPath(macLayout)),
        onRetry: () => {
          if (macLayout !== undefined) ws.retryMac(macLayout);
        },
        onReload: () => void ws.reload(),
      };

  // ---------- 描画 ----------

  if (workspace === undefined) {
    return (
      <div className="app is-gate">
        <Header
          workspaceRoot={undefined}
          targetKey={cursor.key}
          targetStates={undefined}
          onTarget={cursor.setTarget}
          device="disconnected"
          productName={undefined}
          theme={theme.preference}
          onTheme={theme.setPreference}
        />
        <WorkspaceGate
          connection={ws.connection}
          issue={ws.issue}
          message={status.message}
          onReload={() => void ws.reload()}
        />
      </div>
    );
  }

  const targetStates: Readonly<Record<"cornix" | "ansi" | "jis", TargetLoadState>> = {
    cornix:
      workspace.cornix.kind === "legacy-binding" || workspace.cornix.kind === "legacy-layout"
        ? "legacy"
        : workspace.cornix.kind === "ready"
          ? "ready"
          : workspace.cornix.kind,
    ansi: workspace.mac.ansi.kind,
    jis: workspace.mac.jis.kind,
  };
  const devicePhase: DevicePhase =
    device.connection === undefined
      ? "disconnected"
      : device.reading !== undefined
        ? "reading"
        : device.read !== undefined
          ? "read"
          : "connected";
  const cornixRecovery = isCornix ? cornixIssue(workspace) : undefined;
  const macRecovery =
    !isCornix && macState !== undefined && macState.kind !== "ready" ? macState : undefined;
  const busy = status.progress !== undefined;
  const unavailable =
    cornixRecovery !== undefined
      ? "keymap.yaml を読み込めていないため、Cornix LP は編集できない。"
      : macRecovery !== undefined
        ? `${macLayout === undefined ? "" : macKeymapPath(macLayout)} を読み込めていないため編集できない。`
        : undefined;
  const cornixOnly = isCornix
    ? cornix === undefined
      ? "keymap.yaml 未読込"
      : undefined
    : "Cornix のみ";
  const macOnly = isCornix
    ? "Mac のみ"
    : macReady === undefined
      ? `${macLayout === undefined ? "" : macKeymapPath(macLayout)} 未読込`
      : undefined;
  const position =
    selection === undefined
      ? undefined
      : selection.kind === "key"
        ? `layer ${layer} · row ${selection.row} · col ${selection.col}`
        : selection.kind === "encoder"
          ? `layer ${layer} · encoder ${selection.index} · ${selection.direction === "ccw" ? "左回し" : "右回し"}`
          : `layer ${layer} · ${macReady === undefined ? selection.keyCode : macKeycapLabel(selection.keyCode, macReady.document.layout)}`;
  const location =
    selection === undefined
      ? undefined
      : selection.kind === "key"
        ? `layers[${layer}] row ${selection.row} col ${selection.col}`
        : selection.kind === "encoder"
          ? `layers[${layer}] encoder ${selection.index} ${selection.direction}`
          : `layers[${layer}] "${selection.keyCode}"`;
  const jumpableLayers = new Set(
    isCornix
      ? Array.from({ length: view?.capacities.layerCount ?? 0 }, (_, index) => index)
      : macReady === undefined
        ? []
        : macLayerNumbers(macReady.document),
  );
  const panelDef = PANELS.find((item) => item.id === panel);

  const desk = (
    <div className="app">
      <a className="skip-link" href="#main">
        盤面へ移動
      </a>
      <Header
        workspaceRoot={workspace.store.root}
        targetKey={cursor.key}
        targetStates={targetStates}
        onTarget={cursor.setTarget}
        device={devicePhase}
        productName={device.connection?.info.productName}
        theme={theme.preference}
        onTheme={theme.setPreference}
      />
      <Rail
        panel={panel}
        onPanel={openPanel}
        unavailable={{ overview: cornixOnly, behaviors: cornixOnly, typing: macOnly }}
        counts={{
          validation: summary.error + summary.warning,
          device: isCornix && device.read !== undefined ? changed.length : undefined,
        }}
      />
      <main className="desk" id="main">
        <div className="center">
          {cornixRecovery !== undefined ? (
            <CornixRecovery
              issue={cornixRecovery}
              busy={busy}
              onInitialize={() => void initializeWorkspace(cornixRecovery.store)}
              onMigrate={() => {
                if (cornixRecovery.kind === "legacy-binding")
                  void ws.migrateBinding(cornixRecovery);
                if (cornixRecovery.kind === "legacy-layout") void ws.migrateLayout(cornixRecovery);
              }}
              onReload={() => void ws.reload()}
            />
          ) : macRecovery !== undefined && macLayout !== undefined ? (
            <MacRecovery
              layout={macLayout}
              state={macRecovery}
              busy={busy}
              onCreate={() => void ws.createMacKeymap(macLayout)}
              onReload={() => void ws.reload()}
            />
          ) : isCornix && cornix !== undefined && view !== undefined && table !== undefined ? (
            <>
              <CornixLayerBar
                layerCount={view.capacities.layerCount}
                hiddenLayers={overview?.hiddenLayers ?? []}
                layer={layer}
                labels={workspace.labels}
                onLayer={cursor.setLayer}
              />
              <section className="stage" aria-label="盤面">
                <CornixBoard
                  view={view}
                  table={table}
                  layer={layer}
                  labels={workspace.labels}
                  selection={selection}
                  onSelect={select}
                  onEnter={() => inspectorHeading.current?.focus()}
                  diffKeys={diffKeys}
                  diagnosticMarks={marks}
                />
              </section>
              <section className="picker-wrap" aria-label="keycode picker">
                <Picker
                  table={table}
                  labels={workspace.labels}
                  pickTarget={cursor.pickTarget}
                  selectedKeycode={cornixKeycode}
                  layers={[...jumpableLayers]}
                  disabled={selection === undefined}
                  onPick={pick}
                />
              </section>
            </>
          ) : macReady !== undefined && macLayout !== undefined ? (
            <>
              <MacLayerBar
                layers={macLayerNumbers(macReady.document)}
                layer={layer}
                nextLayer={nextMacLayer(macReady.document)}
                onLayer={cursor.setLayer}
                onAddLayer={(next) => {
                  ws.updateMac(macLayout, (document) => addMacLayer(document, next));
                  cursor.setLayer(next);
                }}
              />
              <section className="stage" aria-label="盤面">
                <MacBoard
                  document={macReady.document}
                  layer={layer}
                  labels={macLabels}
                  selection={selection}
                  onSelect={select}
                  onEnter={() => inspectorHeading.current?.focus()}
                  diagnosticMarks={marks}
                />
              </section>
              <section className="picker-wrap" aria-label="keycode picker">
                <Picker
                  table={undefined}
                  labels={macLabels}
                  pickTarget={cursor.pickTarget}
                  selectedKeycode={macKeycode}
                  layers={[...jumpableLayers]}
                  disabled={selection === undefined}
                  isKeycodeEnabled={(keycode) => macKeycodeSupport(keycode).ok}
                  disabledReason="Karabiner で表現できない"
                  onPick={pick}
                />
              </section>
            </>
          ) : null}
        </div>
        <Inspector
          headingRef={inspectorHeading}
          mode={isCornix ? "cornix" : "mac"}
          position={position}
          keycode={currentKeycode}
          table={isCornix ? table : undefined}
          labels={isCornix ? workspace.labels : macLabels}
          pickTarget={cursor.pickTarget}
          onPickTarget={cursor.setPickTarget}
          onEdit={editSelected}
          onClear={clearSelected}
          onLabel={ws.editLabel}
          onJumpLayer={cursor.setLayer}
          jumpableLayers={jumpableLayers}
          location={location}
          save={save}
          onBackToBoard={focusBoard}
          unavailable={unavailable}
        />
        {panel === undefined || panelDef === undefined ? null : (
          <PanelDialog
            key={panel}
            id={panel}
            tone={PANEL_TONE[panel]}
            title={panelDef.label}
            subtitle={TARGET_LABEL[cursor.key]}
            size={panelSizes[panel] ?? (panel === "typing" ? "full" : "window")}
            onSize={(size) => setPanelSizes((current) => ({ ...current, [panel]: size }))}
            onClose={() => closePanel()}
          >
            {panel === "overview" ? (
              cornix !== undefined && view !== undefined ? (
                <OverviewPanel
                  document={cornix.document}
                  definition={cornix.definition}
                  view={view}
                  labels={workspace.labels}
                  currentLayer={layer}
                  onRenameLayer={ws.editLayerLabel}
                  onOpenLayer={(next) => {
                    cursor.setLayer(next);
                    closePanel(focusBoard);
                  }}
                  onExportSvg={() => void ws.exportSvg(layer)}
                  onExportPdf={() => void ws.exportPdf(layer)}
                />
              ) : (
                <p>keymap.yaml を読み込めていないため表示できない。</p>
              )
            ) : null}
            {panel === "behaviors" ? (
              cornix !== undefined ? (
                <BehaviorsPanel
                  document={cornix.document}
                  labels={workspace.labels}
                  onTapDance={(index, field, value) =>
                    behavior(editTapDanceField(cornix.document, index, field, value))
                  }
                  onCombo={(index, field, value) =>
                    behavior(editComboField(cornix.document, index, field, value))
                  }
                  onSetting={(qsid, value) =>
                    behavior(editSettingValue(cornix.document, qsid, value))
                  }
                />
              ) : (
                <p>keymap.yaml を読み込めていないため表示できない。</p>
              )
            ) : null}
            {panel === "validation" ? (
              <ValidationPanel
                diagnostics={diagnostics}
                filter={validationFilter}
                onFilter={setValidationFilter}
                onJump={jumpToDiagnostic}
                references={
                  isCornix ? (
                    cornix === undefined ? (
                      <p>keymap.yaml を読み込めていないため、参照は出せない。</p>
                    ) : (
                      <CornixReferences document={cornix.document} labels={workspace.labels} />
                    )
                  ) : macLayout !== undefined && macState !== undefined ? (
                    <MacReferences layout={macLayout} mac={macState} diagnostics={diagnostics} />
                  ) : null
                }
              />
            ) : null}
            {panel === "device" ? (
              isCornix ? (
                <CornixDevicePanel
                  connected={device.connection !== undefined}
                  productName={device.connection?.info.productName}
                  reading={device.reading}
                  readAt={device.readAt}
                  roundTrips={device.lastReadRoundTrips}
                  identity={
                    device.read === undefined
                      ? undefined
                      : {
                          deviceUid: device.read.keyboardUid,
                          workspaceUid: cornix?.document.uid,
                          deviceDigest: device.definitionDigest,
                          workspaceDigest: cornix?.binding.definitionDigest,
                        }
                  }
                  changed={changed}
                  fatal={gate?.fatal ?? NO_DIAGNOSTICS}
                  applyBlockedReason={blockedReason}
                  cornixReady={cornix !== undefined}
                  onConnect={() => void device.connect()}
                  onDisconnect={() => void device.disconnect()}
                  onRead={() => void device.readDevice(readContext())}
                  onApply={() => closePanel(startApply)}
                  onRestore={() => void ws.restoreBackup()}
                />
              ) : macLayout !== undefined && macState !== undefined ? (
                <MacDevicePanel
                  layout={macLayout}
                  mac={macState}
                  applyBlockedReason={macBlockedReason}
                  onApply={() => closePanel(startMacApply)}
                  onTappingTerm={editTappingTerm}
                  onFlowTapTerm={editFlowTapTerm}
                  onExportKarabiner={() => void ws.exportKarabiner(macLayout)}
                />
              ) : null
            ) : null}
            {panel === "typing" ? (
              macLayout !== undefined && macReady !== undefined ? (
                <TypingPanel
                  document={macReady.document}
                  effectiveTappingTermMs={
                    macApply.effective?.layout === macLayout
                      ? macApply.effective.tappingTermMs
                      : undefined
                  }
                  applyBlockedReason={macBlockedReason}
                  records={trials}
                  onTappingTerm={editTappingTerm}
                  onApply={startMacApply}
                  onRecord={(record) => setTrials((current) => [...current, record])}
                  onSaveLog={(log) => void saveTrialLog(macLayout, log)}
                  onClearRecords={() => setTrials([])}
                />
              ) : (
                <p>Mac の設定を読み込めていないため使えない。</p>
              )
            ) : null}
            {panel === "files" ? (
              <FilesPanel
                cornixReady={cornix !== undefined}
                canReload
                onImportVil={() => void ws.importVil()}
                onExportVil={() => void ws.exportVil()}
                onReload={() => void ws.reload()}
                iconStyle={iconStyle.style}
                onIconStyle={iconStyle.setStyle}
              />
            ) : null}
          </PanelDialog>
        )}
      </main>
      <StatusBar
        summary={summary}
        onSeverity={(severity) => {
          setValidationFilter(severity);
          openPanel("validation");
        }}
        save={isCornix ? cornixSave.state : save.state}
        savePath={isCornix ? cornixSave.path : save.path}
        message={status.message}
        progress={status.progress}
        mode={
          isCornix
            ? {
                kind: "cornix",
                read: device.read !== undefined,
                changedCount: changed.length,
                applyBlockedReason: blockedReason,
                onApply: startApply,
              }
            : {
                kind: "mac",
                applyBlockedReason: macBlockedReason,
                onApply: startMacApply,
              }
        }
      />
      {macApply.view.phase !== "closed" && macLayout !== undefined ? (
        <MacApplyDialog
          view={macApply.view}
          layout={macLayout}
          document={macReady?.document}
          onApply={() => void macApply.apply()}
          onRetrySelect={() => void macApply.retrySelect()}
          onReload={() => {
            macApply.close();
            void ws.reload();
          }}
          onClose={macApply.close}
        />
      ) : null}
      {apply.open ? (
        <ApplyDialog
          step={apply.step}
          backupError={apply.backupError}
          state={apply.state}
          changed={changed}
          gate={gate}
          labels={workspace.labels}
          acknowledged={acknowledged}
          backupRoundTrips={device.lastReadRoundTrips}
          roundTrips={apply.roundTrips}
          roundTripTotal={applyRoundTripTotal(apply.state)}
          onNext={apply.next}
          onAcknowledge={(ids) =>
            void apply.acknowledge({
              ids,
              persist: ws.acknowledge,
              gate,
              deviceRead: device.read,
            })
          }
          onCancel={apply.cancel}
          onWrite={writeApply}
        />
      ) : null}
    </div>
  );
  return <IconStyleContext.Provider value={iconStyle.style}>{desk}</IconStyleContext.Provider>;
}
