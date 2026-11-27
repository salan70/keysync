"""pstack のモデルの割り当てを、git 管理外のファイルで上書きする。

実体は git の共通ディレクトリ（すべての worktree が共有する .git）に 1 つだけ置く。
Claude Code は SessionStart のフック（.claude/settings.json）が `show` の出力を毎回読み込む。
"""
from pathlib import Path
import re
import subprocess

NAME = 'pstack-models.local.md'
GLOBAL_NAME = 'pstack-models.md'
KEY = re.compile(r'[a-z][a-z0-9 ,.-]*')
TEMPLATE = """\
# pstack のモデルのローカル上書き。git 管理外で、すべての worktree が共有する。
# 何も書かなければ、マシン共通（~/.config/pstack/pstack-models.md）、次に .claude/rules/pstack-models.md の値を使う。
# 書いた行だけが、同じ名前の行を置き換える。会話中の利用者の指示はこのファイルより優先する。
# 設定できる名前の例を次に示す（行頭の # を外して値を書く）。
#   provider: thread（スレッドを始めたモデルの provider）、claude、codex のいずれか。
#   cross-provider: on のときだけ、パネルともう一方の provider への委譲を使う。
#   ui: UI を担当するモデル（例: claude:opus low）。
# 変更は `python3 tools/pstack/pstack.py models set <名前> <値>` か、このファイルを直接直す。
"""
GLOBAL_TEMPLATE = """\
# pstack のモデルのマシン共通上書き。git 管理外で、このマシンのすべてのリポジトリに効く。
# 書いた行だけが .claude/rules/pstack-models.md の同じ名前の行を置き換える。
# リポジトリのローカル上書きと会話中の利用者の指示は、このファイルより優先する。
# 変更は `python3 tools/pstack/pstack.py models set --global <名前> <値>` か、このファイルを直接直す。
"""
HEADER = ('# Local model override (git-ignored, shared by every worktree): {path}\n'
          '# Lines here replace the lines with the same name in .claude/rules/pstack-models.md.\n')
GLOBAL_HEADER = ('# Machine-wide model override (git-ignored, applies to every repository on this machine): {path}\n'
                 '# Lines here are read before the local override; the local override wins on lines with the same name.\n')


def _git(checkout, *args):
    return subprocess.run(['git', '-C', str(checkout), *args], check=True,
                          capture_output=True, text=True).stdout.strip()


def common_file(checkout):
    common = _git(checkout, 'rev-parse', '--path-format=absolute', '--git-common-dir')
    return Path(common) / NAME


def machine_file():
    return Path.home() / '.config' / 'pstack' / GLOBAL_NAME


def ensure(target):
    """実体が無ければ雛形で作る。"""
    if not target.exists():
        target.write_text(TEMPLATE, encoding='utf-8')
    return target


def ensure_machine(target):
    """マシン共通ファイルが無ければ、コメントだけの雛形で作る。"""
    if not target.exists():
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(GLOBAL_TEMPLATE, encoding='utf-8')
    return target


def show(checkout, target=None, machine_target=None):
    """セッションの文脈に入れる本文を返す。"""
    target = ensure(Path(target) if target else common_file(Path(checkout)))
    machine = Path(machine_target) if machine_target else machine_file()
    body = ''
    if machine.exists():
        body += GLOBAL_HEADER.format(path=machine) + machine.read_text(encoding='utf-8')
        if not body.endswith('\n'):
            body += '\n'
    return body + HEADER.format(path=target) + target.read_text(encoding='utf-8')


def _set_value(target, key, value):
    lines = target.read_text(encoding='utf-8').splitlines()
    line = f'{key}: {value}'
    for index, current in enumerate(lines):
        if not current.startswith('#') and current.split(':', 1)[0].strip() == key:
            lines[index] = line
            break
    else:
        lines.append(line)
    target.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    return dict(target=str(target), line=line)


def _valid(key, value):
    key, value = key.strip(), ' '.join(value.split())
    if not KEY.fullmatch(key) or not value:
        raise ValueError('Use a role or setting name such as "ui" or "cross-provider", and a value')
    return key, value


def set_value(checkout, key, value, target=None):
    """`<key>: <value>` の行をローカル上書きで置き換え、無ければ末尾に足す。"""
    key, value = _valid(key, value)
    target = ensure(Path(target) if target else common_file(Path(checkout)))
    return _set_value(target, key, value)


def set_global_value(key, value, target=None):
    """`<key>: <value>` の行をマシン共通上書きで置き換え、無ければ末尾に足す。"""
    key, value = _valid(key, value)
    target = ensure_machine(Path(target) if target else machine_file())
    return _set_value(target, key, value)
