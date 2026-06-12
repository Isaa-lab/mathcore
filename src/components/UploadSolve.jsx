import React, { useCallback, useEffect, useMemo, useState } from "react";
import { solveUploaded } from "../lib/aiClient";
import { makeQuestionsApi } from "../lib/questionsApi";
import MathText from "../lib/MathText";

const CSS = `
.us{--ink:#0f1220;--mut:#6b7184;--faint:#9aa0b4;--line:#e7e8ef;--soft:#f0f1f6;--card:#fff;--brand:#4338ca;--brand-soft:#eef0ff;--brand-ink:#3730a3;--emerald:#047857;--emerald-soft:#e7f6ef;--mono:ui-monospace,Menlo,Consolas,monospace;color:var(--ink)}
.us-card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:22px;margin-bottom:16px}.us-h{font-size:16px;font-weight:600;margin:0 0 4px}.us-sub{font-size:13px;color:var(--mut);margin:0 0 14px}.us-ta{width:100%;min-height:120px;border:1px solid var(--line);border-radius:11px;padding:13px;font:inherit;font-size:14px;resize:vertical;outline:none}.us-ta:focus{border-color:var(--brand)}
.us-bar{display:flex;gap:10px;align-items:center;margin-top:12px}.us-bar .sp{flex:1}.us-btn{font-size:14px;border:1px solid var(--line);background:#fff;color:#3a3f55;border-radius:10px;padding:10px 18px;cursor:pointer;font-family:inherit}.us-btn:hover{border-color:var(--brand);color:var(--brand)}.us-btn.primary{background:var(--brand);border-color:var(--brand);color:#fff}.us-btn:disabled{opacity:.5;cursor:not-allowed}
.us-result{margin-top:16px;border:1px solid var(--line);border-radius:12px;overflow:hidden}.us-rh{background:var(--brand-soft);color:var(--brand-ink);padding:10px 14px;font-family:var(--mono);font-size:12px;display:flex;gap:8px;align-items:center}.us-rtag{background:#fff;border-radius:5px;padding:1px 7px}.us-rbody{padding:14px;font-size:14px;color:#3a3f55;line-height:1.7}.us-thm{margin-top:10px;display:flex;flex-wrap:wrap;gap:6px}.us-thm .tg{font-family:var(--mono);font-size:11px;background:var(--brand-soft);color:var(--brand-ink);padding:2px 7px;border-radius:5px}
.us-saved{background:var(--emerald-soft);color:var(--emerald);border-radius:9px;padding:10px 13px;font-size:13px;margin-top:12px;display:flex;align-items:center;gap:8px}.us-loading{font-family:var(--mono);font-size:13px;color:var(--brand);padding:18px;text-align:center}.us-err{background:#fdeaef;color:#be123c;border-radius:10px;padding:12px 14px;font-size:13px;margin-top:12px}.us-mine{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:13px 16px;margin-bottom:10px}.us-mh{display:flex;gap:8px;align-items:center;margin-bottom:7px}.us-tag{font-family:var(--mono);font-size:11px;padding:2px 8px;border-radius:6px;background:var(--soft);color:#475569}.us-empty{text-align:center;color:var(--faint);padding:30px;font-size:13px}.us-ey{font-family:var(--mono);font-size:11px;letter-spacing:.1em;color:var(--faint);text-transform:uppercase;margin:0 0 12px}
`;

function useCSS() {
  React.useEffect(() => {
    if (document.getElementById("us-style")) return;
    const style = document.createElement("style");
    style.id = "us-style";
    style.textContent = CSS;
    document.head.appendChild(style);
  }, []);
}

