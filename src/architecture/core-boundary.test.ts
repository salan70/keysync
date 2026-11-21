import { deepStrictEqual, ok } from "node:assert/strict";
import { test } from "node:test";
import { checkCoreBoundary, type Allowance } from "./boundary-rules.ts";
import { readSourceTree } from "./read-sources.ts";

/**
 * src/core の import 境界の例外。理由を書き、違反が消えたら stale として落とす。
 * 現在は例外が無い。足す前に、境界の外へ出る部分を core の外へ移せないかを先に考える。
 */
const CORE_ALLOWANCES: readonly Allowance[] = [];

test("src/core は node:、react、src/core の外へ到達しない（ADR 0006）", () => {
  const sources = readSourceTree();
  ok(
    [...sources.keys()].filter((path) => path.startsWith("src/core/")).length > 50,
    "src/core の走査対象が少なすぎる。走査の起点が壊れている",
  );
  const { violations, stale } = checkCoreBoundary(sources, CORE_ALLOWANCES);
  deepStrictEqual(
    violations,
    [],
    "禁止先へ到達している経路（入口 → … → 違反のあるファイル → 禁止先）",
  );
  deepStrictEqual(stale, [], "違反が消えた例外。CORE_ALLOWANCES から外す");
});
