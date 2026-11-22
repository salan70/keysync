#!/usr/bin/env python3
"""サブエージェントの spawn 前に model と effort を確かめる PreToolUse hook。

stdin の hook JSON を読み、model と effort が未指定、または表の範囲外なら exit 2 で止める。
範囲の表は .claude/rules/pstack-models.md と、git 管理外の pstack-models.local.md から読む。
表は {provider: {model: [(下限, 上限), ...]}} とし、同じ model が複数のレベルにあれば範囲を足す。
effort は、どれか 1 つの範囲に入れば通す。
上書きの `claude:` `codex:` `devin:` の行は、同じ名前の行を丸ごと置き換える。
上書きのレベル指定行（例: `mid: codex:gpt-6-astra medium`）は、model が表にないときだけ、
その model を全範囲（low から max）で表に加える。表にある model の範囲は広げない。
T3 の delegate_task は provider ごとに effort の option の名前が違う（PROVIDER_EFFORT_OPTION）。
一致した行の provider の option だけを読む。ほかの provider の option 名を渡しても
effort の未指定として止める（例: codex に effort を渡しても reasoningEffort が要る）。
Claude Code の fork は親の model と effort を継ぎ、指定しても無視されるので止める。
内部の例外では止めず、警告だけ出して exit 0 にする（fail open）。
"""
import json
import re
import subprocess
import sys
from pathlib import Path

ORDER = ['low', 'medium', 'high', 'xhigh', 'max']
TARGETS = ('Agent', 'mcp__t3-code__delegate_task')
LOCAL_NAME = 'pstack-models.local.md'
ENTRY = re.compile(r'([a-z]+)=([a-z0-9.-]+)\s*\(\s*([a-z]+)\s*-\s*([a-z]+)\s*,\s*\*([a-z]+)\s*\)')
RULE = '.claude/rules/pstack-models.md'
PROVIDERS = 'claude|codex|devin'
LEVEL_LINE = re.compile(rf'^\s*(?:high|mid|low):\s*({PROVIDERS}):(\S+)')
# orchestrator_capabilities の option id。Claude は effort、Codex は reasoningEffort、Devin は thought_level。
# 一致した行の provider の option だけを認め、ほかの provider の名前では effort を渡せない。
PROVIDER_EFFORT_OPTION = {'claude': 'effort', 'codex': 'reasoningEffort', 'devin': 'thought_level'}
# devin の model id は末尾に thought_level を持つ（swe-2-flash-medium、claude-fable-5-2-medium）。
# claude-fable-5-2-medium が当たる devin 行は既定の表にはなく、上書きで devin 行を足した場合だけ。
# devin の行は部分一致のままにし、claude と codex の行は後ろが版番号の続きのときだけ一致とする。
LOOSE_PROVIDERS = {'devin'}
VERSION_TAIL = re.compile(r'(?:-[\d.]+)*$')


def parse_table(text):
    """provider の行を {provider: {model: [(下限, 上限), ...]}} に解析する。"""
    table = {}
    for line in text.splitlines():
        m = re.match(rf'\s*({PROVIDERS}):(.*)', line)
        if not m:
            continue
        entries = {}
        for e in ENTRY.findall(m.group(2)):
            entries.setdefault(e[1], []).append((e[2], e[3]))
        if entries:
            table[m.group(1)] = entries
    return table


def merge_override(base, override_text):
    """上書きの行が、同じ名前の行を丸ごと置き換える。"""
    merged = dict(base)
    merged.update(parse_table(override_text))
    return merged


def apply_level_models(table, override_text):
    """レベル指定行の model が表にないときだけ、全範囲で表に加える（既存の範囲は広げない）。"""
    result = {provider: dict(entries) for provider, entries in table.items()}
    for line in override_text.splitlines():
        m = LEVEL_LINE.match(line)
        if m and find_model(result, m.group(2)) is None:
            result.setdefault(m.group(1), {})[m.group(2).lower()] = [(ORDER[0], ORDER[-1])]
    return result


def normalize_effort(value):
    if not isinstance(value, str):
        return None
    value = value.strip().lower()
    return value if value in ORDER else None


def extract_effort_option(options, option):
    """options から provider の option の値を取る。options は辞書と、{id, value} の配列の両方を受け付ける。"""
    if isinstance(options, dict):
        return options.get(option)
    if isinstance(options, list):
        for item in options:
            if isinstance(item, dict) and item.get('id') == option:
                return item.get('value')
    return None


