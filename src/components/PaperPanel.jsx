import React, { useCallback, useMemo, useRef, useState } from "react";
import MathText from "../lib/MathText";
import { makeWorkbenchApi } from "../lib/workbenchApi";
import { extractPaper, gradeItem } from "../lib/workbenchAI";

const CSS = `
.pp{--ink:#0f1220;--mut:#6b7184;--faint:#9aa0b4;--line:#e7e8ef;--soft:#f0f1f6;--card:#fff;--brand:#4338ca;--brand-soft:#eef0ff;--emerald:#047857;--emerald-soft:#e7f6ef;--rose:#be123c;--rose-soft:#fdeaef;--amber:#d97706;--amber-soft:#fef3e2;color:var(--ink);height:100%;display:flex;flex-direction:column}
.pp-drop{border:1.5px dashed var(--line);border-radius:14px;padding:22px;text-align:center;color:var(--mut);font-size:13px;cursor:pointer;transition:.15s;background:var(--card)}
.pp-drop.hot{border-color:var(--brand);background:var(--brand-soft);color:#3730a3}
.pp-drop b{color:var(--brand)}
.pp-status{font-family:ui-monospace,monospace;font-size:12px;color:var(--brand);padding:10px 0;text-align:center}
.pp-list{flex:1;overflow-y:auto;margin-top:12px}
.pp-item{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:13px 14px;margin-bottom:10px;cursor:pointer;transition:.12s}
.pp-item:hover{border-color:#d7d9e6}.pp-item.active{border-color:var(--brand);box-shadow:0 0 0 1px var(--brand)}
.pp-item.wrong{border-left:3px solid var(--rose)}.pp-item.correct{border-left:3px solid var(--emerald)}
.pp-ih{display:flex;align-items:center;gap:8px;margin-bottom:7px}.pp-num{font-family:ui-monospace,monospace;font-size:12px;color:var(--faint)}
.pp-badge{font-family:ui-monospace,monospace;font-size:11px;padding:2px 8px;border-radius:6px}.pp-b-correct{background:var(--emerald-soft);color:var(--emerald)}.pp-b-wrong{background:var(--rose-soft);color:var(--rose)}.pp-b-low{background:var(--amber-soft);color:var(--amber)}.pp-b-kp{background:var(--brand-soft);color:#3730a3}
.pp-q{font-size:14px;margin-bottom:6px}.pp-ans{font-size:13px;color:var(--mut)}.pp-ans .lab{font-family:ui-monospace,monospace;font-size:11px;color:var(--faint);margin-right:6px}
.pp-edit{width:100%;border:1px solid var(--line);border-radius:8px;padding:7px 9px;font:inherit;font-size:13px;margin-top:4px;outline:none}.pp-edit:focus{border-color:var(--brand)}
.pp-actions{display:flex;gap:6px;margin-top:9px}.pp-btn{font-size:12px;border:1px solid var(--line);background:#fff;color:#3a3f55;border-radius:7px;padding:5px 10px;cursor:pointer;font-family:inherit}.pp-btn.primary{background:var(--brand);border-color:var(--brand);color:#fff}.pp-btn.mini{padding:3px 8px;font-size:11px}
.pp-empty{text-align:center;color:var(--faint);padding:30px 14px;font-size:13px;line-height:1.7}.pp-flip{margin-left:auto;font-family:ui-monospace,monospace;font-size:11px;color:var(--brand);cursor:pointer;background:none;border:none}
.pp-layout-pick{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-bottom:10px}.pp-lp-label{font-size:12px;color:var(--mut)}.pp-lp-opt{font-size:12px;border:1px solid var(--line);background:#fff;color:#3a3f55;border-radius:7px;padding:5px 10px;cursor:pointer;transition:.12s;user-select:none}.pp-lp-opt:hover{border-color:var(--brand)}.pp-lp-opt.on{background:var(--brand);border-color:var(--brand);color:#fff}
`;

function useCSS() {
  React.useEffect(() => {
    if (document.getElementById("pp-style")) return;
    const style = document.createElement("style");
    style.id = "pp-style";
    style.textContent = CSS;
    document.head.appendChild(style);
  }, []);
}

