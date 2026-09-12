# Contributing

Thanks for helping keep the 2026 Tech OA tracker current. The repo is useful only if reports are specific, source-safe, and easy to verify.

## What To Submit

Good submissions include one or more of the following:

- A newly seen Online Assessment or interview question.
- A correction to a company name, question title, practice link, or update date.
- A missing FastPrep practice link for an existing row.
- A stale or duplicate row that should be reviewed.

## Submission Checklist

When opening an issue, include:

- Company name.
- Role, location, and recruiting season if known.
- Question title or a short source-safe summary.
- Date seen.
- Source context, such as public post, candidate report, or your own anonymized experience.
- FastPrep problem link if one already exists.

The **Format** column and format-specific pages are maintained from FastPrep's
public, candidate-safe catalogs. The complete question bank is the ordered,
route-keyed union of `README.md` and `question-bank/page-N.md`; generated pages
are kept below 400,000 bytes when possible and may never exceed 500,000 bytes.
System design, low-level design/OOD, and AI coding catalog entries are
reconciled into that union automatically every hour. Explicit metadata wins;
legacy `/problems/` routes that predate the public catalog use the coding
workspace's `Coding` fallback. Please do not guess a format from a title or
company.

Please do not submit confidential screenshots, private recruiter messages, account-only assessment pages, or full proprietary problem statements. A short summary is enough for maintainers to verify the report and create a practice-safe entry.

## How Updates Are Reviewed

Maintainers check whether the report is specific, plausible, and safe to
publish. Once verified, update the existing canonical route wherever it lives
in the paginated question bank, or add a new row to the README table. Never copy
a route between pages. Then refresh dates and regenerate the page boundaries,
Format column, links, and filtered pages:

```bash
python3 scripts/refresh-freshness.py
python3 scripts/sync-practice-formats.py
python3 scripts/sync-practice-formats.py --check
```

The catalog sync uses only public fields such as route, title, company, sighting
date, and practice format. It validates global route uniqueness, stable
newest-first ordering, route conservation, and every generated page's byte
limit. It does not export source URLs, answers, evaluator content, or restricted
assessment material.

Prefer one issue per company/question so each report can be tracked independently.

## Corrections

For corrections, link the current README row and explain the exact change needed. Examples:

- Broken practice link.
- Typo in the question title.
- Duplicate question row.
- Incorrect company attribution.

## Community

For quick discussion or follow-up context, join the FastPrep Discord: https://discord.gg/kSbWpSGUTH
