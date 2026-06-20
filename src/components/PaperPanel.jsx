import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MathText from "../lib/MathText";
import { makeWorkbenchApi } from "../lib/workbenchApi";
import {
  extractPaper,
  extractPaperFromText,
  extractQuestionsFromText,
  gradeItem,
  solveQuestion,
} from "../lib/workbenchAI";

// Lazy-load PDF.js (webpack 5 / CRA 5 handles new URL() natively)
let _pdfjsLib = null;
async function getPdfjs() {
  if (_pdfjsLib) return _pdfjsLib;
  const lib = await import("pdfjs-dist");
  lib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
  ).href;
  _pdfjsLib = lib;
  return lib;
}

async function pdfToImageURIs(file, onProgress) {
  const pdfjs = await getPdfjs();
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const uris = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    onProgress?.(`第 ${i}/${pdf.numPages} 页渲染中…`);
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 2.0 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    uris.push(canvas.toDataURL("image/jpeg", 0.88));
  }
  return uris;
}

async function pdfToText(file, onProgress) {
  const pdfjs = await getPdfjs();
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const parts = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    onProgress?.(`第 ${i}/${pdf.numPages} 页文字提取…`);
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    parts.push(content.items.map((it) => it.str).join(" "));
  }
  return parts.join("\n\n");
}

const MIN_TEXT_DENSITY = 60;

const CSS = `
.pp{--ink:#0f1220;--mut:#6b7184;--faint:#9aa0b4;--line:#e7e8ef;--soft:#f0f1f6;--card:#fff;--brand:#4338ca;--brand-soft:#eef0ff;--emerald:#047857;--emerald-soft:#e7f6ef;--rose:#be123c;--rose-soft:#fdeaef;--amber:#d97706;--amber-soft:#fef3e2;color:var(--ink);height:100%;display:flex;flex-direction:column}
.pp-tabs{display:flex;gap:6px;margin-bottom:10px}
.pp-tab{font-size:12px;border:1px solid var(--line);background:#fff;color:#3a3f55;border-radius:7px;padding:5px 12px;cursor:pointer;transition:.12s;user-select:none}
.pp-tab:hover{border-color:var(--brand)}.pp-tab.on{background:var(--brand);border-color:var(--brand);color:#fff}
.pp-drop{border:1.5px dashed var(--line);border-radius:14px;padding:22px;text-align:center;color:var(--mut);font-size:13px;cursor:pointer;transition:.15s;background:var(--card)}
.pp-drop.hot{border-color:var(--brand);background:var(--brand-soft);color:#3730a3}
.pp-drop b{color:var(--brand)}
.pp-status{font-family:ui-monospace,monospace;font-size:12px;color:var(--brand);padding:10px 0;text-align:center}
.pp-list{flex:1;overflow-y:auto;margin-top:12px}
.pp-item{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:13px 14px;margin-bottom:10px;transition:.12s}
.pp-item.clickable{cursor:pointer}.pp-item.clickable:hover{border-color:#d7d9e6}
.pp-item.active{border-color:var(--brand);box-shadow:0 0 0 1px var(--brand)}
.pp-item.wrong{border-left:3px solid var(--rose)}.pp-item.correct{border-left:3px solid var(--emerald)}
.pp-item.solving{opacity:.7}
.pp-ih{display:flex;align-items:center;gap:8px;margin-bottom:7px}.pp-num{font-family:ui-monospace,monospace;font-size:12px;color:var(--faint)}
.pp-badge{font-family:ui-monospace,monospace;font-size:11px;padding:2px 8px;border-radius:6px}
.pp-b-correct{background:var(--emerald-soft);color:var(--emerald)}.pp-b-wrong{background:var(--rose-soft);color:var(--rose)}
.pp-b-low{background:var(--amber-soft);color:var(--amber)}.pp-b-kp{background:var(--brand-soft);color:#3730a3}
.pp-b-solving{background:#f0f1f6;color:var(--mut)}.pp-b-solved{background:var(--emerald-soft);color:var(--emerald)}
.pp-q{font-size:14px;margin-bottom:6px}.pp-ans{font-size:13px;color:var(--mut)}
.pp-ans .lab{font-family:ui-monospace,monospace;font-size:11px;color:var(--faint);margin-right:6px}
.pp-sol{margin-top:8px;padding-top:8px;border-top:1px solid var(--line);font-size:13px}
.pp-sol-hd{font-family:ui-monospace,monospace;font-size:11px;color:var(--emerald);margin-bottom:4px;display:flex;align-items:center;gap:6px;cursor:pointer;user-select:none}
.pp-sol-body{line-height:1.7;color:var(--ink)}
.pp-edit{width:100%;border:1px solid var(--line);border-radius:8px;padding:7px 9px;font:inherit;font-size:13px;margin-top:4px;outline:none}.pp-edit:focus{border-color:var(--brand)}
.pp-actions{display:flex;gap:6px;margin-top:9px}
.pp-btn{font-size:12px;border:1px solid var(--line);background:#fff;color:#3a3f55;border-radius:7px;padding:5px 10px;cursor:pointer;font-family:inherit}
.pp-btn.primary{background:var(--brand);border-color:var(--brand);color:#fff}.pp-btn.mini{padding:3px 8px;font-size:11px}
.pp-empty{text-align:center;color:var(--faint);padding:30px 14px;font-size:13px;line-height:1.7}
.pp-flip{margin-left:auto;font-family:ui-monospace,monospace;font-size:11px;color:var(--brand);cursor:pointer;background:none;border:none}
.pp-layout-pick{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-bottom:10px}
.pp-lp-label{font-size:12px;color:var(--mut)}
.pp-lp-opt{font-size:12px;border:1px solid var(--line);background:#fff;color:#3a3f55;border-radius:7px;padding:5px 10px;cursor:pointer;transition:.12s;user-select:none}
.pp-lp-opt:hover{border-color:var(--brand)}.pp-lp-opt.on{background:var(--brand);border-color:var(--brand);color:#fff}
`;

