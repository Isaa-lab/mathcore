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
  gradeItem,
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
function cropFractionDataUri(uri, rect) {
  return new Promise((res) => {
    const img = new Image();
    img.onerror = () => res(null);
    img.onload = () => {
      const sx = Math.max(0, Math.round(rect.x * img.width));
      const sy = Math.max(0, Math.round(rect.y * img.height));
      const sw = Math.max(1, Math.round(rect.w * img.width));
      const sh = Math.max(1, Math.round(rect.h * img.height));
      const c = document.createElement("canvas");
      c.width = sw; c.height = sh;
      c.getContext("2d").drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      res(c.toDataURL("image/jpeg", 0.9));
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
    let ans = null;
    if (alignMap && Number.isInteger(alignMap[qi]) && answers[alignMap[qi]]) {
      ans = answers[alignMap[qi]];                 // 语义对齐优先
    } else {
      ans = ansMap[canonicalNumber(q.number)] || null; // 退回题号匹配
    }
    return {
      number: q.number,
      question: q.question,
      studentAnswer: ans ? (ans.studentAnswer || "") : (q.studentAnswer || ""),
      answerConfidence: ans ? (ans.answerConfidence || "high") : (q.answerConfidence || "low"),
      bbox: ans ? (ans.bbox || null) : null,
      _img: ans ? (ans._img ?? -1) : -1,
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
.pp-rv-imgwrap{position:relative;display:inline-block;max-width:100%;max-height:100%;line-height:0;transform-origin:center center}
.pp-rv-imgwrap img{max-width:100%;max-height:100%;object-fit:contain;display:block;user-select:none;-webkit-user-drag:none}
.pp-rv-zoom{position:absolute;top:8px;right:8px;display:flex;gap:4px;z-index:3}
.pp-rv-zoom button{width:28px;height:28px;border:1px solid var(--line);background:rgba(255,255,255,.92);border-radius:6px;cursor:pointer;font-size:14px;line-height:1;color:#3a3f55}
.pp-rv-zoom button:hover{border-color:var(--brand);color:var(--brand)}
.pp-rv-box{position:absolute;border:2px solid var(--brand);background:rgba(67,56,202,.12);border-radius:3px;pointer-events:none;transition:all .15s ease}
.pp-rv-frame{border-style:dashed;border-color:var(--emerald);background:rgba(4,120,87,.14);transition:none}
.pp-rv-fraback{width:auto!important;padding:0 10px!important}
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
.pp-mf-edit{flex-shrink:0;font-size:11px;border:1px solid var(--line);background:#fff;border-radius:6px;padding:3px 8px;cursor:pointer;color:var(--brand);font-family:inherit}
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
.pp-rv-foot{display:flex;gap:8px;flex-shrink:0;justify-content:flex-end;padding-top:6px;border-top:1px solid var(--line)}
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
function MathField({ label, value, warn, onChange, onFocus, editExtra, emptyHint }) {
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
              ? <EditableMath value={autoLatex(value)} onChange={onChange} />
              : <span className="pp-ans-empty">{emptyHint || "（空白）"}</span>}
          </div>
          <button className="pp-mf-edit" onClick={(e) => { e.stopPropagation(); setEditing(true); }}>✏️ 全文改</button>
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

function ReviewItemEditor({ item, answers = [], onChange, onFocusAnswer }) {
  const matchedIdx = answers.findIndex((a) => (a.studentAnswer || "") === (item.studentAnswer || "") && (item.studentAnswer || "").trim());
  const dropdown = answers.length > 0 ? (
    <select
      className="pp-rvi-pick"
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
      <MathField label="题目" value={item.question} onChange={(v) => onChange({ ...item, question: v })} />
      <MathField
        label="学生答案"
        warn={item.answerConfidence === "low" && (item.studentAnswer || "").trim() ? <span className="pp-rvi-warn"> · 字迹待确认</span> : null}
        value={item.studentAnswer}
        onChange={(v) => onChange({ ...item, studentAnswer: v })}
        onFocus={() => onFocusAnswer?.(item)}
        editExtra={dropdown}
        emptyHint="（未识别，点修改补充）"
      />
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
  const [framing, setFraming] = useState(false);     // 框选识别模式
  const [frameRect, setFrameRect] = useState(null);   // 拖框中的矩形(0~1)
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
  const onImgWheel = (e) => { if (framing) return; e.preventDefault(); zoomImg(e.deltaY < 0 ? 1.15 : 1 / 1.15); };
  // 相对当前显示图片的比例坐标(0~1)
  const imgFrac = (e) => {
    const el = imgElRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  };
  const onImgDown = (e) => {
    if (framing) { const f = imgFrac(e); setFrameRect({ x0: f.x, y0: f.y, x1: f.x, y1: f.y }); return; }
    imgDragRef.current = { sx: e.clientX, sy: e.clientY, ox: imgView.x, oy: imgView.y };
  };
  const onImgMove = (e) => {
    if (framing) { if (frameRect) { const f = imgFrac(e); setFrameRect((r) => ({ ...r, x1: f.x, y1: f.y })); } return; }
    const d = imgDragRef.current;
    if (!d) return;
    setImgView((v) => ({ ...v, x: d.ox + (e.clientX - d.sx), y: d.oy + (e.clientY - d.sy) }));
  };
  const onImgUp = async () => {
    if (framing) { await commitFrame(); return; }
    imgDragRef.current = null;
  };

  const startFraming = () => {
    if (reviewActiveIdx < 0) { alert("请先点一道题的「学生答案」框，把它设为目标，再框选原图区域。"); return; }
    setImgView({ zoom: 1, x: 0, y: 0 }); // 复位，框选坐标才对得上
    setFrameRect(null);
    setFraming(true);
  };

  const commitFrame = async () => {
    const r = frameRect;
    setFrameRect(null);
    if (!r) return;
    const rect = { x: Math.min(r.x0, r.x1), y: Math.min(r.y0, r.y1), w: Math.abs(r.x1 - r.x0), h: Math.abs(r.y1 - r.y0) };
    if (rect.w < 0.03 || rect.h < 0.02) return; // 框太小，忽略
    setRegionBusy(true);
    try {
      const crop = await cropFractionDataUri(reviewImages[reviewImgIdx], rect);
      if (!crop) throw new Error("裁剪失败");
      const text = await extractRegion(crop);
      if (text) {
        setReviewItems((prev) => prev.map((x, j) => (j === reviewActiveIdx ? { ...x, studentAnswer: text, answerConfidence: "low" } : x)));
        setFraming(false);
      } else {
        alert("没识别出内容，可重新框选更紧的区域。");
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
      setReviewItems(extracted.map(x => ({ number: x.number, question: x.question || "", studentAnswer: x.studentAnswer || "", answerConfidence: x.answerConfidence || "low" })));
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
      report("AI 按内容对齐题目和答案…", 80);
      // 语义对齐：按答案内容判断它解的是哪道题（解决手写编号和官方题号对不上）；失败则回退题号匹配
      let alignMap = null;
      try { alignMap = await alignAnswersToQuestions(questions, answers); } catch { alignMap = null; }
      const merged = mergeQuestionsAnswers(questions, answers, alignMap);
      setReviewAnswers(answers); // 原始 OCR 答案段（带 bbox/_img），供手动指认 + 画框定位
      // 校对左侧用答案原图（带坐标），让每道题能高亮回原图区域
      setReviewImages(images);
      setReviewItems(merged.map(x => ({ number: x.number, question: x.question || "", studentAnswer: x.studentAnswer || "", answerConfidence: x.answerConfidence || "low", bbox: x.bbox || null, _img: x._img ?? -1 })));
      setReviewImgIdx(0);
      setReviewPhase(true);
      onReviewModeChange?.(true);
      report(`识别完成 ${merged.length} 道题，请校对后确认`, 100);
      setTimeout(() => setProgress(null), 600);
    } catch (err) { report("出错：" + (err.message || err)); setProgress(null); }
  }, [userId, wb, qFiles, aFiles, report, progress, onReviewModeChange]);

  const confirmReview = async () => {
    try {
      report("保存中…", 92);
      setProgress(92);
      // 归档原始上传文件到「以往记录」（失败不阻断保存）
      let archived = [];
      try { if (pendingFiles.length) archived = await wb.uploadImages(pendingFiles, userId); } catch {}
      const paper = await wb.createPaper({ userId, imageUrls: archived });
      const rows = reviewItems.map((item) => ({
        paper_id: paper.id,
        user_id: userId,
        number: item.number || "",
        question: item.question || "",
        student_answer: item.studentAnswer || "",
        answer_confidence: "high", // 用户已确认
        reviewed: true,
        is_correct: null,
      }));
      const saved = await wb.insertItems(rows);
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
  };

  const saveAnswer = async (item) => {
    const updated = await wb.updateItem(item.id, { student_answer: draft, reviewed: true });
    setItems((prev) => prev.map((x) => (x.id === item.id ? { ...x, ...updated } : x)));
    setEditing(null); setDraft("");
  };

  const gradeAll = async () => {
    report("AI 批改中…（并发处理）", 5);
    let done = 0;
    // 限并发 3 路批改：N 题不再逐题串行等待
    const graded = await mapLimit(items, 3, async (item) => {
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
        return updated || { ...item, ...patch };
      } catch {
        return item;
      } finally {
        done += 1;
        report(`批改中… ${done}/${items.length}`, Math.round(5 + (done / items.length) * 90));
      }
    });
    setItems(graded);
    await wb.bumpMastery(userId, graded);
    report(`批改完成：错 ${graded.filter((x) => x.is_correct === false).length} 题。点错题开始辅导。`, 100);
    setTimeout(() => setProgress(null), 800);
    onItemsGraded?.(graded);
  };

  const flipCorrect = async (item) => {
    const next = !item.is_correct;
    const updated = await wb.updateItem(item.id, { is_correct: next, error_type: next ? null : (item.error_type || "计算") });
    setItems((prev) => prev.map((x) => (x.id === item.id ? { ...x, ...updated } : x)));
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
                  className="pp-rv-imgmain"
                  onWheel={onImgWheel}
                  onMouseDown={onImgDown}
                  onMouseMove={onImgMove}
                  onMouseUp={onImgUp}
                  onMouseLeave={onImgUp}
                  style={{ cursor: imgDragRef.current ? "grabbing" : imgView.zoom > 1 ? "grab" : "default" }}
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
                    {framing && frameRect && (
                      <div className="pp-rv-box pp-rv-frame" style={{
                        left: `${Math.min(frameRect.x0, frameRect.x1) * 100}%`,
                        top: `${Math.min(frameRect.y0, frameRect.y1) * 100}%`,
                        width: `${Math.abs(frameRect.x1 - frameRect.x0) * 100}%`,
                        height: `${Math.abs(frameRect.y1 - frameRect.y0) * 100}%`,
                      }} />
                    )}
                  </div>
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
                      <button className="pp-rv-fraback" onClick={() => { setFraming(false); setFrameRect(null); }}>{regionBusy ? "识别中…" : "✕ 退出框选"}</button>
                    )}
                  </div>
                  {framing && (
                    <div className="pp-rv-frametip">
                      {regionBusy ? "正在识别框选区域…" : (reviewActiveIdx >= 0 ? `拖框选中要识别的区域 → 填入 #${reviewItems[reviewActiveIdx]?.number || (reviewActiveIdx + 1)}` : "请先选目标题")}
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
              />
            ))}
          </div>
        </div>
        <div className="pp-rv-foot">
          <button className="pp-btn" onClick={() => { setReviewPhase(false); setFocusBox(null); onReviewModeChange?.(false); }}>← 重新上传</button>
          <button className="pp-btn primary" onClick={confirmReview}>确认识别，开始批改 →</button>
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
            <button className="pp-btn primary" style={{ marginTop: 6 }} onClick={gradeAll}>全部批改（判对错 + 分析）</button>
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
