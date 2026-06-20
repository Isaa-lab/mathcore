import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MathText from "../lib/MathText";
import { makeWorkbenchApi } from "../lib/workbenchApi";
import {
  extractPaper,
  extractPaperFromText,
  extractQuestionsFromText,
  extractAnswersFromImage,
  extractAnswersFromText,
  gradeItem,
  solveQuestion,
} from "../lib/workbenchAI";

// ── PDF helpers ──────────────────────────────────────────────────────────────
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
    onProgress?.(`${file.name} 第 ${i}/${pdf.numPages} 页渲染…`);
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
    onProgress?.(`${file.name} 第 ${i}/${pdf.numPages} 页文字提取…`);
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    parts.push(content.items.map((it) => it.str).join(" "));
  }
  return parts.join("\n\n");
}

function fileToDataURI(file) {
  return new Promise((res) => {
    const reader = new FileReader();
    reader.onload = () => res(reader.result);
    reader.onerror = () => res(null);
    reader.readAsDataURL(file);
  });
}

const MIN_TEXT_DENSITY = 60;

// 从任意文件（图片或 PDF）提取题目信息
async function extractFromFiles(files, mode, onProgress) {
  let items = [];
  for (const f of files) {
    onProgress?.(`处理 ${f.name}…`);
    if (f.type === "application/pdf") {
      const text = await pdfToText(f, onProgress);
      if (text.replace(/\s+/g, "").length >= MIN_TEXT_DENSITY) {
        if (mode === "questions") {
          onProgress?.("AI 识别题目结构…");
          const parsed = await extractQuestionsFromText(text);
          items = items.concat(parsed);
        } else {
          onProgress?.("AI 解析题目和答案…");
          items = items.concat(await extractPaperFromText(text, "together"));
        }
      } else {
        const uris = await pdfToImageURIs(f, onProgress);
        onProgress?.(`AI 视觉识别 ${f.name}…`);
        for (const uri of uris) items = items.concat(await extractPaper(uri, "together"));
      }
    } else {
      const uri = await fileToDataURI(f);
      if (!uri) continue;
      if (mode === "questions") {
        const parsed = await extractPaper(uri, "together");
        items = items.concat(parsed.map((x) => ({ number: x.number, question: x.question })));
      } else {
        items = items.concat(await extractPaper(uri, "together"));
      }
    }
  }
  return items;
}

// 从答案文件提取答案列表
async function extractAnswersFromFiles(files, onProgress) {
  let answers = [];
  for (const f of files) {
    onProgress?.(`识别答案 ${f.name}…`);
    if (f.type === "application/pdf") {
      const text = await pdfToText(f, onProgress);
      if (text.replace(/\s+/g, "").length >= MIN_TEXT_DENSITY) {
        answers = answers.concat(await extractAnswersFromText(text));
      } else {
        const uris = await pdfToImageURIs(f, onProgress);
        for (const uri of uris) answers = answers.concat(await extractAnswersFromImage(uri));
      }
    } else {
      const uri = await fileToDataURI(f);
      if (uri) answers = answers.concat(await extractAnswersFromImage(uri));
    }
  }
  return answers;
}

// 按题号合并题目和答案
function mergeQuestionsAnswers(questions, answers) {
  const ansMap = {};
  for (const a of answers) {
    const key = String(a.number || "").trim().toLowerCase();
    if (key) ansMap[key] = { studentAnswer: a.studentAnswer || "", answerConfidence: a.answerConfidence || "high" };
  }
  return questions.map((q) => {
    const key = String(q.number || "").trim().toLowerCase();
    const ans = ansMap[key] || {};
    return {
      number: q.number,
      question: q.question,
      studentAnswer: ans.studentAnswer ?? (q.studentAnswer || ""),
      answerConfidence: ans.answerConfidence ?? (q.answerConfidence || "low"),
    };
  });
}

