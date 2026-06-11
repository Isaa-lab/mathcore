#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
Batch-judge exercise difficulty for questions.json.

PowerShell:
  $env:BBOLUO_KEY='sk-your-key'
  python scripts\judge_difficulty.py
"""

import json
import os
import time
from collections import Counter

from openai import OpenAI

IN_OUT_PATH = "questions.json"
BASE_URL = "https://bboluo.com/v1"
API_KEY = os.environ.get("BBOLUO_KEY", "")
MODEL = os.environ.get("DIFFICULTY_MODEL", "[L]gemini-3-flash-preview")
SLEEP_SEC = 0.6
BATCH = int(os.environ.get("BATCH", "0") or "0")

PROMPT = """判断这道线性代数题的难度，只回一个词：基础 或 进阶 或 挑战
- 基础：套用单一公式或定义即可解出
- 进阶：需要2-3步组合，或综合多个概念
- 挑战：需要证明、构造，或多概念深度综合

题目：{stem}
小问数量：{n}（小问越多通常越综合）"""


def save(db):
    db["total"] = len(db.get("questions", []))
    with open(IN_OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(db, f, ensure_ascii=False, indent=2)


def main():
    if not API_KEY:
        print("Missing BBOLUO_KEY. In PowerShell: $env:BBOLUO_KEY='sk-your-key'")
        return

    with open(IN_OUT_PATH, encoding="utf-8") as f:
        db = json.load(f)
    questions = db.get("questions", [])
    todo = [q for q in questions if not q.get("difficultyJudged")]
    if BATCH:
        todo = todo[:BATCH]

    print(f"Model: {MODEL}")
    print(f"Pending difficulty judgments this run: {len(todo)} / {len(questions)}\n")

    client = OpenAI(api_key=API_KEY, base_url=BASE_URL)
    done = 0
    for q in todo:
        stem = q.get("question", "") + " " + " ".join(str(x) for x in q.get("subQuestions", []))
        prompt = PROMPT.format(stem=stem[:900], n=len(q.get("subQuestions", [])))
        try:
            resp = client.chat.completions.create(
                model=MODEL,
                stream=False,
                messages=[{"role": "user", "content": prompt}],
            )
            ans = str(resp.choices[0].message.content or "").strip()
            level = "基础"
            for candidate in ("挑战", "进阶", "基础"):
                if candidate in ans:
                    level = candidate
                    break
            q["difficulty"] = level
            q["difficultyJudged"] = True
            done += 1
            print(f"{q.get('id')} · #{q.get('number')} -> {level}")
        except Exception as exc:
            print(f"{q.get('id')} error: {exc}")
            continue

        if done % 5 == 0:
            save(db)
        time.sleep(SLEEP_SEC)

    save(db)
    dist = Counter(q.get("difficulty", "基础") for q in questions)
    still = sum(1 for q in questions if not q.get("difficultyJudged"))
    print(f"\nDone this run: {done}")
    print(f"Still pending: {still}")
    print(f"Difficulty distribution: {dict(dist)}")


if __name__ == "__main__":
    main()
