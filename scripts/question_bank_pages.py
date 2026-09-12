#!/usr/bin/env python3
"""Load, validate, and render the paginated public question bank."""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Sequence


ROOT = Path(__file__).resolve().parent.parent
TABLE_HEADER = "| Company | OA / Interview Question | Format | Practice | Updated |"
TABLE_DIVIDER = "| :-- | :-- | :-- | :-: | :-- |"
BOTTOM_ANCHOR = '<a id="bottom"></a>'
# GitHub truncates rendered Markdown around 512 KB. Target 400 KB so routine
# additions retain headroom; reject every generated page above 500 KB.
PAGE_TARGET_BYTES = 400_000
PAGE_HARD_LIMIT_BYTES = 500_000
PAGE_FILE = re.compile(r"^page-(?P<number>[2-9][0-9]*)\.md$")
FASTPREP_ROUTE = re.compile(
    r"https://www\.fastprep\.io/"
    r"(?:problems|system-design|low-level-design|project-coding)/[^)\s|]+"
)
PAGE_NAV_START = "<!-- question-pages:start -->"
PAGE_NAV_END = "<!-- question-pages:end -->"


@dataclass(frozen=True)
class QuestionBankSource:
    prefix: str
    suffix: str
    rows: tuple[str, ...]
    paths: tuple[Path, ...]

    def logical_content(self) -> str:
        return render_logical_content(self.prefix, self.rows, self.suffix)


def split_table(
    content: str,
    *,
    source: str,
    table_header: str = TABLE_HEADER,
    table_divider: str = TABLE_DIVIDER,
) -> tuple[str, list[str], str]:
    lines = content.splitlines()
    try:
        header_index = lines.index(table_header)
    except ValueError as error:
        raise ValueError(f"{source}: question table header not found") from error
    if header_index + 1 >= len(lines) or lines[header_index + 1] != table_divider:
        raise ValueError(f"{source}: question table divider is missing or malformed")
    try:
        bottom_index = lines.index(BOTTOM_ANCHOR, header_index + 2)
    except ValueError as error:
        raise ValueError(f"{source}: question table bottom anchor not found") from error
    rows = lines[header_index + 2 : bottom_index]
    if not rows:
        raise ValueError(f"{source}: question table has no rows")
    prefix = "\n".join(lines[:header_index])
    suffix = "\n".join(lines[bottom_index + 1 :])
    return prefix, rows, suffix


def strip_generated_navigation(prefix: str) -> str:
    lines = prefix.splitlines()
    starts = [index for index, line in enumerate(lines) if line == PAGE_NAV_START]
    ends = [index for index, line in enumerate(lines) if line == PAGE_NAV_END]
    if not starts and not ends:
        return prefix.rstrip()
    if len(starts) != 1 or len(ends) != 1 or ends[0] != starts[0] + 2:
        raise ValueError("README: question-page navigation boundary is malformed")
    del lines[starts[0] : ends[0] + 1]
    while lines and not lines[-1]:
        lines.pop()
    return "\n".join(lines)


def route_from_row(row: str, *, source: str) -> str:
    routes = FASTPREP_ROUTE.findall(row)
    if len(routes) != 2 or routes[0] != routes[1]:
        raise ValueError(
            f"{source}: row must contain the same supported FastPrep route twice"
        )
    return routes[0]


def validate_unique_routes(rows: Sequence[str], *, source: str) -> list[str]:
    routes: list[str] = []
    first_ordinal: dict[str, int] = {}
    for ordinal, row in enumerate(rows, start=1):
        route = route_from_row(row, source=f"{source} row {ordinal}")
        if route in first_ordinal:
            raise ValueError(
                f'{source}: duplicate route "{route}" at rows '
                f"{first_ordinal[route]} and {ordinal}"
            )
        first_ordinal[route] = ordinal
        routes.append(route)
    return routes


