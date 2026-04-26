"""Unit tests for setup_board.py's mobile/.env updater.

Note: _update_mobile_env was removed from setup_board.py — this test file is
retained for git history but the tests are skipped at import time.
"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

try:
    from setup_board import _update_mobile_env  # pyright: ignore[reportMissingImports, reportAttributeAccessIssue]
except ImportError:  # pragma: no cover — function was removed; skip suite
    raise unittest.SkipTest("_update_mobile_env no longer exists in setup_board.py")


class UpdateMobileEnvTests(unittest.TestCase):
    def _tmp_env(self, contents: str | None) -> Path:
        f = tempfile.NamedTemporaryFile("w", suffix=".env", delete=False)
        if contents is not None:
            f.write(contents)
        f.close()
        path = Path(f.name)
        if contents is None:
            path.unlink()  # simulate "file doesn't exist"
        self.addCleanup(lambda: path.unlink(missing_ok=True))
        return path

    def test_updates_existing_board_host(self):
        path = self._tmp_env("EXPO_PUBLIC_BOARD_HOST=1.1.1.1\n")
        _update_mobile_env(path, "2.2.2.2")
        self.assertEqual(path.read_text(), "EXPO_PUBLIC_BOARD_HOST=2.2.2.2\n")

    def test_preserves_other_lines_and_comments(self):
        original = (
            "# mobile env\n"
            "EXPO_PUBLIC_BOARD_HOST=1.1.1.1\n"
            "EXPO_PUBLIC_OTHER=keep-me\n"
        )
        path = self._tmp_env(original)
        _update_mobile_env(path, "9.9.9.9")
        self.assertEqual(
            path.read_text(),
            "# mobile env\nEXPO_PUBLIC_BOARD_HOST=9.9.9.9\nEXPO_PUBLIC_OTHER=keep-me\n",
        )

    def test_appends_when_key_missing(self):
        path = self._tmp_env("EXPO_PUBLIC_OTHER=keep-me\n")
        _update_mobile_env(path, "3.3.3.3")
        self.assertEqual(
            path.read_text(),
            "EXPO_PUBLIC_OTHER=keep-me\nEXPO_PUBLIC_BOARD_HOST=3.3.3.3\n",
        )

    def test_creates_file_when_missing(self):
        path = self._tmp_env(None)
        self.assertFalse(path.exists())
        _update_mobile_env(path, "4.4.4.4")
        self.assertEqual(path.read_text(), "EXPO_PUBLIC_BOARD_HOST=4.4.4.4\n")

    def test_noop_when_value_already_matches(self):
        path = self._tmp_env("EXPO_PUBLIC_BOARD_HOST=5.5.5.5\n")
        mtime_before = path.stat().st_mtime_ns
        _update_mobile_env(path, "5.5.5.5")
        self.assertEqual(path.stat().st_mtime_ns, mtime_before)
        self.assertEqual(path.read_text(), "EXPO_PUBLIC_BOARD_HOST=5.5.5.5\n")


if __name__ == "__main__":
    unittest.main()
