import {
  extractImports,
  isNodeBuiltin,
  isRelative,
  resolveRelative,
  type Sources,
} from "./import-graph.ts";

/** 規則の例外。理由を必ず書き、違反が消えたら stale として落とす。 */
export interface Allowance {
  /** 違反しているファイル（repo root からの相対パス）。 */
  readonly file: string;
  /** 禁止先。解決したファイルのパス、または `node:fs` や `react` のような specifier。 */
  readonly target: string;
  readonly reason: string;
}

export interface RuleResult {
  /** 例外で許されなかった違反。違反の経路を 1 件 1 行で持つ。 */
  readonly violations: readonly string[];
  /** どの違反にも当たらなかった例外。 */
  readonly stale: readonly string[];
}

interface Violation {
  readonly file: string;
  readonly line: number;
  readonly specifier: string;
  readonly target: string;
  readonly rule: string;
}

const CORE_DIR = "src/core/";
const REACT = /^react(-dom)?(\/|$)/;

/** テストは Node の API と fixture を使ってよいので、境界の検査対象にしない。 */
export function isTestFile(path: string): boolean {
  return /\.test\.tsx?$/.test(path);
}

function coreFiles(sources: Sources): readonly string[] {
  return [...sources.keys()].filter((path) => path.startsWith(CORE_DIR) && !isTestFile(path));
}

/**
 * `src/core` の import 境界（ADR 0006）。`node:` 系、react、`src/core` の外への到達を禁止する。
 * 解決できない相対 import も違反にし、検査をすり抜ける経路を残さない。
 *
 * 経路は、どの core ファイルからも import されない入口から違反のあるファイルまでを出す。
 * export 連鎖（`export ... from`）も import と同じ辺として数える。
 */
export function checkCoreBoundary(sources: Sources, allowances: readonly Allowance[]): RuleResult {
  const files = coreFiles(sources);
  const importers = new Map<string, string[]>();
  const found: Violation[] = [];
  for (const file of files) {
    for (const { specifier, line } of extractImports(sources.get(file)!)) {
      if (isNodeBuiltin(specifier)) {
        found.push({
          file,
          line,
          specifier,
          target: specifier,
          rule: "Node.js の組み込みを使わない",
        });
      } else if (REACT.test(specifier)) {
        found.push({ file, line, specifier, target: specifier, rule: "React に依存しない" });
      } else if (isRelative(specifier)) {
        const { path, unresolved } = resolveRelative(file, specifier, sources);
        if (unresolved) {
          found.push({
            file,
            line,
            specifier,
            target: specifier,
            rule: "相対 import が解決できない",
          });
        } else if (path.startsWith(CORE_DIR)) {
          importers.set(path, [...(importers.get(path) ?? []), file]);
        } else {
          found.push({ file, line, specifier, target: path, rule: "src/core の外へ到達しない" });
        }
      }
    }
  }
  /** 循環していても止まるよう、経路に入った file は選ばない。 */
  const firstImporter = (file: string, chain: readonly string[]): string | undefined =>
    (importers.get(file) ?? []).filter((path) => !chain.includes(path)).sort()[0];
  return judge(found, allowances, (violation) => {
    const chain = [violation.file];
    let parent = firstImporter(violation.file, chain);
    while (parent !== undefined) {
      chain.unshift(parent);
      parent = firstImporter(parent, chain);
    }
    return `${chain.join(" → ")} → ${violation.target}`;
  });
}

const VIEW_FILE = /^src\/ui\/components\/.+\.tsx$/;

/** view（`src/ui/components` の描画部品）が import してはいけない場所。 */
function viewForbidden(target: string): string | undefined {
  if (target.startsWith("src/ui/state/use-")) return "接続層の hook を";
  if (target.startsWith("src/device/")) return "device モジュールを";
  if (target.startsWith("src/server/")) return "server モジュールを";
  return undefined;
}

export function viewFiles(sources: Sources): readonly string[] {
  return [...sources.keys()].filter((path) => VIEW_FILE.test(path) && !isTestFile(path));
}

/**
 * view の規約。view は接続層の hook（`src/ui/state/use-*`）と device / server モジュールを
 * import しない（型だけの import も同じ）。局所的な `useState` は import の制約の外なので許す。
 */
export function checkViewConvention(
  sources: Sources,
  allowances: readonly Allowance[],
): RuleResult {
  const found: Violation[] = [];
  for (const file of viewFiles(sources)) {
    for (const { specifier, line } of extractImports(sources.get(file)!)) {
      if (!isRelative(specifier)) continue;
      const { path, unresolved } = resolveRelative(file, specifier, sources);
      if (unresolved) {
        found.push({
          file,
          line,
          specifier,
          target: specifier,
          rule: "相対 import が解決できない",
        });
        continue;
      }
      const kind = viewForbidden(path);
      if (kind !== undefined) {
        found.push({
          file,
          line,
          specifier,
          target: path,
          rule: `view は ${kind} import しない`,
        });
      }
    }
  }
  return judge(found, allowances, (violation) => `${violation.file} → ${violation.target}`);
}

function judge(
  found: readonly Violation[],
  allowances: readonly Allowance[],
  route: (violation: Violation) => string,
): RuleResult {
  const used = new Set<Allowance>();
  const violations: string[] = [];
  for (const violation of found) {
    const allowance = allowances.find(
      (candidate) => candidate.file === violation.file && candidate.target === violation.target,
    );
    if (allowance !== undefined) {
      used.add(allowance);
    } else {
      violations.push(
        `${route(violation)}（${violation.file}:${violation.line} の import "${violation.specifier}": ${violation.rule}）`,
      );
    }
  }
  const stale = allowances
    .filter((allowance) => !used.has(allowance))
    .map((allowance) => `${allowance.file} → ${allowance.target}: ${allowance.reason}`);
  return { violations, stale };
}
