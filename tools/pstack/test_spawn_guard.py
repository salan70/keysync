import json
import subprocess
import sys
import unittest
from pathlib import Path

from tools.pstack import spawn_guard as g

ROOT = Path(__file__).resolve().parents[2]
TABLE = g.parse_table(
    'claude: high=opus (low-high, *medium), mid=sonnet (low-high, *medium), low=haiku (low-max, *xhigh)\n'
    'codex: high=sol (low-xhigh, *high), mid=terra (low-high, *medium), low=luna (low-max, *xhigh)\n'
    'devin: mid=swe-2-high (medium-max, *medium), low=swe-2-flash (medium-max, *medium)\n')


def agent(model=None, effort=None):
    tool_input = {'prompt': 'x'}
    if model is not None:
        tool_input['model'] = model
    if effort is not None:
        tool_input['effort'] = effort
    return g.check('Agent', tool_input, TABLE)


def delegate(model=None, options=None, table=TABLE):
    target = {}
    if model is not None:
        target['model'] = model
    if options is not None:
        target['options'] = options
    return g.check('mcp__t3-code__delegate_task', {'target': target}, table)


class ParseTest(unittest.TestCase):
    def test_parse(self):
        self.assertEqual(TABLE['claude']['haiku'], [('low', 'max')])
        self.assertEqual(TABLE['codex']['terra'], [('low', 'high')])

    def test_parse_devin(self):
        self.assertEqual(TABLE['devin']['swe-2-flash'], [('medium', 'max')])

    def test_real_rule_file(self):
        table = g.parse_table((ROOT / g.RULE).read_text(encoding='utf-8'))
        self.assertIn('opus', table['claude'])
        self.assertIn('fable', table['claude'])
        self.assertIn('luna', table['codex'])
        self.assertIn('swe-2-high', table['devin'])


class AgentTest(unittest.TestCase):
    def test_missing_model(self):
        self.assertIsNotNone(agent(None, 'medium'))

    def test_missing_effort(self):
        self.assertIsNotNone(agent('sonnet'))

    def test_sonnet_xhigh_blocked(self):
        self.assertIn('範囲外', agent('sonnet', 'xhigh'))

    def test_sonnet_medium_ok(self):
        self.assertIsNone(agent('sonnet', 'medium'))

    def test_haiku_xhigh_and_max_ok(self):
        self.assertIsNone(agent('haiku', 'xhigh'))
        self.assertIsNone(agent('haiku', 'max'))

    def test_opus_xhigh_blocked(self):
        self.assertIsNotNone(agent('opus', 'xhigh'))

    def test_unknown_model(self):
        reason = agent('fable', 'medium')
        self.assertIn('opus', reason)

    def test_any_version_of_a_family_passes(self):
        # 版番号は表で指定しない。家族名が含まれれば、将来の版も通す。
        self.assertIsNone(agent('claude-sonnet-9-0', 'High'))
        self.assertIsNone(agent('claude-opus-12-3', 'medium'))


