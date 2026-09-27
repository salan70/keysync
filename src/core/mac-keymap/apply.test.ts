import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { generateOwnedProfile } from "./generate.ts";
import type { KarabinerConfig } from "./karabiner.ts";
import { parseMacKeymapYaml } from "./parse.ts";
import { diffOwnedProfile, ownedProfile, planMacApply, verifyMacApply } from "./apply.ts";

const FIXTURES = join(import.meta.dirname, "../../../fixtures/mac-keyboard");
const readFixture = (name: string) => readFileSync(join(FIXTURES, name), "utf8");

const DESIRED = parseMacKeymapYaml(readFixture("desired.yaml"));
const baseline = (): KarabinerConfig =>
  JSON.parse(readFixture("karabiner-baseline.json")) as KarabinerConfig;

test("所有 profile 以外には触らない", () => {
  // KeySync が所有するのは name が一致する profile 1 個だけ（ADR 0022）。
  const current = baseline();
  const { next } = planMacApply(current, DESIRED);
  deepStrictEqual(next["global"], current["global"]);
  deepStrictEqual(next.profiles[0], current.profiles[0]);
  strictEqual(next.profiles.length, current.profiles.length);
});

test("所有 profile が無ければ末尾へ足す", () => {
  const current: KarabinerConfig = {
    profiles: [
      { name: "Default profile", selected: true },
    ] as unknown as KarabinerConfig["profiles"],
  };
  const { next, diff } = planMacApply(current, DESIRED);
  strictEqual(diff.present, false);
  strictEqual(next.profiles.length, 2);
  strictEqual(next.profiles[1]?.name, "KeySync");
});

test("所有 profile の selected は変更しない", () => {
  // profile の切り替えはユーザーの操作（ADR 0022）。
  const original = baseline();
  const current: KarabinerConfig = {
    ...original,
    profiles: original.profiles.map((profile) =>
      profile.name === "KeySync" ? { ...profile, selected: true } : profile,
    ),
  };
  const { next, diagnostics } = planMacApply(current, DESIRED);
  strictEqual(next.profiles[1]?.selected, true);
  strictEqual(
    diagnostics.some((one) => one.code === "mac-keymap/profile-not-selected"),
    false,
  );
});

test("所有 profile が選択されていなければ選択の要否を診断に出す", () => {
  // 既定では apply が選ぶので information。`--no-select` のときだけ warning になる（ADR 0028）。
  const plan = planMacApply(baseline(), DESIRED);
  strictEqual(plan.selection.required, true);
  strictEqual(
    plan.diagnostics.some((one) => one.code === "mac-keymap/profile-will-be-selected"),
    true,
  );

  const noSelect = planMacApply(baseline(), DESIRED, { selectProfile: false });
  strictEqual(
    noSelect.diagnostics.some((one) => one.code === "mac-keymap/profile-not-selected"),
    true,
  );
  strictEqual(noSelect.fingerprint === plan.fingerprint, false);
});

test("所有 profile がまだ無くても選択が要ると判定する", () => {
  // 判定を「profile が既存か」で書くと、初回だけ無診断で通って何も効かない（ADR 0028）。
  const original = baseline();
  const current: KarabinerConfig = {
    ...original,
    profiles: original.profiles.filter((profile) => profile.name !== "KeySync"),
  };
  const plan = planMacApply(current, DESIRED);
  strictEqual(plan.diff.present, false);
  strictEqual(plan.selection.required, true);
  strictEqual(
    plan.diagnostics.some((one) => one.code === "mac-keymap/profile-will-be-selected"),
    true,
  );
});

test("diff は所有 profile の manipulator 単位で出る", () => {
  // baseline の caps_lock は left_command で、desired の left_control と食い違う。
  const { diff } = planMacApply(baseline(), DESIRED);
  strictEqual(diff.present, true);
  strictEqual(diff.changed, true);
  const changed = diff.entries.filter((entry) => entry.change === "changed");
  strictEqual(changed.length, 1);
  strictEqual(changed[0]?.keyCode, "caps_lock");
  deepStrictEqual(changed[0]?.after?.to_if_held_down, [{ key_code: "left_control" }]);
});

