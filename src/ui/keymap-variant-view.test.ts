import { strictEqual } from "node:assert/strict";
import { test } from "node:test";
import {
  canSaveVariant,
  needsOverwrite,
  variantBlockedReason,
  variantNameProblem,
} from "./keymap-variant-view.ts";

test("どれかのファイルが保存中か保存失敗なら保持と切り替えを止め、それ以外は止めない", () => {
  strictEqual(variantBlockedReason([]), undefined);
  strictEqual(variantBlockedReason([{ kind: "idle" }, { kind: "saved" }]), undefined);
  strictEqual(typeof variantBlockedReason([{ kind: "saved" }, { kind: "saving" }]), "string");
  strictEqual(typeof variantBlockedReason([{ kind: "error", message: "x" }]), "string");
  strictEqual(
    typeof variantBlockedReason([{ kind: "idle" }, { kind: "conflict", message: "x" }]),
    "string",
  );
});

test("名前は規則に合うときだけ保持できる", () => {
  strictEqual(variantNameProblem(""), undefined);
  strictEqual(variantNameProblem("work-1"), undefined);
  strictEqual(typeof variantNameProblem("Work"), "string");
  strictEqual(typeof variantNameProblem("a.b"), "string");
  strictEqual(typeof variantNameProblem("-a"), "string");
  strictEqual(canSaveVariant("work", true), true);
  strictEqual(canSaveVariant("work", false), false);
  strictEqual(canSaveVariant("", true), false);
  strictEqual(canSaveVariant("Work", true), false);
});

test("同名の保持があれば上書きの確認が要る", () => {
  const variants = [{ name: "work", path: "keymap.work.yaml" }];
  strictEqual(needsOverwrite("work", variants), true);
  strictEqual(needsOverwrite("home", variants), false);
});