def find_model(table, model):
    """model が一致した行の (provider, name, ranges) を返す。複数一致では長い name を優先する。

    claude と codex の行は、name の後ろが版番号の続き（-5-2 など）だけで終わるときだけ一致とする。
    そうしないと devin の claude-fable-5-2-medium が claude の fable 行を名乗り、
    claude の option（effort）で止めずに通ってしまう。
    """
    lowered = model.lower()
    best = None
    for provider, entries in table.items():
        for name, ranges in entries.items():
            index = lowered.find(name)
            if index < 0:
                continue
            # xopus が opus 行に当たらないよう、name の前は先頭か区切り（非英数字）に限る。
            # gpt-6.1-terra のように版番号を前に持つ id は - で続くので通る。
            if index > 0 and lowered[index - 1].isalnum():
                continue
            if provider not in LOOSE_PROVIDERS and not VERSION_TAIL.match(lowered, index + len(name)):
                continue
            if best is None or len(name) > len(best[1]):
                best = (provider, name, ranges)
    return best


def known_models(table):
    return sorted({name for entries in table.values() for name in entries})


def extract(tool_name, tool_input):
    """(model, options) を返す。対象外なら None。

    Agent の options は effort の値そのもの、delegate_task の options は provider を見てから
    extract_effort_option で読む options の本体。
    """
    if tool_name == 'Agent':
        return tool_input.get('model'), tool_input.get('effort')
    if tool_name == 'mcp__t3-code__delegate_task':
        target = tool_input.get('target') or {}
        return target.get('model'), target.get('options')
    return None


def check(tool_name, tool_input, table):
    """止める理由（日本語）を返す。通すなら None。"""
    tool_input = tool_input if isinstance(tool_input, dict) else {}
    got = extract(tool_name, tool_input)
    if got is None:
        return None
    if tool_name == 'Agent' and tool_input.get('subagent_type') == 'fork':
        return ('fork は親の model と effort を継ぎ、指定しても無視されます。'
                f'fork を使わず、model と effort を明示した subagent で spawn し直してください（規則は {RULE}）。')
    model, options = got
    fix = f'effort を明示して spawn し直してください（規則は {RULE}）。'
    if not isinstance(model, str) or not model.strip():
        return (f'model が未指定です。継承に任せず、model を明示してください。'
                f'既知の model: {", ".join(known_models(table))}。{fix}')
    found = find_model(table, model)
    if found is None:
        return (f'model「{model}」は表にありません。既知の model: {", ".join(known_models(table))}。'
                f'表にある model を明示して spawn し直してください（規則は {RULE}）。')
    provider, name, ranges = found
    if tool_name == 'Agent' and provider != 'claude':
        return (f'model「{model}」は {provider} の model で、Agent では使えません。'
                f'Agent では claude の model と effort を明示してください（規則は {RULE}）。')
    if tool_name == 'Agent':
        option, raw_effort = 'effort', options
    else:
        option = PROVIDER_EFFORT_OPTION[provider]
        raw_effort = extract_effort_option(options, option)
    spans = '、'.join(f'{low} から {high}' for low, high in ranges)
    scope = f'{name} の {option} の範囲は {spans} です。'
    fix = f'{option} を明示して spawn し直してください（規則は {RULE}）。'
    if raw_effort is None or (isinstance(raw_effort, str) and not raw_effort.strip()):
        return f'{option} が未指定です。{scope}{fix}'
    effort = normalize_effort(raw_effort)
    if effort is None:
        return f'{option}「{raw_effort}」を解釈できません。{scope}{fix}'
    if not any(ORDER.index(low) <= ORDER.index(effort) <= ORDER.index(high) for low, high in ranges):
        return f'{option}「{effort}」は {name} の範囲外です。{scope}{fix}'
    return None


def read_tables():
    root = Path(__file__).resolve().parents[2]
    table = parse_table((root / RULE).read_text(encoding='utf-8'))
    try:
        common = subprocess.run(
            ['git', '-C', str(root), 'rev-parse', '--path-format=absolute', '--git-common-dir'],
            check=True, capture_output=True, text=True).stdout.strip()
        local = Path(common) / LOCAL_NAME
        if local.exists():
            override = local.read_text(encoding='utf-8')
            table = apply_level_models(merge_override(table, override), override)
    except (subprocess.SubprocessError, OSError):
        pass
    return table


def main():
    try:
        payload = json.load(sys.stdin)
        tool_name = payload.get('tool_name')
        if tool_name not in TARGETS:
            return 0
        reason = check(tool_name, payload.get('tool_input') or {}, read_tables())
    except Exception as exc:  # fail open: 内部の失敗で全 spawn を止めない
        print(f'spawn_guard: 警告: 判定に失敗したので通します（{exc!r}）', file=sys.stderr)
        return 0
    if reason:
        print(f'spawn を止めました。{reason}', file=sys.stderr)
        return 2
    return 0


if __name__ == '__main__':
    sys.exit(main())
