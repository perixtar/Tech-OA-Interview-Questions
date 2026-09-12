#!/usr/bin/env python3
"""Regression tests for deterministic question-bank pagination."""

import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import question_bank_pages as pages


def question_row(route: str, title_padding: str = "") -> str:
    url = f"https://www.fastprep.io/problems/{route}"
    return (
        f"|**Example**|[{route}{title_padding}]({url})|Coding|"
        f"[![Practice][p]]({url})|Jan 01, 2026|"
    )


def logical_content(rows: list[str]) -> str:
    return pages.render_logical_content(
        "# Test bank\n\n[p]: assets/practice-button.svg",
        rows,
    )


class QuestionBankPagesTest(unittest.TestCase):
    def test_render_and_reload_preserve_global_route_order(self) -> None:
        rows = [question_row(f"route-{index}", "x" * 80) for index in range(8)]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            rendered = pages.render_question_bank_pages(
                logical_content(rows),
                root=root,
                target_bytes=750,
                hard_limit_bytes=1_500,
            )

            self.assertGreater(len(rendered), 1)
            self.assertEqual(
                list(rendered),
                [
                    root / "README.md",
                    *[
                        root / "question-bank" / f"page-{number}.md"
                        for number in range(2, len(rendered) + 1)
                    ],
                ],
            )
            self.assertTrue(
                all(len(content.encode("utf-8")) <= 1_500 for content in rendered.values())
            )

            pages.write_generated_pages(rendered, [])
            loaded = pages.load_question_bank(root)
            self.assertEqual(list(loaded.rows), rows)
            self.assertEqual(
                pages.validate_unique_routes(loaded.rows, source="reloaded"),
                [
                    f"https://www.fastprep.io/problems/route-{index}"
                    for index in range(8)
                ],
            )

    def test_duplicate_route_across_pages_fails_closed(self) -> None:
        rows = [question_row(f"route-{index}", "x" * 80) for index in range(5)]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            rendered = pages.render_question_bank_pages(
                logical_content(rows),
                root=root,
                target_bytes=650,
                hard_limit_bytes=1_500,
            )
            pages.write_generated_pages(rendered, [])
            continuation = root / "question-bank" / "page-2.md"
            content = continuation.read_text(encoding="utf-8")
            content = content.replace(
                pages.BOTTOM_ANCHOR,
                rows[0] + "\n" + pages.BOTTOM_ANCHOR,
            )
            continuation.write_text(content, encoding="utf-8")

            with self.assertRaisesRegex(ValueError, "duplicate route"):
                pages.load_question_bank(root)

    def test_unmanaged_or_noncontiguous_continuation_pages_fail_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "README.md").write_text(
                logical_content([question_row("route-1")]),
                encoding="utf-8",
            )
            question_bank = root / "question-bank"
            question_bank.mkdir()
            (question_bank / "notes.md").write_text("unexpected\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "unmanaged Markdown file"):
                pages.load_question_bank(root)

            (question_bank / "notes.md").unlink()
            (question_bank / "page-3.md").write_text(
                pages.render_continuation_page(
                    3, [question_row("route-2")], has_next=False
                ),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(ValueError, "contiguous from page 2"):
                pages.load_question_bank(root)

    def test_single_row_over_hard_limit_fails_closed(self) -> None:
        oversized = question_row("route-1", "x" * 2_000)
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, "single row"):
                pages.render_question_bank_pages(
                    logical_content([oversized]),
                    root=Path(directory),
                    target_bytes=400,
                    hard_limit_bytes=800,
                )


if __name__ == "__main__":
    unittest.main()
