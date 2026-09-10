#!/usr/bin/env python3
"""Sort and refresh the README question table.

Rows updated within the last 14 days get a fire marker, within 45 days a new
marker, older rows get none. Rows are kept newest-first by their Updated date.
Run this whenever the table is regenerated or on a schedule so ordering and
markers stay current:

    python3 scripts/refresh-freshness.py
    python3 scripts/sync-practice-formats.py
"""

import re
import sys
from datetime import date
from pathlib import Path

README = Path(__file__).resolve().parent.parent / "README.md"
FIRE_DAYS, NEW_DAYS = 14, 45
TABLE_HEADER = "| Company | OA / Interview Question | Format | Practice | Updated |"
TABLE_DIVIDER = "| :-- | :-- | :-- | :-: | :-- |"
BOTTOM_ANCHOR = '<a id="bottom"></a>'
PRACTICE_BUTTON = "[![Practice][p]]"
PRACTICE_URL = re.compile(
    r"https://www\.fastprep\.io/"
    r"(?:problems|system-design|low-level-design|project-coding)/[^)\s]+"
)
# GitHub truncates rendered README input at 512,000 bytes. Keep enough margin
# for routine table additions between maintenance passes.
README_MAX_BYTES = 500_000
MONTHS = {
    m: i + 1
    for i, m in enumerate(
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

today = date.today()
changed = 0
question_rows = []
lines = README.read_text(encoding="utf-8").splitlines()
try:
    header_index = lines.index(TABLE_HEADER)
except ValueError:
    sys.exit("question table header not found")
if header_index + 1 >= len(lines) or lines[header_index + 1] != TABLE_DIVIDER:
    sys.exit("question table divider is missing or malformed")
try:
    bottom_index = lines.index(BOTTOM_ANCHOR, header_index + 2)
except ValueError:
    sys.exit("question table bottom anchor not found")
if bottom_index == header_index + 2:
    sys.exit("question table has no rows")

for i in range(header_index + 2, bottom_index):
    line = lines[i]
    practice_urls = PRACTICE_URL.findall(line)
    if (
        line.count("|") != 6
        or len(practice_urls) != 2
        or line.count(PRACTICE_BUTTON) != 1
    ):
        sys.exit(f"row {i + 1} is malformed: {line[:120]}")
    m = CELL.match(line)
    if not m:
        sys.exit(f"row {i + 1} does not match the expected format: {line[:120]}")
    try:
        updated = date(int(m["year"]), MONTHS[m["mon"]], int(m["day"]))
    except ValueError as error:
        sys.exit(f"row {i + 1} has an invalid update date: {error}")
    if updated > today:
        sys.exit(f"row {i + 1} has a future update date: {updated.isoformat()}")
    age = (today - updated).days
    mark = "🔥 " if age <= FIRE_DAYS else ("🆕 " if age <= NEW_DAYS else "")
    new = f"{m['head']}{mark}{m['mon']} {m['day']}, {m['year']}|"
    if new != line:
        lines[i] = new
        changed += 1
    question_rows.append((i, updated, new))

sorted_rows = sorted(question_rows, key=lambda row: row[1], reverse=True)
target_indexes = [index for index, _, _ in question_rows]
sorted_lines = [row for _, _, row in sorted_rows]
moved = sum(
    lines[target_index] != row
    for target_index, row in zip(target_indexes, sorted_lines)
)
for target_index, row in zip(target_indexes, sorted_lines):
    lines[target_index] = row

content = "\n".join(lines) + "\n"
readme_bytes = len(content.encode("utf-8"))
if readme_bytes > README_MAX_BYTES:
    sys.exit(
        f"README is {readme_bytes:,} bytes; keep it at or below "
        f"{README_MAX_BYTES:,} bytes to avoid GitHub's rendered README cutoff"
    )

README.write_text(content, encoding="utf-8")
print(
    f"refreshed markers on {changed} row(s); reordered {moved} row position(s); "
    f"README is {readme_bytes:,} bytes"
)