// ── CSS ──────────────────────────────────────────────────────────────────────
const CSS = `
.pp{--ink:#0f1220;--mut:#6b7184;--faint:#9aa0b4;--line:#e7e8ef;--soft:#f0f1f6;--card:#fff;--brand:#4338ca;--brand-soft:#eef0ff;--emerald:#047857;--emerald-soft:#e7f6ef;--rose:#be123c;--rose-soft:#fdeaef;--amber:#d97706;--amber-soft:#fef3e2;color:var(--ink);height:100%;display:flex;flex-direction:column}
.pp-tabs{display:flex;gap:6px;margin-bottom:10px}
.pp-tab{font-size:12px;border:1px solid var(--line);background:#fff;color:#3a3f55;border-radius:7px;padding:5px 12px;cursor:pointer;transition:.12s;user-select:none}
.pp-tab:hover{border-color:var(--brand)}.pp-tab.on{background:var(--brand);border-color:var(--brand);color:#fff}
.pp-drop{border:1.5px dashed var(--line);border-radius:12px;padding:16px;text-align:center;color:var(--mut);font-size:13px;cursor:pointer;transition:.15s;background:var(--card)}
.pp-drop.hot{border-color:var(--brand);background:var(--brand-soft);color:#3730a3}
.pp-drop b{color:var(--brand)}
.pp-drop-sm{padding:12px 10px;font-size:12px}
.pp-flist{margin-top:6px;display:flex;flex-direction:column;gap:3px}
.pp-fitem{font-size:11px;font-family:ui-monospace,monospace;color:var(--mut);background:var(--soft);border-radius:5px;padding:3px 7px;display:flex;align-items:center;gap:5px}
.pp-fitem .rm{cursor:pointer;color:var(--rose);font-size:13px;line-height:1;margin-left:auto}
.pp-zones{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:8px}
.pp-zone-hd{font-size:11px;font-family:ui-monospace,monospace;color:var(--mut);margin-bottom:5px}
.pp-status{font-family:ui-monospace,monospace;font-size:12px;color:var(--brand);padding:8px 0;text-align:center}
.pp-list{flex:1;overflow-y:auto;margin-top:10px}
.pp-item{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:13px 14px;margin-bottom:10px;transition:.12s}
.pp-item.clickable{cursor:pointer}.pp-item.clickable:hover{border-color:#d7d9e6}
.pp-item.active{border-color:var(--brand);box-shadow:0 0 0 1px var(--brand)}
.pp-item.wrong{border-left:3px solid var(--rose)}.pp-item.correct{border-left:3px solid var(--emerald)}
.pp-item.solving{opacity:.65}
.pp-ih{display:flex;align-items:center;gap:8px;margin-bottom:7px;flex-wrap:wrap}
.pp-num{font-family:ui-monospace,monospace;font-size:12px;color:var(--faint)}
.pp-badge{font-family:ui-monospace,monospace;font-size:11px;padding:2px 8px;border-radius:6px}
.pp-b-correct{background:var(--emerald-soft);color:var(--emerald)}.pp-b-wrong{background:var(--rose-soft);color:var(--rose)}
.pp-b-low{background:var(--amber-soft);color:var(--amber)}.pp-b-kp{background:var(--brand-soft);color:#3730a3}
.pp-b-solving{background:#f0f1f6;color:var(--mut)}.pp-b-solved{background:var(--emerald-soft);color:var(--emerald)}
.pp-b-failed{background:var(--rose-soft);color:var(--rose)}
.pp-q{font-size:14px;margin-bottom:6px;line-height:1.6}
.pp-ans{font-size:13px;color:var(--mut)}.pp-ans .lab{font-family:ui-monospace,monospace;font-size:11px;color:var(--faint);margin-right:6px}
.pp-sol{margin-top:8px;padding-top:8px;border-top:1px solid var(--line);font-size:13px}
.pp-sol-hd{font-family:ui-monospace,monospace;font-size:11px;color:var(--emerald);margin-bottom:4px;display:flex;align-items:center;gap:6px;cursor:pointer;user-select:none}
.pp-sol-body{line-height:1.8;color:var(--ink)}
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
  const [hotQ, setHotQ] = useState(false);
  const [hotA, setHotA] = useState(false);
  const [status, setStatus] = useState("");
  const [items, setItems] = useState([]);
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState("");
  const [paperLayout, setPaperLayout] = useState("together");
  // 分开模式：暂存题目/答案文件
  const [qFiles, setQFiles] = useState([]);
  const [aFiles, setAFiles] = useState([]);
  const fileRef = useRef(null);
  const qRef = useRef(null);
  const aRef = useRef(null);

  // ── 在一起模式：单区上传 ──
  const handleTogether = useCallback(async (files) => {
    if (!files?.length) return;
    if (!userId) { alert("请先登录"); return; }
    const allFiles = [...files].filter((f) => f.type.startsWith("image/") || f.type === "application/pdf");
    if (!allFiles.length) { setStatus("请上传图片或 PDF 文件"); return; }
    try {
      let extracted = [];
      let localPaperId = null;
      const ensurePaper = async (imageUrls = []) => {
        if (localPaperId) return localPaperId;
        const p = await wb.createPaper({ userId, imageUrls });
        localPaperId = p.id;
        return localPaperId;
      };
      const imageFiles = allFiles.filter((f) => f.type.startsWith("image/"));
      const pdfFiles = allFiles.filter((f) => f.type === "application/pdf");
      if (imageFiles.length) {
        setStatus(`上传图片 (${imageFiles.length} 张)…`);
        const urls = await wb.uploadImages(imageFiles, userId);
        if (urls.length) {
          await ensurePaper(urls);
          setStatus("AI 识别题目和手写答案…");
          for (let i = 0; i < urls.length; i++) {
            setStatus(`AI 识别第 ${i + 1}/${urls.length} 张…`);
            const uri = await wb.imageToDataURI(urls[i]);
            if (uri) extracted = extracted.concat(await extractPaper(uri, paperLayout));
          }
        }
      }
      for (const pdf of pdfFiles) {
        setStatus(`处理 ${pdf.name}…`);
        const text = await pdfToText(pdf, setStatus);
        await ensurePaper();
        if (text.replace(/\s+/g, "").length >= MIN_TEXT_DENSITY) {
          setStatus("AI 解析题目…");
          const r = await extractPaperFromText(text, paperLayout);
          if (r.length) { extracted = extracted.concat(r); }
          else {
            const uris = await pdfToImageURIs(pdf, setStatus);
            for (let i = 0; i < uris.length; i++) {
              setStatus(`视觉识别第 ${i + 1}/${uris.length} 页…`);
              extracted = extracted.concat(await extractPaper(uris[i], paperLayout));
            }
          }
        } else {
          const uris = await pdfToImageURIs(pdf, setStatus);
          for (let i = 0; i < uris.length; i++) {
            setStatus(`视觉识别扫描页 ${i + 1}/${uris.length}…`);
            extracted = extracted.concat(await extractPaper(uris[i], paperLayout));
          }
        }
      }
      if (!extracted.length) { setStatus("没识别出题目，请检查文件"); return; }
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
      setStatus(`识别完成，共 ${saved.length} 道题。核对答案后点「全部批改」。`);
    } catch (err) { setStatus("出错：" + (err.message || err)); }
  }, [userId, wb, paperLayout]);

  // ── 分开模式：合并题目文件 + 答案文件 ──
  const processSeparate = useCallback(async () => {
    if (!userId) { alert("请先登录"); return; }
    if (!qFiles.length || !aFiles.length) return;
    try {
      setStatus("提取题目…");
      const questions = await extractFromFiles(qFiles, "questions", setStatus);
      if (!questions.length) { setStatus("题目识别失败，请检查题目文件"); return; }
      setStatus(`提取到 ${questions.length} 道题，识别学生答案…`);
      const answers = await extractAnswersFromFiles(aFiles, setStatus);
      setStatus("AI 匹配题目和答案…");
      const merged = mergeQuestionsAnswers(questions, answers);
      const paper = await wb.createPaper({ userId, imageUrls: [] });
      const rows = merged.map((item) => ({
        paper_id: paper.id,
        user_id: userId,
        number: item.number || "",
        question: item.question || "",
        student_answer: item.studentAnswer || "",
        answer_confidence: item.answerConfidence || "low",
        reviewed: false,
        is_correct: null,
      }));
      const saved = await wb.insertItems(rows);
      setItems(saved);
      await wb.setPaperStatus(paper.id, "reviewing");
      setStatus(`匹配完成，共 ${saved.length} 道题。请核对答案后批改。`);
    } catch (err) { setStatus("出错：" + (err.message || err)); }
  }, [userId, wb, qFiles, aFiles]);

  const saveAnswer = async (item) => {
    const updated = await wb.updateItem(item.id, { student_answer: draft, reviewed: true });
    setItems((prev) => prev.map((x) => (x.id === item.id ? { ...x, ...updated } : x)));
    setEditing(null); setDraft("");
  };

  const gradeAll = async () => {
    setStatus("AI 批改中…");
    const graded = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      setStatus(`批改 ${i + 1}/${items.length}：第 ${item.number} 题…`);
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

  const removeQFile = (idx) => setQFiles((prev) => prev.filter((_, i) => i !== idx));
  const removeAFile = (idx) => setAFiles((prev) => prev.filter((_, i) => i !== idx));

  const needGrade = items.length > 0 && items.some((x) => x.is_correct === null);
  const isSep = paperLayout === "separate";

  const dragHandlers = (setH, onDrop) => ({
    onDragOver: (e) => { e.preventDefault(); e.stopPropagation(); setH(true); },
    onDragEnter: (e) => { e.preventDefault(); e.stopPropagation(); setH(true); },
    onDragLeave: (e) => { e.preventDefault(); e.stopPropagation(); setH(false); },
    onDrop: (e) => { e.preventDefault(); e.stopPropagation(); setH(false); if (e.dataTransfer?.files?.length) onDrop(e.dataTransfer.files); },
  });

  return (
    <>
      <div className="pp-layout-pick">
        <span className="pp-lp-label">卷子格式：</span>
        {[{ key: "together", label: "题目+答案在一起" }, { key: "separate", label: "题目和答案分开" }].map((opt) => (
          <span key={opt.key} className={"pp-lp-opt" + (paperLayout === opt.key ? " on" : "")} onClick={() => setPaperLayout(opt.key)}>{opt.label}</span>
        ))}
      </div>

      {!isSep ? (
        /* ── 在一起模式：单区 ── */
        <>
          <div
            className={"pp-drop" + (hot ? " hot" : "")}
            {...dragHandlers(setHot, handleTogether)}
            onClick={() => fileRef.current?.click()}
            role="button" tabIndex={0}
          >
            点击或拖入卷子 <b>图片 / PDF</b><br />
            <span style={{ fontSize: 12 }}>题目打印 + 手写答案；支持多张/多页</span>
          </div>
          <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple hidden
            onChange={(e) => handleTogether(e.target.files)} />
        </>
      ) : (
        /* ── 分开模式：双区 ── */
        <>
          <div className="pp-zones">
            <div>
              <div className="pp-zone-hd">题目文件（PDF / 图片）</div>
              <div
                className={"pp-drop pp-drop-sm" + (hotQ ? " hot" : "")}
                {...dragHandlers(setHotQ, (fs) => setQFiles((prev) => [...prev, ...[...fs]]))}
                onClick={() => qRef.current?.click()}
                role="button" tabIndex={0}
              >
                拖入 <b>题目</b>
              </div>
              <input ref={qRef} type="file" accept="image/*,application/pdf" multiple hidden
                onChange={(e) => setQFiles((prev) => [...prev, ...[...e.target.files]])} />
              {qFiles.length > 0 && (
                <div className="pp-flist">
                  {qFiles.map((f, i) => (
                    <div key={i} className="pp-fitem">
                      <span>📄</span>{f.name}
                      <span className="rm" onClick={() => removeQFile(i)}>×</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <div className="pp-zone-hd">学生答案（图片 / PDF）</div>
              <div
                className={"pp-drop pp-drop-sm" + (hotA ? " hot" : "")}
                {...dragHandlers(setHotA, (fs) => setAFiles((prev) => [...prev, ...[...fs]]))}
                onClick={() => aRef.current?.click()}
                role="button" tabIndex={0}
              >
                拖入 <b>手写答案</b>
              </div>
              <input ref={aRef} type="file" accept="image/*,application/pdf" multiple hidden
                onChange={(e) => setAFiles((prev) => [...prev, ...[...e.target.files]])} />
              {aFiles.length > 0 && (
                <div className="pp-flist">
                  {aFiles.map((f, i) => (
                    <div key={i} className="pp-fitem">
                      <span>✏️</span>{f.name}
                      <span className="rm" onClick={() => removeAFile(i)}>×</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          {qFiles.length > 0 && aFiles.length > 0 && (
            <button className="pp-btn primary" onClick={processSeparate}>
              识别并匹配 ({qFiles.length} 题目文件 + {aFiles.length} 答案文件)
            </button>
          )}
          {(qFiles.length === 0 || aFiles.length === 0) && (
            <div style={{ fontSize: 12, color: "var(--faint)", textAlign: "center", padding: "6px 0" }}>
              {qFiles.length === 0 ? "请上传题目文件" : "请上传学生答案"}
            </div>
          )}
        </>
      )}

      {status && <div className="pp-status">{status}</div>}
      {needGrade && <button className="pp-btn primary" style={{ marginTop: 8 }} onClick={gradeAll}>全部批改（判对错 + 分析）</button>}

      <div className="pp-list">
        {items.length === 0
          ? <div className="pp-empty">还没有题目<br />{isSep ? "分别上传题目和手写答案文件，AI 会匹配" : "上传卷子图片或 PDF，AI 识别题目和答案"}</div>
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
  const [items, setItems] = useState([]);
  const fileInputRef = useRef(null);

  const handleFiles = useCallback(async (files) => {
    if (!files?.length) return;
    const allFiles = [...files].filter((f) => f.type.startsWith("image/") || f.type === "application/pdf");
    if (!allFiles.length) { setStatus("请上传图片或 PDF 文件"); return; }
    try {
      setItems([]);
      let questions = [];
      for (const f of allFiles) {
        setStatus(`读取 ${f.name}…`);
        if (f.type === "application/pdf") {
          const text = await pdfToText(f, setStatus);
          if (text.replace(/\s+/g, "").length >= MIN_TEXT_DENSITY) {
            setStatus("AI 识别题目结构…");
            questions = questions.concat(await extractQuestionsFromText(text));
          } else {
            const uris = await pdfToImageURIs(f, setStatus);
            for (let i = 0; i < uris.length; i++) {
              setStatus(`视觉识别第 ${i + 1}/${uris.length} 页…`);
              const parsed = await extractPaper(uris[i], "together");
              questions = questions.concat(parsed.map((x) => ({ number: x.number, question: x.question })));
            }
          }
        } else {
          const uri = await fileToDataURI(f);
          if (!uri) continue;
          setStatus(`AI 识别图片题目…`);
          const parsed = await extractPaper(uri, "together");
          questions = questions.concat(parsed.map((x) => ({ number: x.number, question: x.question })));
        }
      }
      if (!questions.length) { setStatus("没有识别到题目，请检查文件"); return; }
      setItems(questions.map((q) => ({ ...q, solution: null, knowledgePoints: [], chapter: "", solving: true, expanded: true, failed: false })));
      setStatus(`识别到 ${questions.length} 道题，AI 解题中…`);
      for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        setStatus(`解题 ${i + 1}/${questions.length}：${q.number}…`);
        try {
          const result = await solveQuestion(q.number, q.question);
          const ok = result?.solution && result.solution.trim().length > 10;
          setItems((prev) => prev.map((x, idx) =>
            idx === i ? { ...x, solution: ok ? result.solution : null, knowledgePoints: result?.knowledgePoints || [], chapter: result?.chapter || "", solving: false, failed: !ok } : x
          ));
        } catch {
          setItems((prev) => prev.map((x, idx) =>
            idx === i ? { ...x, solving: false, failed: true } : x
          ));
        }
      }
      setStatus(`全部完成，共 ${questions.length} 道题。`);
    } catch (err) { setStatus("出错：" + (err.message || err)); }
  }, []);

  const retryItem = useCallback(async (idx, item) => {
    setItems((prev) => prev.map((x, i) => i === idx ? { ...x, solving: true, failed: false } : x));
    try {
      const result = await solveQuestion(item.number, item.question);
      const ok = result?.solution && result.solution.trim().length > 10;
      setItems((prev) => prev.map((x, i) =>
        i === idx ? { ...x, solution: ok ? result.solution : null, knowledgePoints: result?.knowledgePoints || [], chapter: result?.chapter || "", solving: false, failed: !ok } : x
      ));
    } catch {
      setItems((prev) => prev.map((x, i) => i === idx ? { ...x, solving: false, failed: true } : x));
    }
  }, []);

  const dragH = {
    onDragOver: (e) => { e.preventDefault(); e.stopPropagation(); setHot(true); },
    onDragEnter: (e) => { e.preventDefault(); e.stopPropagation(); setHot(true); },
    onDragLeave: (e) => { e.preventDefault(); e.stopPropagation(); setHot(false); },
    onDrop: (e) => { e.preventDefault(); e.stopPropagation(); setHot(false); if (e.dataTransfer?.files?.length) handleFiles(e.dataTransfer.files); },
  };

  return (
    <>
      <div className={"pp-drop" + (hot ? " hot" : "")} {...dragH} onClick={() => fileInputRef.current?.click()} role="button" tabIndex={0}>
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
                  : item.failed
                    ? <span className="pp-badge pp-b-failed">解题失败</span>
                    : <span className="pp-badge pp-b-solved">已解答</span>}
                {item.chapter && <span className="pp-badge pp-b-kp">{item.chapter}</span>}
                {(item.knowledgePoints || []).slice(0, 1).map((pt) => <span key={pt} className="pp-badge pp-b-kp">{pt}</span>)}
                {item.failed && !item.solving && (
                  <button className="pp-btn mini" style={{ marginLeft: "auto" }} onClick={() => retryItem(idx, item)}>重试</button>
                )}
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
  const [mode, setMode] = useState("grade");
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
