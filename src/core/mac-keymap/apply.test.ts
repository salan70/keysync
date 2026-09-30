import { deepStrictEqual, notStrictEqual, strictEqual } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { parseMacKeymapYaml } from "./parse.ts";
import {
  appliedTappingTermMs,
  diffKanataText,
  karabinerGrabsBuiltIn,
  karabinerGrabsExternal,
  planMacApply,
  verifyMacApply,
} from "./apply.ts";

const FIXTURES = join(import.meta.dirname, "../../../fixtures/mac-keyboard");
const readFixture = (name: string) => readFileSync(join(FIXTURES, name), "utf8");

const DESIRED = parseMacKeymapYaml(readFixture("desired.yaml"));

test("初回はファイルが無いので、全部が追加の差分になる", () => {
  const plan = planMacApply(undefined, DESIRED);
  strictEqual(plan.present, false);
  strictEqual(plan.changed, true);
  strictEqual(
    plan.entries.every((entry) => entry.change === "added"),
    true,
  );
  deepStrictEqual(
    plan.entries.find((entry) => entry.layer === 0 && entry.keyCode === "caps_lock"),
    {
      layer: 0,
      keyCode: "caps_lock",
      change: "added",
      after: "(tap-hold-opposite-hand-release $tapping-term esc lctl (timeout hold))",
    },
  );
});

test("同じ desired を 2 回適用しても差分は出ない", () => {
  const { text } = planMacApply(undefined, DESIRED);
  const again = planMacApply(text, DESIRED);
  strictEqual(again.changed, false);
  deepStrictEqual(again.entries, []);
});

test("差分は layer とキー、layer の外の設定の単位で出る", () => {
  const before = planMacApply(undefined, DESIRED).text;
  const next = {
    ...DESIRED,
    tappingTermMs: 150,
    layers: new Map([...DESIRED.layers, [1, new Map([["a", "KC_END"]])]]),
  };
  const plan = planMacApply(before, next);
  deepStrictEqual(
    plan.entries.map(({ layer, keyCode, change }) => ({ layer, keyCode, change })),
    [
      { layer: 1, keyCode: "a", change: "changed" },
      { layer: 1, keyCode: "d", change: "removed" },
      { layer: 1, keyCode: "e", change: "removed" },
      { layer: 1, keyCode: "h", change: "removed" },
      { layer: 1, keyCode: "j", change: "removed" },
      { layer: 1, keyCode: "k", change: "removed" },
      { layer: 1, keyCode: "l", change: "removed" },
      { layer: null, keyCode: "tapping-term", change: "changed" },
    ],
  );
});

test("verify は書いたテキストと一致するときだけ通る", () => {
  const { text } = planMacApply(undefined, DESIRED);
  strictEqual(verifyMacApply(text, text), true);
  strictEqual(verifyMacApply(undefined, text), false);
  strictEqual(verifyMacApply(`${text};;\n`, text), false);
});

test("fingerprint は同じ入力で一致し、中身や診断が変わると変わる", () => {
  const one = planMacApply(undefined, DESIRED);
  strictEqual(planMacApply(undefined, DESIRED).fingerprint, one.fingerprint);
  notStrictEqual(
    planMacApply(undefined, { ...DESIRED, tappingTermMs: 150 }).fingerprint,
    one.fingerprint,
  );
  notStrictEqual(
    planMacApply(undefined, DESIRED, { karabinerGrabsBuiltIn: true }).fingerprint,
    one.fingerprint,
  );
});

test("Karabiner が内蔵キーボードを掴むなら warning を出す", () => {
  const plan = planMacApply(undefined, DESIRED, { karabinerGrabsBuiltIn: true });
  const found = plan.diagnostics.find((one) => one.code === "mac-keymap/karabiner-grabs-built-in");
  strictEqual(found?.severity, "warning");
  strictEqual(
    planMacApply(undefined, DESIRED).diagnostics.some(
      (one) => one.code === "mac-keymap/karabiner-grabs-built-in",
    ),
    false,
  );
});

test("karabinerGrabsBuiltIn は選択中の profile が内蔵キーボードを ignore していれば false", () => {
  // R-010 で Karabiner の Devices 画面が書いた形。
  const ignoring = {
    profiles: [
      { name: "Default profile" },
      {
        name: "KeySync",
        selected: true,
        devices: [{ identifiers: { is_keyboard: true }, ignore: true }],
      },
    ],
  };
  strictEqual(karabinerGrabsBuiltIn(ignoring), false);
  // 外付け（id あり）を ignore しても内蔵は掴む。
  const external = {
    profiles: [
      {
        selected: true,
        devices: [
          { identifiers: { is_keyboard: true, vendor_id: 1, product_id: 2 }, ignore: true },
        ],
      },
    ],
  };
  strictEqual(karabinerGrabsBuiltIn(external), true);
  strictEqual(karabinerGrabsBuiltIn(JSON.parse(readFixture("karabiner-baseline.json"))), true);
  strictEqual(karabinerGrabsBuiltIn({}), true);
});

test("適用先デバイスが変わるなら kanata の再起動を求める warning を出す", () => {
  const { text } = planMacApply(undefined, DESIRED);
  const external = { ...DESIRED, devices: [...DESIRED.devices, { name: "Magic Keyboard" }] };
  const found = planMacApply(text, external).diagnostics.find(
    (one) => one.code === "mac-keymap/devices-need-restart",
  );
  strictEqual(found?.severity, "warning");
  const codes = (current: string | undefined, document: typeof DESIRED) =>
    planMacApply(current, document).diagnostics.map((one) => one.code);
  strictEqual(
    codes(text, { ...DESIRED, tappingTermMs: 150 }).includes("mac-keymap/devices-need-restart"),
    false,
  );
  // 初回の適用は kanata がまだ設定を読んでいないので、再起動の案内は要らない。
  strictEqual(codes(undefined, external).includes("mac-keymap/devices-need-restart"), false);
});

test("karabinerGrabsExternal は vendor / product id が一致する ignore の項目があれば false", () => {
  const config = {
    profiles: [
      {
        selected: true,
        devices: [
          { identifiers: { is_keyboard: true, vendor_id: 76, product_id: 614 }, ignore: true },
          { identifiers: { is_keyboard: true, vendor_id: 1452, product_id: 630 }, ignore: false },
        ],
      },
    ],
  };
  strictEqual(karabinerGrabsExternal(config, 76, 614), false);
  strictEqual(karabinerGrabsExternal(config, 1452, 630), true);
  strictEqual(karabinerGrabsExternal(config, 1, 2), true, "項目が無ければ Karabiner の既定で掴む");
  strictEqual(karabinerGrabsExternal({}, 76, 614), true);
});

test("appliedTappingTermMs は所有するファイルの閾値を読み、無ければ null", () => {
  const { text } = planMacApply(undefined, { ...DESIRED, tappingTermMs: 170 });
  strictEqual(appliedTappingTermMs(text), 170);
  strictEqual(appliedTappingTermMs(""), null);
});

test("diffKanataText はコメントと閉じ括弧を差分にしない", () => {
  const text = "(deflayermap (base)\n  a b\n)\n";
  deepStrictEqual(diffKanataText(`;; 手で足した\n${text}`, text), []);
});
