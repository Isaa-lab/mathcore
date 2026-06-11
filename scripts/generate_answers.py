#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
Batch-generate textbook exercise answers for questions.json.

PowerShell:
  $env:BBOLUO_KEY='sk-your-key'
  $env:BATCH='3'
  python scripts\generate_answers.py
"""

import json
import os
import re
import time

from json_repair import repair_json
from openai import OpenAI

IN_OUT_PATH = "questions.json"
BASE_URL = "https://bboluo.com/v1"
API_KEY = os.environ.get("BBOLUO_KEY", "")
MODEL = os.environ.get("ANSWER_MODEL", "[L]gemini-3-flash-preview")
SLEEP_SEC = 1.0
BATCH = int(os.environ.get("BATCH", "0") or "0")

ANSWER_PROMPT = """你是线性代数老师。请解答下面这道课本习题，给出详细、严谨的分步解析。

【题目】
{stem}
{subs}
{context}

【要求】
1. 如果有多个小问 (a)(b)(c)，逐个解答，不要遗漏
2. 每问给出：解题思路 → 分步骤计算过程 → 最终答案
3. 明确写出用到的定理/定义/方法的名称（如"高斯消元法""Cramer法则""秩-零化度定理"）
4. 数学公式用 LaTeX 表示
5. 解完后，自己复核一遍计算是否正确
6. 如果题目引用了其他题（如 Exercise 1、the following systems），必须优先使用【同页上下文】里的原题；不要自行编造题目内容
7. 如果上下文仍不足以唯一确定题目，answer 里说明缺少必要上下文，confidence 填 "low"

【输出】严格 JSON，无多余文字：
{{"answer":"完整分步解析含LaTeX","theorems":["用到的定理1","定理2"],"confidence":"high或low"}}
confidence：如果计算较复杂、你不完全确定结果正确，填 "low"，否则 "high"。"""


def parse_json(raw):
    raw = str(raw or "").strip()
    raw = re.sub(r"^```(?:json)?", "", raw, flags=re.IGNORECASE).strip()
    raw = re.sub(r"```$", "", raw).strip()
    candidates = [raw]
    start, end = raw.find("{"), raw.rfind("}")
    if start != -1 and end != -1 and end > start:
        candidates.append(raw[start : end + 1])

    for candidate in candidates:
        try:
            return json.loads(candidate)
        except Exception:
            pass
        try:
            return json.loads(repair_json(candidate))
        except Exception:
            pass
    return None


def save(db):
    db["total"] = len(db.get("questions", []))
    with open(IN_OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(db, f, ensure_ascii=False, indent=2)


def build_page_context(q, questions):
    page = q.get("sourcePage")
    if not page:
        return ""
    neighbors = [
        item
        for item in questions
        if item.get("sourcePage") == page and item.get("id") != q.get("id")
    ]
    if not neighbors:
        return ""

    lines = ["【同页上下文】"]
    for item in sorted(neighbors, key=lambda x: str(x.get("number", ""))):
        lines.append(f"Exercise {item.get('number')}: {item.get('question', '')}")
        if item.get("subQuestions"):
            lines.extend(f"  {sub}" for sub in item["subQuestions"])
    return "\n" + "\n".join(lines[:80])


def solve_one(client, q, questions):
    subs = ""
    if q.get("subQuestions"):
        subs = "【小问】\n" + "\n".join(str(x) for x in q["subQuestions"])
    context = build_page_context(q, questions)
    prompt = ANSWER_PROMPT.format(stem=q.get("question", ""), subs=subs, context=context)
    resp = client.chat.completions.create(
        model=MODEL,
        stream=False,
        messages=[{"role": "user", "content": prompt}],
    )
    return parse_json(resp.choices[0].message.content)


def main():
    if not API_KEY:
        print("Missing BBOLUO_KEY. In PowerShell: $env:BBOLUO_KEY='sk-your-key'")
        return

    with open(IN_OUT_PATH, encoding="utf-8") as f:
        db = json.load(f)
    questions = db.get("questions", [])
    pending = [q for q in questions if q.get("answerStatus") != "generated"]
    if BATCH:
        pending = pending[:BATCH]

    print(f"Model: {MODEL}")
    print(f"Pending answers this run: {len(pending)} / {len(questions)}\n")

    client = OpenAI(api_key=API_KEY, base_url=BASE_URL)
    done = 0
    for q in pending:
        print(f"Solving {q.get('id')} · {q.get('chapter')} · #{q.get('number')} ...", end=" ")
        try:
            data = solve_one(client, q, questions)
            if not data:
                print("parse failed")
                continue
            q["answer"] = data.get("answer", "")
            q["theorems"] = data.get("theorems", [])
            q["confidence"] = data.get("confidence", "high")
            q["answerStatus"] = "generated"
            done += 1
            print("low confidence" if q["confidence"] == "low" else "ok")
        except Exception as exc:
            print(f"error: {exc}")
            continue

        save(db)
        time.sleep(SLEEP_SEC)

    low = sum(1 for q in questions if q.get("confidence") == "low")
    still = sum(1 for q in questions if q.get("answerStatus") != "generated")
    print(f"\nDone this run: {done}")
    print(f"Still pending: {still}")
    print(f"Low confidence: {low}")


if __name__ == "__main__":
    main()
