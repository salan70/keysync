import { createServer, type ViteDevServer } from "vite";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

const ROOT = new URL("../../../", import.meta.url).pathname;

/**
 * React コンポーネントを node 上で `renderToStaticMarkup` するための読み込み口。
 *
 * コンポーネントは Vite の機能（`import.meta.glob`、`?raw`）と JSX に依存するため、`node` 単体では
 * 読めない。Vite の SSR 変換（`ssrLoadModule`）で読み、依存を増やさずに済ませる。
 * HTTP は待ち受けない（middlewareMode）。react / react-dom は node の通常の解決で読まれるため、
 * テスト側の `renderToStaticMarkup` と同じ React を共有する。
 */
export async function createComponentLoader(): Promise<{
  readonly load: <T = Record<string, unknown>>(path: string) => Promise<T>;
  readonly close: () => Promise<void>;
}> {
  const server: ViteDevServer = await createServer({
    root: ROOT,
    configFile: false,
    logLevel: "silent",
    appType: "custom",
    esbuild: { jsx: "automatic" },
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  return {
    load: (path) => server.ssrLoadModule(path) as never,
    close: () => server.close(),
  };
}

/**
 * 要素を静的 HTML にし、タグの境界で改行する。1 行の HTML は差分で読めないため。
 *
 * SSR は effect を実行せず、DOM の実測（盤面の倍率、`FitText` の縮小）も行わない。
 * 比べられるのは**構造**（要素、class、属性、文言）であって、寸法や文字の収まりではない。
 */
export function markup(element: ReactElement): string {
  return `${renderToStaticMarkup(element).replace(/></g, ">\n<")}\n`;
}