def continuation_paths(root: Path = ROOT) -> list[Path]:
    directory = root / "question-bank"
    if not directory.exists():
        return []
    candidates = sorted(directory.glob("*.md"))
    numbered: list[tuple[int, Path]] = []
    for path in candidates:
        match = PAGE_FILE.fullmatch(path.name)
        if not match:
            raise ValueError(
                f"question-bank contains unmanaged Markdown file {path.name!r}"
            )
        numbered.append((int(match["number"]), path))
    numbered.sort()
    expected_numbers = list(range(2, len(numbered) + 2))
    actual_numbers = [number for number, _ in numbered]
    if actual_numbers != expected_numbers:
        raise ValueError(
            "question-bank continuation pages must be contiguous from page 2"
        )
    return [path for _, path in numbered]


def load_question_bank(root: Path = ROOT) -> QuestionBankSource:
    readme = root / "README.md"
    root_content = readme.read_text(encoding="utf-8")
    prefix, rows, suffix = split_table(root_content, source="README.md")
    prefix = strip_generated_navigation(prefix)
    paths = [readme]
    for path in continuation_paths(root):
        page_prefix, page_rows, page_suffix = split_table(
            path.read_text(encoding="utf-8"),
            source=str(path.relative_to(root)),
        )
        if PAGE_NAV_START not in page_prefix or PAGE_NAV_END not in page_prefix:
            raise ValueError(
                f"{path.relative_to(root)}: generated navigation boundary is missing"
            )
        if page_suffix.strip():
            raise ValueError(
                f"{path.relative_to(root)}: unexpected content follows the table"
            )
        rows.extend(page_rows)
        paths.append(path)
    validate_unique_routes(rows, source="question-bank union")
    return QuestionBankSource(prefix, suffix, tuple(rows), tuple(paths))


def render_logical_content(prefix: str, rows: Sequence[str], suffix: str = "") -> str:
    parts = [
        prefix.rstrip(),
        TABLE_HEADER,
        TABLE_DIVIDER,
        *rows,
        BOTTOM_ANCHOR,
    ]
    if suffix.strip():
        parts.append(suffix.strip("\n"))
    return "\n".join(parts) + "\n"


def page_navigation(
    *,
    page_number: int,
    previous_href: str | None,
    next_href: str | None,
) -> str:
    links: list[str] = []
    if previous_href:
        links.append(f"[← Previous]({previous_href})")
    links.append(f"Page {page_number}")
    if next_href:
        links.append(f"[Next →]({next_href})")
    return "\n".join(
        [PAGE_NAV_START, "<sub>" + " · ".join(links) + "</sub>", PAGE_NAV_END]
    )


def render_root_page(
    prefix: str,
    suffix: str,
    rows: Sequence[str],
    *,
    has_next: bool,
) -> str:
    clean_prefix = strip_generated_navigation(prefix)
    if has_next:
        clean_prefix = (
            clean_prefix.rstrip()
            + "\n\n"
            + page_navigation(
                page_number=1,
                previous_href=None,
                next_href="question-bank/page-2.md",
            )
        )
    return render_logical_content(clean_prefix, rows, suffix)


def render_continuation_page(
    page_number: int,
    rows: Sequence[str],
    *,
    has_next: bool,
) -> str:
    previous_href = (
        "../README.md#question-bank"
        if page_number == 2
        else f"page-{page_number - 1}.md"
    )
    next_href = f"page-{page_number + 1}.md" if has_next else None
    prefix = "\n\n".join(
        [
            f"# Question Bank — Page {page_number}",
            page_navigation(
                page_number=page_number,
                previous_href=previous_href,
                next_href=next_href,
            ),
            "<sub>Newest first · 🔥 2 weeks · 🆕 45 days</sub>",
            "[p]: ../assets/practice-button.svg",
        ]
    )
    return render_logical_content(prefix, rows)