function useCSS() {
  useEffect(() => {
    if (document.getElementById("pp-style")) return;
    const s = document.createElement("style");
    s.id = "pp-style";
    s.textContent = CSS;
    document.head.appendChild(s);
  }, []);
}

// ── 批改模式 ─────────────────────────────────────────────────────────────────
function GradePanel({ supabase, userId, activeItemId, onSelectItem, onItemsGraded }) {
  const wb = useMemo(() => makeWorkbenchApi(supabase), [supabase]);
  const [hot, setHot] = useState(false);
  const [status, setStatus] = useState("");
  const [items, setItems] = useState([]);
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState("");
  const [paperLayout, setPaperLayout] = useState("together");
  const fileInputRef = useRef(null);

  const handleFiles = useCallback(async (files) => {
    if (!files?.length) return;
    if (!userId) { alert("请先登录后再上传卷子"); return; }

    const allFiles = [...files];
    const imageFiles = allFiles.filter((f) => f.type.startsWith("image/"));
    const pdfFiles = allFiles.filter((f) => f.type === "application/pdf");
    if (!imageFiles.length && !pdfFiles.length) { setStatus("请上传图片或 PDF 文件"); return; }

    try {
      let extracted = [];
      // localPaperId 用局部变量追踪，避免 React state 异步更新导致读到旧值
      let localPaperId = null;

      const ensurePaper = async (imageUrls = []) => {
        if (localPaperId) return localPaperId;
        const paper = await wb.createPaper({ userId, imageUrls });
        localPaperId = paper.id;
        return localPaperId;
      };

      // ── 图片 ──
      if (imageFiles.length > 0) {
        setStatus("上传图片中…");
        const urls = await wb.uploadImages(imageFiles, userId);
        if (urls.length) {
          await ensurePaper(urls);
          setStatus("AI 正在识别题目和手写答案…");
          for (const path of urls) {
            const uri = await wb.imageToDataURI(path);
            if (uri) extracted = extracted.concat(await extractPaper(uri, paperLayout));
          }
        }
      }

      // ── PDF ──
      for (const pdf of pdfFiles) {
        setStatus(`处理 ${pdf.name}…`);
        const text = await pdfToText(pdf, setStatus);
        const isTextPdf = text.replace(/\s+/g, "").length >= MIN_TEXT_DENSITY;

        if (isTextPdf) {
          setStatus("PDF 文字版 — AI 解析题目中…");
          await ensurePaper();
          const items2 = await extractPaperFromText(text, paperLayout);
          if (items2.length) {
            extracted = extracted.concat(items2);
          } else {
            setStatus("文字解析无结果，转图片识别…");
            const uris = await pdfToImageURIs(pdf, setStatus);
            setStatus("AI 视觉识别 PDF 页面…");
            await ensurePaper();
            for (const uri of uris) extracted = extracted.concat(await extractPaper(uri, paperLayout));
          }
        } else {
          await ensurePaper();
          const uris = await pdfToImageURIs(pdf, setStatus);
          setStatus(`AI 视觉识别扫描版 PDF（${uris.length} 页）…`);
          for (const uri of uris) extracted = extracted.concat(await extractPaper(uri, paperLayout));
        }
      }

      if (!extracted.length) { setStatus("没识别出题目，请换张清晰的图或文字版 PDF 再试"); return; }

      const rows = extracted.map((item) => ({
        paper_id: localPaperId,
        user_id: userId,
        number: item.number || "",
        question: item.question || "",
        student_answer: item.studentAnswer || "",
        answer_confidence: item.answerConfidence || "high",
        reviewed: false,
        is_correct: null,
      }));
      const saved = await wb.insertItems(rows);
      setItems(saved);
      await wb.setPaperStatus(localPaperId, "reviewing");
      setStatus(`识别完成，共 ${saved.length} 道题。请核对答案后点「全部批改」。`);
    } catch (err) {
      setStatus("出错：" + (err.message || err));
    }
  }, [userId, wb, paperLayout]);

  const saveAnswer = async (item) => {
    const updated = await wb.updateItem(item.id, { student_answer: draft, reviewed: true });
    setItems((prev) => prev.map((x) => (x.id === item.id ? { ...x, ...updated } : x)));
    setEditing(null); setDraft("");
  };

  const gradeAll = async () => {
    setStatus("AI 批改中…");
    const graded = [];
    for (const item of items) {
      try {
        const result = await gradeItem({ question: item.question, studentAnswer: item.student_answer });
        const patch = {
          correct_answer: result?.correctAnswer || "",
          is_correct: !!result?.isCorrect,
          error_type: result?.isCorrect ? null : (result?.errorType || "计算"),
          error_detail: result?.errorDetail || "",
          knowledge_points: result?.knowledgePoints || [],
          chapter: result?.chapter || "Ch.?",
          reviewed: true,
        };
        const updated = await wb.updateItem(item.id, patch);
        graded.push(updated || { ...item, ...patch });
      } catch { graded.push(item); }
    }
    setItems(graded);
    await wb.bumpMastery(userId, graded);
    setStatus(`批改完成：错 ${graded.filter((x) => x.is_correct === false).length} 题。点错题开始辅导。`);
    onItemsGraded?.(graded);
  };

  const flipCorrect = async (item) => {
    const next = !item.is_correct;
    const updated = await wb.updateItem(item.id, { is_correct: next, error_type: next ? null : (item.error_type || "计算") });
    setItems((prev) => prev.map((x) => (x.id === item.id ? { ...x, ...updated } : x)));
  };

  const needGrade = items.length > 0 && items.some((x) => x.is_correct === null);
  const onDragOver = (e) => { e.preventDefault(); e.stopPropagation(); setHot(true); };
  const onDragLeave = (e) => { e.preventDefault(); e.stopPropagation(); setHot(false); };
  const onDrop = (e) => { e.preventDefault(); e.stopPropagation(); setHot(false); if (e.dataTransfer?.files?.length) handleFiles(e.dataTransfer.files); };

  return (
    <>
      <div className="pp-layout-pick">
        <span className="pp-lp-label">卷子格式：</span>
        {[{ key: "together", label: "题目+答案在一起" }, { key: "separate", label: "题目和答案分开" }].map((opt) => (
          <span key={opt.key} className={"pp-lp-opt" + (paperLayout === opt.key ? " on" : "")} onClick={() => setPaperLayout(opt.key)}>{opt.label}</span>
        ))}
      </div>
      <div className={"pp-drop" + (hot ? " hot" : "")} onDragOver={onDragOver} onDragEnter={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop} onClick={() => fileInputRef.current?.click()} role="button" tabIndex={0}>
        点击或拖入卷子 <b>图片 / PDF</b><br />
        <span style={{ fontSize: 12 }}>题目打印 + 手写答案；PDF 支持文字版和扫描版</span>
      </div>
      <input ref={fileInputRef} type="file" accept="image/*,application/pdf" multiple hidden onChange={(e) => handleFiles(e.target.files)} />
      {status && <div className="pp-status">{status}</div>}
      {needGrade && <button className="pp-btn primary" style={{ marginTop: 8 }} onClick={gradeAll}>全部批改（判对错 + 分析）</button>}
      <div className="pp-list">
        {items.length === 0
          ? <div className="pp-empty">还没有题目<br />上传含手写答案的卷子图片或 PDF</div>
          : items.map((item) => {
            const isWrong = item.is_correct === false;
            const isRight = item.is_correct === true;
            const isEditing = editing === item.id;
            return (
              <div key={item.id} className={"pp-item clickable" + (activeItemId === item.id ? " active" : "") + (isWrong ? " wrong" : isRight ? " correct" : "")} onClick={() => item.is_correct !== null && onSelectItem?.(item)}>
                <div className="pp-ih">
                  <span className="pp-num">#{item.number || "—"}</span>
                  {isWrong && <span className="pp-badge pp-b-wrong">错</span>}
                  {isRight && <span className="pp-badge pp-b-correct">对</span>}
                  {item.answer_confidence === "low" && <span className="pp-badge pp-b-low">字迹待确认</span>}
                  {(item.knowledge_points || []).slice(0, 1).map((pt) => <span key={pt} className="pp-badge pp-b-kp">{pt}</span>)}
                  {item.is_correct !== null && <button className="pp-flip" onClick={(e) => { e.stopPropagation(); flipCorrect(item); }}>判错了？翻转</button>}
                </div>
                <div className="pp-q"><MathText text={item.question} /></div>
                <div className="pp-ans">
                  <span className="lab">我的答案</span>
                  {isEditing ? (
                    <>
                      <textarea className="pp-edit" value={draft} onClick={(e) => e.stopPropagation()} onChange={(e) => setDraft(e.target.value)} />
                      <div className="pp-actions">
                        <button className="pp-btn mini primary" onClick={(e) => { e.stopPropagation(); saveAnswer(item); }}>保存</button>
                        <button className="pp-btn mini" onClick={(e) => { e.stopPropagation(); setEditing(null); }}>取消</button>
                      </div>
                    </>
                  ) : (
                    <span onClick={(e) => { e.stopPropagation(); setEditing(item.id); setDraft(item.student_answer || ""); }} style={{ cursor: "text" }}>
                      <MathText text={item.student_answer || "(空白，点击补充)"} />
                    </span>
                  )}
                </div>
              </div>
            );
          })}
      </div>
    </>
  );
}

