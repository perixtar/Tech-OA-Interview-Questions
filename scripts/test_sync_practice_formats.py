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
sys.modules[SPEC.name] = sync
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

        self.assertIn("|Coding|", updated)
        self.assertNotIn("|Unknown|", updated)
        self.assertIn(
            "|Example|[Question](https://www.fastprep.io/problems/legacy-coding-problem)|"
            "Coding|[Practice](https://www.fastprep.io/problems/legacy-coding-problem)|"
            "Jan 01, 2026|",
            updated,
        )
        self.assertEqual(counts, {"Coding": 1})
        self.assertEqual(catalog_missing, ["legacy-coding-problem"])
        self.assertEqual(
            sync.sync_readme(updated, {})[0],
            updated,
        )

    def test_catalog_format_overrides_coding_route_fallback(self) -> None:
        updated, counts, catalog_missing = sync.sync_readme(
            readme_row("sql-problem", "Coding"), {"sql-problem": "SQL"}
        )

        self.assertIn("|SQL|", updated)
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

    def test_format_pages_use_the_same_byte_bounded_pagination(self) -> None:
        rows = []
        for index in range(8):
            route = f"coding-{index}"
            url = f"https://www.fastprep.io/problems/{route}"
            rows.append(
                f"|**Example**|[{route}{'x' * 80}]({url})|Coding|"
                f"[![Practice][p]]({url})|Jan 01, 2026|"
            )
        content = "\n".join(
            [
                sync.TABLE_HEADER,
                sync.TABLE_DIVIDER,
                *rows,
                sync.BOTTOM_ANCHOR,
                "",
            ]
        )

        rendered = sync.render_format_pages(
            content,
            Counter({"Coding": len(rows)}),
            target_bytes=700,
            hard_limit_bytes=1_500,
        )

        self.assertGreater(len(rendered), 1)
        self.assertEqual(
            list(rendered),
            [
                sync.FORMATS_DIR / "coding.md",
                *[
                    sync.FORMATS_DIR / f"coding-page-{number}.md"
                    for number in range(2, len(rendered) + 1)
                ],
            ],
        )
        combined = "\n".join(rendered.values())
        for route in [f"coding-{index}" for index in range(8)]:
            self.assertEqual(combined.count(f"/problems/{route})"), 2)

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

        self.assertIn("|**Unattributed**|", updated)
        self.assertIn("|🔥 Jul 31, 2026|", updated)

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
        self.assertIn("|Jan 01, 2026|", updated)
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

        self.assertIn("|**Example**|", updated)
        self.assertNotIn("<img", updated)

    def test_sync_omits_protected_numeric_alias_rows(self) -> None:
        content = "\n".join(
            [
                sync.TABLE_HEADER,
                sync.TABLE_DIVIDER,
                (
                    "| **Example** | "
                    "[Protected](https://www.fastprep.io/problems/1.protected) | "
                    "Coding | "
                    "[Practice](https://www.fastprep.io/problems/1.protected) | "
                    "Jan 02, 2026 |"
                ),
                (
                    "| **Example** | "
                    "[Public](https://www.fastprep.io/problems/public.slug) | "
                    "Coding | "
                    "[Practice](https://www.fastprep.io/problems/public.slug) | "
                    "Jan 01, 2026 |"
                ),
                sync.BOTTOM_ANCHOR,
                "",
            ]
        )

        updated, counts, catalog_missing = sync.sync_readme(
            content,
            {"1.protected": "Coding", "public.slug": "Coding"},
        )

        self.assertNotIn("1.protected", updated)
        self.assertIn("/problems/public.slug", updated)
        self.assertEqual(counts, {"Coding": 1})
        self.assertEqual(catalog_missing, [])

    def test_managed_rows_use_compact_rendering(self) -> None:
        row = sync.build_managed_rows(
            {
                "system_design": [
                    managed_item(
                        "system_design",
                        "design-feed",
                        "Design a Feed",
                        ["Meta"],
                        ["2026-07-28"],
                    )
                ]
            }
        )["https://www.fastprep.io/system-design/design-feed"]

        rendered = sync.render_managed_row(
            row,
            existing_date=None,
            sync_date=date(2026, 7, 31),
        )

        self.assertEqual(
            rendered,
            "|**Meta**|[Design a Feed](https://www.fastprep.io/system-design/design-feed)|"
            "System design|[![Practice][p]](https://www.fastprep.io/system-design/design-feed)|"
            "🔥 Jul 28, 2026|",
        )

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
            shutil.copy2(
                FRESHNESS_SCRIPT.with_name("question_bank_pages.py"),
                scripts / "question_bank_pages.py",
            )
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
                            "|**Example**|[Same Date](https://www.fastprep.io/problems/same-date)|"
                            "Coding|[![Practice][p]](https://www.fastprep.io/problems/same-date)|Jan 02, 2020|"
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
            self.assertLess(
                first_content.index("/problems/example)"),
                first_content.index("/problems/same-date)"),
            )
            self.assertEqual(readme.read_text(encoding="utf-8"), first_content)
            self.assertIn("refreshed markers on 1 row(s)", first.stdout)
            self.assertIn("refreshed markers on 0 row(s)", second.stdout)
            self.assertIn("reordered 0 row position(s)", second.stdout)


if __name__ == "__main__":
    unittest.main()
