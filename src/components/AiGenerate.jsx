import React, { useMemo, useState } from "react";
import { motion } from "framer-motion";
import katex from "katex";
import "katex/dist/katex.min.css";
import { generateQuestions } from "../lib/aiClient";
import { makeQuestionsApi } from "../lib/questionsApi";

const CHAPTERS = [
  ["Ch.1", "矩阵与线性方程组"],
  ["Ch.2", "行列式"],
  ["Ch.3", "向量空间"],
  ["Ch.4", "线性变换"],
  ["Ch.5", "正交性"],
  ["Ch.6", "特征值"],
  ["Ch.7", "数值线性代数"],
];
const TYPES = ["概念", "计算", "证明", "应用"];
const DIFFS = ["基础", "进阶", "挑战"];
const COUNTS = [3, 5, 10, 20];

const CSS = `
.ag{--ink:#0f1220;--mut:#6b7184;--faint:#9aa0b4;--line:#e7e8ef;--card:#fff;--brand:#4338ca;--brand-soft:#eef0ff;--brand-ink:#3730a3;--mono:ui-monospace,Menlo,Consolas,monospace;color:var(--ink)}
.ag-card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:22px;margin-bottom:16px}.ag-step{font-family:var(--mono);font-size:11px;letter-spacing:.1em;color:var(--faint);text-transform:uppercase;margin:0 0 12px}
.ag-chips{display:flex;flex-wrap:wrap;gap:8px}.ag-chip{font-size:13px;border:1px solid var(--line);background:var(--card);color:#3a3f55;padding:8px 13px;border-radius:9px;cursor:pointer;transition:.12s;user-select:none}.ag-chip:hover{border-color:var(--brand)}.ag-chip.on{background:var(--brand);border-color:var(--brand);color:#fff}.ag-chip .sub{font-family:var(--mono);font-size:11px;opacity:.7;margin-left:6px}
.ag-go{background:var(--brand);color:#fff;border:none;border-radius:11px;padding:13px 22px;font-size:15px;font-weight:600;cursor:pointer;font-family:inherit;transition:.15s}.ag-go:hover{background:var(--brand-ink)}.ag-go:disabled{opacity:.5;cursor:not-allowed}
.ag-q{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin-bottom:10px}.ag-qh{display:flex;gap:8px;align-items:center;margin-bottom:8px}.ag-tag{font-family:var(--mono);font-size:11px;padding:2px 8px;border-radius:6px;background:var(--brand-soft);color:var(--brand-ink)}.ag-stem{font-size:14px;margin-bottom:8px}.ag-opt{font-size:13px;color:#3a3f55;padding:3px 0 3px 14px}.ag-ans{font-size:13px;color:var(--mut);margin-top:6px;padding-top:8px;border-top:1px dashed var(--line)}
.ag-loading{font-family:var(--mono);font-size:13px;color:var(--brand);padding:24px;text-align:center}.ag-err{background:#fdeaef;color:#be123c;border-radius:10px;padding:12px 14px;font-size:13px;margin-bottom:12px}.ag-bar{display:flex;gap:10px;align-items:center;margin-top:14px}.ag-bar .sp{flex:1}.ag-btn{font-size:13px;border:1px solid var(--line);background:#fff;color:#3a3f55;border-radius:9px;padding:9px 15px;cursor:pointer;font-family:inherit}.ag-btn:hover{border-color:var(--brand);color:var(--brand)}.ag-btn.primary{background:var(--brand);border-color:var(--brand);color:#fff}
`;

function useCSS() {
  React.useEffect(() => {
    if (document.getElementById("ag-style")) return;
    const style = document.createElement("style");
    style.id = "ag-style";
    style.textContent = CSS;
    document.head.appendChild(style);
  }, []);
}

function renderMath(text) {
  try {
    return <span dangerouslySetInnerHTML={{ __html: katex.renderToString(String(text || ""), { throwOnError: false }) }} />;
  } catch {
    return <span>{text}</span>;
  }
}

