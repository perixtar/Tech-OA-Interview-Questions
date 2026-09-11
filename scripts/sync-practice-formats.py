#!/usr/bin/env python3
"""Sync the public question bank from FastPrep's candidate-safe catalogs.

The production Firestore ``problem.practiceFormat`` field is the source of
truth. The anonymous catalog APIs expose public projections for coding, system
design, low-level/OOD, and AI coding. The sync preserves the reported coding
rows already maintained in this repository, then upserts every candidate-safe
design and AI-coding catalog item. It never reads evaluator content, source
URLs, answers, or restricted assessment data.

The coding application applies a backward-compatible default: a coding problem
without ``practiceFormat`` is an algorithm problem. Legacy ``/problems/``
routes that predate the public catalog use the same coding-route fallback;
explicit catalog metadata always wins, including for SQL problems.
Positive numeric aliases are login-protected and omitted from every public
question-bank projection.

Run after adding or updating question-bank rows:

    python3 scripts/sync-practice-formats.py
    python3 scripts/sync-practice-formats.py --check

Use ``--catalog-file`` only with a reviewed export containing the four
candidate-safe catalog arrays described by ``load_catalogs``.
"""

import argparse
import json
import re
import sys
from collections import Counter
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent
README = ROOT / "README.md"
FORMATS_DIR = ROOT / "formats"
CATALOG_ENDPOINTS = {
    "coding": "https://www.fastprep.io/api/problems?v=1",
    "system_design": "https://www.fastprep.io/api/system-design/problems",
    "low_level_design": "https://www.fastprep.io/api/low-level-design/problems",
    "project_coding": "https://www.fastprep.io/api/project-coding/problems",
}
OLD_TABLE_HEADER = "| Company | OA / Interview Question | Practice | Updated |"
LEGACY_TABLE_HEADER = (
    "| Company | OA / Interview Question | Practice format | Practice | Updated |"
)
TABLE_HEADER = "| Company | OA / Interview Question | Format | Practice | Updated |"
OLD_TABLE_DIVIDER = "| :-- | :-- | :-: | :-- |"
TABLE_DIVIDER = "| :-- | :-- | :-- | :-: | :-- |"
BOTTOM_ANCHOR = '<a id="bottom"></a>'
FORMAT_LINKS_START = "<!-- format-links:start -->"
FORMAT_LINKS_END = "<!-- format-links:end -->"
COMPANY_LIST_SUMMARY = re.compile(
    r"^<summary><b>🏢 Full company list \(\d+\+\) — click to expand</b></summary>$"
)
COMPANY_REMAINDER = re.compile(r"^… \+ \d+ more companies in the table below ↓$")
COMPANY_LIST_ESCAPED_COMMA = "&#44;"
README_MAX_BYTES = 500_000
FIRE_DAYS = 14
NEW_DAYS = 45
FAVICON = re.compile(r"<img\s+[^>]*>\s*")
UPDATED_CELL = re.compile(
    r"^(?:🔥 |🆕 )?(?P<mon>[A-Z][a-z]{2}) (?P<day>\d{2}), (?P<year>\d{4})$"
)
POSITIVE_NUMERIC_ALIAS = re.compile(r"^[1-9][0-9]*\.")

FORMAT_LABELS = {
    "algorithm": "Coding",
    "tabular": "SQL",
    "system_design": "System design",
    "low_level_design": "Low-level design",
    "project_coding": "AI coding",
}
KNOWN_LABELS = {*FORMAT_LABELS.values(), "Unknown"}
FORMAT_PAGE_SLUGS = {
    "Coding": "coding",
    "SQL": "sql",
    "System design": "system-design",
    "Low-level design": "low-level-design",
    "AI coding": "ai-coding",
}
ROUTE_PREFIXES = {
    "https://www.fastprep.io/problems/": "Coding",
    "https://www.fastprep.io/system-design/": "System design",
    "https://www.fastprep.io/low-level-design/": "Low-level design",
    "https://www.fastprep.io/project-coding/": "AI coding",
}


@dataclass(frozen=True)
class ManagedCatalogSpec:
    route_segment: str
    label: str


@dataclass(frozen=True)
class ManagedCatalogRow:
    route_url: str
    label: str
    title: str
    companies: tuple[str, ...]
    latest_seen: date | None


