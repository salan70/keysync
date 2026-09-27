import { useEffect, useRef, useState } from "react";
import { serializeKeymapYaml } from "../../core/keymap-yaml/serialize.ts";
import { serializeMacKeymapYaml } from "../../core/mac-keymap/serialize.ts";
import type { MacKeyboardLayout, MacKeymapDocument } from "../../core/mac-keymap/types.ts";
import { parseVil } from "../../core/vil/parse.ts";
import type { VilDocument } from "../../core/vil/types.ts";
import { serializeAcknowledgements } from "../../workspace/acknowledgements.ts";
import { writeLayoutMigration, writeWorkspacePlan } from "../../workspace/bootstrap.ts";
import {
  serializeLabelsYaml,
  updateLayerLabel,
  type WorkspaceLabels,
} from "../../workspace/labels.ts";
import { generatedPath, macKeymapPath, WORKSPACE_LAYOUT } from "../../workspace/layout.ts";
import { createSaveQueue, type SaveQueue } from "../../workspace/save-queue.ts";
import {
  generateBrowserKanataFromDocument,
  parseBrowserVil,
  renderBrowserPdf,
  renderBrowserSvg,
  serializeBrowserVil,
} from "../browser-export.ts";
import { pickVilText } from "../browser-files.ts";
import { initialMacKeymapYaml } from "../mac-workspace.ts";
import { saveFailureState, type SaveState } from "../save-state.ts";
import { openServerWorkspace } from "../server-workspace.ts";
import {
  probeStore,
  type UiWorkspaceStore,
  type WorkspaceIssue,
  type WorkspaceModel,
} from "../workspace-probe.ts";
import { errorMessage } from "./use-status.ts";

type CornixReady = Extract<WorkspaceModel["cornix"], { kind: "ready" }>;

/** サーバーの workspace を開くまでの状態。開けた後は `workspace` か `issue` が持つ。 */
export type WorkspaceConnection =
  | { readonly kind: "opening" }
  | { readonly kind: "opened" }
  | { readonly kind: "unreachable" }
  | { readonly kind: "failed"; readonly message: string };

export interface WorkspaceOptions {
  readonly say: (message: string) => void;
  /** workspace を採用した直後に呼ぶ。`preserveTarget` が false なら既定の編集対象へ移す。 */
  readonly onAdopt: (model: WorkspaceModel, preserveTarget: boolean) => void;
}

/**
 * workspace と、その中の目標状態（Cornix、Mac の配列ごと、表示名、acknowledge）とファイル単位の保存キュー。
 *
 * 保存キューは workspace を採用するたびに作り直し、世代番号で古いキューの通知を捨てる。
 * ファイルの読み書き（再読込、VIL、書出、backup 復元）もここに置く。実機には触れない。
 *
 * @doc docs/specs/ui.md#状態の持ち方
 */