export default function PaperPanel({ supabase, userId, activeItemId, onSelectItem, onItemsGraded }) {
  useCSS();
  const wb = useMemo(() => makeWorkbenchApi(supabase), [supabase]);
  const [hot, setHot] = useState(false);
  const [status, setStatus] = useState("");
  const [items, setItems] = useState([]);
  const [paperId, setPaperId] = useState(null);
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState("");
  const [paperLayout, setPaperLayout] = useState("together");
  const fileInputRef = useRef(null);

  const handleFiles = useCallback(async (files) => {
    if (!files?.length) return;
    if (!userId) {
      alert("请先登录后再上传卷子");
      return;
    }
    const imageFiles = [...files].filter((file) => file.type.startsWith("image/"));
    if (!imageFiles.length) {
      setStatus("当前先支持图片卷子；多页 PDF 转图下一步再加。");
      return;
    }
    try {
      setStatus("上传卷子中...");
      const urls = await wb.uploadImages(imageFiles, userId);
      if (!urls.length) {
        setStatus("上传失败，请重试");
        return;
      }
      const paper = await wb.createPaper({ userId, imageUrls: urls });
      setPaperId(paper.id);
      setStatus("AI 正在识别题目和手写答案...");
      let extracted = [];
      for (const path of urls) {
        const uri = await wb.imageToDataURI(path);
        if (!uri) continue;
        extracted = extracted.concat(await extractPaper(uri, paperLayout));
      }
      if (!extracted.length) {
        setStatus("没识别出题目，换张清晰的图试试");
        return;
      }
      const rows = extracted.map((item) => ({
        paper_id: paper.id,
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
      await wb.setPaperStatus(paper.id, "reviewing");
      setStatus(`识别完成，共 ${saved.length} 道题。请核对手写答案后点「全部批改」。`);
    } catch (error) {
      setStatus("出错：" + (error.message || error));
    }
  }, [userId, wb, paperLayout]);

  const saveAnswer = async (item) => {
    const updated = await wb.updateItem(item.id, { student_answer: draft, reviewed: true });
    setItems((prev) => prev.map((x) => (x.id === item.id ? { ...x, ...updated } : x)));
    setEditing(null);
    setDraft("");
  };

  const gradeAll = async () => {
    setStatus("AI 批改中...");
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
      } catch {
        graded.push(item);
      }
    }
    setItems(graded);
    await wb.bumpMastery(userId, graded);
    if (paperId) await wb.setPaperStatus(paperId, "analyzed");
    setStatus(`批改完成：错 ${graded.filter((item) => item.is_correct === false).length} 题。点错题开始辅导。`);
    onItemsGraded?.(graded);
  };

  const flipCorrect = async (item) => {
    const next = !item.is_correct;
    const updated = await wb.updateItem(item.id, { is_correct: next, error_type: next ? null : (item.error_type || "计算") });
    setItems((prev) => prev.map((x) => (x.id === item.id ? { ...x, ...updated } : x)));
  };

  const needGrade = items.length > 0 && items.some((item) => item.is_correct === null);

  const onDragOver = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setHot(true);
  };
  const onDragLeave = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setHot(false);
  };
  const onDrop = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setHot(false);
    if (event.dataTransfer?.files?.length) handleFiles(event.dataTransfer.files);
  };

  return (
    <div className="pp">
      <div className="pp-layout-pick">
        <span className="pp-lp-label">这份卷子是：</span>
        {[
          { key: "together", label: "题目+答案在一起" },
          { key: "separate", label: "题目和答案分开" },
        ].map((option) => (
          <span
            key={option.key}
            className={"pp-lp-opt" + (paperLayout === option.key ? " on" : "")}
            onClick={() => setPaperLayout(option.key)}
          >
            {option.label}
          </span>
        ))}
      </div>

      <div
        className={"pp-drop" + (hot ? " hot" : "")}
        onDragOver={onDragOver}
        onDragEnter={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
        role="button"
        tabIndex={0}
      >
        点击或拖入卷子 <b>图片</b><br />
        <span style={{ fontSize: 12 }}>题目打印、答案手写都可以</span>
      </div>
      <input ref={fileInputRef} type="file" accept="image/*,.pdf" multiple hidden onChange={(event) => handleFiles(event.target.files)} />
      {status && <div className="pp-status">{status}</div>}
      {needGrade && <button className="pp-btn primary" style={{ marginTop: 8 }} onClick={gradeAll}>全部批改（判对错 + 分析）</button>}
      <div className="pp-list">
        {items.length === 0 ? (
          <div className="pp-empty">还没有题目<br />上传一张卷子，AI 会识别出题目和你的手写答案</div>
        ) : items.map((item) => {
          const isWrong = item.is_correct === false;
          const isRight = item.is_correct === true;
          const isEditing = editing === item.id;
          return (
            <div
              key={item.id}
              className={"pp-item" + (activeItemId === item.id ? " active" : "") + (isWrong ? " wrong" : isRight ? " correct" : "")}
              onClick={() => item.is_correct !== null && onSelectItem?.(item)}
            >
              <div className="pp-ih">
                <span className="pp-num">#{item.number || "—"}</span>
                {isWrong && <span className="pp-badge pp-b-wrong">错</span>}
                {isRight && <span className="pp-badge pp-b-correct">对</span>}
                {item.answer_confidence === "low" && <span className="pp-badge pp-b-low">字迹待确认</span>}
                {(item.knowledge_points || []).slice(0, 1).map((point) => <span key={point} className="pp-badge pp-b-kp">{point}</span>)}
                {item.is_correct !== null && <button className="pp-flip" onClick={(event) => { event.stopPropagation(); flipCorrect(item); }}>判错了？点这翻转</button>}
              </div>
              <div className="pp-q"><MathText text={item.question} /></div>
              <div className="pp-ans">
                <span className="lab">我的答案</span>
                {isEditing ? (
                  <>
                    <textarea className="pp-edit" value={draft} onClick={(event) => event.stopPropagation()} onChange={(event) => setDraft(event.target.value)} />
                    <div className="pp-actions">
                      <button className="pp-btn mini primary" onClick={(event) => { event.stopPropagation(); saveAnswer(item); }}>保存</button>
                      <button className="pp-btn mini" onClick={(event) => { event.stopPropagation(); setEditing(null); }}>取消</button>
                    </div>
                  </>
                ) : (
                  <span onClick={(event) => { event.stopPropagation(); setEditing(item.id); setDraft(item.student_answer || ""); }} style={{ cursor: "text" }}>
                    <MathText text={item.student_answer || "(空白，点击补充)"} />
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