export default function UploadSolve({ supabase, userId = null }) {
  useCSS();
  const api = useMemo(() => makeQuestionsApi(supabase), [supabase]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [saved, setSaved] = useState(false);
  const [isPublic, setIsPublic] = useState(false);
  const [mine, setMine] = useState([]);

  const loadMine = useCallback(async () => {
    if (!userId) {
      setMine([]);
      return;
    }
    const data = await api.listQuestions({ source: "upload", owner: userId }, userId);
    setMine(data);
  }, [api, userId]);

  useEffect(() => { loadMine(); }, [loadMine]);

  const doSolve = async () => {
    const qText = text.trim();
    if (!qText) return;
    setError("");
    setSaved(false);
    setResult(null);
    setLoading(true);
    try {
      const solved = await solveUploaded(qText);
      if (!solved?.answer) throw new Error("AI 没有返回有效解答，请重试");
      setResult(solved);
    } catch (err) {
      setError(err?.message || "解答失败");
    } finally {
      setLoading(false);
    }
  };

  const doSave = async () => {
    if (!result || !text.trim()) return;
    setSaving(true);
    setError("");
    const row = {
      question: text.trim(),
      options: [],
      answer: result.answer || "",
      explanation: result.explanation || "",
      chapter: result.chapter || "Ch.?",
      type: result.type || "计算",
      difficulty: result.difficulty || "基础",
      source: "upload",
      owner: isPublic ? "public" : (userId || "anon"),
      answer_status: "generated",
      theorems: result.theorems || [],
      created_by: userId || null,
    };
    const res = await api.insertQuestions([row]);
    setSaving(false);
    if (!res.ok) {
      setError(`保存失败：${res.error}`);
      return;
    }
    setSaved(true);
    setText("");
    setResult(null);
    loadMine();
  };

  return (
    <div className="us">
      <div className="us-card">
        <p className="us-h">上传我的题目</p>
        <p className="us-sub">粘贴课本题或作业题，AI 解答后可存进题库重复练。</p>
        <textarea className="us-ta" placeholder="把题目粘贴到这里..." value={text} onChange={(e) => setText(e.target.value)} />
        <div className="us-bar">
          <label style={{ fontSize: 13, color: "#6b7184", display: "flex", gap: 7, alignItems: "center" }}>
            <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
            公开此题（不勾则仅自己可见）
          </label>
          <span className="sp" />
          <button className="us-btn primary" onClick={doSolve} disabled={loading || !text.trim()}>{loading ? "AI 解答中..." : "AI 解答"}</button>
        </div>
        {loading && <div className="us-loading">AI 正在解答...</div>}
        {error && <div className="us-err">{error}</div>}
        {result && (
          <div className="us-result">
            <div className="us-rh"><span className="us-rtag">{result.chapter || "Ch.?"}</span><span className="us-rtag">{result.type || "计算"}</span><span className="us-rtag">{result.difficulty || "基础"}</span></div>
            <div className="us-rbody">
              <MathText text={result.answer} />
              {(result.theorems || []).length > 0 && <div className="us-thm">{result.theorems.map((t, i) => <span key={i} className="tg">{t}</span>)}</div>}
            </div>
          </div>
        )}
        {result && <div className="us-bar"><span className="sp" /><button className="us-btn" onClick={() => setResult(null)}>重新解答</button><button className="us-btn primary" onClick={doSave} disabled={saving}>{saving ? "保存中..." : "存入题库"}</button></div>}
        {saved && <div className="us-saved">已存入题库，可在下方查看。</div>}
      </div>

      <div className="us-card">
        <p className="us-ey">我的题库 · {mine.length} 题{!userId && "（登录后可永久保存）"}</p>
        {mine.length === 0 ? <div className="us-empty">还没有上传的题。</div> : mine.map((q) => (
          <div key={q.id} className="us-mine">
            <div className="us-mh"><span className="us-tag">{q.chapter}</span><span className="us-tag">{q.type}</span><span className="us-tag">{q.difficulty}</span>{q.owner === "public" && <span className="us-tag">已公开</span>}</div>
            <div style={{ fontSize: 14 }}>{q.question}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