export function useWorkspace({ say, onAdopt }: WorkspaceOptions) {
  const [workspace, setWorkspace] = useState<WorkspaceModel | undefined>();
  const [issue, setIssue] = useState<WorkspaceIssue | undefined>();
  const [connection, setConnection] = useState<WorkspaceConnection>({ kind: "opening" });
  const [keymapSave, setKeymapSave] = useState<SaveState>({ kind: "idle" });
  const [labelsSave, setLabelsSave] = useState<SaveState>({ kind: "idle" });
  const [macSaves, setMacSaves] = useState<Partial<Record<MacKeyboardLayout, SaveState>>>({});
  const generation = useRef(0);
  const keymapQueue = useRef<SaveQueue | undefined>(undefined);
  const labelsQueue = useRef<SaveQueue | undefined>(undefined);
  const macQueues = useRef<Partial<Record<MacKeyboardLayout, SaveQueue>>>({});
  const onAdoptRef = useRef(onAdopt);
  onAdoptRef.current = onAdopt;

  const cornix: CornixReady | undefined =
    workspace?.cornix.kind === "ready" ? workspace.cornix : undefined;

  function adoptWorkspace(model: WorkspaceModel, preserveTarget: boolean): void {
    const current = ++generation.current;
    const stale = (): boolean => generation.current !== current;
    keymapQueue.current =
      model.cornix.kind === "ready"
        ? createSaveQueue({
            store: model.store,
            path: WORKSPACE_LAYOUT.keymap,
            token: model.cornix.token,
            onSaved: () => {
              if (stale()) return;
              setKeymapSave({ kind: "saved" });
              say("keymap.yamlへ保存した");
            },
            onError: (error) => {
              if (stale()) return;
              setKeymapSave(saveFailureState(error));
              say(errorMessage(error));
            },
          })
        : undefined;
    labelsQueue.current = createSaveQueue({
      store: model.store,
      path: WORKSPACE_LAYOUT.labels,
      token: model.labelsToken,
      onSaved: () => {
        if (stale()) return;
        setLabelsSave({ kind: "saved" });
        say(`${WORKSPACE_LAYOUT.labels}へ保存した`);
      },
      onError: (error) => {
        if (stale()) return;
        setLabelsSave(saveFailureState(error));
        say(errorMessage(error));
      },
    });
    setKeymapSave({ kind: "idle" });
    setLabelsSave({ kind: "idle" });
    setMacSaves({});
    macQueues.current = {};
    for (const layout of ["ansi", "jis"] as const) {
      const state = model.mac[layout];
      if (state.kind !== "ready") continue;
      macQueues.current[layout] = createSaveQueue({
        store: model.store,
        path: state.path,
        token: state.token,
        onSaved: () => {
          if (stale()) return;
          setMacSaves((saves) => ({ ...saves, [layout]: { kind: "saved" } }));
          say(`${state.path}へ保存した`);
        },
        onError: (error) => {
          if (stale()) return;
          setMacSaves((saves) => ({ ...saves, [layout]: saveFailureState(error) }));
          say(errorMessage(error));
        },
      });
    }
    setWorkspace(model);
    onAdoptRef.current(model, preserveTarget);
  }

  async function adoptStore(
    store: UiWorkspaceStore,
    okStatus: string,
    preserveTarget = false,
  ): Promise<void> {
    const probe = await probeStore(store);
    if (probe.kind === "ready") {
      setIssue(undefined);
      adoptWorkspace(probe.model, preserveTarget);
      say(okStatus);
      return;
    }
    generation.current++;
    setWorkspace(undefined);
    keymapQueue.current = undefined;
    labelsQueue.current = undefined;
    macQueues.current = {};
    setIssue({ ...probe, store });
    say("workspaceを読み込めなかった");
  }

  /** サーバーの workspace を開く。directory は選ばない（ADR 0038）。 */
  async function connect(): Promise<void> {
    setConnection({ kind: "opening" });
    try {
      const opened = await openServerWorkspace();
      // 理由は入口のカードが出す。通知へは重ねない。
      if (opened.kind !== "opened") {
        setConnection(opened);
        return;
      }
      setConnection({ kind: "opened" });
      await adoptStore(opened.store, "workspaceを開いた");
    } catch (error) {
      setConnection({ kind: "failed", message: errorMessage(error) });
    }
  }

  useEffect(() => {
    void connect();
    // 起動時に一度だけ開く。
  }, []);

  async function reload(): Promise<void> {
    const store = workspace?.store ?? issue?.store;
    if (store === undefined) {
      await connect();
      return;
    }
    try {
      await adoptStore(store, "workspaceを再読み込みした", true);
    } catch (error) {
      say(errorMessage(error));
    }
  }

  async function migrateBinding(
    target: Extract<WorkspaceIssue, { kind: "legacy-binding" }>,
  ): Promise<void> {
    try {
      await writeWorkspacePlan(target.store, target.migration);
      await adoptStore(target.store, "definition bindingを新しいdigest規則へ移行した");
    } catch (error) {
      say(errorMessage(error));
    }
  }

  async function migrateLayout(
    target: Extract<WorkspaceIssue, { kind: "legacy-layout" }>,
  ): Promise<void> {
    try {
      await writeLayoutMigration(target.store, target.migration);
      await adoptStore(target.store, "cornix/をkeysync/へ移行した。cornix/は残してある");
    } catch (error) {
      say(errorMessage(error));
    }
  }

  /** Cornix の目標状態を置き換え、`keymap.yaml` の保存キューへ積む。 */
  function saveCornix(document: VilDocument | undefined = cornix?.document): void {
    if (workspace === undefined || cornix === undefined || document === undefined) return;
    setWorkspace({ ...workspace, cornix: { ...cornix, document } });
    setKeymapSave({ kind: "saving" });
    keymapQueue.current?.enqueue(serializeKeymapYaml(document, cornix.binding));
  }

  /** Core の編集関数を目標状態へ当てる。編集関数が拒否したら理由を通知し、保存しない。 */
  function updateCornix(edit: (document: VilDocument) => VilDocument): void {
    if (cornix === undefined) return;
    try {
      saveCornix(edit(cornix.document));
    } catch (error) {
      say(errorMessage(error));
    }
  }

  function saveLabels(labels: WorkspaceLabels): void {
    if (workspace === undefined) return;
    setWorkspace({ ...workspace, labels });
    setLabelsSave({ kind: "saving" });
    labelsQueue.current?.enqueue(serializeLabelsYaml(labels));
  }

  /** raw keycode 式の表示名。空文字は表示名を消す。 */
  function editLabel(keycode: string, value: string): void {
    if (workspace === undefined) return;
    const keycodes = new Map(workspace.labels.keycodes);
    if (value === "") keycodes.delete(keycode);
    else keycodes.set(keycode, value);
    saveLabels({ ...workspace.labels, keycodes });
  }

  function editLayerLabel(layer: number, value: string): void {
    if (workspace === undefined) return;
    saveLabels(updateLayerLabel(workspace.labels, layer, value));
  }

  function retryLabels(): void {
    if (workspace === undefined) return;
    setLabelsSave({ kind: "saving" });
    labelsQueue.current?.enqueue(serializeLabelsYaml(workspace.labels));
  }

  function saveMac(layout: MacKeyboardLayout, document: MacKeymapDocument): void {
    if (workspace === undefined) return;
    const state = workspace.mac[layout];
    if (state.kind !== "ready") return;
    setWorkspace({ ...workspace, mac: { ...workspace.mac, [layout]: { ...state, document } } });
    setMacSaves((saves) => ({ ...saves, [layout]: { kind: "saving" } }));
    macQueues.current[layout]?.enqueue(serializeMacKeymapYaml(document));
  }

  /** Mac の Core 編集関数を当てる。拒否されたら理由を通知し、保存しない。 */
  function updateMac(
    layout: MacKeyboardLayout,
    edit: (document: MacKeymapDocument) => MacKeymapDocument,
  ): void {
    const state = workspace?.mac[layout];
    if (state?.kind !== "ready") return;
    try {
      saveMac(layout, edit(state.document));
    } catch (error) {
      say(errorMessage(error));
    }
  }

  function retryMac(layout: MacKeyboardLayout): void {
    const state = workspace?.mac[layout];
    if (state?.kind !== "ready") return;
    saveMac(layout, state.document);
  }

  async function createMacKeymap(layout: MacKeyboardLayout): Promise<void> {
    if (workspace === undefined) return;
    try {
      const path = macKeymapPath(layout);
      await workspace.store.writeText(path, initialMacKeymapYaml(layout));
      await adoptStore(workspace.store, `${path}を作成した`, true);
    } catch (error) {
      say(errorMessage(error));
    }
  }

  /**
   * acknowledge 済みの診断 id を `keysync/acknowledgements.json` へ保存する。
   * 保存に失敗したら記録を変えず、false を返す。
   */
  async function acknowledge(ids: readonly string[]): Promise<boolean> {
    if (workspace === undefined) return false;
    try {
      const next = [...new Set(ids)].sort();
      await workspace.store.writeText(
        WORKSPACE_LAYOUT.acknowledgements,
        serializeAcknowledgements(next),
      );
      setWorkspace({ ...workspace, acknowledged: next });
      return true;
    } catch (error) {
      say(errorMessage(error));
      return false;
    }
  }

  /** 最新の backup を目標状態へ読み込む。実機には書き込まず、保存もしない。 */
  async function restoreBackup(): Promise<void> {
    if (workspace === undefined || cornix === undefined) return;
    try {
      const text = await workspace.store.readText(WORKSPACE_LAYOUT.latestBackup);
      if (text === undefined) throw new Error("最新のbackupが見つからない");
      setWorkspace({ ...workspace, cornix: { ...cornix, document: parseVil(text) } });
      say("最新backupをdesiredへ読み込んだ。内容を確認してApplyまたは保存してください");
    } catch (error) {
      say(errorMessage(error));
    }
  }

  async function importVil(): Promise<void> {
    if (cornix === undefined) return;
    try {
      saveCornix(parseBrowserVil(await pickVilText()));
      say(".vilをdesiredへ読み込んだ。validationとdiffを確認してください");
    } catch (error) {
      say(errorMessage(error));
    }
  }

  async function exportVil(): Promise<void> {
    if (workspace === undefined || cornix === undefined) return;
    try {
      const path = generatedPath("keymap.vil");
      await workspace.store.writeText(path, serializeBrowserVil(cornix.document));
      say(`${path}へ書き出した`);
    } catch (error) {
      say(errorMessage(error));
    }
  }

  async function exportSvg(layer: number): Promise<void> {
    if (workspace === undefined || cornix === undefined) return;
    try {
      const path = generatedPath(`keymap-layer-${layer}.svg`);
      const svg = renderBrowserSvg(cornix.document, cornix.definition, layer, workspace.labels);
      await workspace.store.writeText(path, svg);
      say(`${path}へ書き出した`);
    } catch (error) {
      say(errorMessage(error));
    }
  }

  async function exportPdf(layer: number): Promise<void> {
    if (workspace === undefined || cornix === undefined) return;
    try {
      const path = generatedPath(`keymap-layer-${layer}.pdf`);
      const pdf = renderBrowserPdf(cornix.document, cornix.definition, layer, workspace.labels);
      await workspace.store.writeBytes(path, pdf);
      say(`${path}へ書き出した`);
    } catch (error) {
      say(errorMessage(error));
    }
  }

  /**
   * 編集中の Mac の目標状態から kanata の設定を keysync/generated/ へ書き出す。
   *
   * ディスクを再読せず in-memory の document から生成し、保存キューに未 flush の編集がある瞬間の
   * stale read を避ける（ADR 0025）。kanata が読む設定ファイルへ書くのは適用だけ（ADR 0049）。
   */
  async function exportKanata(layout: MacKeyboardLayout): Promise<void> {
    const state = workspace?.mac[layout];
    if (workspace === undefined || state?.kind !== "ready") return;
    try {
      const { config, diagnostics, summary } = generateBrowserKanataFromDocument(state.document);
      if (config === undefined) {
        say(
          `${state.path}にerrorが${summary.error}件ある: ${diagnostics
            .filter((diagnostic) => diagnostic.severity === "error")
            .map((diagnostic) => diagnostic.message)
            .join(" / ")}`,
        );
        return;
      }
      const path = generatedPath("kanata.kbd");
      await workspace.store.writeText(path, config);
      const rest =
        diagnostics.length === 0
          ? ""
          : `（warning ${summary.warning}件・information ${summary.information}件）`;
      say(`${path}へ書き出した${rest}。適用は「kanata へ適用」で行う`);
    } catch (error) {
      say(errorMessage(error));
    }
  }

  return {
    workspace,
    cornix,
    issue,
    connection,
    keymapSave,
    labelsSave,
    macSaves,
    adoptStore,
    reload,
    migrateBinding,
    migrateLayout,
    saveCornix,
    updateCornix,
    editLabel,
    editLayerLabel,
    retryLabels,
    saveMac,
    updateMac,
    retryMac,
    createMacKeymap,
    acknowledge,
    restoreBackup,
    importVil,
    exportVil,
    exportSvg,
    exportPdf,
    exportKanata,
  };
}