MANAGED_CATALOGS = {
    "system_design": ManagedCatalogSpec("system-design", "System design"),
    "low_level_design": ManagedCatalogSpec("low-level-design", "Low-level design"),
    "project_coding": ManagedCatalogSpec("project-coding", "AI coding"),
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--catalog-file",
        type=Path,
        help=(
            "Read a reviewed JSON object with coding, system_design, "
            "low_level_design, and project_coding arrays instead of the public APIs."
        ),
    )
    parser.add_argument(
        "--sync-date",
        type=date.fromisoformat,
        default=date.today(),
        metavar="YYYY-MM-DD",
        help=(
            "Date used only when a new public catalog item has no reported "
            "lastSeen value (default: today)."
        ),
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Exit nonzero if README practice-format labels are not current.",
    )
    return parser.parse_args()


def load_catalogs(catalog_file: Path | None) -> dict[str, list[dict]]:
    if catalog_file:
        try:
            payload = json.loads(catalog_file.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise ValueError(f"could not read catalog file: {error}") from error
        if not isinstance(payload, dict) or set(payload) != set(CATALOG_ENDPOINTS):
            raise ValueError(
                "catalog file must contain exactly coding, system_design, "
                "low_level_design, and project_coding"
            )
        catalogs = payload
    else:
        catalogs: dict[str, list[dict]] = {}
        for catalog_name, catalog_url in CATALOG_ENDPOINTS.items():
            request = Request(
                catalog_url,
                headers={"User-Agent": "FastPrep-question-bank-sync/1"},
            )
            try:
                with urlopen(request, timeout=30) as response:
                    response_payload = json.load(response)
            except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as error:
                raise ValueError(
                    f"could not read FastPrep {catalog_name} catalog: {error}"
                ) from error

            if catalog_name == "coding":
                catalogs[catalog_name] = response_payload
            elif isinstance(response_payload, dict):
                catalogs[catalog_name] = response_payload.get("problems")
            else:
                catalogs[catalog_name] = response_payload

    for catalog_name in CATALOG_ENDPOINTS:
        catalog = catalogs.get(catalog_name)
        if not isinstance(catalog, list) or not all(
            isinstance(item, dict) for item in catalog
        ):
            raise ValueError(f"{catalog_name} catalog must be a JSON array of objects")
        if catalog_name in MANAGED_CATALOGS and not catalog:
            raise ValueError(f"{catalog_name} catalog is unexpectedly empty")
    return catalogs


def build_managed_rows(
    catalogs: dict[str, list[dict]],
) -> dict[str, ManagedCatalogRow]:
    rows: dict[str, ManagedCatalogRow] = {}
    for practice_format, catalog in catalogs.items():
        if practice_format not in MANAGED_CATALOGS:
            continue
        spec = MANAGED_CATALOGS[practice_format]
        for index, item in enumerate(catalog):
            if item.get("practiceFormat") != practice_format:
                raise ValueError(
                    f"{practice_format} catalog item {index} has the wrong practiceFormat"
                )
            problem_id = item.get("id")
            href = item.get("href")
            title = item.get("title")
            companies = item.get("companies")
            last_seen = item.get("lastSeen")
            expected_href = f"/{spec.route_segment}/{problem_id}"
            if (
                not isinstance(problem_id, str)
                or not problem_id.strip()
                or href != expected_href
            ):
                raise ValueError(
                    f"{practice_format} catalog item {index} has no canonical route"
                )
            if not isinstance(title, str) or not title.strip():
                raise ValueError(
                    f"{practice_format} catalog item {index} has no usable title"
                )
            if not isinstance(companies, list) or not all(
                isinstance(company, str) and company.strip() for company in companies
            ):
                raise ValueError(
                    f"{practice_format} catalog item {index} has invalid companies"
                )
            if not isinstance(last_seen, list) or not all(
                isinstance(seen_at, str) for seen_at in last_seen
            ):
                raise ValueError(
                    f"{practice_format} catalog item {index} has invalid lastSeen"
                )
            try:
                seen_dates = [date.fromisoformat(seen_at) for seen_at in last_seen]
            except ValueError as error:
                raise ValueError(
                    f"{practice_format} catalog item {index} has invalid lastSeen"
                ) from error

            route_url = f"https://www.fastprep.io{href}"
            if route_url in rows:
                raise ValueError(f'duplicate managed catalog route "{route_url}"')
            rows[route_url] = ManagedCatalogRow(
                route_url=route_url,
                label=spec.label,
                title=title.strip(),
                companies=tuple(
                    dict.fromkeys(company.strip() for company in companies)
                ),
                latest_seen=max(seen_dates) if seen_dates else None,
            )
    return rows


def build_format_index(catalog: list[dict]) -> dict[str, str]:
    formats: dict[str, str] = {}
    for index, item in enumerate(catalog):
        problem_id = item.get("id")
        route_alias = item.get("url")
        if not isinstance(problem_id, str) or not problem_id.strip():
            raise ValueError(f"catalog item {index} has no usable id or url")

        raw_format = item.get("practiceFormat", "algorithm")
        if raw_format not in FORMAT_LABELS:
            raise ValueError(
                f'catalog route "{route_alias or problem_id}" has unsupported '
                f"practiceFormat {raw_format!r}"
            )
        label = FORMAT_LABELS[raw_format]
        routes = [problem_id]
        if isinstance(route_alias, str) and route_alias.strip():
            routes.append(route_alias)
        for route in routes:
            if route in formats and formats[route] != label:
                raise ValueError(f'catalog route "{route}" has conflicting formats')
            formats[route] = label
    return formats


def row_route_and_namespace(question_cell: str) -> tuple[str, str, str]:
    for prefix, namespace_label in ROUTE_PREFIXES.items():
        marker = question_cell.find(prefix)
        if marker == -1:
            continue
        route_start = marker + len(prefix)
        route_end = question_cell.find(")", route_start)
        if route_end == -1:
            break
        route = question_cell[route_start:route_end]
        if route:
            return prefix + route, route, namespace_label
    raise ValueError("question cell has no supported FastPrep practice route")


def parse_updated_cell(cell: str) -> date:
    match = UPDATED_CELL.fullmatch(cell.strip())
    if not match:
        raise ValueError(f"invalid Updated value {cell.strip()!r}")
    try:
        return datetime.strptime(
            f"{match['mon']} {match['day']}, {match['year']}", "%b %d, %Y"
        ).date()
    except ValueError as error:
        raise ValueError(f"invalid Updated value {cell.strip()!r}") from error


def format_updated_cell(updated: date, sync_date: date) -> str:
    if updated > sync_date:
        raise ValueError(f"Updated date {updated.isoformat()} is in the future")
    age = (sync_date - updated).days
    marker = "🔥 " if age <= FIRE_DAYS else ("🆕 " if age <= NEW_DAYS else "")
    return marker + updated.strftime("%b %d, %Y")


def markdown_text(value: str) -> str:
    return value.replace("|", "&#124;").replace("[", "&#91;").replace("]", "&#93;")


def compact_company_cell(cell: str) -> str:
    return FAVICON.sub("", cell).strip()


def render_managed_row(
    row: ManagedCatalogRow,
    *,
    existing_date: date | None,
    sync_date: date,
) -> str:
    companies = " / ".join(markdown_text(company) for company in row.companies)
    company_cell = f"**{companies or 'Unattributed'}**"
    updated = row.latest_seen or existing_date or sync_date
    title = markdown_text(row.title)
    updated_cell = format_updated_cell(updated, sync_date)
    return (
        f"|{company_cell}|[{title}]({row.route_url})|{row.label}|"
        f"[![Practice][p]]({row.route_url})|{updated_cell}|"
    )


def sync_readme(
    content: str,
    formats: dict[str, str],
    *,
    managed_rows: dict[str, ManagedCatalogRow] | None = None,
    sync_date: date | None = None,
) -> tuple[str, Counter, list[str]]:
    effective_sync_date = sync_date or date.today()
    lines = content.splitlines()
    try:
        header_index = lines.index(TABLE_HEADER)
        has_format_column = True
    except ValueError:
        try:
            header_index = lines.index(LEGACY_TABLE_HEADER)
            has_format_column = True
        except ValueError:
            try:
                header_index = lines.index(OLD_TABLE_HEADER)
                has_format_column = False
            except ValueError as error:
                raise ValueError("question table header not found") from error

    expected_divider = TABLE_DIVIDER if has_format_column else OLD_TABLE_DIVIDER
    if header_index + 1 >= len(lines) or lines[header_index + 1] != expected_divider:
        raise ValueError("question table divider is missing or malformed")
    try:
        bottom_index = lines.index(BOTTOM_ANCHOR, header_index + 2)
    except ValueError as error:
        raise ValueError("question table bottom anchor not found") from error
    if bottom_index == header_index + 2:
        raise ValueError("question table has no rows")

    lines[header_index] = TABLE_HEADER
    lines[header_index + 1] = TABLE_DIVIDER
    counts: Counter[str] = Counter()
    catalog_missing: list[str] = []
    output_rows: list[tuple[date, str]] = []
    seen_managed_routes: set[str] = set()

    for line_index in range(header_index + 2, bottom_index):
        parts = lines[line_index].split("|")
        expected_parts = 7 if has_format_column else 6
        if len(parts) != expected_parts or parts[0] or parts[-1]:
            raise ValueError(f"row {line_index + 1} is malformed")
        parts = [part.strip() for part in parts]

        route_url, route, namespace_label = row_route_and_namespace(parts[2])
        if namespace_label == "Coding" and POSITIVE_NUMERIC_ALIAS.match(route):
            continue
        existing_label = parts[3].strip() if has_format_column else None
        if existing_label is not None and existing_label not in KNOWN_LABELS:
            raise ValueError(
                f"row {line_index + 1} has unsupported practice format {existing_label!r}"
            )

        existing_date = parse_updated_cell(parts[-2])
        managed_row = managed_rows.get(route_url) if managed_rows is not None else None
        if managed_row is not None:
            if route_url in seen_managed_routes:
                raise ValueError(f'duplicate managed route "{route_url}" in README')
            seen_managed_routes.add(route_url)
            rendered = render_managed_row(
                managed_row,
                existing_date=existing_date,
                sync_date=effective_sync_date,
            )
            label = managed_row.label
        else:
            catalog_label = formats.get(route)
            if catalog_label is None and namespace_label == "Coding":
                catalog_missing.append(route)
            label = catalog_label or namespace_label
            parts[1] = compact_company_cell(parts[1])
            if has_format_column:
                parts[3] = label
            else:
                parts.insert(3, label)
            rendered = "|".join(parts)

        output_rows.append((parse_updated_cell(rendered.split("|")[-2]), rendered))
        counts[label] += 1

    if managed_rows is not None:
        for route_url, managed_row in managed_rows.items():
            if route_url in seen_managed_routes:
                continue
            rendered = render_managed_row(
                managed_row,
                existing_date=None,
                sync_date=effective_sync_date,
            )
            output_rows.append((parse_updated_cell(rendered.split("|")[-2]), rendered))
            counts[managed_row.label] += 1

    output_rows.sort(key=lambda item: item[0], reverse=True)
    lines[header_index + 2 : bottom_index] = [row for _, row in output_rows]
    return "\n".join(lines) + "\n", counts, catalog_missing


def format_labels_in_display_order(counts: Counter) -> list[str]:
    return [label for label in FORMAT_PAGE_SLUGS if counts[label] > 0]


def sync_format_links(content: str, counts: Counter) -> str:
    lines = content.splitlines()
    try:
        start = lines.index(FORMAT_LINKS_START)
        end = lines.index(FORMAT_LINKS_END, start + 1)
    except ValueError as error:
        raise ValueError("format-link boundary is missing") from error
    if end != start + 2:
        raise ValueError("format-link boundary must contain exactly one content line")

    links = [
        f"[{label} ({counts[label]:,})](formats/{FORMAT_PAGE_SLUGS[label]}.md)"
        for label in format_labels_in_display_order(counts)
    ]
    if not links:
        raise ValueError("question table has no supported formats")
    lines[start + 1] = "<sub><b>Formats:</b> " + " · ".join(links) + "</sub>"
    return "\n".join(lines) + "\n"


def sync_company_list(content: str, managed_rows: dict[str, ManagedCatalogRow]) -> str:
    lines = content.splitlines()
    try:
        summary_index = next(
            index
            for index, line in enumerate(lines)
            if COMPANY_LIST_SUMMARY.match(line)
        )
        list_index = next(
            index
            for index in range(summary_index + 1, len(lines))
            if lines[index].strip() and lines[index].strip() != "<br/>"
        )
    except (StopIteration, ValueError) as error:
        raise ValueError("full company list boundary is missing") from error

    company_line = lines[list_index].strip()
    if not company_line.endswith("."):
        raise ValueError("full company list is malformed")

    companies_by_key: dict[str, str] = {}
    for raw_company in company_line[:-1].split(","):
        company = raw_company.strip().replace(COMPANY_LIST_ESCAPED_COMMA, ",")
        if company:
            companies_by_key.setdefault(company.casefold(), company)

    managed_companies = [
        company for row in managed_rows.values() for company in row.companies
    ]
    # Older output split names such as "Nike, Inc." into standalone list entries.
    # Remove those generated fragments before adding the canonical catalog name.
    for company in managed_companies:
        if "," not in company:
            continue
        for fragment in company.split(","):
            companies_by_key.pop(fragment.strip().casefold(), None)

    for company in managed_companies:
        companies_by_key.setdefault(company.casefold(), company)

    companies = companies_by_key.values()
    ordered = sorted(companies, key=lambda company: (company.casefold(), company))
    lines[summary_index] = (
        f"<summary><b>🏢 Full company list ({len(ordered)}+) — "
        "click to expand</b></summary>"
    )
    lines[list_index] = ", ".join(
        company.replace(",", COMPANY_LIST_ESCAPED_COMMA) for company in ordered
    ) + "."
    for index, line in enumerate(lines):
        if COMPANY_REMAINDER.match(line):
            lines[index] = (
                f"… + {max(len(ordered) - 10, 0)} more companies in the table below ↓"
            )
    return "\n".join(lines) + "\n"


def render_format_pages(content: str, counts: Counter) -> dict[Path, str]:
    lines = content.splitlines()
    try:
        header_index = lines.index(TABLE_HEADER)
        bottom_index = lines.index(BOTTOM_ANCHOR, header_index + 2)
    except ValueError as error:
        raise ValueError("question table boundary is missing") from error

    rows_by_label: dict[str, list[str]] = {
        label: [] for label in format_labels_in_display_order(counts)
    }
    for line_index in range(header_index + 2, bottom_index):
        parts = lines[line_index].split("|")
        if len(parts) != 7 or parts[0] or parts[-1]:
            raise ValueError(f"row {line_index + 1} is malformed")
        label = parts[3].strip()
        if label not in rows_by_label:
            raise ValueError(
                f"row {line_index + 1} has no generated page for format {label!r}"
            )
        rows_by_label[label].append("|".join(parts[:3] + parts[4:]))

    pages: dict[Path, str] = {}
    for label in format_labels_in_display_order(counts):
        rows = rows_by_label[label]
        if len(rows) != counts[label]:
            raise ValueError(f"{label} page count does not match the README table")
        slug = FORMAT_PAGE_SLUGS[label]
        pages[FORMATS_DIR / f"{slug}.md"] = (
            f"# {label} OA & Interview Questions\n\n"
            "[← Back to all questions](../README.md#question-bank)\n\n"
            f"**{len(rows):,} questions**\n\n"
            "[p]: ../assets/practice-button.svg\n\n"
            "| Company | OA / Interview Question | Practice | Updated |\n"
            "| :-- | :-- | :-: | :-- |\n" + "\n".join(rows) + "\n"
        )
    return pages


def main() -> int:
    args = parse_args()
    try:
        catalogs = load_catalogs(args.catalog_file)
        formats = build_format_index(catalogs["coding"])
        managed_rows = build_managed_rows(catalogs)
        original = README.read_text(encoding="utf-8")
        updated, counts, catalog_missing = sync_readme(
            original,
            formats,
            managed_rows=managed_rows,
            sync_date=args.sync_date,
        )
        updated = sync_format_links(updated, counts)
        updated = sync_company_list(updated, managed_rows)
        format_pages = render_format_pages(updated, counts)
    except (OSError, ValueError) as error:
        print(f"practice-format sync failed: {error}", file=sys.stderr)
        return 2

    changed = updated != original
    stale_pages = [
        page
        for page, expected in format_pages.items()
        if not page.exists() or page.read_text(encoding="utf-8") != expected
    ]
    unknown = counts["Unknown"]
    readme_bytes = len(updated.encode("utf-8"))
    summary = ", ".join(f"{label}={counts[label]}" for label in sorted(counts))
    print(
        f"practice formats: {summary}; catalog-missing={len(catalog_missing)}; "
        f"managed={len(managed_rows)}; unclassified={unknown}; "
        f"README={readme_bytes:,} bytes"
    )
    if catalog_missing:
        print("catalog-missing routes: " + ", ".join(catalog_missing))

    if unknown:
        print("practice-format sync produced an unclassified row", file=sys.stderr)
        return 2
    if readme_bytes > README_MAX_BYTES:
        print(
            f"README is {readme_bytes:,} bytes; keep it at or below "
            f"{README_MAX_BYTES:,} bytes so GitHub renders the full table",
            file=sys.stderr,
        )
        return 2

    if args.check:
        if changed or stale_pages:
            if changed:
                print("README formats are not current", file=sys.stderr)
            if stale_pages:
                print(
                    "format pages are not current: "
                    + ", ".join(str(page.relative_to(ROOT)) for page in stale_pages),
                    file=sys.stderr,
                )
            return 1
        return 0

    if changed:
        README.write_text(updated, encoding="utf-8")
        print("updated README format column and links")
    else:
        print("README format column and links already current")
    FORMATS_DIR.mkdir(exist_ok=True)
    for page, expected in format_pages.items():
        page.write_text(expected, encoding="utf-8")
    if stale_pages:
        print(
            "updated format pages: "
            + ", ".join(str(page.relative_to(ROOT)) for page in stale_pages)
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
