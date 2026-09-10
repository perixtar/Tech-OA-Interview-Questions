#!/usr/bin/env python3
"""Focused regression tests for practice-format synchronization."""

import importlib.util
import shutil
import subprocess
import sys
import tempfile
import unittest
from collections import Counter
from datetime import date
from pathlib import Path


SCRIPT = Path(__file__).with_name("sync-practice-formats.py")
FRESHNESS_SCRIPT = Path(__file__).with_name("refresh-freshness.py")
SPEC = importlib.util.spec_from_file_location("sync_practice_formats", SCRIPT)
assert SPEC and SPEC.loader
sync = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(sync)


def readme_row(route: str, current_label: str = "Unknown") -> str:
    return "\n".join(
        [
            sync.TABLE_HEADER,
            sync.TABLE_DIVIDER,
            (
                "| Example | "
                f"[Question](https://www.fastprep.io/problems/{route}) | "
                f"{current_label} | "
                f"[Practice](https://www.fastprep.io/problems/{route}) | "
                "Jan 01, 2026 |"
            ),
            sync.BOTTOM_ANCHOR,
            "",
        ]
    )


def readme_with_formats() -> str:
    return "\n".join(
        [
            sync.FORMAT_LINKS_START,
            "<sub><b>Formats:</b> stale</sub>",
            sync.FORMAT_LINKS_END,
            sync.TABLE_HEADER,
            sync.TABLE_DIVIDER,
            (
                "| Example | [Coding](https://www.fastprep.io/problems/coding-one) "
                "| Coding | [Practice](https://www.fastprep.io/problems/coding-one) "
                "| Jan 02, 2026 |"
            ),
            (
                "| Example | [SQL](https://www.fastprep.io/problems/sql-one) "
                "| SQL | [Practice](https://www.fastprep.io/problems/sql-one) "
                "| Jan 01, 2026 |"
            ),
            sync.BOTTOM_ANCHOR,
            "",
        ]
    )


def managed_item(
    practice_format: str,
    route: str,
    title: str,
    companies: list[str],
    last_seen: list[str],
) -> dict:
    return {
        "practiceFormat": practice_format,
        "id": route,
        "href": f"/{sync.MANAGED_CATALOGS[practice_format].route_segment}/{route}",
        "title": title,
        "companies": companies,
        "lastSeen": last_seen,
    }


