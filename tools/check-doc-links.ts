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
  let out: string;
  try {
    out = execFileSync("git", ["-C", root, "ls-files", "-z", "--", "*.md"], {
      encoding: "utf8",
      env,
    });
  } catch (error) {
    const detail = error instanceof Error && "stderr" in error ? String(error.stderr).trim() : "";
    throw new Error(
      `git ls-files に失敗しました。Git リポジトリ内で実行してください。${detail ? ` (${detail})` : ""}`,
    );
  }
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

// `_` による強調（`_x_` / `__x__`）。語中の `_`（snake_case）は強調ではない。
const UNDERSCORE_EMPHASIS = /(^|[^\p{L}\p{N}_])(_{1,2})(?=\S)(.+?)(?<=\S)\2(?![\p{L}\p{N}_])/gu;

// CommonMark でバックスラッシュのエスケープが外れる ASCII 記号。
const ESCAPED_PUNCT = /\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g;

// `](` の直後からリンク宛先を読み、宛先と読み終えた位置を返す。
// <…> 形式か、エスケープ記号と対応する () を含む bare 形式（CommonMark の
// link destination）。`file_(v2).md` のような宛先を最初の ) で切らない。
// 対応しない ( は宛先に含めたまま返し、実在しないファイル名として報告させる。
// 既知の制約: 複数行にまたがる宛先は未対応（呼び出し側が行単位で走査するため）。
function readDest(line: string, start: number): { dest: string; end: number } | null {
  if (line.charAt(start) === "<") {
    const end = line.indexOf(">", start + 1);
    return end === -1 ? null : { dest: line.slice(start + 1, end), end: end + 1 };
  }
  let depth = 0;
  let i = start;
  while (i < line.length) {
    const ch = line.charAt(i);
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      if (depth === 0) break;
      depth -= 1;
    } else if (/\s/.test(ch)) break;
    i += 1;
  }
  if (i === start) return null;
  return { dest: line.slice(start, i).replace(ESCAPED_PUNCT, "$1"), end: i };
}

// [text](dest) / ![text](dest) を表示テキスト text に置き換える。
function stripInlineLinks(text: string): string {
  let out = "";
  let cursor = 0;
  for (const m of text.matchAll(/!?\[([^\]]*)\]\(\s*/g)) {
    const r = readDest(text, m.index + m[0].length);
    if (r === null) continue;
    // タイトル（` "…"`）を飛ばして閉じの `)` まで進める。
    let end = r.end;
    while (end < text.length && text.charAt(end) !== ")") end += 1;
    if (text.charAt(end) !== ")") continue;
    out += text.slice(cursor, m.index) + (m[1] ?? "");
    cursor = end + 1;
  }
  return out + text.slice(cursor);
}

