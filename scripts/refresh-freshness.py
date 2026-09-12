#!/usr/bin/env python3
"""Refresh markers and stable newest-first ordering across question-bank pages.

Rows updated within the last 14 days get a fire marker, within 45 days a new
marker, and older rows get none. The shared paginator keeps README.md and every
continuation page below the repository's byte limits.
"""

import re
import sys
from datetime import date
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from question_bank_pages import (
    BOTTOM_ANCHOR,
    ROOT,
    TABLE_HEADER,
    load_question_bank,
    render_question_bank_pages,
    stale_generated_paths,
    write_generated_pages,
)

FIRE_DAYS, NEW_DAYS = 14, 45
PRACTICE_BUTTON = "[![Practice][p]]"
PRACTICE_URL = re.compile(
    r"https://www\.fastprep\.io/"
    r"(?:problems|system-design|low-level-design|project-coding)/[^)\s]+"
)
MONTHS = {
    month: index + 1
    for index, month in enumerate(
        [
            "Jan",
            "Feb",
            "Mar",
            "Apr",
            "May",
            "Jun",
            "Jul",
            "Aug",
            "Sep",
            "Oct",
            "Nov",
            "Dec",
        ]
    )
}
CELL = re.compile(
    r"^(?P<head>\|.*\|)[ \t]*(?:🔥 |🆕 )?(?P<mon>[A-Z][a-z]{2}) "
    r"(?P<day>\d{2}), (?P<year>\d{4})[ \t]*\|$"
)


def main() -> int:
    try:
        source = load_question_bank(ROOT)
        lines = source.logical_content().splitlines()
        header_index = lines.index(TABLE_HEADER)
        bottom_index = lines.index(BOTTOM_ANCHOR, header_index + 2)
    except (OSError, ValueError) as error:
        print(f"freshness refresh failed: {error}", file=sys.stderr)
        return 2

    today = date.today()
    changed = 0
    question_rows: list[tuple[int, date, str]] = []
    for ordinal, line_index in enumerate(
        range(header_index + 2, bottom_index)
    ):
        line = lines[line_index]
        practice_urls = PRACTICE_URL.findall(line)
        if (
            line.count("|") != 6
            or len(practice_urls) != 2
            or practice_urls[0] != practice_urls[1]
            or line.count(PRACTICE_BUTTON) != 1
        ):
            print(
                f"freshness refresh failed: row {line_index + 1} is malformed: "
                f"{line[:120]}",
                file=sys.stderr,
            )
            return 2
        match = CELL.match(line)
        if not match:
            print(
                f"freshness refresh failed: row {line_index + 1} does not match "
                f"the expected format: {line[:120]}",
                file=sys.stderr,
            )
            return 2
        try:
            updated = date(
                int(match["year"]), MONTHS[match["mon"]], int(match["day"])
            )
        except ValueError as error:
            print(
                f"freshness refresh failed: row {line_index + 1} has an invalid "
                f"update date: {error}",
                file=sys.stderr,
            )
            return 2
        if updated > today:
            print(
                f"freshness refresh failed: row {line_index + 1} has a future "
                f"update date: {updated.isoformat()}",
                file=sys.stderr,
            )
            return 2
        age = (today - updated).days
        marker = "🔥 " if age <= FIRE_DAYS else ("🆕 " if age <= NEW_DAYS else "")
        refreshed = (
            f"{match['head']}{marker}{match['mon']} {match['day']}, "
            f"{match['year']}|"
        )
        if refreshed != line:
            changed += 1
        question_rows.append((ordinal, updated, refreshed))

    sorted_rows = sorted(
        question_rows,
        key=lambda row: (-row[1].toordinal(), row[0]),
    )
    moved = sum(
        original_ordinal != sorted_ordinal
        for sorted_ordinal, (original_ordinal, _, _) in enumerate(sorted_rows)
    )
    lines[header_index + 2 : bottom_index] = [row for _, _, row in sorted_rows]
    logical_content = "\n".join(lines) + "\n"

    try:
        expected_pages = render_question_bank_pages(logical_content, root=ROOT)
        stale_pages = stale_generated_paths(expected_pages, source.paths)
        write_generated_pages(expected_pages, source.paths)
    except (OSError, ValueError) as error:
        print(f"freshness refresh failed: {error}", file=sys.stderr)
        return 2

    sizes = [len(content.encode("utf-8")) for content in expected_pages.values()]
    print(
        f"refreshed markers on {changed} row(s); reordered {moved} row "
        f"position(s); pages={len(expected_pages)}; largest={max(sizes):,} bytes"
    )
    if stale_pages:
        print(
            "updated question-bank pages: "
            + ", ".join(str(path.relative_to(ROOT)) for path in stale_pages)
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