export default function AiGenerate({ supabase, userId = null, onSaved }) {
  useCSS();
  const api = useMemo(() => makeQuestionsApi(supabase), [supabase]);
  const [chapter, setChapter] = useState("Ch.1");
  const [types, setTypes] = useState(new Set(["计算"]));
  const [difficulty, setDifficulty] = useState("基础");
  const [count, setCount] = useState(5);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState([]);

  const toggleType = (type) => setTypes((prev) => {
    const next = new Set(prev);
    next.has(type) ? next.delete(type) : next.add(type);
    return next.size ? next : prev;
  });

  const doGenerate = async () => {
    setError("");
    setPreview([]);
    setLoading(true);
    try {
      const chapterTitle = CHAPTERS.find(([c]) => c === chapter)?.[1] || "";
      const questions = await generateQuestions({ chapter, chapterTitle, types: [...types], difficulty, count });
      if (!questions.length) throw new Error("AI 没有返回可解析题目，请重试");
      setPreview(questions.map((q, i) => ({ ...q, _key: i })));
    } catch (err) {
      setError(err?.message || "生成失败");
    } finally {
      setLoading(false);
    }
  };

  const doSave = async () => {
    setSaving(true);
    setError("");
    const chapterTitle = CHAPTERS.find(([c]) => c === chapter)?.[1] || "";
    const rows = preview.map((q) => ({
      question: q.question,
      options: q.options || [],
      answer: q.answer || "",
      explanation: q.explanation || "",
      chapter,
      chapter_title: chapterTitle,
      type: q.type || [...types][0] || "计算",
      difficulty: q.difficulty || difficulty,
      source: "ai",
      owner: "public",
      answer_status: q.answer ? "generated" : "pending",
      created_by: userId || null,
    }));
    const result = await api.insertQuestions(rows);
    setSaving(false);
    if (!result.ok) {
      setError(`保存失败：${result.error}`);
      return;
    }
    setPreview([]);
    onSaved?.(result.data.length);
    alert(`已保存 ${result.data.length} 道题到 AI 题库`);
  };

  return (
    <div className="ag">
      <div className="ag-card">
        <p className="ag-step">Step 1 · 选章节</p>
        <div className="ag-chips">{CHAPTERS.map(([c, title]) => <span key={c} className={`ag-chip${chapter === c ? " on" : ""}`} onClick={() => setChapter(c)}>{c}<span className="sub">{title}</span></span>)}</div>
      </div>
      <div className="ag-card">
        <p className="ag-step">Step 2 · 题型（可多选）</p>
        <div className="ag-chips">{TYPES.map((t) => <span key={t} className={`ag-chip${types.has(t) ? " on" : ""}`} onClick={() => toggleType(t)}>{t}</span>)}</div>
      </div>
      <div className="ag-card">
        <p className="ag-step">Step 3 · 难度 & 数量</p>
        <div className="ag-chips" style={{ marginBottom: 12 }}>{DIFFS.map((d) => <span key={d} className={`ag-chip${difficulty === d ? " on" : ""}`} onClick={() => setDifficulty(d)}>{d}</span>)}</div>
        <div className="ag-chips">{COUNTS.map((n) => <span key={n} className={`ag-chip${count === n ? " on" : ""}`} onClick={() => setCount(n)}>{n} 题</span>)}</div>
        <div className="ag-bar"><span className="sp" /><button className="ag-go" onClick={doGenerate} disabled={loading}>{loading ? "AI 生成中..." : "生成题目"}</button></div>
      </div>
      {error && <div className="ag-err">{error}</div>}
      {loading && <div className="ag-loading">AI 正在出题，请稍候...</div>}
      {preview.length > 0 && (
        <div className="ag-card">
          <p className="ag-step">预览 · {preview.length} 题（确认后保存）</p>
          {preview.map((q) => (
            <motion.div key={q._key} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="ag-q">
              <div className="ag-qh"><span className="ag-tag">{chapter}</span><span className="ag-tag">{q.type || "计算"}</span><span className="ag-tag">{q.difficulty || difficulty}</span></div>
              <div className="ag-stem">{renderMath(q.question)}</div>
              {(q.options || []).map((opt, i) => <div key={i} className="ag-opt">{renderMath(opt)}</div>)}
              {q.answer && <div className="ag-ans">答案：{renderMath(q.answer)}</div>}
            </motion.div>
          ))}
          <div className="ag-bar"><span className="sp" /><button className="ag-btn" onClick={() => setPreview([])}>丢弃</button><button className="ag-btn primary" onClick={doSave} disabled={saving}>{saving ? "保存中..." : `保存 ${preview.length} 题`}</button></div>
        </div>
      )}
    </div>
  );
}
