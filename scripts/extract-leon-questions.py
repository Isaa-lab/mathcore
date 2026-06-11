#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
Extract textbook exercises from Leon 9th via vision model.

Usage on Windows CMD:
  cd C:\Users\26357\mathcore
  .venv\Scripts\activate.bat
  set BBOLUO_KEY=sk-your-key
  python scripts\extract-leon-questions.py

Before first run:
  Put the PDF at: textbooks\leon9.pdf
  Keep MAX_PAGES = 2 for testing. Change to None after checking questions.json.
"""

import os
import re
import json
import time
import base64
import warnings
from collections import Counter

import fitz  # PyMuPDF
from json_repair import repair_json
from openai import OpenAI

warnings.filterwarnings("ignore")


# ============== Config ==============
PDF_PATH = "textbooks/leon9.pdf"
OUT_PATH = "questions.json"

BASE_URL = "https://bboluo.com/v1"
API_KEY = os.environ.get("BBOLUO_KEY", "")
MODEL = "[L]gemini-3-flash-preview"

RENDER_DPI = 200
SLEEP_SEC = 1.0
MAX_PAGES = None  # None = full extraction. Use 2 for a quick test.
BATCH_PAGES = int(os.environ.get("BATCH_PAGES", "0") or "0")
JUDGE_DIFFICULTY = os.environ.get("JUDGE_DIFFICULTY", "0") == "1"

# Leon 9th calibrated ranges, 0-based PDF page index.
CHAPTER_RANGES = {
    1: (17, 102),
    2: (103, 127),
    3: (128, 184),
    4: (185, 216),
    5: (217, 302),
    6: (303, 410),
    7: (411, 486),
}

CHAPTER_TITLES = {
    1: "矩阵与线性方程组",
    2: "行列式",
    3: "向量空间",
    4: "线性变换",
    5: "正交性",
    6: "特征值",
    7: "数值线性代数",
}

BODY_START = 17
BODY_END = 486


EXTRACT_PROMPT = """你是数学教材习题提取专家。我给你一张线性代数教材的页面图片。

【任务】只提取页面上「EXERCISES」习题区里带编号(1. 2. 3. ...)的练习题。

【必须跳过，不要提取】
- 章节讲解正文、定义、定理、公式推导
- 标着 EXAMPLE 的例题（那是带解答的讲解，不是练习）
- 前言、目录、页眉页脚、图表标题
- 任何不是"要求学生做"的叙述性句子

【公式要求】
- 所有数学符号用 LaTeX：下标 x_1, x_2；矩阵 \\begin{bmatrix}...\\end{bmatrix}；分数 \\frac{}{}
- 小问 (a)(b)(c) 完整保留各自的公式

【题型判定】每题标注 type：计算 / 概念 / 证明 / 应用

