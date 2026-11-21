// Markdown 同士の相対リンクと #anchor の実在を検査する。
//
// DocBridge（コード↔docs/specs/ のリンク）とは別の責務で、文書↔文書のリンク切れだけを見る。
// 外部 URL は検査しない。fenced code block とインラインコード内のリンクは無視する。
// アンカーは GitHub の見出し slug（github-slugger 相当）で照合する。
//
// 使い方: tsx tools/check-doc-links.ts [リポジトリのルート]（既定は cwd）

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// 検査対象外の vendor 資産（.claude / .agents）。pre-commit の exclude と揃える。
const VENDOR_PREFIXES = [".claude/", ".agents/"];

export type LinkProblem = {
  file: string;
  line: number;
  link: string;
  reason: string;
};

// 検査対象は Git が追跡する Markdown だけにする。
// 未追跡の下書きや gitignore 対象（.pnpm-store、coverage、result など）を走査せず、
// CI のクリーンな checkout と同じ範囲になる。
export function listMarkdownFiles(root: string): string[] {
  // hook の実行中は GIT_DIR / GIT_INDEX_FILE が設定され、`-C` より優先されてしまう。
  const env = { ...process.env };
  for (const name of ["GIT_DIR", "GIT_INDEX_FILE", "GIT_WORK_TREE"]) delete env[name];
  const out = execFileSync("git", ["-C", root, "ls-files", "-z", "--", "*.md"], {
    encoding: "utf8",
    env,
  });
  return out
    .split("\0")
    .filter((name) => name !== "" && !VENDOR_PREFIXES.some((prefix) => name.startsWith(prefix)))
    .sort()
    .map((name) => resolve(root, name))
    .filter((path) => existsSync(path)); // 削除済みで未 stage のファイルは除く
}

// GitHub が見出しから作るアンカー。小文字化し、文字・数字・結合文字・`_`・`-`・空白以外を除き、
// 空白を `-` にする。日本語の文字は残り、全角の括弧や句読点は消える。
export function slugify(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, "")
    .replace(/ /g, "-");
}

// 見出しの表示テキスト（リンク・画像・強調・コードの記号を外したもの）。
function headingText(raw: string): string {
  return raw
    .replace(/\s+#+\s*$/, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/`([^`]*)`/g, "$1")
    .trim();
}

type Scanned = {
  anchors: Set<string>;
  links: { line: number; dest: string }[];
};

const FENCE = /^ {0,3}(`{3,}|~{3,})/;

// 本文の行を、コードブロックの内外で分けて走査する。
function scan(source: string): Scanned {
  const anchors = new Set<string>();
  const seen = new Map<string, number>();
  const links: Scanned["links"] = [];
  const lines = source.split(/\r?\n/);
  let fence: string | null = null;

  const addAnchor = (text: string): void => {
    const base = slugify(text);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    anchors.add(count === 0 ? base : `${base}-${count}`);
  };

  lines.forEach((line, index) => {
    const fenceMatch = FENCE.exec(line);
    if (fence !== null) {
      if (
        fenceMatch?.[1] &&
        fenceMatch[1][0] === fence[0] &&
        fenceMatch[1].length >= fence.length
      ) {
        fence = null;
      }
      return;
    }
    if (fenceMatch?.[1]) {
      fence = fenceMatch[1];
      return;
    }

    const heading = /^ {0,3}#{1,6}[ \t]+(.*)$/.exec(line);
    if (heading?.[1] !== undefined) addAnchor(headingText(heading[1]));
    // setext 見出し（直前の行が本文で、この行が === / ---）。
    const next = lines[index + 1];
    if (
      heading === null &&
      line.trim() !== "" &&
      next !== undefined &&
      /^ {0,3}(=+|-+)\s*$/.test(next)
    ) {
      addAnchor(headingText(line));
    }

    // 明示的な HTML アンカー。
    for (const m of line.matchAll(/<a\s+[^>]*?(?:id|name)=["']([^"']+)["']/gi)) {
      if (m[1] !== undefined) anchors.add(m[1].toLowerCase());
    }

    const stripped = line.replace(/`+[^`]*`+/g, (m) => " ".repeat(m.length));
    for (const m of stripped.matchAll(/!?\[(?:[^\]\\]|\\.)*\]\(\s*(<[^>]*>|[^\s)]*)/g)) {
      if (m[1] !== undefined) links.push({ line: index + 1, dest: m[1].replace(/^<|>$/g, "") });
    }
    // 脚注の定義（[^1]: 本文）はリンク定義ではない。
    const def = /^ {0,3}\[(?!\^)[^\]]+\]:\s*(<[^>]*>|\S+)/.exec(stripped);
    if (def?.[1] !== undefined) links.push({ line: index + 1, dest: def[1].replace(/^<|>$/g, "") });
  });

  return { anchors, links };
}

const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function checkRoot(root: string): LinkProblem[] {
  const problems: LinkProblem[] = [];
  const files = listMarkdownFiles(root);
  const cache = new Map<string, Scanned>();
  const load = (path: string): Scanned => {
    let scanned = cache.get(path);
    if (scanned === undefined) {
      scanned = scan(readFileSync(path, "utf8"));
      cache.set(path, scanned);
    }
    return scanned;
  };

  for (const file of files) {
    const rel = relative(root, file).split(sep).join("/");
    for (const { line, dest } of load(file).links) {
      if (dest === "" || EXTERNAL.test(dest)) continue;
      const hash = dest.indexOf("#");
      const pathPart = decode(hash === -1 ? dest : dest.slice(0, hash));
      const fragment = hash === -1 ? "" : decode(dest.slice(hash + 1));
      const query = pathPart.indexOf("?");
      const targetRel = query === -1 ? pathPart : pathPart.slice(0, query);

      let target: string;
      if (targetRel === "") target = file;
      else if (targetRel.startsWith("/")) target = resolve(root, `.${targetRel}`);
      else target = resolve(dirname(file), targetRel);

      if (!existsSync(target)) {
        problems.push({ file: rel, line, link: dest, reason: "リンク先のファイルが存在しません" });
        continue;
      }
      // 行番号アンカー（#L10 など）と、Markdown 以外へのアンカーは検査しない。
      if (fragment === "" || !target.endsWith(".md") || /^L\d+(-L\d+)?$/.test(fragment)) continue;
      if (!load(target).anchors.has(fragment.toLowerCase())) {
        problems.push({
          file: rel,
          line,
          link: dest,
          reason: "リンク先に該当する見出しがありません",
        });
      }
    }
  }
  return problems;
}

function main(): number {
  const root = resolve(process.argv[2] ?? process.cwd());
  const problems = checkRoot(root);
  if (problems.length === 0) {
    console.log("check-doc-links: 切れたリンクとアンカーはありません。");
    return 0;
  }
  for (const p of problems) console.error(`${p.file}:${p.line}: ${p.reason}: ${p.link}`);
  console.error(`check-doc-links: ${problems.length} 件のリンク切れを検出しました。`);
  return 1;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
