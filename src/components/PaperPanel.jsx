import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MathText from "../lib/MathText";
import { makeWorkbenchApi } from "../lib/workbenchApi";
import { mapLimit } from "../utils/concurrency";
import FileEditModal from "./FileEditModal";
import EditableMath from "./EditableMath";
import {
  extractPaper,
  extractPaperFromText,
  extractQuestionsFromText,
  extractAnswersFromImage,
  extractAnswersFromText,
  alignAnswersToQuestions,
  repairOcr,
  gradeItem,
  verifyGrade,
  solveQuestion,
  autoLatex,
  toLatex,
  extractRegion,
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

// 打开 PDF；遇到加密/密码保护时抛出清晰的中文错误，而不是含糊的"识别失败"
async function loadPdfDoc(file) {
  const pdfjs = await getPdfjs();
  try {
    return await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  } catch (e) {
    const name = e?.name || "";
    const msg = e?.message || "";
    if (name === "PasswordException" || /password|encrypt/i.test(msg)) {
      throw new Error(`「${file.name}」有密码/加密保护，浏览器无法读取。请先去掉 PDF 密码（用阅读器「另存为/打印成 PDF」即可生成无密码版），或把题目截图成图片上传。`);
    }
    throw e;
  }
}

async function pdfToImageURIs(file, onProgress) {
  const pdf = await loadPdfDoc(file);
  const uris = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    onProgress?.(`${file.name} 第 ${i}/${pdf.numPages} 页渲染…`);
    const page = await pdf.getPage(i);
    const rawViewport = page.getViewport({ scale: 1 });
    const scale = Math.min(1.4, 1400 / rawViewport.width);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    uris.push(canvas.toDataURL("image/jpeg", 0.72));
  }
  return uris;
}

async function pdfToText(file, onProgress) {
  const pdf = await loadPdfDoc(file);
  const parts = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    onProgress?.(`${file.name} 第 ${i}/${pdf.numPages} 页文字提取…`);
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    parts.push(content.items.map((it) => it.str).join(" "));
  }
  return parts.join("\n\n");
}

// 把一张 dataURI 图片顺时针旋转 deg 度（90 的倍数），返回新的 dataURI。
// 用于校对界面"手动转正"：真旋转像素，布局正常，转正后可直接重跑 OCR。
function rotateDataUri(uri, deg = 90) {
  return new Promise((res) => {
    const img = new Image();
    img.onerror = () => res(uri);
    img.onload = () => {
      const d = ((deg % 360) + 360) % 360;
      const swap = d === 90 || d === 270;
      const canvas = document.createElement("canvas");
      canvas.width = swap ? img.height : img.width;
      canvas.height = swap ? img.width : img.height;
      const ctx = canvas.getContext("2d");
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((d * Math.PI) / 180);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);
      res(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.src = uri;
  });
}

// 按 0~1 比例矩形裁剪一张 dataURI 图片，返回裁剪后的 dataURI（用于"框选某区域重识别"）。
// 关键：框小区域时裁出来的块可能很小（如 250px），视觉模型拿到的 token 太少 → 读不清堆叠的数字/矩阵。
// 这里把小裁块放大到长边 ~1400px（最多 3x）并轻度增强对比，让 qwen-vl-max 看清每一行。
function cropFractionDataUri(uri, rect) {
  return new Promise((res) => {
    const img = new Image();
    img.onerror = () => res(null);
    img.onload = () => {
      const sx = Math.max(0, Math.round(rect.x * img.width));
      const sy = Math.max(0, Math.round(rect.y * img.height));
      const sw = Math.max(1, Math.round(rect.w * img.width));
      const sh = Math.max(1, Math.round(rect.h * img.height));
      const longSide = Math.max(sw, sh);
      const scale = Math.min(3, Math.max(1, 1400 / longSide)); // 只放大、不缩小，最多 3x
      const dw = Math.round(sw * scale), dh = Math.round(sh * scale);
      const c = document.createElement("canvas");
      c.width = dw; c.height = dh;
      const ctx = c.getContext("2d");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.filter = "contrast(1.25) brightness(1.03)"; // 轻度增强，手写笔迹更分明
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);
      res(c.toDataURL("image/jpeg", 0.92));
    };
    img.src = uri;
  });
}

