#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
Import questions.json into Supabase questions table.

PowerShell:
  $env:SUPABASE_URL='https://xxxx.supabase.co'
  $env:SUPABASE_SERVICE_KEY='service_role key'
  python scripts\import_to_supabase.py
"""

import json
import os

from supabase import create_client

JSON_PATH = "questions.json"
TABLE = "questions"
BATCH = 100

URL = os.environ.get("SUPABASE_URL", "")
KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")


def map_question_type(value):
    value = str(value or "").strip()
    if value in {"单选题", "判断题", "填空题", "简答题"}:
        return value
    # 课本题的“计算/概念/证明/应用”本质都是需要展开作答的题。
    return "简答题"


def to_row(q):
    return {
        "question": q.get("question", ""),
        "options": q.get("options") or None,
        "answer": q.get("answer", ""),
        "explanation": q.get("explanation", ""),
        "chapter": q.get("chapter", "Ch.?"),
        "course": q.get("course", "Linear Algebra"),
        "chapter_title": q.get("chapterTitle", ""),
        "type": map_question_type(q.get("type", "计算")),
        "difficulty": q.get("difficulty", "基础"),
        "source": "textbook",
        "owner": "public",
        "answer_status": q.get("answerStatus", "pending"),
        "sub_questions": q.get("subQuestions", []),
        "number": str(q.get("number", "")),
        "source_page": q.get("sourcePage"),
        "theorems": q.get("theorems", []),
        "confidence": q.get("confidence", "high"),
    }


def strip(row, fields):
    out = dict(row)
    for field in fields:
        out.pop(field, None)
    return out


def insert_chunk(client, rows):
    candidates = [
        rows,
        [strip(r, ["sub_questions", "number", "source_page", "theorems", "confidence"]) for r in rows],
        [strip(r, ["source", "owner", "answer_status", "sub_questions", "number", "source_page", "theorems", "confidence"]) for r in rows],
        [strip(r, ["source", "owner", "answer_status", "chapter_title", "sub_questions", "number", "source_page", "theorems", "confidence"]) for r in rows],
    ]
    last_error = None
    for payload in candidates:
        try:
            client.table(TABLE).insert(payload).execute()
            return True, None
        except Exception as exc:
            last_error = exc
    return False, last_error


def main():
    if not URL or not KEY:
        print("Missing env vars:")
        print("  $env:SUPABASE_URL='https://xxxx.supabase.co'")
        print("  $env:SUPABASE_SERVICE_KEY='service_role key'")
        return

    with open(JSON_PATH, encoding="utf-8") as f:
        db = json.load(f)
    questions = db.get("questions", [])
    rows = [to_row(q) for q in questions]

    print(f"Importing {len(rows)} questions into `{TABLE}`...")
    client = create_client(URL, KEY)
    inserted = 0
    for start in range(0, len(rows), BATCH):
        chunk = rows[start : start + BATCH]
        ok, error = insert_chunk(client, chunk)
        if not ok:
            print(f"Batch {start // BATCH + 1} failed: {error}")
            print("If the error says a column is missing, add that column or remove it in to_row().")
            break
        inserted += len(chunk)
        print(f"  imported {inserted}/{len(rows)}")

    print(f"Done. Imported {inserted}/{len(rows)} questions.")


if __name__ == "__main__":
    main()