// 見出しの表示テキスト（リンク・画像・強調・コードの記号を外したもの）。
function headingText(raw: string): string {
  const text = stripInlineLinks(raw.replace(/\s+#+\s*$/, "")).replace(/<[^>]+>/g, "");
  // インラインコードの中の `_` は強調として外さない。
  return text
    .split(/(`[^`]*`)/)
    .map((part, i) => (i % 2 === 1 ? part.slice(1, -1) : part.replace(UNDERSCORE_EMPHASIS, "$1$3")))
    .join("")
    .trim();
}

type Scanned = {
  anchors: Set<string>;
  links: { line: number; dest: string }[];
};

// 開きの fence。バッククォートの fence は info string にバッククォートを含められない。
const FENCE_OPEN = /^ {0,3}(?:(`{3,})[^`]*|(~{3,}).*)$/;
// 閉じの fence は fence 文字と空白だけ。info string が付いた行は閉じにならない（CommonMark）。
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
// 既知の制約: リスト項目や引用の中の fence（4 桁の indent、`> ``` `）は ^ {0,3} に合わず
// 認識せず、その中のリンクは本文として検査される。現在のリポジトリには該当箇所がない。
const LIST_ITEM = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;

// 本文の行を、コードブロックの内外で分けて走査する。
function scan(source: string): Scanned {
  const anchors = new Set<string>();
  // github-slugger と同じく、採番済みの slug 自体も使用済みとして数える。
  const seen = new Map<string, number>();
  const links: Scanned["links"] = [];
  const lines = source.split(/\r?\n/);
  let fence: string | null = null;
  // HTML コメント（<!-- … -->）の中は GitHub が描画しないため、見出しもリンクも検査しない。
  // 複数行にまたがるコメントはこのフラグで追い、コメント部分を取り除いた行だけを読む。
  let inComment = false;
  const stripComments = (line: string): string => {
    let out = "";
    let i = 0;
    while (i < line.length) {
      if (inComment) {
        const end = line.indexOf("-->", i);
        if (end === -1) return out;
        inComment = false;
        i = end + 3;
      } else {
        const start = line.indexOf("<!--", i);
        if (start === -1) return out + line.slice(i);
        out += line.slice(i, start);
        inComment = true;
        i = start + 4;
      }
    }
    return out;
  };
  // インデントによるコードブロック。直前が空行で、リスト項目の続きではない 4 桁以上の行から始まる。
  let indentedCode = false;
  let prevBlank = true;
  let inList = false;

  const addAnchor = (text: string): void => {
    const base = slugify(text);
    let slug = base;
    while (seen.has(slug)) {
      const count = (seen.get(base) ?? 0) + 1;
      seen.set(base, count);
      slug = `${base}-${count}`;
    }
    seen.set(slug, 0);
    anchors.add(slug);
  };

  lines.forEach((line, index) => {
    if (fence !== null) {
      const close = FENCE_CLOSE.exec(line)?.[1];
      if (close && close[0] === fence[0] && close.length >= fence.length) fence = null;
      return;
    }
    // HTML コメントを除いた見た目の行で、これ以降のすべてを判定する。
    // fence の中ではコメント記号はリテラルなので、stripComments には回さない。
    const visible = stripComments(line);
    const open = FENCE_OPEN.exec(visible);
    const opener = open?.[1] ?? open?.[2];
    if (opener) {
      fence = opener;
      prevBlank = false;
      return;
    }

    const blank = visible.trim() === "";
    const indented = /^(?: {4}|\t)/.test(visible);
    if (indentedCode) {
      if (blank || indented) {
        prevBlank = blank;
        return;
      }
      indentedCode = false;
    } else if (indented && prevBlank && !inList) {
      indentedCode = true;
      prevBlank = false;
      return;
    }
    if (!blank && !indented) inList = LIST_ITEM.test(visible);
    prevBlank = blank;

    const heading = /^ {0,3}#{1,6}[ \t]+(.*)$/.exec(visible);
    if (heading?.[1] !== undefined) addAnchor(headingText(heading[1]));
    // setext 見出し（直前の行が本文で、この行が === / ---）。
    const next = lines[index + 1];
    if (
      heading === null &&
      visible.trim() !== "" &&
      next !== undefined &&
      /^ {0,3}(=+|-+)\s*$/.test(next)
    ) {
      addAnchor(headingText(visible));
    }

    // 明示的な HTML アンカー。
    for (const m of visible.matchAll(/<a\s+[^>]*?(?:id|name)=["']([^"']+)["']/gi)) {
      if (m[1] !== undefined) anchors.add(m[1].toLowerCase());
    }

    const stripped = visible.replace(/`+[^`]*`+/g, (m) => " ".repeat(m.length));
    for (const m of stripped.matchAll(/!?\[(?:[^\]\\]|\\.)*\]\(\s*/g)) {
      const r = readDest(stripped, m.index + m[0].length);
      if (r !== null) links.push({ line: index + 1, dest: r.dest });
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
  let problems: LinkProblem[];
  try {
    problems = checkRoot(root);
  } catch (error) {
    console.error(`check-doc-links: ${error instanceof Error ? error.message : error}`);
    return 2;
  }
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
