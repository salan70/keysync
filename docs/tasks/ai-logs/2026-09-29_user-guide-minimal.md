# 利用者ガイドを最低限に絞る

## 依頼

利用者向けのガイドを最低限の情報に絞り、認知負荷を減らす。

## 方針

- 画面が理由を表示する内容（ボタンを押せない理由の表など）は書かない
- 内部の仕組み（atomic write、fingerprint の計算、digest の意味、用語集）は書かない。必要なら ADR と specs が正本
- 同じ手順を複数のファイルに書かない。反映と復旧は `web-ui.md`、Mac の戻し方は `cli.md` に 1 つずつ置く
- `safe-apply.md` と `workspace-and-terms.md` は、残す内容を `README.md` と `web-ui.md` へ移して削除した

## 結果

利用者ガイドは 7 ファイル 1135 行から 5 ファイル 256 行になった。

## 未実施

- `concise-writing` の `check-prose.sh` は、dotfiles に見つからず実行していない
