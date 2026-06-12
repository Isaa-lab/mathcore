#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
Preview and clean dirty rows from Supabase questions table.

PowerShell / CMD after env vars are set:
  python scripts\clean_dirty_questions.py
  set CONFIRM_DELETE=yes
  python scripts\clean_dirty_questions.py
"""

import os
from collections import Counter

from supabase import create_client

URL = os.environ.get("SUPABASE_URL", "")
KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
CONFIRM = os.environ.get("CONFIRM_DELETE", "").lower() == "yes"
TABLE = "questions"

VALID_CHAPTERS = {"Ch.1", "Ch.2", "Ch.3", "Ch.4", "Ch.5", "Ch.6", "Ch.7"}
VALID_COURSES = {"Linear Algebra", "线性代数", ""}

JUNK_PATTERNS = [
    "Please use",
    "T for True",
    "F for False",
    "以下哪个描述最准确",
    "以下说法是否正确",
    "关于「(",
    "关于 「(",
    "关于(",
]


def is_dirty(row):
    chapter = str(row.get("chapter") or "").strip()
    course = str(row.get("course") or "").strip()
    question = str(row.get("question") or "")
    source = str(row.get("source") or "").strip()

    # Keep uploaded/AI rows out of this cleanup unless they clearly match junk text.
    if source and source not in {"textbook", "manual"}:
        for pattern in JUNK_PATTERNS:
            if pattern in question:
                return True, f"垃圾题干: {pattern}"
        return False, ""

    if chapter not in VALID_CHAPTERS:
        return True, f"非法章节: {chapter or '(empty)'}"
    if course not in VALID_COURSES:
        return True, f"非法课程: {course}"
    for pattern in JUNK_PATTERNS:
        if pattern in question:
            return True, f"垃圾题干: {pattern}"
    return False, ""


def main():
    if not URL or not KEY:
        print("Missing env vars:")
        print("  set SUPABASE_URL=https://xxxx.supabase.co")
        print("  set SUPABASE_SERVICE_KEY=service_role key")
        return

    client = create_client(URL, KEY)
    response = client.table(TABLE).select("id, chapter, course, question, source").execute()
    rows = response.data or []
    print(f"Total rows in `{TABLE}`: {len(rows)}")

    dirty = []
    for row in rows:
        bad, reason = is_dirty(row)
        if bad:
            dirty.append((row, reason))

    if not dirty:
        print("No dirty rows found.")
        return

    print(f"Dirty rows found: {len(dirty)}\n")
    for reason, count in Counter(reason for _, reason in dirty).most_common():
        print(f"  {count:4d} · {reason}")

    print("\nSamples:")
    for row, reason in dirty[:10]:
        question = str(row.get("question") or "").replace("\n", " ")
        print(f"  - [{row.get('course')}/{row.get('chapter')}] {question[:80]}... ({reason})")

    if not CONFIRM:
        print("\nPreview only. To delete these rows, run:")
        print("  set CONFIRM_DELETE=yes")
        print("  python scripts\\clean_dirty_questions.py")
        return

    ids = [row["id"] for row, _ in dirty if row.get("id")]
    print(f"\nDeleting {len(ids)} rows...")
    for start in range(0, len(ids), 100):
        chunk = ids[start:start + 100]
        client.table(TABLE).delete().in_("id", chunk).execute()
        print(f"  deleted {min(start + 100, len(ids))}/{len(ids)}")
    print("Done.")


if __name__ == "__main__":
    main()
