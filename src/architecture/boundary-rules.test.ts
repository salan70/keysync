import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { test } from "node:test";
import { checkCoreBoundary, checkViewConvention } from "./boundary-rules.ts";
import { extractImports, stripComments } from "./import-graph.ts";

function sources(files: Record<string, string>): ReadonlyMap<string, string> {
  return new Map(Object.entries(files));
}

test("import は静的・再 export・side effect・動的を、複数行でも拾う", () => {
  const refs = extractImports(`import a from "./a.ts";
import type { B } from "./b.ts";
import {
  c,
  type D,
} from "./c.ts";
export * from "./d.ts";
export { e } from "./e.ts";
export type { F } from "./f.ts";
import "./g.ts";
const h = await import("./h.ts");
export const text = "import x from './not-an-import.ts'";
`);
  deepStrictEqual(
    refs.map(({ specifier, line }) => [specifier, line]),
    [
      ["./a.ts", 1],
      ["./b.ts", 2],
      ["./c.ts", 6],
      ["./d.ts", 7],
      ["./e.ts", 8],
      ["./f.ts", 9],
      ["./g.ts", 10],
      ["./h.ts", 11],
    ],
  );
});

test("コメントの中の import は拾わず、文字列の中の // はコメントにしない", () => {
  const source = `// import a from "./a.ts";
/* import b from "./b.ts";
   import c from "./c.ts"; */
const url = "http://example.com";
import d from "./d.ts";
`;
  strictEqual(stripComments(source).split("\n").length, source.split("\n").length);
  deepStrictEqual(
    extractImports(source).map(({ specifier }) => specifier),
    ["./d.ts"],
  );
});

test("core は node:、bare の組み込み、react、core の外を禁止し、違反の経路を示す", () => {
  const result = checkCoreBoundary(
    sources({
      "src/core/index.ts": `export * from "./chain/b.ts";`,
      "src/core/chain/b.ts": `export { a } from "./a.ts";`,
      "src/core/chain/a.ts": `import { useState } from "react";\nimport { readFileSync } from "node:fs";\nimport { join } from "path";`,
      "src/core/direct.ts": `import { x } from "../ui/x.ts";\nimport { y } from "../../src/device/y.ts";`,
      "src/core/ok.ts": `import { z } from "./chain/b.ts";\nimport { w } from "yaml";`,
      "src/core/ok.test.ts": `import { readFileSync } from "node:fs";`,
      "src/ui/x.ts": `import "react";`,
      "src/device/y.ts": ``,
    }),
    [],
  );
  deepStrictEqual(result.stale, []);
  deepStrictEqual(result.violations, [
    'src/core/index.ts → src/core/chain/b.ts → src/core/chain/a.ts → react（src/core/chain/a.ts:1 の import "react": React に依存しない）',
    'src/core/index.ts → src/core/chain/b.ts → src/core/chain/a.ts → node:fs（src/core/chain/a.ts:2 の import "node:fs": Node.js の組み込みを使わない）',
    'src/core/index.ts → src/core/chain/b.ts → src/core/chain/a.ts → path（src/core/chain/a.ts:3 の import "path": Node.js の組み込みを使わない）',
    'src/core/direct.ts → src/ui/x.ts（src/core/direct.ts:1 の import "../ui/x.ts": src/core の外へ到達しない）',
    'src/core/direct.ts → src/device/y.ts（src/core/direct.ts:2 の import "../../src/device/y.ts": src/core の外へ到達しない）',
  ]);
});

test("core の相対 import が解決できないときも違反にし、資産の import は存在を問わない", () => {
  const result = checkCoreBoundary(
    sources({
      "src/core/a.ts": `import "./missing.ts";\nimport raw from "./data.json";`,
    }),
    [],
  );
  deepStrictEqual(result.violations, [
    'src/core/a.ts → ./missing.ts（src/core/a.ts:1 の import "./missing.ts": 相対 import が解決できない）',
  ]);
});

test("例外は該当する違反だけを許し、違反が消えた例外は stale として返す", () => {
  const files = sources({
    "src/core/a.ts": `import { x } from "../ui/x.ts";`,
    "src/ui/x.ts": ``,
  });
  const allowed = checkCoreBoundary(files, [
    { file: "src/core/a.ts", target: "src/ui/x.ts", reason: "移行中" },
  ]);
  deepStrictEqual(allowed, { violations: [], stale: [] });

  const stale = checkCoreBoundary(files, [
    { file: "src/core/a.ts", target: "src/ui/x.ts", reason: "移行中" },
    { file: "src/core/a.ts", target: "node:fs", reason: "消えた" },
  ]);
  deepStrictEqual(stale, { violations: [], stale: ["src/core/a.ts → node:fs: 消えた"] });
});

test("view は state の hook と device / server を禁止し、それ以外の ui と core は許す", () => {
  const result = checkViewConvention(
    sources({
      "src/ui/components/A.tsx": [
        `import { useApply } from "../state/use-apply.ts";`,
        `import type { P } from "../../server/protocol.ts";`,
        `import { d } from "../../device/webhid.ts";`,
        `import { label } from "../keycode-labels.ts";`,
        `import { c } from "../../core/model/keymap-view.ts";`,
        `import { Icon } from "./Icon.tsx";`,
        `import svg from "../icons/logo.svg?raw";`,
        `const [open, setOpen] = useState(false);`,
      ].join("\n"),
      "src/ui/components/Icon.tsx": ``,
      "src/ui/components/A.test.tsx": `import { useApply } from "../state/use-apply.ts";`,
      "src/ui/components/index.ts": `import { useApply } from "../state/use-apply.ts";`,
      "src/ui/App.tsx": `import { useApply } from "./state/use-apply.ts";`,
      "src/ui/state/use-apply.ts": ``,
      "src/ui/keycode-labels.ts": ``,
      "src/server/protocol.ts": ``,
      "src/device/webhid.ts": ``,
      "src/core/model/keymap-view.ts": ``,
    }),
    [],
  );
  deepStrictEqual(result.violations, [
    'src/ui/components/A.tsx → src/ui/state/use-apply.ts（src/ui/components/A.tsx:1 の import "../state/use-apply.ts": view は 接続層の hook を import しない）',
    'src/ui/components/A.tsx → src/server/protocol.ts（src/ui/components/A.tsx:2 の import "../../server/protocol.ts": view は server モジュールを import しない）',
    'src/ui/components/A.tsx → src/device/webhid.ts（src/ui/components/A.tsx:3 の import "../../device/webhid.ts": view は device モジュールを import しない）',
  ]);
});
