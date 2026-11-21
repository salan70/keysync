import json
import subprocess
import sys
import unittest
from pathlib import Path

GUARD = Path(__file__).resolve().parent / "nix_path_guard.py"


def run_guard(command):
    return subprocess.run(
        [sys.executable, str(GUARD)], input=json.dumps({"tool_input": {"command": command}}),
        text=True, capture_output=True,
    )


class NixPathGuardTest(unittest.TestCase):
    def test_path_reference_is_blocked(self):
        for command in (
            "nix develop path:.",
            "logrun nix develop path:/x --command pnpm test",
            'nix develop "path:$PWD"',
            "nix flake metadata path:.",
            "cd x && nix develop path:. -c true",
            "nix develop \\\n  path:. --command true",
            "FOO=1 nix develop path:.",
            "cd /x && nix develop path:.",
            'bash -c "nix develop path:."',
            'nix --extra-experimental-features "nix-command flakes" develop path:.',
            "nix develop --flake=path:. --command true",
            "timeout 60 nix develop path:. -c true",
            'nix develop path:. "',
        ):
            with self.subTest(command=command):
                result = run_guard(command)
                self.assertEqual(result.returncode, 2)
                self.assertIn("nix develop -c", result.stderr)

    def test_other_commands_pass(self):
        for command in (
            "nix develop --command pnpm test",
            'nix develop "git+file://$PWD"',
            'rg "path:" src',
            "pnpm exec tsx --define path:x",
            "nix develop --command true && rg path: src",
            "rg 'nix develop path:' docs tools",
            "nix develop --command rg path: src",
            "nix develop -c pnpm exec tsx --define path:x",
            "echo nix develop path:.",
            'git commit -m "docs: nix develop path: を禁止"',
            "nix develop --command true",
        ):
            with self.subTest(command=command):
                self.assertEqual(run_guard(command).returncode, 0)

    def test_broken_input_passes(self):
        result = subprocess.run([sys.executable, str(GUARD)], input="not json", text=True, capture_output=True)
        self.assertEqual(result.returncode, 0)


if __name__ == "__main__":
    unittest.main()
