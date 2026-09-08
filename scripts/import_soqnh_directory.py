#!/usr/bin/env python3
"""Build an idempotent D1 import from the State of Queer NH directory CSV."""

from __future__ import annotations

import argparse
import csv
import hashlib
import re
import unicodedata
from pathlib import Path


EXCLUDED_COLUMNS = {"Submitted by", "Your Email (If different from above)"}
EXPECTED_COLUMNS = {
    "Name",
    "Category",
    "Website",
    "Primary Social Media Handle",
    "Contact Email for Resource",
    "Contact Phone",
    "Town/City",
    "Description (up to 30 words)",
    "Why should this listing be included in this resource book?",
    "Is this resource queer and/or BIPOC-led?",
    "Logo/Photo",
    "Region",
    "Primary Social Media",
    "Does this resource operate/provide services statewide?",
    *EXCLUDED_COLUMNS,
}


def clean(value: str | None) -> str | None:
    normalized = (value or "").strip()
    return normalized or None


def slugify(value: str) -> str:
    ascii_value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    return re.sub(r"^-+|-+$", "", re.sub(r"[^a-z0-9]+", "-", ascii_value.lower()))[:80]


def normalize_url(value: str | None) -> str | None:
    value = clean(value)
    if not value:
        return None
    value = value.replace(" ", "")
    return value if re.match(r"^https?://", value, re.I) else f"https://{value}"


def normalize_phone(value: str | None) -> str | None:
    value = clean(value)
    if not value:
        return None
    digits = re.sub(r"\D", "", value)
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    if len(digits) == 10:
        return f"({digits[:3]}) {digits[3:6]}-{digits[6:]}"
    return value


def normalize_image_urls(value: str | None) -> str | None:
    value = clean(value)
    if not value:
        return None
    return "\n".join(part.strip() for part in re.split(r",\s*(?=https?://)", value) if part.strip())


def summarize(value: str | None, limit: int = 240) -> str | None:
    value = clean(re.sub(r"\s+", " ", value or ""))
    if not value or len(value) <= limit:
        return value
    shortened = value[: limit + 1].rsplit(" ", 1)[0].rstrip(" ,;:-")
    return f"{shortened}…"


def sql_literal(value: str | int | None) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, int):
        return str(value)
    return "'" + value.replace("'", "''") + "'"


def read_records(source: Path) -> tuple[list[dict[str, str]], int]:
    with source.open(encoding="utf-8-sig", newline="") as handle:
        raw_rows = list(csv.reader(handle))
    header_index = next((index for index, row in enumerate(raw_rows) if len(row) >= 2 and row[0] == "Name" and row[1] == "Category"), None)
    if header_index is None:
        raise ValueError("Could not find the directory column header row.")
    headers = raw_rows[header_index]
    missing = EXPECTED_COLUMNS.difference(headers)
    if missing:
        raise ValueError(f"Missing expected columns: {', '.join(sorted(missing))}")
    rows = [dict(zip(headers, row, strict=True)) for row in raw_rows[header_index + 1 :] if len(row) == len(headers)]
    rows = [row for row in rows if clean(row.get("Name")) and row["Name"] != "Name"]

    grouped: dict[str, list[dict[str, str]]] = {}
    for row in rows:
        grouped.setdefault(row["Name"].strip().casefold(), []).append(row)
    merged: list[dict[str, str]] = []
    for matches in grouped.values():
        matches.sort(key=lambda row: sum(bool(clean(value)) for key, value in row.items() if key not in EXCLUDED_COLUMNS), reverse=True)
        selected = dict(matches[0])
        for row in matches[1:]:
            for key, value in row.items():
                if key not in EXCLUDED_COLUMNS and not clean(selected.get(key)) and clean(value):
                    selected[key] = value
        merged.append(selected)
    return sorted(merged, key=lambda row: row["Name"].casefold()), len(rows) - len(merged)


def build_sql(records: list[dict[str, str]]) -> str:
    used_slugs: set[str] = set()
    statements: list[str] = []
    columns = [
        "id", "name", "slug", "summary", "description", "category", "website_url",
        "contact_email", "contact_phone", "town_city", "region", "social_platform",
        "social_handle", "listing_rationale", "leadership_identity", "source_image_urls",
        "operates_statewide", "status", "directory_status", "created_at", "updated_at",
        "event_scraping_enabled",
    ]
    update_columns = columns[1:17]
    for row in records:
        name = row["Name"].strip()
        base_slug = slugify(name) or "organization"
        slug = base_slug
        if slug in used_slugs:
            slug = f"{base_slug[:71]}-{hashlib.sha256(name.encode()).hexdigest()[:8]}"
        used_slugs.add(slug)
        statewide_raw = clean(row.get("Does this resource operate/provide services statewide?"))
        statewide = 1 if statewide_raw and statewide_raw.casefold() == "yes" else 0 if statewide_raw and statewide_raw.casefold() == "no" else None
        description = clean(row.get("Description (up to 30 words)"))
        values: list[str | int | None] = [
            f"directory-{hashlib.sha256(name.casefold().encode()).hexdigest()[:24]}",
            name,
            slug,
            summarize(description),
            description,
            clean(row.get("Category")),
            normalize_url(row.get("Website")),
            clean(row.get("Contact Email for Resource")),
            normalize_phone(row.get("Contact Phone")),
            clean(row.get("Town/City")),
            clean(row.get("Region")),
            clean(row.get("Primary Social Media")),
            clean(row.get("Primary Social Media Handle")),
            clean(row.get("Why should this listing be included in this resource book?")),
            clean(row.get("Is this resource queer and/or BIPOC-led?")),
            normalize_image_urls(row.get("Logo/Photo")),
            statewide,
            "active",
            "not_listed",
            "CURRENT_TIMESTAMP",
            "CURRENT_TIMESTAMP",
            0,
        ]
        rendered = [value if value == "CURRENT_TIMESTAMP" else sql_literal(value) for value in values]
        assignments = ", ".join(f"{column} = coalesce(excluded.{column}, organizations.{column})" for column in update_columns)
        statements.append(
            f"INSERT INTO organizations ({', '.join(columns)}) VALUES ({', '.join(rendered)}) "
            f"ON CONFLICT(slug) DO UPDATE SET {assignments}, updated_at = CURRENT_TIMESTAMP;"
        )
    return "\n".join(statements) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source_csv", type=Path)
    parser.add_argument("output_sql", type=Path)
    args = parser.parse_args()
    records, merged_duplicates = read_records(args.source_csv)
    args.output_sql.write_text(build_sql(records), encoding="utf-8")
    print(f"Prepared {len(records)} organizations; merged {merged_duplicates} duplicate/header-free rows.")
    print("Excluded columns: Submitted by; Your Email (If different from above)")


if __name__ == "__main__":
    main()
