#!/usr/bin/env python3
"""Regression tests for compact question-table freshness updates."""

import shutil
import sys
import subprocess
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("refresh-freshness.py")
TABLE_HEADER = "| Company | OA / Interview Question | Format | Practice | Updated |"
TABLE_DIVIDER = "| :-- | :-- | :-- | :-: | :-- |"
BOTTOM_ANCHOR = '<a id="bottom"></a>'


class RefreshFreshnessTest(unittest.TestCase):
    def test_accepts_spaced_rows_and_emits_idempotent_compact_rows(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            scripts = root / "scripts"
            scripts.mkdir()
            copied_script = scripts / SCRIPT.name
            shutil.copy2(SCRIPT, copied_script)
            readme = root / "README.md"
            readme.write_text(
                "\n".join(
                    [
                        TABLE_HEADER,
                        TABLE_DIVIDER,
                        (
                            "| **Example** | [Question](https://www.fastprep.io/problems/example) "
                            "| Coding | [![Practice][p]](https://www.fastprep.io/problems/example) "
                            "| Jan 02, 2020 |"
                        ),
                        (
                            "|**Example**|[Older](https://www.fastprep.io/problems/older)|"
                            "Coding|[![Practice][p]](https://www.fastprep.io/problems/older)|Jan 01, 2020|"
                        ),
                        BOTTOM_ANCHOR,
                        "",
                    ]
                ),
                encoding="utf-8",
            )

            first = subprocess.run(
                [sys.executable, str(copied_script)],
                check=True,
                capture_output=True,
                text=True,
            )
            first_content = readme.read_text(encoding="utf-8")
            second = subprocess.run(
                [sys.executable, str(copied_script)],
                check=True,
                capture_output=True,
                text=True,
            )

            self.assertIn(
                "| **Example** | [Question](https://www.fastprep.io/problems/example) "
                "| Coding | [![Practice][p]](https://www.fastprep.io/problems/example) "
                "|Jan 02, 2020|",
                first_content,
            )
            self.assertEqual(readme.read_text(encoding="utf-8"), first_content)
            self.assertIn("refreshed markers on 0 row(s)", second.stdout)
            self.assertIn("reordered 0 row position(s)", second.stdout)
            self.assertIn("refreshed markers on 1 row(s)", first.stdout)


if __name__ == "__main__":
    unittest.main()
