# 依存境界はソース走査の構造検査で守り、UI は接続・表示値計算・純粋描画に分ける

状態: 採用

2026-11-22 に、ADR 0006 の「`src/core` は React、filesystem、WebHID を import しない」が文章だけで、機械的に守られていないことを確認して決めた。\
Issue は #28 である。

## 背景

ADR 0006 の境界は、`tsconfig.core.json` の `include` を `src/core` などに絞るだけで支えられていた。\
この分割は、`types: ["node"]` を持つ以上 `node:fs` の import を止められず、`src/ui` の絶対パスへの到達も `include` の外のファイルを辿れば検査を抜ける。\
現在の `src/core` に違反は無いが、違反が入ったときに気づく手段が無い。

UI は `src/ui/App.tsx`（接続）、`src/ui/*.ts`（表示値計算、約 25 本の純粋関数）、`src/ui/components`（描画）に分かれている。\
ただし描画の部品が hook や device / server の型を直接 import する箇所があり、「描画は表示値を受け取るだけ」という前提が部品ごとにまちまちである。\
この前提が揃わないと、表示値を props で受けて部品を単独で描く検査（視覚回帰など）を足せない。

## 選択肢

1. 規約を AGENTS.md やコメントで書くだけにする
2. ESLint や dependency-cruiser のような依存検査の道具を足す
3. `node:test` のソース走査テストで import の境界を検査する

## 決定

案 3 を採る。

### 違反を防ぐ階層と検証の置き場所

違反は、次の順に先に防ぐ。\
下の階層ほど、違反が起きてから気づく。

1. **コード**: 型と構造で、違反を書けないようにする（`src/core` の純粋関数、`ApplyState` の状態機械）
2. **lint と構造検査**: 書けてしまう違反を CI で落とす
3. **テストと実機**: 振る舞いを確かめる
4. **コメント**: 上の階層で防げないものだけに書く

検証は次のように住み分ける。

| 検証                 | 置き場所                     | 守るもの                       |
| -------------------- | ---------------------------- | ------------------------------ |
| lint、format         | pre-commit と CI             | 書き方、Markdown、フォーマット |
| ソース走査の構造検査 | `src/architecture/*.test.ts` | ファイルの間の import の向き   |
| 振る舞いテスト       | 各モジュールの `*.test.ts`   | 関数と部品が返す値             |
| 型検査               | `pnpm typecheck`             | 型の整合                       |

構造検査は import の文だけを見て、振る舞いを確かめない。\
逆に振る舞いテストは、import の向きを守る手段にならない。

### `src/core` の import 境界

`src/architecture/core-boundary.test.ts` が、`src/core` の非テストの全ファイルを走査する。\
次の import を違反とする。

- `node:` で始まる specifier と、`fs` や `path` のような `node:` 無しの組み込み
- `react` と `react-dom`
- 解決した先が `src/core` の外にある相対 import（`src/ui`、`src/device`、`src/server` など）
- 拡張子が `.ts` / `.tsx` の相対 import で、走査対象に無いもの（検査をすり抜けるため。`.js` など他の拡張子の未解決は対象にしない）

import は `.ts` 拡張子付きの相対 specifier で書かれているので、文字列の走査で解決できる。\
`export ... from` も同じ辺として数え、`src/core` を全件走査するので export の連鎖も検査に入る。\
違反は「どの core ファイルからも import されない入口 → … → 違反のあるファイル → 禁止先」の経路で報告する。

例外は、理由を付けた allowlist（`file` と `target`）で持つ。\
`typeOnly: true` の例外は `import type` / `export type` の違反にだけ当たり、値の import は違反のままにする。\
どの違反にも当たらなくなった例外は stale としてテストを落とし、消えた例外を残さない。\
現在の例外は無い。

テストファイル（`*.test.ts`）は Node の API と fixture を使うので、境界の対象にしない。

### view の規約

