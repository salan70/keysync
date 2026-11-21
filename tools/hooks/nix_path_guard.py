#!/usr/bin/env python3
"""PreToolUse hook: `nix ... path:` を実行前に拒否する。

`path:` は gitignore 対象も含む worktree 全体を /nix/store へコピーする。
内容が変わるたびに別のコピーができ、ディスクを使い切る原因になる。
"""

import json
import os
import re
import shlex
import sys

SEGMENT = re.compile(r"[;&|\n]")
NIX = re.compile(r"(?<![\w./-])nix(?![\w-])")
SUBCOMMAND = re.compile(r"(?<![\w-])(develop|shell|run|print-dev-env|build|flake|eval|copy)(?![\w-])")
PATH_REF = re.compile(r"(?<![\w+.-])path:")

SEPARATOR_CHARS = set(";&|()")
WRAPPERS = {"logrun", "time", "env", "command", "exec", "nohup", "sudo", "nice", "timeout", "caffeinate", "builtin"}
SHELLS = {"bash", "sh", "zsh"}
ENV_ASSIGN = re.compile(r"^\w+=")
NUMBER = re.compile(r"^\d+(\.\d+)?[smhd]?$")
PATH_ARG = re.compile(r"(^|=)path:")
SHELL_C = re.compile(r"^-[a-z]*c[a-z]*$")
MAX_DEPTH = 3

MESSAGE = (
    "nix の path: 参照は worktree 全体（gitignore 対象の node_modules を含む）を /nix/store へコピーします。\n"
    "内容が変わるたびに別のコピーが増え、ディスクを使い切ります。\n"
    "代わりに次のどちらかを使ってください。\n"
    "  nix develop -c <コマンド>\n"
    '  nix develop "git+file://$PWD" -c <コマンド>\n'
)


def _coarse(command: str) -> bool:
    # 字句解析できないときの安全側の判定。同じ区間に nix と path: があれば拒否する。
    for segment in SEGMENT.split(command):
        if NIX.search(segment) and SUBCOMMAND.search(segment) and PATH_REF.search(segment):
            return True
    return False


def _segments(line: str) -> list[list[str]]:
    lexer = shlex.shlex(line, posix=True, punctuation_chars=True)
    lexer.commenters = ""
    lexer.whitespace_split = True
    segments: list[list[str]] = [[]]
    for token in lexer:
        if set(token) <= SEPARATOR_CHARS:
            segments.append([])
        else:
            segments[-1].append(token)
    return segments


def _blocked_segment(words: list[str], depth: int) -> bool:
    index = 0
    while index < len(words) and (
        ENV_ASSIGN.match(words[index])
        or words[index] in WRAPPERS
        or words[index].startswith("-")
        or NUMBER.match(words[index])
    ):
        index += 1
    if index >= len(words):
        return False
    head, args = os.path.basename(words[index]), words[index + 1 :]
    if head == "nix":
        for arg in args:
            if arg in ("--command", "-c", "--"):
                break
            if PATH_ARG.search(arg):
                return True
        return False
    if depth >= MAX_DEPTH:
        return False
    if head in SHELLS:
        for position, arg in enumerate(args[:-1]):
            if SHELL_C.match(arg):
                return _blocked(args[position + 1], depth + 1)
    elif head == "eval" and args:
        return _blocked(" ".join(args), depth + 1)
    return False


def _blocked(command: str, depth: int) -> bool:
    for line in command.replace("\\\n", " ").split("\n"):
        try:
            segments = _segments(line)
        except ValueError:
            return _coarse(line)
        if any(_blocked_segment(words, depth) for words in segments):
            return True
    return False


def blocked(command: str) -> bool:
    return _blocked(command, 0)


def main() -> int:
    try:
        command = json.load(sys.stdin).get("tool_input", {}).get("command", "")
    except (ValueError, AttributeError):
        return 0
    if isinstance(command, str) and blocked(command):
        sys.stderr.write(MESSAGE)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
