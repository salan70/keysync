import { strictEqual } from "node:assert/strict";
import { test } from "node:test";

import { describeDevices, kanataDeviceText } from "./mac-references.ts";

test("適用先の文言は内蔵と外付けを並べる", () => {
  strictEqual(describeDevices([{ builtIn: true }]), "内蔵キーボード");
  strictEqual(
    describeDevices([{ builtIn: true }, { name: "Magic Keyboard" }]),
    "内蔵キーボード、外付け Magic Keyboard",
  );
  strictEqual(describeDevices([]), "なし");
});

test("適用先の指定は kanata の macos-dev-names-include と同じ語彙", () => {
  strictEqual(
    kanataDeviceText([{ builtIn: true }]),
    'macos-dev-names-include ("Apple Internal Keyboard / Trackpad")',
  );
  strictEqual(
    kanataDeviceText([{ builtIn: true }, { name: "Magic Keyboard" }]),
    'macos-dev-names-include ("Apple Internal Keyboard / Trackpad" "Magic Keyboard")',
  );
});