view は、`src/ui/components` の `*.tsx`（描画の部品）と定める。\
規約はファイル名ではなく import の制約で表す。

- view は `src/ui/state/use-*`、`src/device`、`src/server`、接続層（`src/ui/*Container.tsx` と `src/ui/App.tsx`）を import しない（型だけの import も同じ）
- `useState` のようなダイアログの開閉などの局所的な hook は、import の制約の外なので許す。\
  制約が import だけなので、機械的に検査できる
- `src/ui/*.ts` の表示値計算（既に純粋関数）は、改名も移動もしない。\
  `*.projection.ts` のような接尾辞は付けない

`src/architecture/view-convention.test.ts` が、この規約を同じ走査と allowlist、stale 検出で強制する。\
現在の例外は、規約の導入前から型だけを import している 6 件で、それぞれに理由を書いた。\
新しく足さない。

### 画面の 3 層

撮影や視覚回帰の対象にする画面を、段階的に次の 3 層へ分ける。

| 層         | 役割                                                        | 置き場所                  |
| ---------- | ----------------------------------------------------------- | ------------------------- |
| 接続       | hook の状態を集め、表示値計算へ渡し、描画へ callback を渡す | `src/ui/*Container.tsx`   |
| 表示値計算 | 状態から、描画が使う値（文言、行、状態）を作る純粋関数      | `src/ui/*-view.ts`        |
| 純粋描画   | 受け取った値と callback だけで描く。hook を import しない   | `src/ui/components/*.tsx` |

今回は Apply の確認 modal（`ApplyDialog`）を分けた。\
表示値は `buildApplyDialogView` が作り、`ApplyDialogContainer` が `useApply` と `App` の値をそれへ写し、`ApplyDialog` は値を描くだけにした。\
挙動と DOM は変えない。\
他の画面は、撮影の対象にする順に同じ形へ分ける。

## 理由

- 案 1 は、違反が入ったあとで人が気づくしかない。\
  ADR 0006 の境界が実際に文章だけで残っていた
- 案 2 は、足す依存と設定が、`import` の文を数えるだけの検査に対して重い。\
  `node:test` は既に全件を数秒で走らせており、全ファイルの走査も同じ時間に収まる
- `tsconfig` の分割は、含めるファイルを絞るだけで、`node:` の import を止められない。\
  構造検査がこの穴を補う
- view の規約を import に絞ると、規約が「hook を呼ばない」ではなく「hook のモジュールへ届かない」になり、`useState` を許しても機械検査できる
- 表示値計算を `src/ui/*.ts` のまま残すと、`@doc` のリンクと履歴を乱さず、規約はファイル名ではなく import で表せる

## 影響

- `src/core` に `node:` や `src/ui` の import を足すと CI が落ち、違反の経路が表示される。\
  外へ出る部分は `src/core` の外へ置く
- view に hook や protocol の型が欲しくなったら、表示値計算の `.ts` に型を置く。\
  allowlist に足さない
- 検査は文字列の走査なので、文の先頭にない `import` は拾わない。\
  文字列と template literal の中身はそのまま走査するため、行頭に書かれた `import` 風の文は文字列の中身でも拾う。\
  動的 `import()` は引用符の specifier だけを拾い、backtick の specifier は拾わない。\
  `ts-morph` のような構文木の道具は、この限界が実害になるまで足さない
- Node の global（`process.env`、`Buffer` など）は検査の対象外である。\
  `tsconfig.core.json` の `types: ["node"]` で型が付くので型検査でも止められず、import の走査にも現れない。\
  現在の `src/core` にこの使用は無い
- `tsconfig.cli.json` が `src/architecture` を含める。\
  構造検査は `node:fs` を使うので、`src/core` の外に置く
- Store（Elm 型）は導入しない。\
  ADR 0013 は `useReducer` を許容済みで、Apply の状態機械は `src/core/apply/plan.ts` で既に純粋である