test("同じ desired を 2 回適用しても差分は出ない", () => {
  const applied = planMacApply(baseline(), DESIRED).next;
  strictEqual(planMacApply(applied, DESIRED).diff.changed, false);
});

test("整形の違いだけでは差分にならない", () => {
  // karabiner_cli --format-json が独自整形でファイルを書き換えるため、
  // テキスト比較では毎回「変更あり」になる（ADR 0022）。
  const { profile } = generateOwnedProfile(DESIRED);
  const reordered = JSON.parse(
    JSON.stringify({
      complex_modifications: profile.complex_modifications,
      virtual_hid_keyboard: profile.virtual_hid_keyboard,
      name: profile.name,
    }),
  ) as typeof profile;
  strictEqual(diffOwnedProfile(reordered, profile).changed, false);
});

test("verify は適用後の config で通る", () => {
  const plan = planMacApply(baseline(), DESIRED);
  const observed = JSON.parse(JSON.stringify(plan.next)) as KarabinerConfig;
  deepStrictEqual(verifyMacApply(observed, plan.profile), { ok: true, entries: [] });
});

test("verify は所有 profile が書けていなければ落ちる", () => {
  const plan = planMacApply(baseline(), DESIRED);
  const result = verifyMacApply(baseline(), plan.profile);
  strictEqual(result.ok, false);
  strictEqual(result.entries.length > 0, true);
});

test("fingerprint は同じ入力で一致し、変えると変わる", () => {
  strictEqual(
    planMacApply(baseline(), DESIRED).fingerprint,
    planMacApply(baseline(), DESIRED).fingerprint,
  );
  const modified = {
    ...DESIRED,
    layers: new Map([...DESIRED.layers, [4, new Map([["p", "KC_P"]])]]),
  };
  strictEqual(
    planMacApply(baseline(), DESIRED).fingerprint ===
      planMacApply(baseline(), modified).fingerprint,
    false,
  );
});

test("ownedProfile は名前が一致する 1 個だけを返す", () => {
  strictEqual(ownedProfile(baseline(), "KeySync")?.name, "KeySync");
  strictEqual(ownedProfile(baseline(), "存在しない"), undefined);
});

test("改名前の profile が残っていれば案内するだけで、触らない", () => {
  // 旧 profile は所有していない。置き換えも削除もしない（ADR 0036）。
  const current = JSON.parse(readFixture("karabiner-legacy-profile.json")) as KarabinerConfig;
  const plan = planMacApply(current, DESIRED);

  const legacy = plan.diagnostics.filter((one) => one.code === "mac-keymap/legacy-profile-present");
  strictEqual(legacy.length, 1);
  strictEqual(legacy[0]?.severity, "information");
  strictEqual(plan.diff.present, false);
  deepStrictEqual(
    plan.next.profiles.map((profile) => profile.name),
    ["Default profile", "Cornix Bonsai", "KeySync"],
  );
  deepStrictEqual(ownedProfile(plan.next, "Cornix Bonsai"), ownedProfile(current, "Cornix Bonsai"));
});

test("改名前の profile を所有している設定では案内しない", () => {
  // profile: "Cornix Bonsai" のままの設定は、その profile を所有しているので旧 profile ではない。
  const current = JSON.parse(readFixture("karabiner-legacy-profile.json")) as KarabinerConfig;
  const plan = planMacApply(current, { ...DESIRED, profile: "Cornix Bonsai" });

  strictEqual(
    plan.diagnostics.some((one) => one.code === "mac-keymap/legacy-profile-present"),
    false,
  );
  strictEqual(plan.diff.present, true);
});

test("改名前の profile が無ければ案内しない", () => {
  strictEqual(
    planMacApply(baseline(), DESIRED).diagnostics.some(
      (one) => one.code === "mac-keymap/legacy-profile-present",
    ),
    false,
  );
});
