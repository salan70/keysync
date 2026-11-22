import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { checkRoot, slugify } from "./check-doc-links.ts";

function git(root: string, ...args: string[]): void {
  // hook 内で実行されても tmp の repo を操作するよう、親の GIT_* は引き継がない。
  const env = { ...process.env };
  for (const name of ["GIT_DIR", "GIT_INDEX_FILE", "GIT_WORK_TREE"]) delete env[name];
  execFileSync("git", ["-C", root, ...args], { env, stdio: "ignore" });
}

function write(root: string, files: Record<string, string>): void {
  for (const [name, body] of Object.entries(files)) {
    const path = join(root, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body);
  }
}

// files は git add 済み（追跡対象）、untracked は未追跡のまま置く。
function withDocs(
  files: Record<string, string>,
  run: (root: string) => void,
  untracked: Record<string, string> = {},
): void {
  const root = mkdtempSync(join(tmpdir(), "doc-links-"));
  try {
    git(root, "init", "--quiet");
    write(root, files);
    git(root, "add", "-A");
    write(root, untracked);
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

test("未追跡・gitignore 対象の Markdown と壊れた symlink は走査しない", () => {
  withDocs(
    {
      ".gitignore": "ignored/\n",
      "docs/a.md": "# A\n\n[b](./b.md)\n",
      "docs/b.md": "# B\n",
      "ignored/x.md": "[x](./none.md)\n",
    },
    (root) => {
      symlinkSync(join(root, "missing"), join(root, "broken-link"));
      symlinkSync(root, join(root, "docs", "loop"));
      assert.deepEqual(checkRoot(root), []);
    },
    { "notes/scratch.md": "[草稿](./none.md)\n" },
  );
});

test("追跡済みの Markdown が壊れたリンクを持てば検出する", () => {
  withDocs({ "docs/a.md": "# A\n\n[x](./none.md)\n" }, (root) =>
    assert.deepEqual(
      checkRoot(root).map((p) => p.link),
      ["./none.md"],
    ),
  );
});

// 未追跡ファイルは hook の実行中は存在しても、CI のクリーンな checkout では切れる。
test("未追跡の Markdown へのリンクは失敗し、追跡済みなら通る", () => {
  withDocs(
    { "docs/a.md": "# A\n\n[untracked](./draft.md)\n" },
    (root) =>
      assert.deepEqual(
        checkRoot(root).map((p) => [p.link, p.reason]),
        [["./draft.md", "リンク先の Markdown が Git で追跡されていません"]],
      ),
    { "docs/draft.md": "# Draft\n" },
  );
  // 追跡済みなら vendor 資産（.claude / .agents）へのリンクも通す。
  withDocs(
    {
      "docs/a.md": "# A\n\n[tracked](./b.md) [vendor](../.claude/v.md)\n",
      "docs/b.md": "# B\n",
      ".claude/v.md": "# V\n",
    },
    (root) => assert.deepEqual(checkRoot(root), []),
  );
});

test("宛先中の対応する () を含むリンクを解決する", () => {
  withDocs(
    {
      "docs/a.md": "# A\n\n[ok](./b_(v2).md) [節](./b_(v2).md#日本語の節) [esc](./c\\(d\\).md)\n",
      "docs/b_(v2).md": "# B\n\n## 日本語の節\n",
      "docs/c(d).md": "# C\n",
    },
    (root) => assert.deepEqual(checkRoot(root), []),
  );
});

test("対応しない ( を含む宛先はリンク切れとして報告する", () => {
  withDocs({ "docs/a.md": "# A\n\n[ng1](./none_(v2).md) [ng2](./a(b.md)\n" }, (root) =>
    assert.deepEqual(
      checkRoot(root).map((p) => p.link),
      ["./none_(v2).md", "./a(b.md)"],
    ),
  );
});

test("脚注の定義をリンク定義として扱わない", () => {
  withDocs({ "docs/a.md": "# A\n\n本文[^1]\n\n[^1]: Footnote.\n[^note]: 注記 text\n" }, (root) =>
    assert.deepEqual(checkRoot(root), []),
  );
});

test("`_` の強調を外して slug にし、語中の `_` とコード内の `_` は残す", () => {
  withDocs(
    {
      "docs/a.md": [
        "# __Bold__ head",
        "",
        "## _斜体_ と text",
        "",
        "## snake_case_name",
        "",
        "## `__init__` の話",
        "",
        "[1](#bold-head) [2](#斜体-と-text) [3](#snake_case_name) [4](#__init__-の話)",
        "",
      ].join("\n"),
    },
    (root) => assert.deepEqual(checkRoot(root), []),
  );
});

test("インデントのコードブロック内のリンクと見出しは検査しない", () => {
  withDocs(
    {
      "docs/a.md": [
        "# A",
        "",
        "段落",
        "",
        "    [code](./none.md)",
        "    # 偽の見出し",
        "",
        "- 項目",
        "",
        "    - [入れ子](./b.md)",
        "",
        "段落の続き",
        "    [lazy](./lazy-none.md)",
        "",
      ].join("\n"),
      "docs/b.md": "# B\n",
    },
    (root) =>
      assert.deepEqual(
        checkRoot(root).map((p) => p.link),
        ["./lazy-none.md"],
      ),
  );
});

test("fence は info string 付きの行では閉じず、fence 文字だけの行で閉じる", () => {
  withDocs(
    {
      "docs/a.md": [
        "# A",
        "",
        "```md",
        "```js",
        "[内側](./none.md)",
        "```",
        "",
        "[外側](./outer-none.md)",
        "",
        "~~~~",
        "~~~",
        "[内側2](./none2.md)",
        "~~~~   ",
        "",
        "[外側2](./outer-none2.md)",
        "",
      ].join("\n"),
    },
    (root) =>
      assert.deepEqual(
        checkRoot(root).map((p) => p.link),
        ["./outer-none.md", "./outer-none2.md"],
      ),
  );
});

test("重複見出しの採番は github-slugger と同じにする（a, a, a-1 → a, a-1, a-1-1）", () => {
  withDocs(
    {
      "docs/a.md": [
        "# a",
        "",
        "# a",
        "",
        "# a-1",
        "",
        "# a",
        "",
        "[1](#a) [2](#a-1) [3](#a-1-1) [4](#a-2) [5](#a-3)",
        "[6](#a-4)",
        "",
      ].join("\n"),
    },
    (root) =>
      assert.deepEqual(
        checkRoot(root).map((p) => p.link),
        ["#a-3", "#a-4"],
      ),
  );
});

test("参照形式のリンクは定義の宛先を検査する", () => {
  withDocs(
    {
      "docs/a.md": "# A\n\n[x][ok] [y][bad]\n\n[ok]: ./b.md\n[bad]: ./none.md#h\n",
      "docs/b.md": "# B\n",
    },
    (root) =>
      assert.deepEqual(
        checkRoot(root).map((p) => [p.line, p.link]),
        [[6, "./none.md#h"]],
      ),
  );
});

test("パーセントエンコードのアンカーと、<a id> / <a name> を解決する", () => {
  withDocs(
    {
      "docs/a.md": [
        "# A",
        "",
        "[1](./b.md#%E6%97%A5%E6%9C%AC%E8%AA%9E) [2](./b.md#custom-id) [3](./b.md#Legacy-Name)",
        "",
      ].join("\n"),
      "docs/b.md": '# 日本語\n\n<a id="custom-id"></a>\n\n<a name="Legacy-Name"></a>\n',
    },
    (root) => assert.deepEqual(checkRoot(root), []),
  );
});

test("setext 見出しをアンカーにする", () => {
  withDocs(
    {
      "docs/a.md": "Title\n=====\n\nSub head\n--------\n\n[1](#title) [2](#sub-head) [3](#none)\n",
    },
    (root) =>
      assert.deepEqual(
        checkRoot(root).map((p) => p.link),
        ["#none"],
      ),
  );
});

test("行番号アンカー（#L10）は検査せず、?query 付きのリンクはパス部分だけ検査する", () => {
  withDocs(
    {
      "docs/a.md":
        "# A\n\n[1](./b.md#L10) [2](./b.md#L3-L9) [3](./b.md?plain=1) [4](./none.md?plain=1)\n",
      "docs/b.md": "# B\n",
    },
    (root) =>
      assert.deepEqual(
        checkRoot(root).map((p) => p.link),
        ["./none.md?plain=1"],
      ),
  );
});

test("画像リンクの宛先を検査する", () => {
  withDocs(
    { "docs/a.md": "# A\n\n![ok](./pic.png) ![ng](./none.png)\n", "docs/pic.png": "" },
    (root) =>
      assert.deepEqual(
        checkRoot(root).map((p) => p.link),
        ["./none.png"],
      ),
  );
});

test("数字だけの見出しもアンカーにする", () => {
  withDocs({ "docs/a.md": "# 2024\n\n## 1.2.3\n\n[1](#2024) [2](#123)\n" }, (root) =>
    assert.deepEqual(checkRoot(root), []),
  );
});

test("HTML コメントの中のリンクと見出しは検査しない", () => {
  withDocs(
    {
      "docs/a.md": [
        "# A",
        "",
        "<!-- [単行](./none.md) -->",
        "",
        "前 <!-- [途中](./none2.md) --> 後",
        "",
        "<!--",
        "[複数行](./none3.md)",
        "# コメント内の見出し",
        "-->",
        "",
        "[コメント内の見出しだけを指す](#コメント内の見出し)",
        "",
      ].join("\n"),
    },
    (root) =>
      // コメント内の見出しはアンカーにならないため、それを指すリンクだけが報告される。
      assert.deepEqual(
        checkRoot(root).map((p) => p.link),
        ["#コメント内の見出し"],
      ),
  );
});

test("Git リポジトリの外では案内を出して 2 で終わる", () => {
  const dir = mkdtempSync(join(tmpdir(), "doc-links-nogit-"));
  try {
    const { status, stderr } = runCli(dir);
    assert.equal(status, 2);
    assert.match(stderr, /Git リポジトリ/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// CI の赤が意味を持つことの確認。壊れたリンクとアンカーで非 0、正常で 0 になる。
function runCli(root: string): { status: number | null; stderr: string } {
  const script = fileURLToPath(new URL("./check-doc-links.ts", import.meta.url));
  const result = spawnSync(process.execPath, [script, root], { encoding: "utf8" });
  return { status: result.status, stderr: result.stderr };
}

test("CLI は壊れたリンクかアンカーで非 0 を返し、正常なら 0 を返す", () => {
  withDocs({ "docs/a.md": "# A\n\n[b](./b.md#b)\n", "docs/b.md": "# B\n" }, (root) =>
    assert.equal(runCli(root).status, 0),
  );
  withDocs({ "docs/a.md": "# A\n\n[b](./none.md)\n" }, (root) => {
    const { status, stderr } = runCli(root);
    assert.equal(status, 1);
    assert.match(stderr, /docs\/a\.md:3: リンク先のファイルが存在しません: \.\/none\.md/);
  });
  withDocs({ "docs/a.md": "# A\n\n[b](./b.md#missing)\n", "docs/b.md": "# B\n" }, (root) => {
    const { status, stderr } = runCli(root);
    assert.equal(status, 1);
    assert.match(stderr, /リンク先に該当する見出しがありません: \.\/b\.md#missing/);
  });
});
