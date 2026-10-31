#!/usr/bin/env python3
import json
import re
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
README = ROOT / "README.md"
DOMAINS_FILE = ROOT / "assets" / "company-domains.json"
DATA_DIR = ROOT / "data"

MONTH_MAP = {
    "Jan": 1, "Feb": 2, "Mar": 3, "Apr": 4, "May": 5, "Jun": 6,
    "Jul": 7, "Aug": 8, "Sep": 9, "Oct": 10, "Nov": 11, "Dec": 12
}

def parse_date(date_str: str) -> str:
    cleaned = re.sub(r"[🔥🆕\s]+", " ", date_str).strip()
    match = re.search(r"([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{4})", cleaned)
    if match:
        mon, day, yr = match.groups()
        mon_num = MONTH_MAP.get(mon.capitalize(), 1)
        return f"{yr}-{mon_num:02d}-{int(day):02d}"
    return "2020-01-01"

def build():
    DATA_DIR.mkdir(exist_ok=True)
    domains_map = {}
    if DOMAINS_FILE.exists():
        with open(DOMAINS_FILE, "r", encoding="utf-8") as f:
            raw_domains = json.load(f)
            domains_map = {k.strip().lower(): v for k, v in raw_domains.items()}

    content = README.read_text(encoding="utf-8")
    lines = content.splitlines()

    in_table = False
    items = []

    for line in lines:
        if line.startswith("| Company | OA / Interview Question |"):
            in_table = True
            continue
        if in_table:
            if line.startswith('<a id="bottom">') or line.startswith("---"):
                break
            if not line.startswith("|") or line.startswith("| :--"):
                continue

            parts = [p.strip() for p in line.strip().strip("|").split("|")]
            if len(parts) >= 5:
                company_raw, question_raw, fmt, practice_raw, updated_raw = parts[:5]

                cleaned_company = re.sub(r"^\*\*(.*?)\*\*$", r"\1", company_raw).strip()
                companies = [c.strip() for c in cleaned_company.split("/") if c.strip()]

                title_match = re.match(r"\[(.*?)\]\((.*?)\)", question_raw)
                title = title_match.group(1) if title_match else question_raw
                url = title_match.group(2) if title_match else ""

                practice_match = re.search(r"\((https?://.*?)\)", practice_raw)
                practice_url = practice_match.group(1) if practice_match else url

                is_hot = "🔥" in updated_raw
                is_new = "🆕" in updated_raw
                iso_date = parse_date(updated_raw)
                display_date = re.sub(r"[🔥🆕\s]+", " ", updated_raw).strip()

                matched_domains = {}
                for c in companies:
                    c_low = c.lower()
                    if c_low in domains_map:
                        matched_domains[c] = domains_map[c_low]

                item_id = url.rstrip("/").split("/")[-1] if url else f"item-{len(items)+1}"

                items.append({
                    "id": item_id,
                    "title": title,
                    "url": url,
                    "practiceUrl": practice_url,
                    "companies": companies,
                    "domains": matched_domains,
                    "format": fmt,
                    "date": display_date,
                    "isoDate": iso_date,
                    "isHot": is_hot,
                    "isNew": is_new,
                })

    company_counts = {}
    format_counts = {}
    for item in items:
        fmt = item["format"]
        format_counts[fmt] = format_counts.get(fmt, 0) + 1
        for comp in item["companies"]:
            company_counts[comp] = company_counts.get(comp, 0) + 1

    sorted_companies = sorted(company_counts.items(), key=lambda x: (-x[1], x[0]))

    metadata = {
        "total": len(items),
        "updatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "formatCounts": format_counts,
        "topCompanies": [{"name": c, "count": cnt} for c, cnt in sorted_companies[:50]],
        "allCompanies": [{"name": c, "count": cnt} for c, cnt in sorted_companies],
    }

    payload = {
        "metadata": metadata,
        "questions": items,
    }

    json_path = DATA_DIR / "questions.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    js_path = DATA_DIR / "questions-data.js"
    with open(js_path, "w", encoding="utf-8") as f:
        f.write(f"window.QUESTION_BANK_DATA = {json.dumps(payload, ensure_ascii=False)};\n")

    print(f"Successfully processed {len(items)} questions across {len(company_counts)} companies.")
    print(f"Generated {json_path} and {js_path}")

if __name__ == "__main__":
    build()
