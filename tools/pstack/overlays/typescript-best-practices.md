## Project overrides (keysync)

- このリポジトリに実行時のスキーマのライブラリは無い。\
  この規則のために足さず、外から来るデータは境界の parse 関数で型に変える。
- **Real tests** でも、実機、WebHID、launchd、keyd、sudo は動かさない。\
  test ではこれらに偽物を注入する（例: `src/cli/linux.test.ts`）。
- **Structured telemetry** の「`console.log` を使わない」は、CLI の出力には当てはめない。
- `src/core` は React、filesystem、WebHID に依存させない（`AGENTS.md` の「設計ルール」）。
