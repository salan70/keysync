import { deepStrictEqual, ok } from "node:assert/strict";
import { test } from "node:test";
import { checkViewConvention, viewFiles, type Allowance } from "./boundary-rules.ts";
import { readSourceTree } from "./read-sources.ts";

const TYPE_ONLY_HOOK = "型だけの import。型を hook の外（表示値計算の .ts）へ移すまでの暫定";
const TYPE_ONLY_PROTOCOL = "型だけの import。protocol の型を UI 側へ写すまでの暫定";

/**
 * view の規約の例外。いずれも既存の型だけの import で、新しく足さない。
 * 違反が消えたら stale として落とす。
 */
const VIEW_ALLOWANCES: readonly Allowance[] = [
  {
    file: "src/ui/components/MacApplyDialog.tsx",
    target: "src/server/protocol.ts",
    reason: TYPE_ONLY_PROTOCOL,
  },
  {
    file: "src/ui/components/MacApplyDialog.tsx",
    target: "src/ui/state/use-mac-apply.ts",
    reason: TYPE_ONLY_HOOK,
  },
  {
    file: "src/ui/components/StatusBar.tsx",
    target: "src/device/protocol.ts",
    reason: TYPE_ONLY_PROTOCOL,
  },
  {
    file: "src/ui/components/Workspace.tsx",
    target: "src/ui/state/use-workspace.ts",
    reason: TYPE_ONLY_HOOK,
  },
  {
    file: "src/ui/components/panels/DevicePanel.tsx",
    target: "src/device/protocol.ts",
    reason: TYPE_ONLY_PROTOCOL,
  },
  {
    file: "src/ui/components/panels/FilesPanel.tsx",
    target: "src/ui/state/use-keymap-variants.ts",
    reason: TYPE_ONLY_HOOK,
  },
];

test("view は接続層の hook と device / server モジュールを import しない", () => {
  const sources = readSourceTree();
  ok(viewFiles(sources).length >= 20, "view の走査対象が少なすぎる。走査の起点が壊れている");
  const { violations, stale } = checkViewConvention(sources, VIEW_ALLOWANCES);
  deepStrictEqual(violations, [], "規約に反する import（view → 禁止先）");
  deepStrictEqual(stale, [], "違反が消えた例外。VIEW_ALLOWANCES から外す");
});