def paginate_rows(
    rows: Sequence[str],
    render_page: Callable[[int, Sequence[str], bool], str],
    *,
    target_bytes: int = PAGE_TARGET_BYTES,
    hard_limit_bytes: int = PAGE_HARD_LIMIT_BYTES,
) -> list[list[str]]:
    if not rows:
        raise ValueError("cannot paginate an empty question table")
    pages: list[list[str]] = []
    current: list[str] = []
    page_number = 1
    for row in rows:
        candidate = [*current, row]
        candidate_size = len(
            render_page(page_number, candidate, True).encode("utf-8")
        )
        if current and candidate_size > target_bytes:
            pages.append(current)
            page_number += 1
            current = [row]
        else:
            current = candidate
        singleton_size = len(
            render_page(page_number, current, True).encode("utf-8")
        )
        if len(current) == 1 and singleton_size > hard_limit_bytes:
            raise ValueError(
                f"page {page_number} cannot fit its single row under "
                f"{hard_limit_bytes:,} bytes"
            )
    pages.append(current)
    for index, page_rows in enumerate(pages, start=1):
        rendered = render_page(index, page_rows, index < len(pages))
        size = len(rendered.encode("utf-8"))
        if size > hard_limit_bytes:
            raise ValueError(
                f"page {index} is {size:,} bytes; hard limit is "
                f"{hard_limit_bytes:,} bytes"
            )
    return pages


def assert_route_conservation(
    expected_rows: Sequence[str],
    rendered_pages: Sequence[str],
    *,
    source: str,
    table_header: str = TABLE_HEADER,
    table_divider: str = TABLE_DIVIDER,
) -> None:
    expected_routes = validate_unique_routes(expected_rows, source=f"{source} input")
    actual_rows: list[str] = []
    for page_number, content in enumerate(rendered_pages, start=1):
        _, rows, _ = split_table(
            content,
            source=f"{source} page {page_number}",
            table_header=table_header,
            table_divider=table_divider,
        )
        actual_rows.extend(rows)
    actual_routes = validate_unique_routes(actual_rows, source=f"{source} output")
    if actual_routes != expected_routes:
        raise ValueError(f"{source}: pagination changed route membership or order")


def render_question_bank_pages(
    logical_content: str,
    *,
    root: Path = ROOT,
    target_bytes: int = PAGE_TARGET_BYTES,
    hard_limit_bytes: int = PAGE_HARD_LIMIT_BYTES,
) -> dict[Path, str]:
    prefix, rows, suffix = split_table(logical_content, source="logical question bank")
    validate_unique_routes(rows, source="logical question bank")

    def renderer(page_number: int, page_rows: Sequence[str], has_next: bool) -> str:
        if page_number == 1:
            return render_root_page(prefix, suffix, page_rows, has_next=has_next)
        return render_continuation_page(
            page_number, page_rows, has_next=has_next
        )

    row_pages = paginate_rows(
        rows,
        renderer,
        target_bytes=target_bytes,
        hard_limit_bytes=hard_limit_bytes,
    )
    rendered_pages = [
        renderer(index, page_rows, index < len(row_pages))
        for index, page_rows in enumerate(row_pages, start=1)
    ]
    assert_route_conservation(rows, rendered_pages, source="question bank")
    output = {root / "README.md": rendered_pages[0]}
    for page_number, content in enumerate(rendered_pages[1:], start=2):
        output[root / "question-bank" / f"page-{page_number}.md"] = content
    return output


def stale_generated_paths(
    expected: dict[Path, str],
    existing: Sequence[Path],
) -> list[Path]:
    return sorted(
        path
        for path in set(existing) | set(expected)
        if path not in expected
        or not path.exists()
        or path.read_text(encoding="utf-8") != expected[path]
    )


def write_generated_pages(
    expected: dict[Path, str],
    existing: Sequence[Path],
) -> None:
    for path, content in expected.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
    for path in set(existing) - set(expected):
        path.unlink()