// Compress image and optionally boost contrast (for light pencil handwriting).
// enhance=true: grayscale + contrast 1.6 + brightness 1.05 via canvas filter.
function fileToDataURI(file, { maxPx = 1600, quality = 0.85, enhance = false } = {}) {
  return new Promise((res) => {
    const reader = new FileReader();
    reader.onerror = () => res(null);
    reader.onload = (e) => {
      if (!file.type.startsWith("image/")) { res(e.target.result); return; }
      const img = new Image();
      img.onerror = () => res(e.target.result);
      img.onload = () => {
        const ratio = Math.min(1, maxPx / Math.max(img.width, img.height));
        const w = Math.round(img.width * ratio);
        const h = Math.round(img.height * ratio);
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (enhance) ctx.filter = "grayscale(100%) contrast(1.6) brightness(1.05)";
        ctx.drawImage(img, 0, 0, w, h);
        res(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

const MIN_TEXT_DENSITY = 60;

// 分数列（sql/paper_items_score.sql 加的）。用户没跑迁移时这些列不存在，写入会报错——
// 故所有写分数的地方都包一层：先带分数写，失败就剥掉分数列重试，保证主流程不被打断。
const SCORE_COLS = ["score_pct", "max_score", "score_source", "teacher_comment"];
const stripScoreCols = (row) => {
  const r = { ...row };
  for (const k of SCORE_COLS) delete r[k];
  return r;
};
const isMissingColumnErr = (e) => /column|score_pct|max_score|score_source|teacher_comment/i.test(String(e?.message || e));

// 老师红笔 → 得分百分比：写了数字用数字，否则按符号判定（✓→95 / 部分→55 / ✗→20）；没红笔返回 null。
function teacherScoreFromMarks(item) {
  const num = Number(item?.teacherScorePct);
  if (Number.isFinite(num)) return Math.max(0, Math.min(100, Math.round(num)));
  switch (item?.teacherMark) {
    case "correct": return 95;
    case "partial": return 55;
    case "wrong": return 20;
    default: return null;
  }
}

// 分数展示标签：有满分 → "8/10"，否则 → "85%"。无分数返回 null。
function scoreLabel(item) {
  const pct = Number(item?.score_pct);
  if (!Number.isFinite(pct)) return null;
  const max = Number(item?.max_score);
  if (Number.isFinite(max) && max > 0) return `${Math.round((pct / 100) * max * 10) / 10}/${max}`;
  return `${Math.round(pct)}%`;
}

// 获取题目图片供 AI 使用（印刷体，不需要增强）
// 关键：直接返回压缩 base64（内联图），不发 Supabase 签名链接——
// Gemini 官方只认 inlineData，豆包跨境抓外链会超时；内联图两家都能直接读。
async function getImageForAI(file, wb, userId) {
  return fileToDataURI(file, { maxPx: 1500, quality: 0.85 });
}

// 获取手写答案图片供 AI 使用（铅笔/浅色字迹需要增强对比度）
// 同样直接返回压缩 base64（增强对比度后），不发签名链接，避免豆包跨境抓图超时 / Gemini 拒收外链。
async function getAnswerImageForAI(file, wb, userId) {
  return fileToDataURI(file, { maxPx: 1500, quality: 0.85, enhance: true });
}

async function extractFromFiles(files, mode, onProgress, wb, userId) {
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
      onProgress?.(`上传 ${f.name} 到云端…`);
      const imgUrl = await getImageForAI(f, wb, userId);
      if (!imgUrl) continue;
      if (mode === "questions") {
        const parsed = await extractPaper(imgUrl, "together");
        items = items.concat(parsed.map((x) => ({ number: x.number, question: x.question })));
      } else {
        items = items.concat(await extractPaper(imgUrl, "together"));
      }
    }
  }
  return items;
}

// 从答案文件提取答案列表。questionNumbers：已知题号清单，传给 OCR 做对号入座。
// 返回 { answers, images }：answers 每条带 _img（来源图在 images 里的下标，无图为 -1）+ bbox，
// images 是可直接展示的答案原图（dataURI），供校对时画框定位。
async function extractAnswersFromFiles(files, onProgress, wb, userId, questionNumbers = []) {
  // 先把文件展开成有序的"识别单元"并登记展示图（这步是本地准备，快）；
  // 真正慢的 OCR 调用随后限并发执行，明显提速。
  const units = []; // {kind:'text', text} | {kind:'image', ocrUrl, imgIdx}
  const images = []; // 展示用原图（与 _img 下标对应）
  for (const f of files) {
    onProgress?.(`准备 ${f.name}…`);
    if (f.type === "application/pdf") {
      const text = await pdfToText(f, onProgress);
      if (text.replace(/\s+/g, "").length >= MIN_TEXT_DENSITY) {
        units.push({ kind: "text", text });
      } else {
        const uris = await pdfToImageURIs(f, onProgress);
        for (const uri of uris) units.push({ kind: "image", ocrUrl: uri, imgIdx: images.push(uri) - 1 });
      }
    } else {
      const imgUrl = await getAnswerImageForAI(f, wb, userId);
      if (imgUrl) {
        const displayUri = await fileToDataURI(f, { maxPx: 1100, quality: 0.85 }) || imgUrl;
        units.push({ kind: "image", ocrUrl: imgUrl, imgIdx: images.push(displayUri) - 1 });
      }
    }
  }
  onProgress?.(`识别 ${units.length} 页答案…`);
  // 串行识别（并发=1）：DashScope 视觉对并发敏感，2 路会互相拖慢直至 55s 超时；
  // 每页独占带宽更稳。慢一点但不失败。
  const results = await mapLimit(units, 1, async (u) => {
    if (u.kind === "text") return (await extractAnswersFromText(u.text, questionNumbers)).map((a) => ({ ...a, _img: -1 }));
    return (await extractAnswersFromImage(u.ocrUrl, questionNumbers)).map((a) => ({ ...a, _img: u.imgIdx }));
  });
  return { answers: results.flat(), images };
}

// 题号归一化：让 "Q2(i)"、"2.(i)"、"2 (I)" 都映射到同一个 key "2-i"
// 处理：去 Q/第/题 前缀、罗马数字大小写、括号/点/空白统一为 "-"
function canonicalNumber(raw) {
  let s = String(raw || "").trim().toLowerCase();
  if (!s) return "";
  s = s.replace(/^(?:q|第|题|no\.?|#)\s*/i, "");        // 去前缀
  s = s.replace(/[（）()\[\]{}.．、]+/g, "-");            // 各类括号/点 → -
  s = s.replace(/\s+/g, "-");                            // 空白 → -
  s = s.replace(/-+/g, "-").replace(/^-|-$/g, "");       // 收敛多余的 -
  return s;
}

// 合并题目和答案。优先用 AI 的"语义对齐"结果（alignMap: 题目下标→答案下标，按内容判断
// 答案实际在解哪道题）；语义对齐没覆盖到的题，退回按归一化题号匹配。
// 不做"按顺序兜底对齐"——那会静默配错（如把 2(ii) 的答案挂到 Q1）。
function mergeQuestionsAnswers(questions, answers, alignMap = null) {
  const ansMap = {}; // 归一化题号 → 答案对象
  for (const a of answers) {
    const key = canonicalNumber(a.number);
    if (key && key !== "?" && !(key in ansMap)) ansMap[key] = a;
  }
  return questions.map((q, qi) => {
    // 语义对齐优先：alignMap[qi] 是该题的答案段下标数组（一题可由多段拼成，如 ①②③）
    let segs = [];
    if (alignMap && Array.isArray(alignMap[qi]) && alignMap[qi].length) {
      segs = alignMap[qi].map((ai) => answers[ai]).filter(Boolean);
    } else {
      const m = ansMap[canonicalNumber(q.number)]; // 退回题号匹配
      if (m) segs = [m];
    }
    const first = segs[0] || null;
    const studentAnswer = segs.length
      ? segs.map((s) => s.studentAnswer || "").filter(Boolean).join("\n")
      : (q.studentAnswer || "");
    return {
      number: q.number,
      question: q.question,
      studentAnswer,
      answerConfidence: first ? (first.answerConfidence || "high") : (q.answerConfidence || "low"),
      bbox: first ? (first.bbox || null) : null,
      _img: first ? (first._img ?? -1) : -1,
    };
  });
}

// ── CSS ──────────────────────────────────────────────────────────────────────
const CSS = `
.pp{--ink:#0f1220;--mut:#6b7184;--faint:#9aa0b4;--line:#e7e8ef;--soft:#f0f1f6;--card:#fff;--brand:#4338ca;--brand-soft:#eef0ff;--emerald:#047857;--emerald-soft:#e7f6ef;--rose:#be123c;--rose-soft:#fdeaef;--amber:#d97706;--amber-soft:#fef3e2;color:var(--ink);flex:1;min-height:0;display:flex;flex-direction:column}
.pp-tabs{display:flex;gap:6px;margin-bottom:10px}
.pp-tab{font-size:12px;border:1px solid var(--line);background:#fff;color:#3a3f55;border-radius:7px;padding:5px 12px;cursor:pointer;transition:.12s;user-select:none}
.pp-tab:hover{border-color:var(--brand)}.pp-tab.on{background:var(--brand);border-color:var(--brand);color:#fff}
.pp-drop{border:1.5px dashed var(--line);border-radius:12px;padding:16px;text-align:center;color:var(--mut);font-size:13px;cursor:pointer;transition:.15s;background:var(--card)}
.pp-drop.hot{border-color:var(--brand);background:var(--brand-soft);color:#3730a3}
.pp-drop b{color:var(--brand)}
.pp-drop-sm{padding:12px 10px;font-size:12px}
.pp-flist{margin-top:6px;display:flex;flex-direction:column;gap:3px}
.pp-fitem{font-size:11px;font-family:ui-monospace,monospace;color:var(--mut);background:var(--soft);border-radius:5px;padding:3px 7px;display:flex;align-items:center;gap:5px}
.pp-fitem .fname{cursor:pointer;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pp-fitem .fname:hover{color:var(--brand);text-decoration:underline}
.pp-fitem .rm{cursor:pointer;color:var(--rose);font-size:13px;line-height:1;margin-left:8px}
.pp-zones{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:8px}
.pp-zone-hd{font-size:11px;font-family:ui-monospace,monospace;color:var(--mut);margin-bottom:5px}
.pp-status{font-family:ui-monospace,monospace;font-size:12px;color:var(--brand);padding:5px 0 3px;text-align:center}
.pp-prog-wrap{height:4px;border-radius:3px;background:#e7e8ef;margin:4px 0 6px;overflow:hidden}
.pp-prog-bar{height:100%;border-radius:3px;background:var(--brand);transition:width .3s ease}
.pp-prog-pct{font-family:ui-monospace,monospace;font-size:11px;color:var(--brand);text-align:right;margin-bottom:4px}
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
.pp-b-score{background:#eef2ff;color:#3730a3;font-variant-numeric:tabular-nums;font-weight:600}.pp-b-score.teacher{background:var(--rose-soft);color:var(--rose)}
.pp-b-solving{background:#f0f1f6;color:var(--mut)}.pp-b-solved{background:var(--emerald-soft);color:var(--emerald)}
.pp-b-failed{background:var(--rose-soft);color:var(--rose)}
.pp-q{font-size:14px;margin-bottom:6px;line-height:1.6}
.pp-ans{font-size:13px;color:var(--mut)}.pp-ans .lab{font-family:ui-monospace,monospace;font-size:11px;color:var(--faint);margin-right:6px}
.pp-sol{margin-top:8px;padding-top:8px;border-top:1px solid var(--line);font-size:13px}
.pp-sol-hd{font-family:ui-monospace,monospace;font-size:11px;color:var(--emerald);margin-bottom:4px;display:flex;align-items:center;gap:6px;cursor:pointer;user-select:none}
.pp-sol-body{line-height:1.8;color:var(--ink)}
.pp-edit{width:100%;border:1px solid var(--line);border-radius:8px;padding:7px 9px;font:inherit;font-size:13px;margin-top:4px;outline:none;resize:vertical;min-height:52px}.pp-edit:focus{border-color:var(--brand)}
.pp-preview{background:var(--brand-soft);border:1px solid #dfe2ff;border-radius:8px;padding:7px 10px;margin-top:6px;font-size:13px;color:#3730a3;line-height:1.7}
.pp-preview-label{font-family:ui-monospace,monospace;font-size:10px;color:var(--mut);display:block;margin-bottom:3px}
.pp-ans-val{padding:4px 8px;border-radius:7px;cursor:pointer;transition:.12s;line-height:1.7;display:inline-block;min-width:40px}
.pp-ans-val:hover{background:var(--soft)}
.pp-ans-val.unconfirmed{background:var(--amber-soft);border:1px dashed var(--amber);border-radius:7px;padding:5px 10px}
.pp-ans-val .pp-edit-hint{font-family:ui-monospace,monospace;font-size:10px;color:var(--faint);margin-left:6px;opacity:0;transition:.12s}
.pp-ans-val:hover .pp-edit-hint{opacity:1}
.pp-ans-empty{color:var(--faint);font-style:italic}
.pp-grade-warn{font-size:12px;color:var(--amber);background:var(--amber-soft);border-radius:7px;padding:5px 10px;margin-top:6px;text-align:center}
.pp-actions{display:flex;gap:6px;margin-top:9px}
.pp-btn{font-size:12px;border:1px solid var(--line);background:#fff;color:#3a3f55;border-radius:7px;padding:5px 10px;cursor:pointer;font-family:inherit}
.pp-btn.primary{background:var(--brand);border-color:var(--brand);color:#fff}.pp-btn.mini{padding:3px 8px;font-size:11px}
.pp-btn:disabled{opacity:.55;cursor:wait}
.pp-empty{text-align:center;color:var(--faint);padding:30px 14px;font-size:13px;line-height:1.7}
.pp-flip{margin-left:auto;font-family:ui-monospace,monospace;font-size:11px;color:var(--brand);cursor:pointer;background:none;border:none}
.pp-starbtn{background:none;border:none;cursor:pointer;font-size:16px;line-height:1;color:var(--amber);margin-left:6px;padding:0}
.pp-collapse-bar{font-size:12px;color:var(--brand);background:var(--brand-soft);border:1px solid #dfe2ff;border-radius:8px;padding:6px 12px;cursor:pointer;text-align:center;margin-bottom:8px;user-select:none;flex-shrink:0}
.pp-collapse-bar:hover{background:#e7e9ff}
.pp-layout-pick{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-bottom:10px}
.pp-lp-label{font-size:12px;color:var(--mut)}
.pp-lp-opt{font-size:12px;border:1px solid var(--line);background:#fff;color:#3a3f55;border-radius:7px;padding:5px 10px;cursor:pointer;transition:.12s;user-select:none}
.pp-lp-opt:hover{border-color:var(--brand)}.pp-lp-opt.on{background:var(--brand);border-color:var(--brand);color:#fff}
/* ── 校对模式 ── */
.pp-rv{display:flex;flex-direction:column;gap:12px;height:100%;overflow:hidden}
.pp-rv-hd{font-size:13px;font-weight:600;color:var(--ink);padding:2px 0 6px;border-bottom:1px solid var(--line);flex-shrink:0}
.pp-rv-hd span{font-size:11px;font-weight:400;color:var(--mut);margin-left:8px}
.pp-rv-body{display:grid;grid-template-columns:1fr 1fr;gap:12px;flex:1;min-height:0}
.pp-rv-imgs{display:flex;flex-direction:column;gap:8px;overflow:hidden}
.pp-rv-imgmain{position:relative;flex:1;min-height:0;overflow:hidden;border:1px solid var(--line);border-radius:10px;background:#f8f8fb;display:flex;align-items:center;justify-content:center}
/* 框选时整块取景区铺满全屏，图更大、可缩放/平移取景 */
.pp-rv-imgmain.framing-full{position:fixed;inset:0;z-index:9998;max-width:none;border:none;border-radius:0;background:rgba(15,18,32,.92)}
.pp-rv-imgmain.framing-full .pp-rv-zoom{flex-wrap:wrap;max-width:70vw;justify-content:flex-end}
/* 关键：全屏下按视口尺寸约束整张图（百分比 max-height 在自动高度的包裹层里会失效，导致竖图溢出底部）→ 用 vw/vh 让整页完整可见，再滚轮放大 */
.pp-rv-imgmain.framing-full .pp-rv-imgwrap,.pp-rv-imgmain.framing-full .pp-rv-imgwrap img{max-width:100vw;max-height:100vh}
.pp-rv-fratool{width:auto!important;padding:0 10px!important;font-size:12px!important}
.pp-rv-fratool.on{background:var(--brand)!important;border-color:var(--brand)!important;color:#fff!important}
.pp-rv-imgwrap{position:relative;display:inline-block;max-width:100%;max-height:100%;line-height:0;transform-origin:center center}
.pp-rv-imgwrap img{max-width:100%;max-height:100%;object-fit:contain;display:block;user-select:none;-webkit-user-drag:none}
.pp-rv-zoom{position:absolute;top:8px;right:8px;display:flex;gap:4px;z-index:3}
.pp-rv-zoom button{width:28px;height:28px;border:1px solid var(--line);background:rgba(255,255,255,.92);border-radius:6px;cursor:pointer;font-size:14px;line-height:1;color:#3a3f55}
.pp-rv-zoom button:hover{border-color:var(--brand);color:var(--brand)}
.pp-rv-box{position:absolute;border:2px solid var(--brand);background:rgba(67,56,202,.12);border-radius:3px;pointer-events:none;transition:all .15s ease}
.pp-rv-frame{border-style:dashed;border-color:var(--emerald);background:rgba(4,120,87,.14);transition:none}
.pp-rv-handle{position:absolute;width:14px;height:14px;background:#fff;border:2px solid var(--emerald);border-radius:50%;pointer-events:auto;z-index:4}
.pp-rv-handle-nw{left:-8px;top:-8px;cursor:nwse-resize}
.pp-rv-handle-ne{right:-8px;top:-8px;cursor:nesw-resize}
.pp-rv-handle-sw{left:-8px;bottom:-8px;cursor:nesw-resize}
.pp-rv-handle-se{right:-8px;bottom:-8px;cursor:nwse-resize}
.pp-rv-fraback,.pp-rv-fraok{width:auto!important;padding:0 10px!important}
.pp-rv-fraok{background:var(--emerald)!important;border-color:var(--emerald)!important;color:#fff!important;font-weight:600}
.pp-rv-fraok:disabled{opacity:.5;cursor:not-allowed}
.pp-rv-fraback:disabled{opacity:.5;cursor:not-allowed}
.pp-rv-frametip{position:absolute;left:8px;bottom:8px;z-index:3;background:rgba(15,18,32,.82);color:#fff;font-size:12px;padding:5px 10px;border-radius:8px;pointer-events:none}
.pp-rv-hint{flex-shrink:0;font-size:11px;color:var(--faint);text-align:center}
.pp-rv-imgtools{flex-shrink:0;display:flex;gap:8px;justify-content:center;margin-top:4px}
.pp-rv-thumbs{display:flex;gap:6px;overflow-x:auto;flex-shrink:0;padding-bottom:4px}
.pp-rv-thumb{height:52px;width:52px;object-fit:cover;border-radius:7px;cursor:pointer;border:2px solid transparent;opacity:.7;flex-shrink:0;transition:.12s}
.pp-rv-thumb.active,.pp-rv-thumb:hover{border-color:var(--brand);opacity:1}
.pp-rv-items{overflow-y:auto;display:flex;flex-direction:column;gap:8px}
.pp-rvi{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 12px}
.pp-rvi-num{font-family:ui-monospace,monospace;font-size:11px;color:var(--faint);margin-bottom:6px;font-weight:600}
.pp-rvi-field{margin-bottom:8px}
.pp-rvi-label{font-family:ui-monospace,monospace;font-size:10px;color:var(--faint);margin-bottom:3px}
.pp-rvi-warn{color:var(--amber)}
.pp-mf-view{display:flex;align-items:flex-start;gap:8px;background:var(--soft);border-radius:8px;padding:9px 11px;cursor:pointer}
.pp-mf-view:hover{background:#eceef5}
.pp-mf-rendered{flex:1;min-width:0;overflow-x:auto;font-size:14px;line-height:1.7}
.pp-mf-btns{flex-shrink:0;display:flex;flex-direction:column;gap:4px}
.pp-mf-edit{flex-shrink:0;font-size:11px;border:1px solid var(--line);background:#fff;border-radius:6px;padding:3px 8px;cursor:pointer;color:var(--brand);font-family:inherit;white-space:nowrap}
.pp-mf-edit:hover{border-color:var(--brand)}
.pp-mf-tools{display:flex;gap:8px;margin-bottom:5px}
.em .em-math{cursor:pointer;border-radius:4px;padding:0 1px;transition:background .12s}
.em .em-math:hover{background:#eef0ff;outline:1px dashed var(--brand)}
.em-empty{color:var(--faint)}
math-field.em-mf{--primary:var(--brand)}
.pp-rvi-pick{width:100%;border:1px solid var(--line);border-radius:8px;padding:5px 8px;font:inherit;font-size:12px;margin-bottom:4px;background:#fff;color:var(--ink);cursor:pointer;outline:none}
.pp-rvi-pick:focus{border-color:var(--brand)}
.pp-mtb{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:5px}
.pp-mtb button{font-size:11px;border:1px solid var(--line);background:#fff;border-radius:6px;padding:2px 7px;cursor:pointer;font-family:ui-monospace,monospace;color:#3a3f55;line-height:1.4}
.pp-mtb button:hover{border-color:var(--brand);color:var(--brand)}
.pp-rvi textarea.pp-edit{min-height:40px;font-size:12px}
.pp-rvi .pp-preview{margin-top:4px;padding:5px 8px;font-size:12px}
.pp-rv-foot{display:flex;gap:8px;flex-shrink:0;justify-content:flex-end;align-items:center;padding-top:6px;border-top:1px solid var(--line)}
.pp-rv-redpen{margin-right:auto;display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--mut);cursor:pointer;user-select:none}
.pp-rv-redpen input{cursor:pointer}
/* 图片灯箱 */
.pp-lightbox{position:fixed;inset:0;background:rgba(0,0,0,.82);z-index:9999;display:flex;align-items:center;justify-content:center;cursor:zoom-out}
.pp-lightbox img{max-width:92vw;max-height:92vh;object-fit:contain;border-radius:8px}
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

// ── 校对阶段：单题编辑器 ─────────────────────────────────────────────────────
// 取答案前若干字做下拉里的预览标签（去掉 LaTeX 噪音）
function answerSnippet(s) {
  const t = String(s || "").replace(/\$+/g, "").replace(/\\[a-zA-Z]+/g, "").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, 36) + (t.length > 36 ? "…" : "") : "（空白）";
}

// 数学输入助手：在光标处插入 LaTeX 片段。片段里用 ‸ 标记插入后光标落点（包裹选中文本）。
const MATH_BTNS = [
  { label: "$ $", snip: "$‸$", title: "公式包裹" },
  { label: "a/b", snip: "\\frac{‸}{}", title: "分数" },
  { label: "x²", snip: "^{‸}", title: "上标" },
  { label: "xᵢ", snip: "_{‸}", title: "下标" },
  { label: "√", snip: "\\sqrt{‸}", title: "根号" },
  { label: "矩阵", snip: "\\begin{pmatrix} ‸ & \\\\ & \\end{pmatrix}", title: "矩阵 pmatrix" },
  { label: "|·|", snip: "\\begin{vmatrix} ‸ & \\\\ & \\end{vmatrix}", title: "行列式" },
  { label: "∑", snip: "\\sum_{‸}^{}" },
  { label: "∫", snip: "\\int ‸" },
  { label: "λ", snip: "\\lambda " },
  { label: "α", snip: "\\alpha " },
  { label: "≤", snip: "\\le " },
  { label: "≥", snip: "\\ge " },
  { label: "≠", snip: "\\ne " },
  { label: "→", snip: "\\to " },
  { label: "∈", snip: "\\in " },
  { label: "×", snip: "\\times " },
  { label: "det", snip: "\\det(‸)" },
];

function insertSnippet(ta, snip, onChange) {
  if (!ta) return;
  const start = ta.selectionStart ?? ta.value.length;
  const end = ta.selectionEnd ?? start;
  const before = ta.value.slice(0, start);
  const selected = ta.value.slice(start, end);
  const after = ta.value.slice(end);
  const caretIdx = snip.indexOf("‸");
  const clean = snip.replace("‸", "");
  let insertText, newCaret;
  if (caretIdx >= 0) {
    insertText = clean.slice(0, caretIdx) + selected + clean.slice(caretIdx);
    newCaret = before.length + caretIdx + selected.length;
  } else {
    insertText = clean;
    newCaret = before.length + clean.length;
  }
  onChange(before + insertText + after);
  requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(newCaret, newCaret); });
}

function MathToolbar({ taRef, onChange }) {
  return (
    <div className="pp-mtb">
      {MATH_BTNS.map((b) => (
        <button key={b.label} type="button" title={b.title || b.label}
          onMouseDown={(e) => { e.preventDefault(); insertSnippet(taRef.current, b.snip, onChange); }}>
          {b.label}
        </button>
      ))}
    </div>
  );
}

// 数学字段：默认只显示「渲染后的公式」，点「✏️ 修改」才展开输入；
// 改时可点「🤖 AI 帮我转成公式」——随便用普通写法敲，AI 转成规范 LaTeX 并渲染，全程不碰源码。
function MathField({ label, value, warn, onChange, onFocus, editExtra, emptyHint, hints, onFrame }) {
  const [editing, setEditing] = useState(false);
  const [converting, setConverting] = useState(false);
  const taRef = useRef(null);
  const has = (value || "").trim();

  const aiConvert = async () => {
    if (!has) return;
    setConverting(true);
    try { const out = await toLatex(value); if (out) onChange(out); } finally { setConverting(false); }
  };

  return (
    <div className="pp-rvi-field">
      <div className="pp-rvi-label">{label}{warn}</div>
      {!editing ? (
        <div className="pp-mf-view" onClick={() => onFocus?.()}>
          <div className="pp-mf-rendered">
            {has
              ? <EditableMath value={autoLatex(value)} onChange={onChange} hints={hints} />
              : <span className="pp-ans-empty">{emptyHint || "（空白）"}</span>}
          </div>
          <div className="pp-mf-btns" onClick={(e) => e.stopPropagation()}>
            {onFrame && <button className="pp-mf-edit" title="框选原图区域，AI 重新识别填入本题" onClick={onFrame}>✂︎ 框选</button>}
            <button className="pp-mf-edit" onClick={() => setEditing(true)}>✏️ 全文改</button>
          </div>
        </div>
      ) : (
        <>
          {editExtra}
          <div className="pp-mf-tools">
            <button className="pp-btn mini primary" disabled={converting || !has} onClick={aiConvert}>{converting ? "转换中…" : "🤖 AI 帮我转成公式"}</button>
            <button className="pp-btn mini" onClick={() => setEditing(false)}>完成</button>
          </div>
          <MathToolbar taRef={taRef} onChange={onChange} />
          <textarea ref={taRef} className="pp-edit" rows={2} value={value || ""} onFocus={() => onFocus?.()} onChange={(e) => onChange(e.target.value)} />
          {has && <div className="pp-preview"><span className="pp-preview-label">渲染预览</span><MathText text={autoLatex(value)} /></div>}
        </>
      )}
    </div>
  );
}

function ReviewItemEditor({ item, answers = [], onChange, onFocusAnswer, onFrame, showRedPen = false }) {
  const hints = [(item.knowledge_points || []).join(" "), item.chapter || "", item.question || ""].join(" ");
  const matchedIdx = answers.findIndex((a) => (a.studentAnswer || "") === (item.studentAnswer || "") && (item.studentAnswer || "").trim());
  const dropdown = answers.length > 0 ? (
    <select
      className="pp-rvi-pick"
      style={{ flex: 1, minWidth: 0 }}
      value={matchedIdx}
      onChange={(e) => {
        const idx = Number(e.target.value);
        if (idx < 0) onChange({ ...item, studentAnswer: "", answerConfidence: "low", bbox: null, _img: -1 });
        else {
          const a = answers[idx];
          onChange({ ...item, studentAnswer: a.studentAnswer || "", answerConfidence: a.answerConfidence || "low", bbox: a.bbox || null, _img: a._img ?? -1 });
          onFocusAnswer?.({ ...item, bbox: a.bbox || null, _img: a._img ?? -1 });
        }
      }}
    >
      <option value={-1}>{matchedIdx < 0 ? "— 选对应的识别段 / 手动输入 —" : "— 清空 / 手动输入 —"}</option>
      {answers.map((a, ai) => (
        <option key={ai} value={ai}>识别段 #{a.number || "?"}：{answerSnippet(a.studentAnswer)}</option>
      ))}
    </select>
  ) : null;

  return (
    <div className="pp-rvi">
      <div className="pp-rvi-num">#{item.number || "?"}</div>
      <MathField label="题目" value={item.question} hints={hints} onChange={(v) => onChange({ ...item, question: v })} />
      <MathField
        label="学生答案"
        warn={item.answerConfidence === "low" && (item.studentAnswer || "").trim() ? <span className="pp-rvi-warn"> · 字迹待确认</span> : null}
        value={item.studentAnswer}
        hints={hints}
        onChange={(v) => onChange({ ...item, studentAnswer: v })}
        onFocus={() => onFocusAnswer?.(item)}
        onFrame={onFrame}
        emptyHint="（未识别，点修改补充）"
      />
      {/* 始终可见的"指认识别段"：配错题时一键换成正确的识别段，不用先进编辑 */}
      {answers.length > 0 && (
        <div className="pp-rvi-assign" style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 11, color: "var(--faint,#9aa0b4)", whiteSpace: "nowrap" }}>配错了？换一段 →</span>
          {dropdown}
        </div>
      )}
      <div className="pp-rvi-score" style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6, fontSize: 12, color: "var(--mut,#6b7184)" }}>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          本题满分
          <input
            type="number" min="0" step="1"
            value={item.maxScore ?? ""}
            placeholder="留空=只给百分比"
            onChange={(e) => onChange({ ...item, maxScore: e.target.value === "" ? null : Math.max(0, Number(e.target.value)) })}
            style={{ width: 110, padding: "3px 6px", border: "1px solid var(--line,#e7e8ef)", borderRadius: 6, fontSize: 12 }}
          />
        </label>
        {showRedPen && (item.teacherScorePct != null || item.teacherMark) && (
          <span style={{ color: "#be123c" }} title={item.teacherComment || ""}>
            🖊 检测到红笔：{item.teacherScorePct != null
              ? `${item.teacherScorePct}%`
              : item.teacherMark === "correct" ? "判对 ✓" : item.teacherMark === "partial" ? "部分对" : "判错 ✗"}
            {item.teacherComment ? `（${answerSnippet(item.teacherComment)}）` : ""}
          </span>
        )}
      </div>
    </div>
  );
}

// ── 批改模式 ─────────────────────────────────────────────────────────────────
function GradePanel({ supabase, userId, activeItemId, onSelectItem, onItemsGraded, onReviewModeChange }) {
  const wb = useMemo(() => makeWorkbenchApi(supabase), [supabase]);
  const [hot, setHot] = useState(false);
  const [hotQ, setHotQ] = useState(false);
  const [hotA, setHotA] = useState(false);
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState(null); // null=idle, 0-100=processing
  const [items, setItems] = useState([]);
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState("");
  const [paperLayout, setPaperLayout] = useState("together");
  // 分开模式：暂存题目/答案文件
  const [qFiles, setQFiles] = useState([]);
  const [aFiles, setAFiles] = useState([]);
  // 校对阶段
  const [reviewPhase, setReviewPhase] = useState(false);
  const [reviewItems, setReviewItems] = useState([]);
  const [reviewAnswers, setReviewAnswers] = useState([]); // 原始 OCR 答案段，供手动指认
  const [reviewImages, setReviewImages] = useState([]);
  const [reviewImgIdx, setReviewImgIdx] = useState(0);
  const [focusBox, setFocusBox] = useState(null); // {img, bbox} 当前高亮的题在原图里的区域
  const [lightbox, setLightbox] = useState(null); // URL of enlarged image
  const [imgView, setImgView] = useState({ zoom: 1, x: 0, y: 0 }); // 原图缩放/平移
  const imgDragRef = useRef(null);
  const imgElRef = useRef(null);
  const imgMainRef = useRef(null);                    // 图片容器（含居中留白），框选用它的像素坐标
  const [hasRedPen, setHasRedPen] = useState(false);  // 卷面是否有老师红笔批改（默认否）——只有勾选才按红笔判分，避免无红笔时误判
  const [blockRefine, setBlockRefine] = useState(false); // 逐块精识别：默认关——实测一遍后发现 bbox 不紧会把相邻题揉一起、且 qwen-vl-ocr 吐文档级 LaTeX，反而更差；保留开关供实验
  const [ocrRepair, setOcrRepair] = useState(true);   // OCR 校正：识别后用文本模型保守修正符号/字符误读（不改数学结论），默认开
  const [busy, setBusy] = useState(false);            // 确认识别/批改进行中——给按钮即时反馈、防重复点击
  const [framing, setFraming] = useState(false);     // 框选识别模式（全屏取景）
  const [frameTool, setFrameTool] = useState("draw"); // 框选时工具：'draw' 画框 / 'pan' 移动图
  const [frameRect, setFrameRect] = useState(null);   // 拖框中的矩形：相对 imgmain 的像素 {x0,y0,x1,y1}
  const frameModeRef = useRef(null);                  // 框选交互：{ mode:'draw'|'move'|'resize', handle?, sx, sy, orig }
  const [regionBusy, setRegionBusy] = useState(false);
  const [reviewActiveIdx, setReviewActiveIdx] = useState(-1); // 框选结果填入哪道题
  const [uploadCollapsed, setUploadCollapsed] = useState(false); // 有题目后收起上传区，给列表腾空间
  const [pendingFiles, setPendingFiles] = useState([]); // 本次上传的原始文件，确认后归档到「以往记录」
  const [editing2, setEditing2] = useState(null); // { which: 'q'|'a', idx, file } 点文件名打开的编辑器
  const fileRef = useRef(null);
  const qRef = useRef(null);
  const aRef = useRef(null);

  const report = useCallback((msg, pct) => {
    setStatus(msg);
    if (pct !== undefined) setProgress(pct);
  }, []);

  // 识别/批改出题目后，自动收起上面的上传区，把空间让给题目列表
  const hasItems = items.length > 0;
  useEffect(() => { if (hasItems) setUploadCollapsed(true); }, [hasItems]);

  // 切换原图页时复位缩放/平移
  useEffect(() => { setImgView({ zoom: 1, x: 0, y: 0 }); }, [reviewImgIdx]);
  const zoomImg = (factor) => setImgView((v) => {
    const z = Math.min(6, Math.max(1, v.zoom * factor));
    return z === 1 ? { zoom: 1, x: 0, y: 0 } : { ...v, zoom: z };
  });
  // 框选时也允许滚轮缩放（全屏取景，crop 数学按变换后的图片 rect 算，缩放/平移都不影响结果）
  const onImgWheel = (e) => { e.preventDefault(); zoomImg(e.deltaY < 0 ? 1.15 : 1 / 1.15); };
  // 框选：相对 imgmain 容器的像素坐标（光标在哪框就在哪，不受居中留白影响）
  const mainPx = (e) => {
    const r = imgMainRef.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  // 归一化矩形（x0<x1, y0<y1），命中测试和拖动都用它
  const normRect = (r) => ({
    x0: Math.min(r.x0, r.x1), y0: Math.min(r.y0, r.y1),
    x1: Math.max(r.x0, r.x1), y1: Math.max(r.y0, r.y1),
  });
  const insideRect = (p, r) => {
    const n = normRect(r);
    return p.x >= n.x0 && p.x <= n.x1 && p.y >= n.y0 && p.y <= n.y1;
  };
  const onImgDown = (e) => {
    if (framing) {
      // 移动工具：拖动平移图片（去够到目标区域）
      if (frameTool === "pan") { imgDragRef.current = { sx: e.clientX, sy: e.clientY, ox: imgView.x, oy: imgView.y }; return; }
      const p = mainPx(e);
      // 画框工具：已有框且点在框内 → 移动整框；否则在空白处按下 → 重新画框
      if (frameRect && insideRect(p, frameRect)) {
        frameModeRef.current = { mode: "move", sx: p.x, sy: p.y, orig: normRect(frameRect) };
      } else {
        frameModeRef.current = { mode: "draw" };
        setFrameRect({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
      }
      return;
    }
    imgDragRef.current = { sx: e.clientX, sy: e.clientY, ox: imgView.x, oy: imgView.y };
  };
  // 角点拖拽：在叠加框的把手上按下时调用（阻止冒泡到 onImgDown）
  const onHandleDown = (handle) => (e) => {
    e.stopPropagation();
    if (!frameRect) return;
    frameModeRef.current = { mode: "resize", handle, orig: normRect(frameRect) };
  };
  const onImgMove = (e) => {
    if (framing) {
      if (frameTool === "pan") {
        const d = imgDragRef.current;
        if (d) setImgView((v) => ({ ...v, x: d.ox + (e.clientX - d.sx), y: d.oy + (e.clientY - d.sy) }));
        return;
      }
      const fm = frameModeRef.current;
      if (!fm) return;
      const p = mainPx(e);
      if (fm.mode === "draw") {
        setFrameRect((r) => (r ? { ...r, x1: p.x, y1: p.y } : r));
      } else if (fm.mode === "move") {
        const dx = p.x - fm.sx, dy = p.y - fm.sy, o = fm.orig;
        setFrameRect({ x0: o.x0 + dx, y0: o.y0 + dy, x1: o.x1 + dx, y1: o.y1 + dy });
      } else if (fm.mode === "resize") {
        const o = fm.orig, h = fm.handle;
        setFrameRect({
          x0: h.includes("w") ? p.x : o.x0,
          y0: h.includes("n") ? p.y : o.y0,
          x1: h.includes("e") ? p.x : o.x1,
          y1: h.includes("s") ? p.y : o.y1,
        });
      }
      return;
    }
    const d = imgDragRef.current;
    if (!d) return;
    setImgView((v) => ({ ...v, x: d.ox + (e.clientX - d.sx), y: d.oy + (e.clientY - d.sy) }));
  };
  const onImgUp = () => {
    if (framing) {
      if (frameTool === "pan") { imgDragRef.current = null; return; }
      // 画框模式下松开鼠标只结束本次拖动/画框，不立即识别；
      // 用户可继续移动/缩放框，满意后点「确定识别」。
      const fm = frameModeRef.current;
      frameModeRef.current = null;
      if (fm) setFrameRect((r) => (r ? normRect(r) : r));
      return;
    }
    imgDragRef.current = null;
  };

  const startFraming = () => {
    if (reviewActiveIdx < 0) { alert("请先点一道题的「学生答案」框，把它设为目标，再框选原图区域。"); return; }
    setImgView({ zoom: 1, x: 0, y: 0 }); // 复位，框选坐标才对得上
    setFrameRect(null);
    setFrameTool("draw");
    setFraming(true);
  };

  const commitFrame = async () => {
    const r = frameRect;
    if (!r) return;
    // 像素框（相对 imgmain）→ 相对图片的比例：扣掉图片在容器里的居中偏移
    const main = imgMainRef.current?.getBoundingClientRect();
    const im = imgElRef.current?.getBoundingClientRect();
    if (!main || !im || im.width < 2 || im.height < 2) return;
    const offX = im.left - main.left, offY = im.top - main.top;
    const fx0 = (Math.min(r.x0, r.x1) - offX) / im.width;
    const fy0 = (Math.min(r.y0, r.y1) - offY) / im.height;
    const fx1 = (Math.max(r.x0, r.x1) - offX) / im.width;
    const fy1 = (Math.max(r.y0, r.y1) - offY) / im.height;
    const clamp = (v) => Math.min(1, Math.max(0, v));
    const rect = { x: clamp(fx0), y: clamp(fy0), w: clamp(fx1) - clamp(fx0), h: clamp(fy1) - clamp(fy0) };
    if (rect.w < 0.02 || rect.h < 0.015) { alert("框太小或落在图片外，请重新拖框或调整大小。"); return; } // 保留当前框，便于继续调整
    setRegionBusy(true);
    try {
      const crop = await cropFractionDataUri(reviewImages[reviewImgIdx], rect);
      if (!crop) throw new Error("裁剪失败");
      const text = await extractRegion(crop);
      if (text) {
        setReviewItems((prev) => prev.map((x, j) => (j === reviewActiveIdx ? { ...x, studentAnswer: text, answerConfidence: "low" } : x)));
        setFraming(false);
        setFrameRect(null);
        setImgView({ zoom: 1, x: 0, y: 0 }); // 退出全屏取景后复位
      } else {
        alert("没识别出内容，可调整框的位置/大小后再点「确定识别」。");
      }
    } catch (e) {
      alert("区域识别失败：" + (e.message || e));
    } finally { setRegionBusy(false); }
  };

  // ── 在一起模式：单区上传 ──
  const handleTogether = useCallback(async (files) => {
    if (!files?.length) return;
    if (!userId) { alert("请先登录"); return; }
    const allFiles = [...files].filter((f) => f.type.startsWith("image/") || f.type === "application/pdf");
    if (!allFiles.length) { report("请上传图片或 PDF 文件"); return; }
    setPendingFiles(allFiles); // 归档到「以往记录」用
    try {
      setProgress(5);
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
      const collectedImages = []; // 收集源图 URI 供校对阶段展示
      if (imageFiles.length) {
        report(`上传图片 (${imageFiles.length} 张)…`, 10);
        const urls = await wb.uploadImages(imageFiles, userId);
        if (urls.length) {
          await ensurePaper(urls);
          for (let i = 0; i < urls.length; i++) {
            report(`AI 识别第 ${i + 1}/${urls.length} 张…`, Math.round(15 + (i / urls.length) * 65));
            const uri = await wb.imageToDataURI(urls[i]);
            if (uri) { collectedImages.push(uri); extracted = extracted.concat(await extractPaper(uri, paperLayout)); }
          }
        }
      }
      const pdfTotal = pdfFiles.length;
      for (let pi = 0; pi < pdfTotal; pi++) {
        const pdf = pdfFiles[pi];
        const baseP = Math.round(10 + (pi / pdfTotal) * 70);
        report(`处理 ${pdf.name}…`, baseP);
        const text = await pdfToText(pdf, (msg) => report(msg, baseP + 5));
        await ensurePaper();
        if (text.replace(/\s+/g, "").length >= MIN_TEXT_DENSITY) {
          report("AI 解析题目…", baseP + 15);
          const r = await extractPaperFromText(text, paperLayout);
          if (r.length) { extracted = extracted.concat(r); }
          else {
            const uris = await pdfToImageURIs(pdf, (msg) => report(msg, baseP + 15));
            collectedImages.push(...uris);
            for (let i = 0; i < uris.length; i++) {
              report(`视觉识别第 ${i + 1}/${uris.length} 页…`, Math.round(baseP + 15 + (i / uris.length) * 40));
              extracted = extracted.concat(await extractPaper(uris[i], paperLayout));
            }
          }
        } else {
          const uris = await pdfToImageURIs(pdf, (msg) => report(msg, baseP + 10));
          collectedImages.push(...uris);
          for (let i = 0; i < uris.length; i++) {
            report(`视觉识别扫描页 ${i + 1}/${uris.length}…`, Math.round(baseP + 10 + (i / uris.length) * 55));
            extracted = extracted.concat(await extractPaper(uris[i], paperLayout));
          }
        }
      }
      if (!extracted.length) { report("没识别出题目，请检查文件"); setProgress(null); return; }
      // 进入校对阶段，而不是立即保存
      setReviewItems(extracted.map(x => ({ number: x.number, question: x.question || "", studentAnswer: x.studentAnswer || "", answerConfidence: x.answerConfidence || "low", maxScore: x.maxScore ?? null, teacherScorePct: x.teacherScorePct ?? null, teacherComment: x.teacherComment || "", teacherMark: x.teacherMark || null })));
      setReviewImages(collectedImages);
      setReviewImgIdx(0);
      setReviewPhase(true);
      onReviewModeChange?.(true);
      report(`识别完成 ${extracted.length} 道题，请校对后确认`, 100);
      setTimeout(() => setProgress(null), 600);
    } catch (err) { report("出错：" + (err.message || err)); setProgress(null); }
  }, [userId, wb, paperLayout, report, onReviewModeChange]);

  // ── 分开模式：合并题目文件 + 答案文件 ──
  const processSeparate = useCallback(async () => {
    if (!userId) { alert("请先登录"); return; }
    if (!qFiles.length || !aFiles.length) return;
    setPendingFiles([...qFiles, ...aFiles]); // 归档到「以往记录」用
    try {
      report("提取题目…", 5);
      const questions = await extractFromFiles(qFiles, "questions", (msg) => report(msg, Math.min(35, (progress || 5) + 3)), wb, userId);
      if (!questions.length) { report("题目识别失败，请检查题目文件"); setProgress(null); return; }
      report(`提取到 ${questions.length} 道题，识别学生答案…`, 40);
      const questionNumbers = questions.map((q) => q.number).filter(Boolean);
      const { answers, images } = await extractAnswersFromFiles(aFiles, (msg) => report(msg, Math.min(75, (progress || 40) + 3)), wb, userId, questionNumbers);
      // 逐块精识别（"自动二次框选"）：对每个有 bbox 的答案块，按位置裁原图、放大、用 qwen-vl-ocr 重识别，
      // 比整页一次性识别准很多；轻链(只 qwen-vl-ocr)求快，失败则保留整页识别结果。
      if (blockRefine) {
        const refinable = answers.filter((a) => a._img >= 0 && Array.isArray(a.bbox) && a.bbox.length === 4 && images[a._img]);
        if (refinable.length) {
          let done = 0;
          await mapLimit(refinable, 2, async (a) => {
            try {
              const [x0, y0, x1, y1] = a.bbox.map(Number);
              const pad = 0.02;
              const rx = Math.max(0, x0 - pad), ry = Math.max(0, y0 - pad);
              const rect = { x: rx, y: ry, w: Math.min(1, x1 + pad) - rx, h: Math.min(1, y1 + pad) - ry };
              if (rect.w > 0.03 && rect.h > 0.02) {
                const crop = await cropFractionDataUri(images[a._img], rect);
                if (crop) {
                  const refined = await extractRegion(crop, ["qwen-vl-ocr"]); // 轻链：只用专用 OCR，快
                  if (refined && refined.trim()) a.studentAnswer = refined;
                }
              }
            } catch {}
            finally { done += 1; report(`逐块精识别 ${done}/${refinable.length}…`, Math.min(79, 76 + Math.round((done / refinable.length) * 3))); }
          });
        }
      }
      // OCR 校正（保守）：只修符号/字符误读，不改学生的数学结论；改善显示 + 对齐质量。
      let ansArr = answers;
      if (ocrRepair) {
        report("OCR 校正中…", 79);
        try { ansArr = await repairOcr(answers); } catch { ansArr = answers; }
      }
      report("AI 按内容对齐题目和答案…", 80);
      // 语义对齐：按答案内容判断它解的是哪道题（解决手写编号和官方题号对不上）；失败则回退题号匹配
      let alignMap = null;
      try { alignMap = await alignAnswersToQuestions(questions, ansArr); } catch { alignMap = null; }
      const merged = mergeQuestionsAnswers(questions, ansArr, alignMap);
      setReviewAnswers(ansArr); // 校正后的答案段（带 bbox/_img），供手动指认 + 画框定位
      // 校对左侧用答案原图（带坐标），让每道题能高亮回原图区域
      setReviewImages(images);
      setReviewItems(merged.map(x => ({ number: x.number, question: x.question || "", studentAnswer: x.studentAnswer || "", answerConfidence: x.answerConfidence || "low", bbox: x.bbox || null, _img: x._img ?? -1, maxScore: x.maxScore ?? null, teacherScorePct: x.teacherScorePct ?? null, teacherComment: x.teacherComment || "", teacherMark: x.teacherMark || null })));
      setReviewImgIdx(0);
      setReviewPhase(true);
      onReviewModeChange?.(true);
      report(`识别完成 ${merged.length} 道题，请校对后确认`, 100);
      setTimeout(() => setProgress(null), 600);
    } catch (err) { report("出错：" + (err.message || err)); setProgress(null); }
  }, [userId, wb, qFiles, aFiles, report, progress, onReviewModeChange, blockRefine, ocrRepair]);

  const confirmReview = async () => {
    if (busy) return;
    setBusy(true);
    try {
      report("保存中…", 92);
      setProgress(92);
      // 归档原始上传文件到「以往记录」（失败不阻断保存）
      let archived = [];
      try { if (pendingFiles.length) archived = await wb.uploadImages(pendingFiles, userId); } catch {}
      const paper = await wb.createPaper({ userId, imageUrls: archived });
      // 红笔幻觉防护：OCR 常把红笔幻觉到每道题上、且全标"判错/0 分"。真老师不会给整卷判 0，
      // 所以若"检测到红笔"的题占了多数(≥60%)且全是低分(<60)，判定为幻觉 → 整卷忽略红笔、改回纯 AI 判分。
      const _tScores = reviewItems.map((it) => teacherScoreFromMarks(it)).filter((s) => s != null);
      const redPenHallucinated = _tScores.length >= Math.max(3, Math.ceil(reviewItems.length * 0.6))
        && _tScores.every((s) => s < 60);
      const useRedPen = hasRedPen && !redPenHallucinated;
      if (hasRedPen && redPenHallucinated) report("红笔识别异常(疑似整卷误判)，本次按 AI 判分", 92);
      const rows = reviewItems.map((item) => ({
        paper_id: paper.id,
        user_id: userId,
        number: item.number || "",
        question: item.question || "",
        student_answer: item.studentAnswer || "",
        answer_confidence: "high", // 用户已确认
        reviewed: true,
        is_correct: null, // 仍交给「全部批改」生成参考答案/知识点；红笔分数下面单独存
        max_score: item.maxScore ?? null,
        // 红笔批改 → 存为老师分，批改时不被 AI 覆盖。仅在勾选「有红笔」且未触发幻觉防护时采纳。
        ...(useRedPen && teacherScoreFromMarks(item) != null ? { score_pct: teacherScoreFromMarks(item), score_source: "teacher" } : {}),
        ...(useRedPen && item.teacherComment ? { teacher_comment: item.teacherComment } : {}),
      }));
      let saved;
      try { saved = await wb.insertItems(rows); }
      catch (e) {
        if (!isMissingColumnErr(e)) throw e;
        saved = await wb.insertItems(rows.map(stripScoreCols)); // 未跑分数迁移 → 不带分数列重存
      }
      await wb.setPaperStatus(paper.id, "reviewing");
      setItems(saved);
      setReviewPhase(false);
      setReviewItems([]);
      setReviewAnswers([]);
      setReviewImages([]);
      setFocusBox(null);
      setPendingFiles([]);
      onReviewModeChange?.(false);
      report(`保存完成，共 ${saved.length} 道题，点「全部批改」开始。`, 100);
      setTimeout(() => setProgress(null), 800);
    } catch (err) { report("保存失败：" + (err.message || err)); setProgress(null); }
    finally { setBusy(false); }
  };

  const saveAnswer = async (item) => {
    const updated = await wb.updateItem(item.id, { student_answer: draft, reviewed: true });
    setItems((prev) => prev.map((x) => (x.id === item.id ? { ...x, ...updated } : x)));
    setEditing(null); setDraft("");
  };

  // 带分数列的更新：未跑分数迁移时剥掉分数列重试，避免整次更新失败
  const safeUpdateItem = async (id, patch) => {
    try { return await wb.updateItem(id, patch); }
    catch (e) {
      if (!isMissingColumnErr(e)) throw e;
      return await wb.updateItem(id, stripScoreCols(patch));
    }
  };

  const gradeAll = async () => {
    if (busy) return;
    setBusy(true);
    report("AI 批改中…（并发处理）", 5);
    let done = 0;
    try {
    // 限并发 3 路批改：N 题不再逐题串行等待
    const graded = await mapLimit(items, 3, async (item) => {
      try {
        const result = await gradeItem({ question: item.question, studentAnswer: item.student_answer });
        // 红笔已给分的题：判定和分数以老师为准，AI 只补参考答案/错因/知识点
        const hasTeacherScore = item.score_source === "teacher" && item.score_pct != null;
        const teacherCorrect = hasTeacherScore ? Number(item.score_pct) >= 60 : null;
        const isCorrect = hasTeacherScore ? teacherCorrect : !!result?.isCorrect;
        const patch = {
          correct_answer: result?.correctAnswer || "",
          is_correct: isCorrect,
          error_type: isCorrect ? null : (result?.errorType || "计算"),
          // 判对时 error_detail 存"小瑕疵提示"（minor 档），判错时存错因
          error_detail: isCorrect ? (result?.minorNote || "") : (result?.errorDetail || item.teacher_comment || ""),
          knowledge_points: result?.knowledgePoints || [],
          chapter: result?.chapter || "Ch.?",
          reviewed: true,
          ...(hasTeacherScore ? {} : { score_pct: result?.scorePct ?? null, score_source: "ai" }),
        };
        const updated = await safeUpdateItem(item.id, patch);
        return updated || { ...item, ...patch };
      } catch {
        return item;
      } finally {
        done += 1;
        report(`批改中… ${done}/${items.length}`, Math.round(5 + (done / items.length) * 90));
      }
    });

    // 关键题复核：对第一遍判"对"的题独立再核一次，抓"没做完却判对"这类假阳性
    const toVerify = graded.filter((x) => x.is_correct === true && x.score_source !== "teacher" && (x.student_answer || "").trim());
    if (toVerify.length) {
      report(`复核 ${toVerify.length} 道判对的题…`, 95);
      await mapLimit(toVerify, 3, async (item) => {
        try {
          const v = await verifyGrade({ question: item.question, studentAnswer: item.student_answer });
          if (v && v.ok === false) {
            const keepTeacher = item.score_source === "teacher" && item.score_pct != null;
            const patch = {
              is_correct: false, error_type: item.error_type || "计算", error_detail: v.reason || "复核发现答案未完成或最终结果不正确",
              ...(keepTeacher ? {} : { score_pct: Math.min(Number(item.score_pct) || 45, 45), score_source: "ai" }),
            };
            const updated = await safeUpdateItem(item.id, patch);
            const merged = updated || { ...item, ...patch };
            const gi = graded.findIndex((g) => g.id === item.id);
            if (gi >= 0) graded[gi] = merged;
          }
        } catch {}
      });
    }

    setItems([...graded]);
    await wb.bumpMastery(userId, graded);
    report(`批改完成：错 ${graded.filter((x) => x.is_correct === false).length} 题。点错题开始辅导。`, 100);
    setTimeout(() => setProgress(null), 800);
    onItemsGraded?.([...graded]);
    } catch (err) { report("批改出错：" + (err?.message || err)); setProgress(null); }
    finally { setBusy(false); }
  };

  const flipCorrect = async (item) => {
    const next = !item.is_correct;
    // 用户手动翻转 = 最终裁决，分数也同步并标记为 manual（连老师红笔分也覆盖）
    const cur = Number(item.score_pct);
    const patch = {
      is_correct: next, error_type: next ? null : (item.error_type || "计算"),
      score_pct: next ? Math.max(Number.isFinite(cur) ? cur : 0, 90) : Math.min(Number.isFinite(cur) ? cur : 45, 45),
      score_source: "manual",
    };
    // 乐观更新：先即时变界面，再后台写库（避免点了"翻转"半天没反应）
    setItems((prev) => prev.map((x) => (x.id === item.id ? { ...x, ...patch } : x)));
    try { await safeUpdateItem(item.id, patch); } catch {}
  };

  // 收藏到错题本（错题已自动收录；这里主要让"对的题"也能进错题本）
  const toggleStar = async (item) => {
    const next = !item.starred;
    setItems((prev) => prev.map((x) => (x.id === item.id ? { ...x, starred: next } : x)));
    try { await wb.setStar(item.id, next); } catch {}
  };

  const removeQFile = (idx) => setQFiles((prev) => prev.filter((_, i) => i !== idx));
  const removeAFile = (idx) => setAFiles((prev) => prev.filter((_, i) => i !== idx));

  // 编辑器保存：用旋转/裁剪后的图片替换原文件（PDF 可能拆成多页图片）
  const applyEdit = (newFiles) => {
    if (!editing2 || !newFiles?.length) { setEditing2(null); return; }
    const { which, idx } = editing2;
    const setter = which === "q" ? setQFiles : setAFiles;
    setter((prev) => prev.flatMap((f, i) => (i === idx ? newFiles : [f])));
    setEditing2(null);
  };

  const needGrade = items.length > 0 && items.some((x) => x.is_correct === null);
  const isSep = paperLayout === "separate";

  const dragHandlers = (setH, onDrop) => ({
    onDragOver: (e) => { e.preventDefault(); e.stopPropagation(); setH(true); },
    onDragEnter: (e) => { e.preventDefault(); e.stopPropagation(); setH(true); },
    onDragLeave: (e) => { e.preventDefault(); e.stopPropagation(); setH(false); },
    onDrop: (e) => { e.preventDefault(); e.stopPropagation(); setH(false); if (e.dataTransfer?.files?.length) onDrop(e.dataTransfer.files); },
  });

  // ── 校对阶段 JSX ─────────────────────────────────────────────────────────────
  if (reviewPhase) {
    return (
      <div className="pp-rv">
        <div className="pp-rv-hd">
          识别校对
          <span>对照原图核对 AI 识别的题目和答案 · 点任意公式可直接可视化修改，确认后再批改</span>
        </div>
        <div className="pp-rv-body">
          {/* 左：原图查看（点选右侧某题 → 在原图上画框定位该题） */}
          <div className="pp-rv-imgs">
            {reviewImages.length > 0 ? (
              <>
                <div
                  ref={imgMainRef}
                  className={"pp-rv-imgmain" + (framing ? " framing-full" : "")}
                  onWheel={onImgWheel}
                  onMouseDown={onImgDown}
                  onMouseMove={onImgMove}
                  onMouseUp={onImgUp}
                  onMouseLeave={onImgUp}
                  style={{ cursor: framing ? (frameTool === "pan" ? (imgDragRef.current ? "grabbing" : "grab") : "crosshair") : imgDragRef.current ? "grabbing" : imgView.zoom > 1 ? "grab" : "default" }}
                >
                  <div className="pp-rv-imgwrap" style={{ transform: `translate(${imgView.x}px, ${imgView.y}px) scale(${imgView.zoom})` }}>
                    <img ref={imgElRef} src={reviewImages[reviewImgIdx]} alt="原始图片" draggable={false} />
                    {focusBox && focusBox.img === reviewImgIdx && Array.isArray(focusBox.bbox) && !framing && (
                      <div className="pp-rv-box" style={{
                        left: `${focusBox.bbox[0] * 100}%`,
                        top: `${focusBox.bbox[1] * 100}%`,
                        width: `${(focusBox.bbox[2] - focusBox.bbox[0]) * 100}%`,
                        height: `${(focusBox.bbox[3] - focusBox.bbox[1]) * 100}%`,
                      }} />
                    )}
                  </div>
                  {/* 框选叠加框：相对 imgmain 的像素，光标在哪框就在哪。
                      画完后可拖框内部移动、拖四角把手缩放，确认后再识别。 */}
                  {framing && frameRect && (
                      <div className="pp-rv-box pp-rv-frame" style={{
                        position: "absolute",
                        left: `${Math.min(frameRect.x0, frameRect.x1)}px`,
                        top: `${Math.min(frameRect.y0, frameRect.y1)}px`,
                        width: `${Math.abs(frameRect.x1 - frameRect.x0)}px`,
                        height: `${Math.abs(frameRect.y1 - frameRect.y0)}px`,
                        cursor: "move",
                      }}>
                        {["nw", "ne", "sw", "se"].map((h) => (
                          <span key={h} className={`pp-rv-handle pp-rv-handle-${h}`} onMouseDown={onHandleDown(h)} />
                        ))}
                      </div>
                    )}
                  <div className="pp-rv-zoom" onMouseDown={(e) => e.stopPropagation()}>
                    {!framing ? (
                      <>
                        <button title="放大" onClick={() => zoomImg(1.3)}>＋</button>
                        <button title="缩小" onClick={() => zoomImg(1 / 1.3)}>－</button>
                        <button title="复位" onClick={() => setImgView({ zoom: 1, x: 0, y: 0 })}>⟲</button>
                        <button title="全屏查看" onClick={() => setLightbox(reviewImages[reviewImgIdx])}>⛶</button>
                        <button title="框选某块重新识别填入选中题" onClick={startFraming}>✂︎</button>
                      </>
                    ) : (
                      <>
                        <button className={"pp-rv-fratool" + (frameTool === "draw" ? " on" : "")} title="画框工具：拖出/移动/缩放识别框" onClick={() => setFrameTool("draw")}>▭ 画框</button>
                        <button className={"pp-rv-fratool" + (frameTool === "pan" ? " on" : "")} title="移动工具：拖动平移图片、滚轮缩放，去够到目标区域" onClick={() => setFrameTool("pan")}>✋ 移动图</button>
                        <button title="放大" onClick={() => zoomImg(1.3)}>＋</button>
                        <button title="缩小" onClick={() => zoomImg(1 / 1.3)}>－</button>
                        <button title="复位" onClick={() => setImgView({ zoom: 1, x: 0, y: 0 })}>⟲</button>
                        <button className="pp-rv-fraok" disabled={!frameRect || regionBusy} onClick={commitFrame}>{regionBusy ? "识别中…" : "✓ 确定识别"}</button>
                        <button className="pp-rv-fraback" disabled={regionBusy} onClick={() => { setFraming(false); setFrameRect(null); frameModeRef.current = null; setImgView({ zoom: 1, x: 0, y: 0 }); }}>✕ 退出</button>
                      </>
                    )}
                  </div>
                  {framing && (
                    <div className="pp-rv-frametip">
                      {regionBusy ? "正在识别框选区域…"
                        : reviewActiveIdx < 0 ? "请先选目标题"
                        : frameTool === "pan" ? "移动图模式：拖动平移、滚轮缩放，把目标区域调清楚 → 再切回「▭ 画框」"
                        : frameRect ? `拖框内可移动、拖四角可缩放 → 满意后点「确定识别」填入 #${reviewItems[reviewActiveIdx]?.number || (reviewActiveIdx + 1)}`
                        : `全屏取景：拖出一个框选中要识别的区域（够不到就切「✋ 移动图」）→ 填入 #${reviewItems[reviewActiveIdx]?.number || (reviewActiveIdx + 1)}`}
                    </div>
                  )}
                </div>
                {reviewImages.length > 1 && (
                  <div className="pp-rv-thumbs">
                    {reviewImages.map((img, i) => (
                      <img key={i} src={img} alt={`图${i + 1}`} className={"pp-rv-thumb" + (i === reviewImgIdx ? " active" : "")} onClick={() => setReviewImgIdx(i)} />
                    ))}
                  </div>
                )}
                <div className="pp-rv-hint">原图可滚轮/＋－缩放、按住拖动平移、⟲ 复位、⛶ 全屏。点右侧答案框会跳到对应页并框出位置。</div>
              </>
            ) : (
              <div style={{ color: "var(--faint)", fontSize: 12, textAlign: "center", padding: 20 }}>（PDF 文字版无图片预览）</div>
            )}
          </div>
          {/* 右：可编辑题目列表 */}
          <div className="pp-rv-items">
            {reviewItems.map((item, i) => (
              <ReviewItemEditor
                key={i}
                item={item}
                answers={reviewAnswers}
                onChange={(updated) => setReviewItems(prev => prev.map((x, j) => j === i ? updated : x))}
                onFocusAnswer={(it) => {
                  setReviewActiveIdx(i); // 框选识别的目标题
                  // 只要知道来源图就先跳到那页（靠我们记的页码，一定有效）；
                  // 模型给了 bbox 才额外画框。
                  if (it && it._img >= 0) {
                    setReviewImgIdx(it._img);
                    setFocusBox(Array.isArray(it.bbox) ? { img: it._img, bbox: it.bbox } : null);
                  } else {
                    setFocusBox(null);
                  }
                }}
                onFrame={() => { setReviewActiveIdx(i); setImgView({ zoom: 1, x: 0, y: 0 }); setFrameRect(null); setFrameTool("draw"); setFraming(true); }}
                showRedPen={hasRedPen}
              />
            ))}
          </div>
        </div>
        <div className="pp-rv-foot">
          <button className="pp-btn" onClick={() => { setReviewPhase(false); setFocusBox(null); onReviewModeChange?.(false); }}>← 重新上传</button>
          <label className="pp-rv-redpen" title="默认按 AI 判分。只有卷面确实有老师红笔批改时才勾选，勾选后按红笔的对错/得分判定。">
            <input type="checkbox" checked={hasRedPen} onChange={(e) => setHasRedPen(e.target.checked)} />
            卷面有老师红笔批改（按红笔判分）
          </label>
          <button className="pp-btn primary" onClick={confirmReview} disabled={busy}>{busy ? "处理中…" : "确认识别，开始批改 →"}</button>
        </div>
        {/* 图片灯箱 */}
        {lightbox && (
          <div className="pp-lightbox" onClick={() => setLightbox(null)}>
            <img src={lightbox} alt="放大" />
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      {hasItems && (
        <div className="pp-collapse-bar" onClick={() => setUploadCollapsed((c) => !c)}>
          {uploadCollapsed ? "▸ 展开上传区（重新上传卷子）" : "▾ 收起上传区，腾出空间看题目"}
        </div>
      )}
      {!uploadCollapsed && (
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
                      <span>📄</span>
                      <span className="fname" title="点击旋转/裁剪" onClick={() => setEditing2({ which: "q", idx: i, file: f })}>{f.name}</span>
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
                      <span>✏️</span>
                      <span className="fname" title="点击旋转/裁剪" onClick={() => setEditing2({ which: "a", idx: i, file: f })}>{f.name}</span>
                      <span className="rm" onClick={() => removeAFile(i)}>×</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          {(qFiles.length > 0 || aFiles.length > 0) && (
            <div style={{ fontSize: 11, color: "var(--faint)", textAlign: "center", padding: "2px 0 4px" }}>
              💡 图片方向不对？点文件名可旋转 / 裁剪后再识别
            </div>
          )}
          {qFiles.length > 0 && aFiles.length > 0 && (
            <>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--mut)", justifyContent: "center", padding: "2px 0", cursor: "pointer", userSelect: "none" }} title="识别后用文本模型保守修正符号/字符误读（μ被读成M、χ²读成x²、z值读乱等），不改学生的数字/结论/对错。推荐开。">
                <input type="checkbox" checked={ocrRepair} onChange={(e) => setOcrRepair(e.target.checked)} />
                OCR 校正（修符号误读，不改对错，推荐开）
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--mut)", justifyContent: "center", padding: "2px 0", cursor: "pointer", userSelect: "none" }} title="实验功能：整页识别后按 bbox 逐块重识别。实测当 bbox 不紧时会把相邻题揉到一起、反而更差，故默认关闭。">
                <input type="checkbox" checked={blockRefine} onChange={(e) => setBlockRefine(e.target.checked)} />
                逐块精识别（实验，默认关；bbox 不准时反而更差）
              </label>
              <button className="pp-btn primary" onClick={processSeparate}>
                识别并匹配 ({qFiles.length} 题目文件 + {aFiles.length} 答案文件)
              </button>
            </>
          )}
          {(qFiles.length === 0 || aFiles.length === 0) && (
            <div style={{ fontSize: 12, color: "var(--faint)", textAlign: "center", padding: "6px 0" }}>
              {qFiles.length === 0 ? "请上传题目文件" : "请上传学生答案"}
            </div>
          )}
        </>
      )}
      </>
      )}

      {editing2 && (
        <FileEditModal file={editing2.file} onSave={applyEdit} onClose={() => setEditing2(null)} />
      )}

      {status && <div className="pp-status">{status}</div>}
      {progress !== null && progress < 100 && (
        <>
          <div className="pp-prog-pct">{progress}%</div>
          <div className="pp-prog-wrap"><div className="pp-prog-bar" style={{ width: `${progress}%` }} /></div>
        </>
      )}
      {needGrade && (() => {
        const unconfirmed = items.filter((x) => x.is_correct === null && x.answer_confidence === "low" && !x.reviewed).length;
        return (
          <>
            {unconfirmed > 0 && (
              <div className="pp-grade-warn">⚠ {unconfirmed} 道题答案待确认，建议先核对再批改</div>
            )}
            <button className="pp-btn primary" style={{ marginTop: 6 }} onClick={gradeAll} disabled={busy}>{busy ? "批改中…" : "全部批改（判对错 + 分析）"}</button>
          </>
        );
      })()}

      <div className="pp-list">
        {items.length === 0
          ? <div className="pp-empty">还没有题目<br />{isSep ? "分别上传题目和手写答案文件，AI 会匹配" : "上传卷子图片或 PDF，AI 识别题目和答案"}</div>
          : items.map((item) => {
            const isWrong = item.is_correct === false;
            const isRight = item.is_correct === true;
            const isEditing = editing === item.id;
            const needsConfirm = item.answer_confidence === "low" && !item.reviewed;
            return (
              <div key={item.id} className={"pp-item clickable" + (activeItemId === item.id ? " active" : "") + (isWrong ? " wrong" : isRight ? " correct" : "")} onClick={() => item.is_correct !== null && onSelectItem?.(item)}>
                <div className="pp-ih">
                  <span className="pp-num">#{item.number || "—"}</span>
                  {isWrong && <span className="pp-badge pp-b-wrong">错</span>}
                  {isRight && <span className="pp-badge pp-b-correct">对</span>}
                  {item.is_correct !== null && scoreLabel(item) && (
                    <span
                      className={"pp-badge pp-b-score" + (item.score_source === "teacher" ? " teacher" : "")}
                      title={item.score_source === "teacher" ? "老师红笔给分" : item.score_source === "manual" ? "翻转后估分" : "AI 估分"}
                    >
                      {item.score_source === "teacher" ? "🖊 " : ""}{scoreLabel(item)}
                    </span>
                  )}
                  {needsConfirm && <span className="pp-badge pp-b-low">字迹待确认</span>}
                  {(item.knowledge_points || []).slice(0, 1).map((pt) => <span key={pt} className="pp-badge pp-b-kp">{pt}</span>)}
                  {item.is_correct !== null && <button className="pp-flip" onClick={(e) => { e.stopPropagation(); flipCorrect(item); }}>判错了？翻转</button>}
                  {item.is_correct !== null && (
                    <button className="pp-starbtn" title={item.starred ? "取消收藏" : "收藏到错题本"} onClick={(e) => { e.stopPropagation(); toggleStar(item); }}>
                      {item.starred ? "★" : "☆"}
                    </button>
                  )}
                </div>
                <div className="pp-q"><MathText text={item.question} /></div>
                <div className="pp-ans">
                  <div className="lab">我的答案</div>
                  {isEditing ? (
                    <>
                      <textarea
                        className="pp-edit"
                        value={draft}
                        placeholder="输入答案，数学公式用 $...$，如 $x=3$"
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setDraft(e.target.value)}
                      />
                      {draft.trim() && (
                        <div className="pp-preview">
                          <span className="pp-preview-label">渲染预览</span>
                          <MathText text={autoLatex(draft)} />
                        </div>
                      )}
                      <div className="pp-actions">
                        <button className="pp-btn mini primary" onClick={(e) => { e.stopPropagation(); saveAnswer(item); }}>确认答案</button>
                        <button className="pp-btn mini" onClick={(e) => { e.stopPropagation(); setEditing(null); }}>取消</button>
                      </div>
                    </>
                  ) : (
                    <div
                      className={"pp-ans-val" + (needsConfirm ? " unconfirmed" : "")}
                      onClick={(e) => { e.stopPropagation(); setEditing(item.id); setDraft(item.student_answer || ""); }}
                    >
                      {item.student_answer
                        ? <MathText text={autoLatex(item.student_answer)} />
                        : <span className="pp-ans-empty">空白，点击补充</span>
                      }
                      <span className="pp-edit-hint">✏ 点击修改</span>
                    </div>
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
function SolvePanel({ supabase, userId }) {
  const wb = useMemo(() => makeWorkbenchApi(supabase), [supabase]);
  const [hot, setHot] = useState(false);
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState(null);
  const [items, setItems] = useState([]);
  const fileInputRef = useRef(null);
  const report = useCallback((msg, pct) => { setStatus(msg); if (pct !== undefined) setProgress(pct); }, []);

  // 收藏一道 AI 解题的题到错题本（存进 paper_items 的"收藏夹"卷子，标 starred）
  const toggleStar = async (idx, item) => {
    if (!userId) { alert("请先登录"); return; }
    if (item.savedId) {
      setItems((prev) => prev.map((x, i) => (i === idx ? { ...x, savedId: null } : x)));
      try { await wb.deleteItem(item.savedId); } catch {}
      return;
    }
    try {
      const saved = await wb.saveSolvedItem(userId, {
        number: item.number, question: item.question, solution: item.solution,
        knowledgePoints: item.knowledgePoints || [], chapter: item.chapter || "",
      });
      if (saved) setItems((prev) => prev.map((x, i) => (i === idx ? { ...x, savedId: saved.id } : x)));
      else alert("收藏失败：请先在 Supabase 执行 sql/paper_items_starred.sql 添加 starred 列");
    } catch (e) { alert("收藏失败：" + (e.message || e)); }
  };

  const handleFiles = useCallback(async (files) => {
    if (!files?.length) return;
    const allFiles = [...files].filter((f) => f.type.startsWith("image/") || f.type === "application/pdf");
    if (!allFiles.length) { report("请上传图片或 PDF 文件"); return; }
    // 归档原始文件到「以往记录」（仅登录时，失败不阻断解题）
    if (userId) {
      (async () => {
        try {
          const paths = await wb.uploadImages(allFiles, userId);
          if (paths.length) await wb.createPaper({ userId, subject: "AI 解题", title: `AI 解题 ${new Date().toLocaleString()}`, imageUrls: paths });
        } catch {}
      })();
    }
    try {
      setItems([]);
      let questions = [];
      const total = allFiles.length;
      for (let fi = 0; fi < total; fi++) {
        const f = allFiles[fi];
        const baseP = Math.round(5 + (fi / total) * 25);
        report(`读取 ${f.name}…`, baseP);
        if (f.type === "application/pdf") {
          const text = await pdfToText(f, (msg) => report(msg, baseP + 3));
          if (text.replace(/\s+/g, "").length >= MIN_TEXT_DENSITY) {
            report("AI 识别题目结构…", baseP + 8);
            questions = questions.concat(await extractQuestionsFromText(text));
          } else {
            const uris = await pdfToImageURIs(f, (msg) => report(msg, baseP + 5));
            for (let i = 0; i < uris.length; i++) {
              report(`视觉识别第 ${i + 1}/${uris.length} 页…`, Math.round(baseP + 5 + (i / uris.length) * 18));
              const parsed = await extractPaper(uris[i], "together");
              questions = questions.concat(parsed.map((x) => ({ number: x.number, question: x.question })));
            }
          }
        } else {
          const uri = await fileToDataURI(f);
          if (!uri) continue;
          report("AI 识别图片题目…", baseP + 5);
          const parsed = await extractPaper(uri, "together");
          questions = questions.concat(parsed.map((x) => ({ number: x.number, question: x.question })));
        }
      }
      if (!questions.length) { report("没有识别到题目，请检查文件"); setProgress(null); return; }
      setItems(questions.map((q) => ({ ...q, solution: null, knowledgePoints: [], chapter: "", solving: true, expanded: true, failed: false })));
      report(`识别到 ${questions.length} 道题，AI 解题中…（并发）`, 30);
      let solved = 0;
      // 限并发 3 路解题；每题完成各自就地更新，不必等前一题
      await mapLimit(questions, 3, async (q, i) => {
        try {
          const result = await solveQuestion(q.number, q.question);
          const ok = result?.solution && result.solution.trim().length > 10;
          setItems((prev) => prev.map((x, idx) =>
            idx === i ? { ...x, solution: ok ? result.solution : null, knowledgePoints: result?.knowledgePoints || [], chapter: result?.chapter || "", solving: false, failed: !ok } : x
          ));
        } catch {
          setItems((prev) => prev.map((x, idx) => (idx === i ? { ...x, solving: false, failed: true } : x)));
        } finally {
          solved += 1;
          report(`解题中… ${solved}/${questions.length}`, Math.round(30 + (solved / questions.length) * 68));
        }
      });
      report(`全部完成，共 ${questions.length} 道题。`, 100);
      setTimeout(() => setProgress(null), 800);
    } catch (err) { report("出错：" + (err.message || err)); setProgress(null); }
  }, [report]);

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
      {progress !== null && progress < 100 && (
        <>
          <div className="pp-prog-pct">{progress}%</div>
          <div className="pp-prog-wrap"><div className="pp-prog-bar" style={{ width: `${progress}%` }} /></div>
        </>
      )}
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
                {!item.solving && !item.failed && item.solution && (
                  <button className="pp-starbtn" style={{ marginLeft: "auto" }} title={item.savedId ? "取消收藏" : "收藏到错题本"} onClick={() => toggleStar(idx, item)}>
                    {item.savedId ? "★" : "☆"}
                  </button>
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
export default function PaperPanel({ supabase, userId, activeItemId, onSelectItem, onItemsGraded, onReviewModeChange }) {
  useCSS();
  const [mode, setMode] = useState("grade");
  return (
    <div className="pp">
      <div className="pp-tabs">
        <span className={"pp-tab" + (mode === "grade" ? " on" : "")} onClick={() => setMode("grade")}>批改卷子</span>
        <span className={"pp-tab" + (mode === "solve" ? " on" : "")} onClick={() => setMode("solve")}>AI 解题</span>
      </div>
      {mode === "grade"
        ? <GradePanel supabase={supabase} userId={userId} activeItemId={activeItemId} onSelectItem={onSelectItem} onItemsGraded={onItemsGraded} onReviewModeChange={onReviewModeChange} />
        : <SolvePanel supabase={supabase} userId={userId} />}
    </div>
  );
}