// ── 解题模式 ─────────────────────────────────────────────────────────────────
function SolvePanel() {
  const [hot, setHot] = useState(false);
  const [status, setStatus] = useState("");
  // items: { number, question, solution, knowledgePoints, chapter, solving, expanded }
  const [items, setItems] = useState([]);
  const fileInputRef = useRef(null);

  const handleFiles = useCallback(async (files) => {
    if (!files?.length) return;
    const allFiles = [...files];
    const imageFiles = allFiles.filter((f) => f.type.startsWith("image/"));
    const pdfFiles = allFiles.filter((f) => f.type === "application/pdf");
    if (!imageFiles.length && !pdfFiles.length) { setStatus("请上传图片或 PDF 文件"); return; }

    try {
      setItems([]);
      let questions = []; // [{ number, question }]

      // ── PDF ──
      for (const pdf of pdfFiles) {
        setStatus(`读取 ${pdf.name}…`);
        const text = await pdfToText(pdf, setStatus);
        const isTextPdf = text.replace(/\s+/g, "").length >= MIN_TEXT_DENSITY;
        if (isTextPdf) {
          setStatus("AI 识别题目结构…");
          const parsed = await extractQuestionsFromText(text);
          questions = questions.concat(parsed);
        } else {
          // 扫描版：渲染图片 → 用视觉识别提取题目
          const uris = await pdfToImageURIs(pdf, setStatus);
          setStatus("视觉识别扫描版题目…");
          for (const uri of uris) {
            // extractPaper 会返回带 question 字段的 items
            const parsed = await extractPaper(uri, "together");
            questions = questions.concat(parsed.map((x) => ({ number: x.number, question: x.question })));
          }
        }
      }

      // ── 图片 ──
      for (const img of imageFiles) {
        setStatus(`识别图片 ${img.name}…`);
        const reader = new FileReader();
        const uri = await new Promise((res) => { reader.onload = () => res(reader.result); reader.readAsDataURL(img); });
        const parsed = await extractPaper(uri, "together");
        questions = questions.concat(parsed.map((x) => ({ number: x.number, question: x.question })));
      }

      if (!questions.length) { setStatus("没有识别到题目，请检查文件"); return; }

      // 展示占位，逐题解答
      setItems(questions.map((q) => ({ ...q, solution: null, knowledgePoints: [], chapter: "", solving: true, expanded: true })));
      setStatus(`识别到 ${questions.length} 道题，AI 解题中…`);

      for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        setStatus(`解题中 ${i + 1}/${questions.length}：${q.number}…`);
        try {
          const result = await solveQuestion(q.number, q.question);
          setItems((prev) => prev.map((x, idx) =>
            idx === i ? { ...x, solution: result?.solution || "（解题失败，请重试）", knowledgePoints: result?.knowledgePoints || [], chapter: result?.chapter || "", solving: false } : x
          ));
        } catch {
          setItems((prev) => prev.map((x, idx) =>
            idx === i ? { ...x, solution: "（出错，请重试）", solving: false } : x
          ));
        }
      }
      setStatus(`全部解答完成，共 ${questions.length} 道题。`);
    } catch (err) {
      setStatus("出错：" + (err.message || err));
    }
  }, []);

  const onDragOver = (e) => { e.preventDefault(); e.stopPropagation(); setHot(true); };
  const onDragLeave = (e) => { e.preventDefault(); e.stopPropagation(); setHot(false); };
  const onDrop = (e) => { e.preventDefault(); e.stopPropagation(); setHot(false); if (e.dataTransfer?.files?.length) handleFiles(e.dataTransfer.files); };

  return (
    <>
      <div className={"pp-drop" + (hot ? " hot" : "")} onDragOver={onDragOver} onDragEnter={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop} onClick={() => fileInputRef.current?.click()} role="button" tabIndex={0}>
        点击或拖入 <b>题目 PDF / 图片</b><br />
        <span style={{ fontSize: 12 }}>只有题目没有答案；AI 自动生成完整解答</span>
      </div>
      <input ref={fileInputRef} type="file" accept="image/*,application/pdf" multiple hidden onChange={(e) => handleFiles(e.target.files)} />
      {status && <div className="pp-status">{status}</div>}
      <div className="pp-list">
        {items.length === 0
          ? <div className="pp-empty">还没有题目<br />上传一份试卷或作业 PDF，AI 会给出完整解答</div>
          : items.map((item, idx) => (
            <div key={idx} className={"pp-item" + (item.solving ? " solving" : "")}>
              <div className="pp-ih">
                <span className="pp-num">{item.number || `#${idx + 1}`}</span>
                {item.solving
                  ? <span className="pp-badge pp-b-solving">解题中…</span>
                  : <span className="pp-badge pp-b-solved">已解答</span>}
                {item.chapter && <span className="pp-badge pp-b-kp">{item.chapter}</span>}
                {(item.knowledgePoints || []).slice(0, 1).map((pt) => <span key={pt} className="pp-badge pp-b-kp">{pt}</span>)}
              </div>
              <div className="pp-q"><MathText text={item.question} /></div>
              {!item.solving && item.solution && (
                <div className="pp-sol">
                  <div className="pp-sol-hd" onClick={() => setItems((prev) => prev.map((x, i) => i === idx ? { ...x, expanded: !x.expanded } : x))}>
                    AI 解答 {item.expanded ? "▲" : "▼"}
                  </div>
                  {item.expanded && <div className="pp-sol-body"><MathText text={item.solution} /></div>}
                </div>
              )}
            </div>
          ))}
      </div>
    </>
  );
}

// ── 主组件 ────────────────────────────────────────────────────────────────────
export default function PaperPanel({ supabase, userId, activeItemId, onSelectItem, onItemsGraded }) {
  useCSS();
  const [mode, setMode] = useState("grade"); // "grade" | "solve"

  return (
    <div className="pp">
      <div className="pp-tabs">
        <span className={"pp-tab" + (mode === "grade" ? " on" : "")} onClick={() => setMode("grade")}>批改卷子</span>
        <span className={"pp-tab" + (mode === "solve" ? " on" : "")} onClick={() => setMode("solve")}>AI 解题</span>
      </div>
      {mode === "grade"
        ? <GradePanel supabase={supabase} userId={userId} activeItemId={activeItemId} onSelectItem={onSelectItem} onItemsGraded={onItemsGraded} />
        : <SolvePanel />}
    </div>
  );
}