【输出】严格 JSON，无任何解释文字：
{"questions":[{"number":"1","stem":"题干含LaTeX","type":"计算","subQuestions":["(a) ...","(b) ..."]}]}
若本页无习题，返回 {"questions":[]}"""

DIFFICULTY_PROMPT = """判断这道线性代数题难度，只回一个词：基础 或 进阶 或 挑战
- 基础：套用单一公式/定义即可
- 进阶：需2-3步组合或综合多个概念
- 挑战：需证明、构造或多概念深度综合
题目：{stem}"""


def page_to_data_uri(doc, page_index, dpi=RENDER_DPI):
    page = doc[page_index]
    pix = page.get_pixmap(dpi=dpi)
    png = pix.tobytes("png")
    b64 = base64.b64encode(png).decode()
    return f"data:image/png;base64,{b64}"


def which_chapter(page_index):
    for ch, (lo, hi) in CHAPTER_RANGES.items():
        if lo <= page_index <= hi:
            return ch
    return None


def find_exercise_pages(doc):
    pages = []
    end = min(BODY_END + 1, doc.page_count)
    for i in range(BODY_START, end):
        text = doc[i].get_text()
        if re.search(r"\bEXERCISES\b", text):
            pages.append(i)
    return pages


def strip_json_fence(raw):
    raw = str(raw or "").strip()
    raw = re.sub(r"^```(?:json)?", "", raw, flags=re.IGNORECASE).strip()
    raw = re.sub(r"```$", "", raw).strip()
    return raw


def repair_latex_json_escapes(raw):
    # Models often emit LaTeX like \{ inside JSON strings, which is not a valid
    # JSON escape. Preserve real JSON escapes and double the LaTeX backslashes.
    return re.sub(r'\\(?!["\\/bfnrtu])', r"\\\\", raw)


def escape_newlines_in_json_strings(raw):
    out = []
    in_string = False
    escaped = False
    for ch in raw:
        if in_string:
            if escaped:
                out.append(ch)
                escaped = False
                continue
            if ch == "\\":
                out.append(ch)
                escaped = True
                continue
            if ch == '"':
                out.append(ch)
                in_string = False
                continue
            if ch == "\n":
                out.append("\\n")
                continue
            if ch == "\r":
                continue
            out.append(ch)
            continue

        out.append(ch)
        if ch == '"':
            in_string = True
    return "".join(out)


def repair_model_json(raw):
    return repair_latex_json_escapes(escape_newlines_in_json_strings(raw))


def call_vision(client, data_uri):
    resp = client.chat.completions.create(
        model=MODEL,
        stream=False,
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": EXTRACT_PROMPT},
                    {"type": "image_url", "image_url": {"url": data_uri}},
                ],
            }
        ],
    )
    raw = strip_json_fence(resp.choices[0].message.content)
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        try:
            return json.loads(repair_model_json(raw))
        except Exception:
            pass
        try:
            return json.loads(repair_json(repair_model_json(raw)))
        except Exception:
            pass
        start = raw.find("{")
        end = raw.rfind("}")
        if start != -1 and end != -1 and end > start:
            try:
                clipped = raw[start : end + 1]
                return json.loads(repair_model_json(clipped))
            except Exception:
                pass
            try:
                return json.loads(repair_json(repair_model_json(clipped)))
            except Exception:
                pass
        print("    JSON parse failed; skipped this page.")
        print("    Raw preview:", raw[:300].replace("\n", " "))
        return {"questions": [], "_parseFailed": True}


def judge_difficulty(client, stem):
    try:
        resp = client.chat.completions.create(
            model=MODEL,
            stream=False,
            messages=[
                {"role": "user", "content": DIFFICULTY_PROMPT.format(stem=stem[:600])}
            ],
        )
        ans = str(resp.choices[0].message.content or "").strip()
        for level in ("挑战", "进阶", "基础"):
            if level in ans:
                return level
    except Exception:
        pass
    return "基础"


def normalize(stem):
    return re.sub(r"\s+", "", str(stem or "")).lower()


def load_existing_output():
    if not os.path.exists(OUT_PATH):
        return [], set()
    try:
        with open(OUT_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        questions = data.get("questions", [])
        if not isinstance(questions, list):
            return [], set()
        done_pages = {int(q["sourcePage"]) for q in questions if q.get("sourcePage")}
        done_pages.update(int(page) for page in data.get("processedPages", []) if page)
        return questions, done_pages
    except Exception as exc:
        print(f"Could not read existing {OUT_PATH}; starting fresh. Reason: {exc}")
        return [], set()


def save_output(questions, done_pages=None):
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(
            {
                "total": len(questions),
                "processedPages": sorted(done_pages or []),
                "questions": questions,
            },
            f,
            ensure_ascii=False,
            indent=2,
        )


def main():
    if not API_KEY:
        print("Missing BBOLUO_KEY.")
        print("In CMD, run: set BBOLUO_KEY=sk-your-key")
        return

    if not os.path.exists(PDF_PATH):
        print(f"PDF not found: {PDF_PATH}")
        print(r"Please copy your PDF to: C:\Users\26357\mathcore\textbooks\leon9.pdf")
        return

    client = OpenAI(api_key=API_KEY, base_url=BASE_URL)
    doc = fitz.open(PDF_PATH)

    exercise_pages = find_exercise_pages(doc)
    total_found = len(exercise_pages)
    all_questions, done_pages = load_existing_output()
    seen = {normalize(q.get("question")) for q in all_questions if q.get("question")}

    if MAX_PAGES:
        exercise_pages = exercise_pages[:MAX_PAGES]

    if BATCH_PAGES > 0:
        remaining_pages = [p for p in exercise_pages if p + 1 not in done_pages]
        exercise_pages = remaining_pages[:BATCH_PAGES]

    print(f"Found {total_found} exercise pages. Running {len(exercise_pages)} page(s).")
    print("Tip: MAX_PAGES = 2 is test mode. Change to None after quality check.\n")

    if all_questions:
        print(f"Resuming from {OUT_PATH}: {len(all_questions)} saved question(s), {len(done_pages)} page(s) done.")

    for idx, page_index in enumerate(exercise_pages, 1):
        if page_index + 1 in done_pages:
            print(f"[{idx}/{len(exercise_pages)}] PDF page {page_index + 1} already saved; skipped.")
            continue

        ch = which_chapter(page_index)
        ch_label = f"Ch.{ch} {CHAPTER_TITLES.get(ch, '')}" if ch else "Unknown chapter"
        print(f"[{idx}/{len(exercise_pages)}] PDF page {page_index + 1} · {ch_label}")

        try:
            data_uri = page_to_data_uri(doc, page_index)
            result = call_vision(client, data_uri)
        except Exception as exc:
            print(f"    Request/render failed: {exc}")
            time.sleep(SLEEP_SEC)
            continue

        page_questions = result.get("questions", [])
        if not isinstance(page_questions, list):
            page_questions = []
        print(f"    Extracted {len(page_questions)} question(s)")

        for item in page_questions:
            stem = str(item.get("stem") or "").strip()
            if len(stem) < 5:
                continue
            key = normalize(stem)
            if key in seen:
                continue
            seen.add(key)

            difficulty = judge_difficulty(client, stem) if JUDGE_DIFFICULTY else "基础"
            all_questions.append(
                {
                    "id": f"tb_{len(all_questions) + 1:04d}",
                    "source": "textbook",
                    "owner": "public",
                    "chapter": f"Ch.{ch}" if ch else "Ch.?",
                    "chapterTitle": CHAPTER_TITLES.get(ch, ""),
                    "type": item.get("type", "计算"),
                    "difficulty": difficulty,
                    "number": str(item.get("number", "")),
                    "question": stem,
                    "subQuestions": item.get("subQuestions", []),
                    "answer": "",
                    "answerStatus": "pending",
                    "sourcePage": page_index + 1,
                }
            )
            time.sleep(SLEEP_SEC)

        if result.get("_parseFailed"):
            print("    Parse failed page was not marked done; it will be retried later.")
        else:
            done_pages.add(page_index + 1)
        save_output(all_questions, done_pages)
        print(f"    Saved checkpoint: {len(all_questions)} total question(s)")
        time.sleep(SLEEP_SEC)

    save_output(all_questions, done_pages)

    print(f"\nDone. Extracted {len(all_questions)} question(s).")
    print(f"Saved to: {OUT_PATH}")

    by_ch = Counter(q["chapter"] for q in all_questions)
    by_type = Counter(q["type"] for q in all_questions)
    by_diff = Counter(q["difficulty"] for q in all_questions)
    print("Chapter distribution:", dict(sorted(by_ch.items())))
    print("Type distribution:", dict(by_type))
    print("Difficulty distribution:", dict(by_diff))


if __name__ == "__main__":
    main()