class SyncPracticeFormatsTest(unittest.TestCase):
    def test_missing_catalog_entry_uses_coding_route_fallback(self) -> None:
        updated, counts, catalog_missing = sync.sync_readme(
            readme_row("legacy-coding-problem"), {}
        )

        self.assertIn("| Coding |", updated)
        self.assertNotIn("| Unknown |", updated)
        self.assertEqual(counts, {"Coding": 1})
        self.assertEqual(catalog_missing, ["legacy-coding-problem"])

    def test_catalog_format_overrides_coding_route_fallback(self) -> None:
        updated, counts, catalog_missing = sync.sync_readme(
            readme_row("sql-problem", "Coding"), {"sql-problem": "SQL"}
        )

        self.assertIn("| SQL |", updated)
        self.assertEqual(counts, {"SQL": 1})
        self.assertEqual(catalog_missing, [])

    def test_legacy_practice_format_header_is_renamed(self) -> None:
        content = readme_row("coding-one", "Coding").replace(
            sync.TABLE_HEADER, sync.LEGACY_TABLE_HEADER
        )

        updated, _, _ = sync.sync_readme(content, {"coding-one": "Coding"})

        self.assertIn(sync.TABLE_HEADER, updated)
        self.assertNotIn(sync.LEGACY_TABLE_HEADER, updated)

    def test_format_links_include_only_formats_in_the_table(self) -> None:
        updated = sync.sync_format_links(
            readme_with_formats(), Counter({"Coding": 1_644, "SQL": 2})
        )

        self.assertIn("[Coding (1,644)](formats/coding.md)", updated)
        self.assertIn("[SQL (2)](formats/sql.md)", updated)
        self.assertNotIn("system-design.md", updated)

    def test_format_pages_contain_only_matching_rows(self) -> None:
        pages = sync.render_format_pages(
            readme_with_formats(), Counter({"Coding": 1, "SQL": 1})
        )
        coding = pages[sync.FORMATS_DIR / "coding.md"]
        sql = pages[sync.FORMATS_DIR / "sql.md"]

        self.assertIn("coding-one", coding)
        self.assertNotIn("sql-one", coding)
        self.assertIn("sql-one", sql)
        self.assertNotIn("coding-one", sql)
        self.assertIn(
            "| Company | OA / Interview Question | Practice | Updated |", coding
        )
        self.assertNotIn("| Format |", coding)

    def test_managed_catalogs_add_design_and_ai_coding_rows(self) -> None:
        catalogs = {
            "system_design": [
                managed_item(
                    "system_design",
                    "design-feed",
                    "Design a Feed",
                    ["Meta"],
                    ["2026-07-28"],
                )
            ],
            "low_level_design": [
                managed_item(
                    "low_level_design",
                    "design-parking-lot",
                    "Design a Parking Lot",
                    ["Amazon"],
                    ["2026-07-27"],
                )
            ],
            "project_coding": [
                managed_item(
                    "project_coding",
                    "repair-api",
                    "Repair an API",
                    ["Anthropic"],
                    ["2026-07-26"],
                )
            ],
        }
        managed_rows = sync.build_managed_rows(catalogs)

        updated, counts, _ = sync.sync_readme(
            readme_with_formats(),
            {"coding-one": "Coding", "sql-one": "SQL"},
            managed_rows=managed_rows,
            sync_date=date(2026, 7, 31),
        )

        self.assertIn("https://www.fastprep.io/system-design/design-feed", updated)
        self.assertIn(
            "https://www.fastprep.io/low-level-design/design-parking-lot", updated
        )
        self.assertIn("https://www.fastprep.io/project-coding/repair-api", updated)
        self.assertEqual(counts["System design"], 1)
        self.assertEqual(counts["Low-level design"], 1)
        self.assertEqual(counts["AI coding"], 1)

    def test_missing_public_attribution_uses_factual_fallbacks(self) -> None:
        managed_rows = sync.build_managed_rows(
            {
                "system_design": [
                    managed_item(
                        "system_design",
                        "general-design",
                        "General Design Exercise",
                        [],
                        [],
                    )
                ]
            }
        )

        updated, _, _ = sync.sync_readme(
            readme_with_formats(),
            {"coding-one": "Coding", "sql-one": "SQL"},
            managed_rows=managed_rows,
            sync_date=date(2026, 7, 31),
        )

        self.assertIn("| **Unattributed** |", updated)
        self.assertIn("| 🔥 Jul 31, 2026 |", updated)

    def test_missing_sighting_date_preserves_the_first_sync_date(self) -> None:
        content = readme_row("general-design", "System design").replace(
            "/problems/", "/system-design/"
        )
        managed_rows = sync.build_managed_rows(
            {
                "system_design": [
                    managed_item(
                        "system_design",
                        "general-design",
                        "General Design Exercise",
                        [],
                        [],
                    )
                ]
            }
        )

        updated, counts, _ = sync.sync_readme(
            content,
            {},
            managed_rows=managed_rows,
            sync_date=date(2026, 7, 31),
        )

        self.assertEqual(updated.count("/system-design/general-design"), 2)
        self.assertIn("| Jan 01, 2026 |", updated)
        self.assertEqual(counts["System design"], 1)

    def test_sync_compacts_favicons_to_keep_the_readme_renderable(self) -> None:
        content = readme_row("coding-one", "Coding").replace(
            "| Example |",
            (
                '| <img src="https://www.google.com/s2/favicons?domain=example.com&sz=16"> '
                "**Example** |"
            ),
        )

        updated, _, _ = sync.sync_readme(content, {"coding-one": "Coding"})

        self.assertIn("| **Example** |", updated)
        self.assertNotIn("<img", updated)

    def test_managed_catalog_companies_are_added_to_company_list(self) -> None:
        content = "\n".join(
            [
                "… + 99 more companies in the table below ↓",
                "<details>",
                "<summary><b>🏢 Full company list (2+) — click to expand</b></summary>",
                "<br/>",
                "Amazon, Meta.",
                "</details>",
                "",
            ]
        )
        managed_rows = sync.build_managed_rows(
            {
                "system_design": [
                    managed_item(
                        "system_design",
                        "design-feed",
                        "Design a Feed",
                        ["Meta", "New Company"],
                        ["2026-07-28"],
                    )
                ]
            }
        )

        updated = sync.sync_company_list(content, managed_rows)

        self.assertIn("Full company list (3+)", updated)
        self.assertIn("Amazon, Meta, New Company.", updated)
        self.assertIn("… + 0 more companies in the table below ↓", updated)

    def test_company_list_is_case_insensitive_comma_safe_and_idempotent(self) -> None:
        content = "\n".join(
            [
                "… + 99 more companies in the table below ↓",
                "<details>",
                "<summary><b>🏢 Full company list (4+) — click to expand</b></summary>",
                "<br/>",
                "Amazon, Inc., Infosys, Nike.",
                "</details>",
                "",
            ]
        )
        managed_rows = sync.build_managed_rows(
            {
                "system_design": [
                    managed_item(
                        "system_design",
                        "design-shoes",
                        "Design a Shoe Store",
                        ["infosys", "Nike, Inc."],
                        ["2026-07-28"],
                    )
                ]
            }
        )

        updated = sync.sync_company_list(content, managed_rows)

        self.assertIn("Full company list (3+)", updated)
        self.assertIn("Amazon, Infosys, Nike&#44; Inc.", updated)
        self.assertNotIn("infosys", updated)
        self.assertEqual(sync.sync_company_list(updated, managed_rows), updated)

    def test_refresh_freshness_accepts_spaced_and_compact_date_cells(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            scripts = root / "scripts"
            scripts.mkdir()
            copied_script = scripts / FRESHNESS_SCRIPT.name
            shutil.copy2(FRESHNESS_SCRIPT, copied_script)
            readme = root / "README.md"
            readme.write_text(
                "\n".join(
                    [
                        sync.TABLE_HEADER,
                        sync.TABLE_DIVIDER,
                        (
                            "| **Example** | [Question](https://www.fastprep.io/problems/example) "
                            "| Coding | [![Practice][p]](https://www.fastprep.io/problems/example) "
                            "| Jan 02, 2020 |"
                        ),
                        (
                            "|**Example**|[Older](https://www.fastprep.io/problems/older)|"
                            "Coding|[![Practice][p]](https://www.fastprep.io/problems/older)|Jan 01, 2020|"
                        ),
                        sync.BOTTOM_ANCHOR,
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
            self.assertIn("refreshed markers on 1 row(s)", first.stdout)
            self.assertIn("refreshed markers on 0 row(s)", second.stdout)
            self.assertIn("reordered 0 row position(s)", second.stdout)


if __name__ == "__main__":
    unittest.main()