class DelegateTest(unittest.TestCase):
    def test_dict_ok(self):
        self.assertIsNone(delegate('terra', {'reasoningEffort': 'medium'}))

    def test_array_xhigh_blocked(self):
        self.assertIsNotNone(delegate('terra', [{'id': 'reasoningEffort', 'value': 'xhigh'}]))

    def test_sol_xhigh_ok(self):
        self.assertIsNone(delegate('sol', {'reasoningEffort': 'xhigh'}))

    def test_luna_max_ok(self):
        self.assertIsNone(delegate('luna', [{'id': 'reasoningEffort', 'value': 'max'}]))

    def test_missing_effort(self):
        self.assertIsNotNone(delegate('terra'))
        self.assertIsNotNone(delegate('terra', [{'id': 'other', 'value': 'x'}]))

    def test_missing_model(self):
        self.assertIsNotNone(delegate(None, {'reasoningEffort': 'low'}))

    def test_codex_reasoning_effort(self):
        # orchestrator_capabilities で Codex の effort の option は reasoningEffort。
        self.assertIsNone(delegate('gpt-6.1-terra', {'reasoningEffort': 'medium'}))
        self.assertIsNone(delegate('gpt-6.1-terra', [{'id': 'reasoningEffort', 'value': 'high'}]))
        self.assertIn('範囲外', delegate('gpt-6.1-terra', {'reasoningEffort': 'xhigh'}))

    def test_codex_effort_key_blocked(self):
        # codex の行に一致した model では effort は認めず、reasoningEffort が要る。
        self.assertIn('reasoningEffort が未指定', delegate('terra', {'effort': 'medium'}))
        self.assertIn('reasoningEffort が未指定',
                      delegate('terra', [{'id': 'effort', 'value': 'medium'}]))

    def test_devin_thought_level(self):
        # Devin の effort の option は thought_level で、値は medium・high・max。
        self.assertIsNone(delegate('swe-2-high', {'thought_level': 'max'}))
        self.assertIsNone(delegate('swe-2-flash-medium', [{'id': 'thought_level', 'value': 'medium'}]))
        self.assertIn('範囲外', delegate('swe-2-high', {'thought_level': 'low'}))
        self.assertIn('thought_level が未指定', delegate('swe-2-high', {'mode': 'plan'}))

    def test_devin_other_option_keys_blocked(self):
        # devin の行に一致した model では effort と reasoningEffort を認めない。
        self.assertIn('thought_level が未指定', delegate('swe-2-high', {'effort': 'high'}))
        self.assertIn('thought_level が未指定', delegate('swe-2-high', {'reasoningEffort': 'high'}))

    def test_devin_fable_not_claimed_by_claude_row(self):
        # devin の model id は末尾に thought_level を持つ。claude の fable 行と option を名乗らせない。
        self.assertIn('表にありません', delegate('claude-fable-5-2-medium', {'effort': 'medium'}))
        self.assertIn('表にありません', delegate('claude-fable-5-2-medium', {'thought_level': 'medium'}))

    def test_devin_row_fable_uses_thought_level(self):
        # devin の行に claude-fable-5-2 があれば、devin の option（thought_level）を読む。
        table = g.merge_override(
            TABLE,
            'devin: mid=swe-2-high (medium-max, *medium), low=swe-2-flash (medium-max, *medium),'
            ' named=claude-fable-5-2 (low-max, *medium)\n')
        self.assertIsNone(delegate('claude-fable-5-2-medium', {'thought_level': 'medium'}, table))
        self.assertIn('thought_level が未指定',
                      delegate('claude-fable-5-2-medium', {'effort': 'medium'}, table))

    def test_name_must_start_at_a_boundary(self):
        # xopus が opus 行に当たらないよう、name の前は先頭か区切りに限る。
        self.assertIn('表にありません', delegate('xopus', {'effort': 'medium'}))
        self.assertIn('表にありません', delegate('xterra', {'reasoningEffort': 'medium'}))
        # gpt-6.1-terra のように版番号を前に持つ id は従来どおり当たる。
        self.assertIsNone(delegate('gpt-6.1-terra', {'reasoningEffort': 'medium'}))

    def test_agent_cannot_use_other_provider_model(self):
        # Agent は claude 専用。codex の model を effort で呼んでも止まる。
        self.assertIn('codex', agent(model='terra', effort='medium'))
        self.assertIsNone(agent(model='sonnet', effort='medium'))


class ForkTest(unittest.TestCase):
    def test_fork_is_blocked_even_with_model_and_effort(self):
        tool_input = {'subagent_type': 'fork', 'prompt': 'x', 'model': 'haiku', 'effort': 'low'}
        self.assertIn('fork', g.check('Agent', tool_input, TABLE))

    def test_other_subagent_type_is_checked_normally(self):
        tool_input = {'subagent_type': 'Explore', 'prompt': 'x', 'model': 'haiku', 'effort': 'low'}
        self.assertIsNone(g.check('Agent', tool_input, TABLE))


