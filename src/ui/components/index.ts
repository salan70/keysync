// DocBridge は `.ts` の export 宣言だけを link できるため、`.tsx` の部品をここで束ねて仕様と結ぶ。
import { App as AppComponent } from "../App.tsx";
import { ApplyDialog as ApplyDialogComponent } from "./ApplyDialog.tsx";
import { CornixBoard as CornixBoardComponent, MacBoard as MacBoardComponent } from "./Board.tsx";
import { Button as ButtonComponent } from "./Button.tsx";
import { FitText as FitTextComponent } from "./FitText.tsx";
import { Header as HeaderComponent } from "./Header.tsx";
import { Icon as IconComponent } from "./Icon.tsx";
import { Inspector as InspectorComponent } from "./Inspector.tsx";
import { Logo as LogoComponent } from "./Logo.tsx";
import { MacApplyDialog as MacApplyDialogComponent } from "./MacApplyDialog.tsx";
import {
  CornixLayerBar as CornixLayerBarComponent,
  MacLayerBar as MacLayerBarComponent,
} from "./LayerBar.tsx";
import { PanelDialog as PanelDialogComponent } from "./PanelDialog.tsx";
import { Picker as PickerComponent } from "./Picker.tsx";
import { Rail as RailComponent } from "./Rail.tsx";
import { StatusBar as StatusBarComponent } from "./StatusBar.tsx";
import {
  CornixRecovery as CornixRecoveryComponent,
  MacRecovery as MacRecoveryComponent,
  WorkspaceGate as WorkspaceGateComponent,
} from "./Workspace.tsx";
import { BehaviorsPanel as BehaviorsPanelComponent } from "./panels/BehaviorsPanel.tsx";
import {
  CornixDevicePanel as CornixDevicePanelComponent,
  MacDevicePanel as MacDevicePanelComponent,
} from "./panels/DevicePanel.tsx";
import { FilesPanel as FilesPanelComponent } from "./panels/FilesPanel.tsx";
import { OverviewPanel as OverviewPanelComponent } from "./panels/OverviewPanel.tsx";
import { TypingPanel as TypingPanelComponent } from "./panels/TypingPanel.tsx";
import {
  CornixReferences as CornixReferencesComponent,
  MacReferences as MacReferencesComponent,
  ValidationPanel as ValidationPanelComponent,
} from "./panels/ValidationPanel.tsx";

/** @doc docs/specs/ui.md#画面構成 */
export const App = AppComponent;

/** @doc docs/specs/ui.md#header-and-status */
export const Header = HeaderComponent;

/** @doc docs/specs/ui.md#header-and-status */
export const StatusBar = StatusBarComponent;

/** @doc docs/specs/ui.md#rail-and-panels */
export const Rail = RailComponent;

/** @doc docs/specs/ui.md#rail-and-panels */
export const PanelDialog = PanelDialogComponent;

/** @doc docs/specs/ui.md#keymap-editor */
export const CornixLayerBar = CornixLayerBarComponent;

/** @doc docs/specs/ui.md#keymap-editor */
export const CornixBoard = CornixBoardComponent;

/** @doc docs/specs/ui.md#side-panel-editing-controls */
export const Inspector = InspectorComponent;

/** @doc docs/specs/ui.md#keycode-picker */
export const Picker = PickerComponent;

/** @doc docs/specs/ui.md#mac-board */
export const MacLayerBar = MacLayerBarComponent;

/** @doc docs/specs/ui.md#mac-board */
export const MacBoard = MacBoardComponent;

/** @doc docs/specs/ui.md#validation-panel */
export const ValidationPanel = ValidationPanelComponent;

/** @doc docs/specs/ui.md#apply-modal-steps */
export const ApplyDialog = ApplyDialogComponent;

/** @doc docs/specs/ui.md#mac-apply */
export const MacApplyDialog = MacApplyDialogComponent;

/** @doc docs/specs/ui.md#device-panel */
export const CornixDevicePanel = CornixDevicePanelComponent;

/** @doc docs/specs/ui.md#device-panel */
export const MacDevicePanel = MacDevicePanelComponent;

/** @doc docs/specs/ui.md#typing-panel */
export const TypingPanel = TypingPanelComponent;

/** @doc docs/specs/ui.md#overview-layer-grid */
export const OverviewPanel = OverviewPanelComponent;

/** @doc docs/specs/ui.md#browser-import-export */
export const FilesPanel = FilesPanelComponent;

/** @doc docs/specs/ui.md#behaviors-and-references */
export const BehaviorsPanel = BehaviorsPanelComponent;

/** @doc docs/specs/ui.md#behaviors-and-references */
export const CornixReferences = CornixReferencesComponent;

/** @doc docs/specs/ui.md#behaviors-and-references */
export const MacReferences = MacReferencesComponent;

/** @doc docs/specs/ui.md#workspace-recovery */
export const WorkspaceGate = WorkspaceGateComponent;

/** @doc docs/specs/ui.md#workspace-recovery */
export const CornixRecovery = CornixRecoveryComponent;

/** @doc docs/specs/ui.md#workspace-recovery */
export const MacRecovery = MacRecoveryComponent;

/** @doc docs/specs/design-system.md#button */
export const Button = ButtonComponent;

/** @doc docs/specs/design-system.md#fittext-サイズ固定-文字を縮小 */
export const FitText = FitTextComponent;

/** @doc docs/specs/design-system.md#icon */
export const Icon = IconComponent;

/** @doc docs/specs/design-system.md#logo */
export const Logo = LogoComponent;
