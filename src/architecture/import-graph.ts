import { builtinModules } from "node:module";
import { posix } from "node:path";

/** repo root からの相対パス（`/` 区切り）をキーにした、走査対象のソース。 */
export type Sources = ReadonlyMap<string, string>;

export interface ImportRef {
  readonly specifier: string;
  /** 1 始まりの行。複数行の import は specifier のある行。 */
  readonly line: number;
  /** `import type` / `export type` で書かれた型だけの import。 */
  readonly typeOnly: boolean;
}

const NODE_BUILTINS: ReadonlySet<string> = new Set(builtinModules);

/**
 * コメントを同じ長さの空白へ置き換える。改行は残すので、行番号は元のソースと一致する。
 * 文字列と template literal の中の `//` や `/*` はコメントとして扱わない。
 */
export function stripComments(source: string): string {
  let out = "";
  let index = 0;
  while (index < source.length) {
    const char = source[index]!;
    const next = source[index + 1];
    if (char === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") {
        out += " ";
        index += 1;
      }
    } else if (char === "/" && next === "*") {
      const end = source.indexOf("*/", index + 2);
      const stop = end === -1 ? source.length : end + 2;
      out += source.slice(index, stop).replace(/[^\n]/g, " ");
      index = stop;
    } else if (char === '"' || char === "'" || char === "`") {
      let stop = index + 1;
      while (stop < source.length && source[stop] !== char) {
        stop += source[stop] === "\\" ? 2 : 1;
      }
      out += source.slice(index, stop + 1);
      index = stop + 1;
    } else {
      out += char;
      index += 1;
    }
  }
  return out;
}

/** 文の先頭の `import` / `export` だけを数え、文字列の中に書かれた import 風の文を拾わない。 */
const STATIC_IMPORT =
  /^[ \t]*(?:import|export)\s+(type\s+)?(?:[^"'`;]*?\s+from\s+)?(["'])([^"'\n]+)\2/gm;
const DYNAMIC_IMPORT = /\bimport\s*\(\s*(["'])([^"'\n]+)\1\s*\)/g;

/** `import ... from`、`import "x"`、`export ... from`、`import("x")` の specifier を取り出す。 */
export function extractImports(source: string): readonly ImportRef[] {
  const code = stripComments(source);
  const refs: ImportRef[] = [];
  const push = (match: RegExpExecArray, specifier: string, typeOnly: boolean): void => {
    const specifierAt = match.index + match[0].lastIndexOf(specifier);
    refs.push({
      specifier,
      line: code.slice(0, specifierAt).split("\n").length,
      typeOnly,
    });
  };
  for (const match of code.matchAll(STATIC_IMPORT)) {
    push(match, match[3]!, match[1] !== undefined);
  }
  for (const match of code.matchAll(DYNAMIC_IMPORT)) {
    push(match, match[2]!, false);
  }
  return refs.sort((a, b) => a.line - b.line);
}

export function isNodeBuiltin(specifier: string): boolean {
  if (specifier.startsWith("node:")) return true;
  return NODE_BUILTINS.has(specifier.split("/")[0]!);
}

export function isRelative(specifier: string): boolean {
  return specifier.startsWith("./") || specifier.startsWith("../");
}

export interface ResolvedImport {
  /** repo root からの相対パス。`?raw` のような query は落とす。 */
  readonly path: string;
  /** `.ts` / `.tsx` の import なのに走査対象に無い。検査をすり抜けるので呼び出し側が違反にする。 */
  readonly unresolved: boolean;
}

/** 相対 specifier を repo root からの相対パスへ解決する。`.svg?raw` などの資産は存在を確かめない。 */
export function resolveRelative(from: string, specifier: string, sources: Sources): ResolvedImport {
  const path = posix.normalize(posix.join(posix.dirname(from), specifier.split("?")[0]!));
  return { path, unresolved: /\.tsx?$/.test(path) && !sources.has(path) };
}
