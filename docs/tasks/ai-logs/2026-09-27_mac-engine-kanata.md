# Mac の engine を Karabiner-Elements から kanata へ替える

2026-09-27。
利用者から、home mod のショートカットとしての反応が鈍いので調整したいと要望があった。
Karabiner では Cornix と同じ Permissive Hold を作れない（ADR 0048）ため、利用者は kanata への移行の検証を選んだ。
R-010 Spike で利用者が実機で確かめたあと、計画を plan mode で承認した。

## Fact

- `brew install --HEAD kanata` は 1 回目、別の brew のダウンロードの lock で失敗し、2 回目で入った（`HEAD-ac1ddb4`）。
- kanata の macOS のキー名のうち `prtsc` は無効だった。表の全キーを 1 つずつ `kanata --check` にかけて見つけ、表から外した。
- 生成器のテストは、kanata が PATH にある開発機でだけ `kanata --check` を通す。
- 利用者の workspace で `just mac generate` の生成物は `kanata --check` を通った。
- `just mac service` は、Karabiner の KeySync profile の `ignore` を読み、`karabinerGrabsBuiltIn: false` を返した。
- `just mac diff` は、kanata の設定ファイルがまだ無いので全部を追加の差分として出した。
- 計画では 4 commit に分ける予定だった。第 1 段階（生成器と検証の差し替え）だけでは、消す予定の Karabiner の適用のテストを一時的に直す必要が出た。engine を替える 1 つの判断なので、1 commit にまとめた。
- 使われなくなった fixture（`karabiner-devices.json`、`karabiner-legacy-profile.json`、`karabiner-no-owned-profile.json`）を消した。
- fixture の `desired.yaml` の `TG(3)` を `MO(3)` にした。kanata では `TG` を error にするため。

## Decision

ADR 0049 に記録した。
ADR 0047 と 0048 の状態欄に、0049 が上書きしたことを書いた。

## Open Question

- launchd から起動した kanata が、入力監視の許可を得て起動時から内蔵キーボードを掴めるか。利用者の `just mac service install` 待ちである。
- Web UI からの適用で、TCP の Reload が root なしで通るか。常駐の登録後に確かめる。
- 打鍵ログの `analyzeModTapOutput` が kanata の出力で正しく判定するか。