class MiscTest(unittest.TestCase):
    def test_other_tool_passes(self):
        self.assertIsNone(g.check('Bash', {'command': 'ls'}, TABLE))

    def test_override(self):
        merged = g.merge_override(TABLE, 'claude: mid=sonnet (low-xhigh, *medium)\nui: claude\n')
        self.assertIsNotNone(g.check('Agent', {'model': 'sonnet', 'effort': 'xhigh'}, TABLE))
        self.assertIsNone(g.check('Agent', {'model': 'sonnet', 'effort': 'xhigh'}, merged))
        self.assertIn('terra', merged['codex'])
        self.assertNotIn('opus', merged['claude'])


class MultiLevelTest(unittest.TestCase):
    def test_same_model_two_levels(self):
        table = g.parse_table(
            'claude: high=opus (low-high, *medium), mid=opus (low-medium, *medium), low=haiku (low-max, *xhigh)\n')
        self.assertEqual(table['claude']['opus'], [('low', 'high'), ('low', 'medium')])
        self.assertIsNone(g.check('Agent', {'model': 'opus', 'effort': 'high'}, table))
        reason = g.check('Agent', {'model': 'opus', 'effort': 'max'}, table)
        self.assertIn('範囲外', reason)
        self.assertIn('low から high、low から medium', reason)


class LevelOverrideTest(unittest.TestCase):
    def merged(self, text):
        return g.apply_level_models(g.merge_override(TABLE, text), text)

    def call(self, table, model, option, value):
        options = {} if value is None else {option: value}
        return g.check('mcp__t3-code__delegate_task',
                       {'target': {'model': model, 'options': options}}, table)

    def test_unknown_model_gets_full_range(self):
        table = self.merged('mid: codex:gpt-6-astra medium\n')
        self.assertIsNone(self.call(table, 'gpt-6-astra', 'reasoningEffort', 'medium'))
        self.assertIsNone(self.call(table, 'gpt-6-astra', 'reasoningEffort', 'max'))
        self.assertIsNotNone(self.call(table, 'gpt-6-astra', 'reasoningEffort', None))

    def test_known_model_range_not_widened(self):
        table = self.merged('mid: codex:terra medium\n')
        self.assertEqual(table['codex']['terra'], [('low', 'high')])
        self.assertIsNotNone(self.call(table, 'terra', 'reasoningEffort', 'xhigh'))

    def test_unlisted_model_blocked(self):
        table = self.merged('mid: codex:gpt-6-astra medium\n')
        self.assertIn('表にありません', self.call(table, 'gpt-9-unknown', 'reasoningEffort', 'medium'))

    def test_devin_level_line(self):
        table = self.merged('high: devin:gemini-4-neon-high high\n')
        self.assertIsNone(self.call(table, 'gemini-4-neon-high', 'thought_level', 'high'))

    def test_ui_line_changes_nothing(self):
        table = self.merged('ui: claude\n')
        self.assertEqual(table, TABLE)
        self.assertIsNotNone(g.check('Agent', {'model': 'sonnet', 'effort': 'xhigh'}, table))
        self.assertIsNone(g.check('Agent', {'model': 'sonnet', 'effort': 'medium'}, table))


class MainTest(unittest.TestCase):
    def run_main(self, stdin):
        return subprocess.run([sys.executable, str(ROOT / 'tools/pstack/spawn_guard.py')],
                              input=stdin, capture_output=True, text=True)

    def test_broken_json_fails_open(self):
        r = self.run_main('{not json')
        self.assertEqual(r.returncode, 0)
        self.assertIn('警告', r.stderr)

    def test_blocks_with_exit_2(self):
        r = self.run_main(json.dumps({'tool_name': 'Agent', 'tool_input': {'model': 'sonnet'}}))
        self.assertEqual(r.returncode, 2)
        self.assertIn('effort', r.stderr)


if __name__ == '__main__':
    unittest.main()
