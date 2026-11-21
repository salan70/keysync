import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { checkRoot, slugify } from "./check-doc-links.ts";

function withDocs(files: Record<string, string>, run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "doc-links-"));
  try {
    for (const [name, body] of Object.entries(files)) {
      const path = join(root, name);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, body);
    }
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("slugify は GitHub の見出しアンカーと同じ規則にする", () => {
  assert.equal(slugify("Light / Dark theme"), "light--dark-theme");
  assert.equal(slugify("外付けキーボードに効かせる"), "外付けキーボードに効かせる");
  assert.equal(slugify("設定（任意）、確認。"), "設定任意確認");
  assert.equal(slugify("snake_case と kebab-case"), "snake_case-と-kebab-case");
});

test("実在するファイルと見出しへのリンクは通す", () => {
  withDocs(
    {
      "docs/a.md": "# A\n\n[b](./b.md) [節](./b.md#日本語の節) [自分](#a) [絶対](/docs/b.md)\n",
      "docs/b.md": "# B\n\n## 日本語の（節）\n\n## 重複\n\n## 重複\n\n[二つ目](./b.md#重複-1)\n",
    },
    (root) => assert.deepEqual(checkRoot(root), []),
  );
});

test("存在しないファイルと見出しを検出する", () => {
  withDocs(
    {
      "docs/a.md": "# A\n\n[x](./none.md)\n[y](./b.md#missing)\n[z](#nothing)\n",
      "docs/b.md": "# B\n",
    },
    (root) => {
      const problems = checkRoot(root);
      assert.deepEqual(
        problems.map((p) => [p.file, p.line, p.link]),
        [
          ["docs/a.md", 3, "./none.md"],
          ["docs/a.md", 4, "./b.md#missing"],
          ["docs/a.md", 5, "#nothing"],
        ],
      );
    },
  );
});

test("外部 URL・コードブロック・インラインコードは検査しない", () => {
  withDocs(
    {
      "docs/a.md": [
        "# A",
        "",
        "[外部](https://example.com/none.md#x) [mail](mailto:a@example.com)",
        "`[code](./none.md)`",
        "",
        "```md",
        "[block](./none.md)",
        "# 偽の見出し",
        "```",
        "",
        "[偽の見出しへ](#偽の見出し)",
        "",
      ].join("\n"),
    },
    (root) => {
      const problems = checkRoot(root);
      assert.deepEqual(
        problems.map((p) => p.link),
        ["#偽の見出し"],
      );
    },
  );
});

test("vendor 資産（.claude / .agents）は検査しない", () => {
  withDocs({ ".claude/x.md": "[x](./none.md)\n", ".agents/y.md": "[y](./none.md)\n" }, (root) =>
    assert.deepEqual(checkRoot(root), []),
  );
});
