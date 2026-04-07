import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";
import katex from "katex";
import "katex/dist/katex.min.css";

const supabase = createClient(
  "https://kadjwgslbpklwbpvpsze.supabase.co",
  "sb_publishable_TvfRCNQCSs92EmZ02J5H1A_yM3FrFUp"
);

const G = {
  teal: "#1D9E75", tealLight: "#E1F5EE", tealDark: "#0F6E56",
  blue: "#185FA5", blueLight: "#E6F1FB",
  amber: "#BA7517", amberLight: "#FAEEDA",
  red: "#A32D2D", redLight: "#FCEBEB",
  purple: "#534AB7", purpleLight: "#EEEDFE",
};

const MATERIAL_ALLOWED_EXTS = [".pdf", ".ppt", ".pptx", ".doc", ".docx"];

/** materials 表尚未执行审核迁移（无 status 列）时，PostgREST 会报 PGRST204 */
const isMissingMaterialsStatusColumn = (err) => {
  const msg = String(err?.message || "");
  const code = String(err?.code || "");
  if (/Could not find the ['"]status['"] column of ['"]materials['"]/i.test(msg)) return true;
  if (/column\s+.*\bstatus\b.*does not exist/i.test(msg)) return true;
  if ((code === "PGRST204" || msg.includes("PGRST204")) && /\bstatus\b/i.test(msg) && /\bmaterials\b/i.test(msg)) {
    return true;
  }
  return false;
};

const isMissingQuestionsMaterialIdColumn = (err) => {
  const msg = String(err?.message || "");
  const code = String(err?.code || "");
  if (/Could not find the ['"]material_id['"] column of ['"]questions['"]/i.test(msg)) return true;
  if (/column\s+.*\bmaterial_id\b.*does not exist/i.test(msg)) return true;
  if ((code === "PGRST204" || msg.includes("PGRST204")) && /\bmaterial_id\b/i.test(msg) && /\bquestions\b/i.test(msg)) {
    return true;
  }
  return false;
};

const isMissingQuestionsQualityColumns = (err) => {
  const msg = String(err?.message || "");
  const code = String(err?.code || "");
  if (/Could not find the ['"](source_chunk_id|source_quote|quality_score)['"] column of ['"]questions['"]/i.test(msg)) return true;
  if (/column\s+.*\b(source_chunk_id|source_quote|quality_score)\b.*does not exist/i.test(msg)) return true;
  if ((code === "PGRST204" || msg.includes("PGRST204")) && /\bquestions\b/i.test(msg) && /\b(source_chunk_id|source_quote|quality_score)\b/i.test(msg)) {
    return true;
  }
  return false;
};

const getFileExt = (name = "") => {
  const idx = name.lastIndexOf(".");
  return idx >= 0 ? name.slice(idx).toLowerCase() : "";
};

const withTimeout = async (promise, ms = 12000) => {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error("请求超时")), ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }
};

const normalizeMaterialText = (input) => {
  const raw = String(input || "");
  if (!raw) return "";
  // 保留换行便于英文 PDF 按段/按句切分；行内多空格压成单空格
  const cleaned = raw
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
  if (!cleaned) return "";
  // Only block obvious office-zip/binary artifacts; keep normal English textbook text.
  const junkLike = /PK\u0003\u0004|word\/|ppt\/|_rels|Content_Types\.xml|Image Manager/i.test(cleaned);
  if (junkLike) return "";
  return cleaned;
};

/** 未选章节时不要用「未知章节」：用具体章节 / 课程名 / 资料标题，避免题干与 API 上下文全是占位词 */
const resolveMaterialChapterLabel = (material) => {
  const ch = String(material?.chapter || "").trim();
  if (ch && ch !== "全部") return ch;
  const co = String(material?.course || "").trim();
  if (co) return co;
  const ti = String(material?.title || "").trim();
  if (ti) return ti.length > 42 ? `${ti.slice(0, 40)}…` : ti;
  return "本资料";
};

const splitTextIntoChunks = (text, maxLen = 700) => {
  const raw = String(text || "").trim();
  if (!raw) return [];
  const sents = raw
    .split(/\n+/)
    .flatMap((block) => block.split(/[。！？]|\.\s+|\?\s+|\!\s+/))
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const out = [];
  let cur = "";
  sents.forEach((s) => {
    if (!cur) {
      cur = s;
      return;
    }
    if ((cur.length + s.length + 1) <= maxLen) cur += " " + s;
    else {
      out.push(cur);
      cur = s;
    }
  });
  if (cur) out.push(cur);
  return out.slice(0, 30);
};

const buildSeedClaimsFromText = (text, chapter, course, count = 12) => {
  const src = String(text || "").trim();
  if (!src) return [];
  const sents = src
    .split(/\n+/)
    .flatMap((block) => block.split(/[。！？]|\.\s+|\?\s+|\!\s+/))
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length >= 10)
    .slice(0, count * 3);
  const out = [];
  for (let i = 0; i < sents.length && out.length < count; i++) {
    const claim = sents[i].slice(0, 110);
    // 种子 claim 来自 PDF 原句，不因「中文太少」丢弃英文教材
    if (/Image Manager|Neelakantan|_rels|Content_Types\.xml|PK\u0003\u0004/i.test(claim)) continue;
    out.push({
      chunk_index: 0,
      claim_text: claim,
      claim_type: "fact",
      difficulty: 2,
      source_quote: claim.slice(0, 80),
      chapter: chapter || null,
      course: course || "数学",
    });
  }
  return out;
};

const fetchChapterFallbackQuestions = async (chapter, count = 6) => {
  if (!count || count <= 0) return [];
  try {
    const res = await withTimeout(fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chapter: chapter || "资料专题", type: "单选题", count }),
    }), 9000);
    const data = await res.json();
    if (data?.error) return [];
    const arr = Array.isArray(data?.questions) ? data.questions : [];
    return arr.map((q) => ({
      ...q,
      type: q?.type || (q?.options ? "单选题" : "判断题"),
      quality_score: Math.max(72, Number(q?.quality_score || 72)),
      source_quote: q?.source_quote || `来自章节「${chapter || "资料专题"}」的兜底命题`,
      source_chunk_id: Number.isFinite(Number(q?.source_chunk_id)) ? Number(q.source_chunk_id) : null,
    }));
  } catch (e) {
    return buildMinimalChapterQuestions(chapter || "资料专题", Math.min(count, 4));
  }
};

const buildFallbackQuestions = (text, chapter, count = 6) => {
  const src = String(text || "").trim();
  if (!src) return [];
  const sents = src
    .split(/\n+/)
    .flatMap((block) => block.split(/[。！？]|\.\s+|\?\s+|\!\s+/))
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 12)
    .slice(0, count * 4);
  const qs = [];
  for (let i = 0; i < sents.length && qs.length < count; i++) {
    const sent = sents[i];
    if (i % 2 === 0) {
      qs.push({
        question: `以下说法是否正确：「${sent.slice(0, 58)}」`,
        options: null,
        answer: "正确",
        explanation: sent.slice(0, 120),
        type: "判断题",
        chapter: chapter || "资料专题",
      });
    } else {
      const words = sent.split(/[，,\s]/).filter(w => w.length > 1);
      const key = words[0] || "该知识点";
      qs.push({
        question: `关于「${key}」，下列描述最恰当的是：`,
        options: [
          `A.${sent.slice(0, 30)}`,
          `B.${key}与原文结论相反`,
          `C.${key}在资料中未出现`,
          "D.以上都不正确",
        ],
        answer: "A",
        explanation: sent.slice(0, 120),
        type: "单选题",
        chapter: chapter || "资料专题",
      });
    }
  }
  return qs.slice(0, count);
};

const buildFallbackTopics = (text, chapter, count = 4) => {
  const raw = String(text || "").trim();
  if (!raw) {
    return Array.from({ length: Math.max(2, Math.min(count, 4)) }).map((_, i) => ({
      name: `${chapter || "资料专题"} 知识点 ${i + 1}`,
      summary: "基于资料自动生成的核心要点，建议先阅读原文再练习。",
      chapter: chapter || null,
    }));
  }
  const sents = raw
    .split(/\n+/)
    .flatMap((block) => block.split(/[。！？]|\.\s+/))
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 12)
    .slice(0, count);
  return sents.map((s, i) => ({
    name: s.length > 32 ? s.slice(0, 30) + "…" : s,
    summary: s.slice(0, 80),
    chapter: chapter || null,
  }));
};

const buildMinimalChapterQuestions = (chapter = "资料专题", count = 4) => {
  let ch = String(chapter || "").trim();
  if (!ch || ch === "未知章节" || ch === "全部") ch = "本资料";
  const n = Math.max(2, Math.min(Number(count) || 4, 8));
  const templates = [
    {
      question: `关于「${ch}」，下列说法最合理的是：`,
      options: [
        "A.应从定义、条件和结论三层理解知识点",
        "B.只记结论，不必关注适用条件",
        "C.任何方法都可直接套用，无需判断前提",
        "D.学习时不需要和例题对应验证",
      ],
      answer: "A",
      explanation: "有效学习应同时掌握定义、前提与结论，并通过例题验证。",
      type: "单选题",
      chapter: ch,
      source_quote: `章节「${ch}」通用保底题`,
      quality_score: 72,
      source_chunk_id: null,
    },
    {
      question: `在学习「${ch}」时，先明确概念再做题通常更有效。`,
      options: null,
      answer: "正确",
      explanation: "先理解概念与适用条件，可以减少机械套题造成的错误。",
      type: "判断题",
      chapter: ch,
      source_quote: `章节「${ch}」通用保底题`,
      quality_score: 72,
      source_chunk_id: null,
    },
  ];
  const out = [];
  while (out.length < n) out.push(templates[out.length % templates.length]);
  return out;
};

const buildTopicsFromClaims = (claims = [], chapter = null) => {
  const rows = (Array.isArray(claims) ? claims : [])
    .map((c) => String(c?.claim_text || "").trim())
    .filter((t) => t.length >= 8)
    .slice(0, 6);
  if (!rows.length) return [];
  return rows.map((t, i) => ({
    name: `知识点 ${i + 1}`,
    summary: t.slice(0, 80),
    chapter: chapter || null,
  }));
};

const normalizeOutline = (outlineRaw = [], defaultSection = "资料大纲") => {
  const sections = (Array.isArray(outlineRaw) ? outlineRaw : [])
    .map((s) => ({
      title: String(s?.title || "").trim() || defaultSection,
      summary: String(s?.summary || "").trim(),
      topics: (Array.isArray(s?.topics) ? s.topics : [])
        .map((t) => String(t || "").trim())
        .filter((t) => t.length >= 2)
        .slice(0, 8),
    }))
    .filter((s) => s.topics.length > 0)
    .slice(0, 6);
  return sections;
};

const flattenOutlineTopics = (sections = []) => {
  const out = [];
  sections.forEach((s) => {
    (s.topics || []).forEach((t) => out.push({
      name: t,
      chapter: s.title,
      summary: s.summary || "",
    }));
  });
  return out.slice(0, 24);
};

const ensurePdfJs = async () => {
  if (window.pdfjsLib) return;
  await new Promise((res, rej) => {
    const sc = document.createElement("script");
    sc.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    sc.onload = res;
    sc.onerror = rej;
    document.head.appendChild(sc);
  });
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
};

/** @returns {{ text: string, pdfMeta: null | { likelyScanned: boolean, pageCount: number, sampledPages: number, textItemCount: number, meaningfulCharCount: number } }} */
const extractMaterialTextWithMeta = async (file) => {
  if (!file) return { text: "", pdfMeta: null };
  const ext = getFileExt(file.name);
  if (ext === ".pdf") {
    try {
      await ensurePdfJs();
      const buf = await file.arrayBuffer();
      const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
      let text = "";
      let totalItems = 0;
      const sampledPages = Math.min(pdf.numPages, 60);
      for (let i = 1; i <= sampledPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const items = content.items || [];
        totalItems += items.length;
        // 片段间加空格，避免英文粘成一词导致无法按句切分、AI 也读不懂
        let line = "";
        let lastY = null;
        for (const item of items) {
          const s = item.str || "";
          if (!s) continue;
          const y = item.transform ? item.transform[5] : 0;
          if (lastY !== null && Math.abs(y - lastY) > 4) {
            text += line.trim() + "\n";
            line = "";
          }
          if (line && !/\s$/.test(line) && !/^[\s.,;:!?)\]}]/.test(s)) line += " ";
          line += s;
          lastY = y;
        }
        if (line.trim()) text += line.trim() + "\n";
      }
      const normalized = normalizeMaterialText(text);
      const compact = normalized.replace(/\s/g, "");
      const meaningfulCharCount = compact.length;
      const pageCount = pdf.numPages;
      // 扫描版通常几乎无 text items / 无内嵌文字层（与「页数多但字少」一并判断）
      const fewItems = totalItems < 24 && pageCount >= 2;
      const likelyScanned =
        meaningfulCharCount === 0 ||
        (pageCount >= 2 && meaningfulCharCount < 120) ||
        (pageCount === 1 && meaningfulCharCount < 40) ||
        (fewItems && meaningfulCharCount < 200);
      return {
        text: normalized,
        pdfMeta: {
          likelyScanned,
          pageCount,
          sampledPages,
          textItemCount: totalItems,
          meaningfulCharCount,
        },
      };
    } catch (e) {
      return {
        text: "",
        pdfMeta: { likelyScanned: true, pageCount: 0, sampledPages: 0, textItemCount: 0, meaningfulCharCount: 0 },
      };
    }
  }
  // NOTE: .docx/.pptx are zip binaries; direct text() often becomes garbage.
  if (ext === ".docx" || ext === ".pptx" || ext === ".ppt" || ext === ".doc") {
    return { text: "", pdfMeta: null };
  }
  try {
    const t = await file.text();
    return { text: normalizeMaterialText((t || "").slice(0, 12000)), pdfMeta: null };
  } catch (e) {
    return { text: "", pdfMeta: null };
  }
};

const isLowQualityQuestion = (q) => {
  const text = String(q?.question || "");
  const exp = String(q?.explanation || "");
  const opts = q?.options;
  const sourceQuote = String(q?.source_quote || "");
  const qualityScore = Number(q?.quality_score || 0);
  const hasOptions = Array.isArray(opts) ? opts.length >= 2 : typeof opts === "string" && String(opts).trim().length > 8;

  if (!text || text.length < 10) return true;
  // API/保底模板把「未知章节」写进题干，无学科信息
  if (/[「『]未知章节[」』]/.test(text)) return true;
  // Obvious noisy/irrelevant artifacts
  if (/Image Manager|Neelakantan|_rels|Content_Types\.xml|PK\u0003\u0004/i.test(text)) return true;
  const chineseCount = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const alphaCount = (text.match(/[A-Za-z]/g) || []).length;
  // Keep English math materials available; only block obvious software/file artifacts.
  if (alphaCount > 120 && chineseCount < 2 && /_rels|Content_Types\.xml|Image Manager|PK\u0003\u0004/i.test(text)) return true;
  // 占位模板（全角/半角数字、多空格）
  if (/第[ \t\u3000]*[\d０-９]+[ \t\u3000]*个理解点/.test(text)) return true;
  if (/关于本资料内容/.test(text)) return true;
  if (/理解点/.test(text) && /以下判断是否正确|是否正确[？?]/.test(text)) return true;
  if (/请结合资料原文和课堂笔记/.test(exp)) return true;
  // extract 约定单选题却缺选项 → 常被误判成判断题
  if (!hasOptions && /下列|哪项|哪个|最恰当|选择的是/.test(text)) return true;
  // 判断题模板：只否定「以下判断是否正确」但无引号命题且含占位用语
  const hasQuotedClaim = /「[^」]{4,}」|『[^』]{4,}』/.test(text);
  if (/以下判断是否正确|如下判断是否正确/.test(text) && !hasQuotedClaim) {
    if (/理解点|本资料|知识点\s*\d|第\s*[\d０-９]+\s*个/.test(text)) return true;
  }
  if (sourceQuote && sourceQuote.length < 6) return true;
  if (qualityScore > 0 && qualityScore < 70) return true;

  return false;
};

const isLikelyRelevantClaim = (claimText = "") => {
  const t = String(claimText || "").trim();
  if (t.length < 8) return false;
  if (/Image Manager|Neelakantan|_rels|Content_Types\.xml|PK\u0003\u0004/i.test(t)) return false;
  const chineseCount = (t.match(/[\u4e00-\u9fff]/g) || []).length;
  const alphaCount = (t.match(/[A-Za-z]/g) || []).length;
  const mathHint = /(矩阵|范数|收敛|迭代|导数|积分|微分|误差|牛顿|最小二乘|优化|特征值|条件数|插值|方程|算法|线性|非线性|梯度|行列式|向量|子空间|基|秩|转置|可逆|正交|对角化|hessian|newton|gauss|qr|lu|svd|matrix|vector|eigen|determinant|linear|subspace|basis|rank|transpose|invertible|orthogonal|theorem|definition|lemma|proof)/i.test(t);
  if (chineseCount >= 3) return true;
  if (mathHint) return true;
  // 英文教材：足够长的字母句视为有效 claim（避免整段被清空）
  if (alphaCount >= 18 && t.length >= 24) return true;
  return false;
};

const fetchFileAsBrowserFile = async (url, fallbackName = "material.pdf") => {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const ext = getFileExt(fallbackName) || ".pdf";
    const mimeByExt = {
      ".pdf": "application/pdf",
      ".doc": "application/msword",
      ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ".ppt": "application/vnd.ms-powerpoint",
      ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    };
    const file = new File([blob], fallbackName, { type: mimeByExt[ext] || blob.type || "application/octet-stream" });
    return file;
  } catch (e) {
    return null;
  }
};

const processMaterialWithAI = async ({ material, file, genCount = 5 }) => {
  const materialId = material?.id;
  if (!materialId) return { topics: [], questions: [], insertedCount: 0, materialLinked: false };

  const chapter = (material?.chapter && material.chapter !== "全部")
    ? material.chapter : (material?.course || material?.title || "本资料");

  // Step 1: Extract text from PDF using pdf.js (client-side, free)
  let text = "";
  const pdfLikelyScanned = false;

  if (file) {
    try {
      await ensurePdfJs();
      const buf = await file.arrayBuffer();
      const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
      const totalPages = pdf.numPages;

      // Sample strategy: skip likely cover/TOC pages (first 3), sample up to 50 content pages
      const startPage = Math.min(4, totalPages);
      const endPage = Math.min(startPage + 49, totalPages);

      // First pass: collect all page texts to detect running headers/footers
      const rawPageTexts = [];
      for (let i = startPage; i <= endPage; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const items = (content.items || [])
          .filter(item => item.str && item.str.trim())
          .sort((a, b) => {
            const yDiff = (b.transform?.[5] || 0) - (a.transform?.[5] || 0);
            if (Math.abs(yDiff) > 5) return yDiff;
            return (a.transform?.[4] || 0) - (b.transform?.[4] || 0);
          });
        let pageText = "";
        let lastY = null;
        for (const item of items) {
          const y = item.transform?.[5] || 0;
          if (lastY !== null && Math.abs(y - lastY) > 8) pageText += "\n";
          else if (pageText && !pageText.endsWith(" ")) pageText += " ";
          pageText += item.str;
          lastY = y;
        }
        if (pageText.trim()) rawPageTexts.push(pageText.trim());
      }

      // Detect running headers/footers: short lines (< 80 chars) appearing in 30%+ of pages
      const lineFreq = {};
      const sampledCount = rawPageTexts.length;
      rawPageTexts.forEach(pt => {
        const firstLine = pt.split("\n")[0].trim();
        const lastLine = pt.split("\n").slice(-1)[0].trim();
        [firstLine, lastLine].forEach(l => {
          if (l.length > 0 && l.length < 80) {
            lineFreq[l] = (lineFreq[l] || 0) + 1;
          }
        });
      });
      const threshold = Math.max(2, Math.floor(sampledCount * 0.3));
      const headerFooterSet = new Set(
        Object.entries(lineFreq).filter(([, c]) => c >= threshold).map(([l]) => l)
      );

      const pageTexts = rawPageTexts.map(pt => {
        return pt
          .split("\n")
          .filter(l => !headerFooterSet.has(l.trim()))
          .join("\n");
      }).filter(pt => pt.trim().length > 0);

      let rawText = pageTexts.join("\n\n").trim();

      // Fix hyphenated line breaks common in English academic PDFs (e.g. "algo-\nrithm")
      rawText = rawText.replace(/([a-zA-Z])-\n([a-zA-Z])/g, "$1$2");
      // Collapse excessive blank lines
      rawText = rawText.replace(/\n{3,}/g, "\n\n");

      text = normalizeMaterialText(rawText);
    } catch (e) {
      console.error("PDF extraction error:", e.message);
    }
  }

  // Step 2: Try fetching from stored URL if no local file
  if (!text && material?.file_data && material.file_data.startsWith("http")) {
    try {
      const r = await fetch(material.file_data);
      if (r.ok) {
        const blob = await r.blob();
        const f2 = new File([blob], material.file_name || "m.pdf", { type: "application/pdf" });
        const sub = await processMaterialWithAI({ material, file: f2, genCount });
        return sub;
      }
    } catch (e) {}
  }

  const hasText = text.trim().length > 80;
  let topics = [], questions = [], usedApi = false;
  let apiQuotaExceeded = false;
  let apiErrorMsg = "";

  // Step 3: Call /api/extract with the extracted text
  if (hasText) {
    try {
      const resp = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: text.slice(0, 8000),
          course: material?.course || "数学",
          chapter,
          count: genCount,
        }),
      });
      const data = await resp.json();
      if (resp.status === 429 || data.error === "QUOTA_EXCEEDED") {
        apiQuotaExceeded = true;
        apiErrorMsg = data.message || "Gemini API 配额已用完，请等待 1 分钟后重试。";
        console.warn("API quota exceeded:", apiErrorMsg);
      } else if (!data.error) {
        topics = Array.isArray(data.topics) ? data.topics : [];
        questions = Array.isArray(data.questions) ? data.questions : [];
        usedApi = true;
      } else {
        apiErrorMsg = data.error;
        console.error("API extract error:", data.error);
      }
    } catch (e) {
      console.error("API extract fetch error:", e.message);
    }
  }

  // Step 4: Fallback sentence-based questions — ONLY when API failed for non-quota reasons
  // Skip entirely on quota exceeded (would produce garbage questions)
  if (questions.length === 0 && hasText && !apiQuotaExceeded) {
    const isLikelySentence = (s) => {
      if (s.length < 30 || s.length > 180) return false;
      // Reject fragments starting with punctuation, math operators, or digits
      if (/^[\s,，.。;；:：\-+×÷=<>()\[\]{}|\/\\^_*\d]/.test(s)) return false;
      // Reject if math symbol density is too high (formula fragment)
      const mathCount = (s.match(/[=+\-×÷<>()\[\]{}|\/\\^_]/g) || []).length;
      if (mathCount > s.length * 0.15) return false;
      // Must contain at least 5 words / tokens
      if (s.trim().split(/\s+/).length < 5) return false;
      // Must have real alphabetic or CJK content
      if (!/[一-龥a-zA-Z]{3,}/.test(s)) return false;
      return true;
    };

    const sents = text
      .split(/[。\n]|\.\s+/)
      .map(s => s.replace(/\s+/g, " ").trim())
      .filter(isLikelySentence);

    for (let i = 0; i < sents.length && questions.length < genCount; i++) {
      const s = sents[i];
      questions.push({
        question: `判断：「${s.slice(0, 80)}」是否正确？`,
        options: null, answer: "正确",
        explanation: "请结合教材核对该陈述的准确性。",
        type: "判断题", chapter,
      });
    }
  }

  // Step 5: Save questions to DB — skip if quota exceeded (don't persist garbage)
  let insertedCount = 0;
  let materialLinked = false;
  if (!apiQuotaExceeded && questions.length > 0) {
    try {
      const rows = questions.map(q => ({
        chapter: q.chapter || chapter,
        course: material?.course || "数学",
        type: q.type || (q.options ? "单选题" : "判断题"),
        question: q.question,
        options: q.options || null,
        answer: q.answer,
        explanation: q.explanation || "",
        material_id: materialId,
      }));
      const { error: e1 } = await supabase.from("questions").insert(rows);
      if (!e1) { insertedCount = rows.length; materialLinked = true; }
      else {
        // Try without material_id if column missing
        const rows2 = rows.map(({ material_id, ...r }) => r);
        const { error: e2 } = await supabase.from("questions").insert(rows2);
        if (!e2) insertedCount = rows2.length;
      }
    } catch (e) {}
  }

  // Build diagnostic info for the UI
  const textLen = text.trim().length;
  const englishRatio = textLen > 0
    ? (text.match(/[a-zA-Z]/g) || []).length / textLen
    : 0;
  const textDiag = {
    charCount: textLen,
    language: englishRatio > 0.4 ? "English" : "Chinese",
    quality: !hasText ? "poor" : textLen < 500 ? "low" : textLen < 2000 ? "medium" : "good",
    hint: !hasText
      ? "未能提取文字（扫描版 PDF），题目质量很低，建议使用可选中文字的电子版 PDF"
      : textLen < 500
      ? `提取文字较少（${textLen} 字符），建议上传内容更多的 PDF 以提升出题质量`
      : `提取到 ${textLen} 字符（${englishRatio > 0.4 ? "英文" : "中文"}教材），题目基于真实教材内容生成`,
  };

  return {
    topics, questions, insertedCount, materialLinked,
    hasText, usedApi, pdfLikelyScanned: !hasText,
    textDiag,
    apiQuotaExceeded,
    apiErrorMsg,
    parseHint: !hasText ? "未能从 PDF 提取文字（可能是扫描版），建议使用可选中文字的电子版 PDF。" : null,
  };
};


// ── KaTeX ─────────────────────────────────────────────────────────────────────
const M = ({ tex, block = false }) => {
  const ref = useRef();
  useEffect(() => {
    if (ref.current) {
      try { katex.render(tex, ref.current, { throwOnError: false, displayMode: block }); } catch (e) {}
    }
  }, [tex, block]);
  return <span ref={ref} style={{ display: block ? "block" : "inline", margin: block ? "0.6rem 0" : "0 2px" }} />;
};

// ── Simple Visualizations (SVG) ───────────────────────────────────────────────
const VizBisection = () => (
  <svg viewBox="0 0 320 140" style={{ width: "100%", maxWidth: 320, display: "block", margin: "0 auto" }}>
    <rect x="0" y="0" width="320" height="140" fill={G.blueLight} rx="8"/>
    <line x1="20" y1="110" x2="300" y2="110" stroke="#aaa" strokeWidth="1"/>
    <path d="M30,30 Q120,140 200,50 Q250,10 300,80" stroke={G.teal} strokeWidth="2" fill="none"/>
    {/* intervals */}
    <line x1="30" y1="105" x2="300" y2="105" stroke={G.blue} strokeWidth="3"/>
    <line x1="30" y1="100" x2="30" y2="112" stroke={G.blue} strokeWidth="2"/>
    <line x1="300" y1="100" x2="300" y2="112" stroke={G.blue} strokeWidth="2"/>
    <text x="30" y="125" fontSize="10" fill={G.blue} textAnchor="middle">a</text>
    <text x="300" y="125" fontSize="10" fill={G.blue} textAnchor="middle">b</text>
    <line x1="165" y1="98" x2="165" y2="112" stroke={G.amber} strokeWidth="2" strokeDasharray="3"/>
    <text x="165" y="125" fontSize="10" fill={G.amber} textAnchor="middle">c=(a+b)/2</text>
    <circle cx="213" cy="72" r="5" fill={G.red}/>
    <text x="213" y="65" fontSize="10" fill={G.red} textAnchor="middle">root</text>
    <text x="160" y="15" fontSize="11" fill={G.blue} textAnchor="middle" fontWeight="500">二分法区间缩减示意</text>
  </svg>
);

const VizNewton = () => (
  <svg viewBox="0 0 320 150" style={{ width: "100%", maxWidth: 320, display: "block", margin: "0 auto" }}>
    <rect x="0" y="0" width="320" height="150" fill={G.tealLight} rx="8"/>
    <line x1="20" y1="120" x2="300" y2="120" stroke="#aaa" strokeWidth="1"/>
    <path d="M60,20 Q160,180 280,40" stroke={G.teal} strokeWidth="2.5" fill="none"/>
    {/* tangent line at x1 */}
    <line x1="80" y1="130" x2="200" y2="40" stroke={G.amber} strokeWidth="1.5" strokeDasharray="4"/>
    <circle cx="140" cy="85" r="5" fill={G.blue}/>
    <text x="140" y="78" fontSize="10" fill={G.blue} textAnchor="middle">x₁</text>
    <line x1="178" y1="118" x2="178" y2="122" stroke={G.amber} strokeWidth="2"/>
    <text x="178" y="134" fontSize="10" fill={G.amber} textAnchor="middle">x₂</text>
    <circle cx="218" cy="55" r="5" fill={G.blue}/>
    <text x="218" y="48" fontSize="10" fill={G.blue} textAnchor="middle">x₀</text>
    <circle cx="252" cy="108" r="5" fill={G.red}/>
    <text x="252" y="101" fontSize="10" fill={G.red} textAnchor="middle">x*</text>
    <text x="160" y="16" fontSize="11" fill={G.tealDark} textAnchor="middle" fontWeight="500">Newton 法切线迭代</text>
  </svg>
);

const VizLU = () => (
  <svg viewBox="0 0 320 130" style={{ width: "100%", maxWidth: 320, display: "block", margin: "0 auto" }}>
    <rect x="0" y="0" width="320" height="130" fill={G.purpleLight} rx="8"/>
    {/* A matrix */}
    <rect x="20" y="30" width="60" height="60" fill="white" rx="4" stroke={G.purple} strokeWidth="1.5"/>
    <text x="50" y="64" fontSize="20" fill={G.purple} textAnchor="middle" fontWeight="700">A</text>
    <text x="50" y="22" fontSize="11" fill={G.purple} textAnchor="middle">系数矩阵</text>
    {/* = */}
    <text x="98" y="66" fontSize="22" fill="#666" textAnchor="middle">=</text>
    {/* L matrix */}
    <rect x="112" y="30" width="60" height="60" fill="white" rx="4" stroke={G.teal} strokeWidth="1.5"/>
    <text x="142" y="64" fontSize="20" fill={G.teal} textAnchor="middle" fontWeight="700">L</text>
    <text x="142" y="22" fontSize="11" fill={G.teal} textAnchor="middle">下三角</text>
    {/* × */}
    <text x="188" y="66" fontSize="18" fill="#666" textAnchor="middle">×</text>
    {/* U matrix */}
    <rect x="202" y="30" width="60" height="60" fill="white" rx="4" stroke={G.blue} strokeWidth="1.5"/>
    <text x="232" y="64" fontSize="20" fill={G.blue} textAnchor="middle" fontWeight="700">U</text>
    <text x="232" y="22" fontSize="11" fill={G.blue} textAnchor="middle">上三角</text>
    {/* steps */}
    <text x="160" y="112" fontSize="10" fill="#555" textAnchor="middle">Ly=b → Ux=y，逐步求解</text>
  </svg>
);

const VizSimpson = () => (
  <svg viewBox="0 0 320 150" style={{ width: "100%", maxWidth: 320, display: "block", margin: "0 auto" }}>
    <rect x="0" y="0" width="320" height="150" fill={G.amberLight} rx="8"/>
    <defs>
      <linearGradient id="fillGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={G.amber} stopOpacity="0.3"/>
        <stop offset="100%" stopColor={G.amber} stopOpacity="0.05"/>
      </linearGradient>
    </defs>
    <line x1="30" y1="120" x2="290" y2="120" stroke="#aaa" strokeWidth="1"/>
    <path d="M50,110 Q120,20 160,35 Q200,50 270,100" stroke={G.amber} strokeWidth="2.5" fill="none"/>
    <path d="M50,110 Q120,20 160,35 Q200,50 270,100 L270,120 L50,120 Z" fill="url(#fillGrad)"/>
    {/* trapezoid lines */}
    <line x1="50" y1="110" x2="50" y2="120" stroke={G.blue} strokeWidth="1.5"/>
    <line x1="160" y1="35" x2="160" y2="120" stroke={G.blue} strokeWidth="1.5" strokeDasharray="3"/>
    <line x1="270" y1="100" x2="270" y2="120" stroke={G.blue} strokeWidth="1.5"/>
    <text x="50" y="133" fontSize="10" fill={G.blue} textAnchor="middle">a</text>
    <text x="160" y="133" fontSize="10" fill={G.blue} textAnchor="middle">(a+b)/2</text>
    <text x="270" y="133" fontSize="10" fill={G.blue} textAnchor="middle">b</text>
    <text x="160" y="15" fontSize="11" fill={G.amber} textAnchor="middle" fontWeight="500">Simpson 法则数值积分</text>
  </svg>
);

const VIZ_MAP = {
  "二分法": <VizBisection />,
  "Newton 法": <VizNewton />,
  "LU 分解": <VizLU />,
  "梯形法 / Simpson 法": <VizSimpson />,
};

// ── Knowledge Content ─────────────────────────────────────────────────────────
const KNOWLEDGE_CONTENT = {
  "二分法": {
    intro: "二分法（Bisection Method）是求方程 f(x)=0 的最稳健数值方法。每次将有根区间对半分，保证收敛。",
    formulas: [
      { label: "中点计算", tex: "c = \\frac{a+b}{2}" },
      { label: "误差上界（n 次迭代后）", tex: "|c_n - r| \\leq \\frac{b-a}{2^{n+1}}" },
    ],
    steps: ["验证 f(a)·f(b) < 0（有根）", "计算中点 c = (a+b)/2", "若 f(a)·f(c) < 0 则令 b=c，否则令 a=c", "重复直到 |b-a| < ε"],
    note: "一定收敛，但速度慢（线性）。每步误差缩小 1/2。",
    viz: "二分法",
  },
  "Newton 法": {
    intro: "Newton 法（牛顿迭代法）用函数在当前点的切线交 x 轴的点作为下一步近似，二阶收敛，非常快速。",
    formulas: [
      { label: "迭代公式", tex: "x_{n+1} = x_n - \\frac{f(x_n)}{f'(x_n)}" },
      { label: "二阶收敛误差", tex: "e_{n+1} \\approx \\frac{f''(x^*)}{2f'(x^*)} e_n^2" },
    ],
    steps: ["取初始近似 x₀ 在根附近", "计算 x₁ = x₀ - f(x₀)/f'(x₀)", "重复直到 |xₙ₊₁ - xₙ| < ε"],
    note: "每步有效数字大约翻倍，但需要 f'(x)≠0 且初始值足够近。",
    viz: "Newton 法",
  },
  "不动点迭代": {
    intro: "将 f(x)=0 改写为 x=g(x)，然后迭代 x_{n+1}=g(x_n) 求根。收敛性由 |g'(x*)| 决定。",
    formulas: [
      { label: "迭代格式", tex: "x_{n+1} = g(x_n)" },
      { label: "收敛条件（压缩映射）", tex: "|g'(x)| \\leq L < 1 \\quad \\forall x \\in [a,b]" },
      { label: "误差估计", tex: "|x^* - x_n| \\leq \\frac{L^n}{1-L}|x_1 - x_0|" },
    ],
    steps: ["将 f(x)=0 改写为 x=g(x)", "验证 |g'(x)| < 1 在根附近成立", "从 x₀ 出发迭代"],
    note: "|g'(x*)| 越小，收敛越快。当 g'(x*)=0 时达到超线性收敛。",
  },
  "Gauss 消去法": {
    intro: "高斯消去法是解线性方程组 Ax=b 的标准算法，分前向消元（化为上三角）和回代两步。",
    formulas: [
      { label: "消元乘子", tex: "m_{ik} = \\frac{a_{ik}^{(k)}}{a_{kk}^{(k)}},\\; i > k" },
      { label: "计算复杂度", tex: "\\frac{n^3}{3} + O(n^2) \\text{ 次运算}" },
    ],
    steps: ["对每列 k，计算消元乘子 mₖₗ", "用第 k 行消去下面各行的第 k 列元素", "回代从最后一行求解各未知数"],
    note: "必须选主元（Pivoting）避免数值不稳定。部分主元法选每列最大元素。",
  },
  "LU 分解": {
    intro: "LU 分解把矩阵 A 写成 A=LU，L 是下三角、U 是上三角，一次分解可高效求解多个右端项。",
    formulas: [
      { label: "分解形式", tex: "A = LU \\quad (\\text{或带行交换 } PA = LU)" },
      { label: "两步求解", tex: "Ly = b \\;\\Rightarrow\\; Ux = y" },
    ],
    steps: ["对 A 做 LU 分解（O(n³)，只做一次）", "前代求解 Ly=b（O(n²)）", "回代求解 Ux=y（O(n²)）"],
    note: "对每个新的 b 只需 O(n²)，适合多右端项。带行交换的 PA=LU 更稳定。",
    viz: "LU 分解",
  },
  "Lagrange 插值": {
    intro: "给定 n+1 个节点，Lagrange 插值构造唯一的次数 ≤n 的多项式经过所有节点。",
    formulas: [
      { label: "插值多项式", tex: "P_n(x) = \\sum_{k=0}^{n} y_k L_k(x)" },
      { label: "基函数", tex: "L_k(x) = \\prod_{j \\neq k} \\frac{x-x_j}{x_k-x_j}" },
      { label: "误差上界", tex: "|f(x)-P_n(x)| \\leq \\frac{M_{n+1}}{(n+1)!}|\\omega_{n+1}(x)|" },
    ],
    steps: ["选取 n+1 个节点", "计算每个基函数 Lₖ(x)", "加权求和得到 Pₙ(x)"],
    note: "等距节点高次插值会在端点附近振荡（Runge 现象）。建议使用 Chebyshev 节点。",
  },
  "法方程": {
    intro: "线性最小二乘求 x 使 ‖b-Ax‖₂ 最小，对目标函数求导置零得到法方程（正规方程）。",
    formulas: [
      { label: "最小化目标", tex: "\\min_x \\|Ax - b\\|_2^2" },
      { label: "法方程", tex: "A^\\top A\\, x = A^\\top b" },
    ],
    steps: ["建立超定方程组 Ax≈b（方程数 > 未知数）", "构造法方程 AᵀAx=Aᵀb", "求解得到最优参数"],
    note: "AᵀA 的条件数是 A 的平方，数值稳定性差。实践中用 QR 分解更好。",
  },
  "梯形法 / Simpson 法": {
    intro: "数值积分方法用多项式近似被积函数，再精确积分该多项式，从而近似原来的定积分。",
    formulas: [
      { label: "梯形法", tex: "\\int_a^b f\\,dx \\approx \\tfrac{b-a}{2}[f(a)+f(b)],\\; E=O(h^2)" },
      { label: "Simpson 法", tex: "\\int_a^b f\\,dx \\approx \\tfrac{b-a}{6}[f(a)+4f(m)+f(b)],\\; E=O(h^4)" },
    ],
    steps: ["将 [a,b] 分成 n 个子区间", "在每个子区间用梯形或 Simpson 公式", "累加各子区间结果"],
    note: "Simpson 法对次数 ≤3 的多项式精确，误差比梯形法高两阶。",
    viz: "梯形法 / Simpson 法",
  },
  "Euler 法": {
    intro: "Euler 法是求解 ODE 初值问题 y'=f(t,y) 最简单的方法：用当前斜率直接预测下一步。",
    formulas: [
      { label: "Euler 迭代", tex: "w_{i+1} = w_i + h\\,f(t_i,\\,w_i)" },
      { label: "局部截断误差", tex: "\\tau = \\tfrac{h}{2}y''(\\xi)=O(h^2),\\quad \\text{全局} O(h)" },
    ],
    steps: ["从初始值 w₀=y₀ 出发", "依次计算 wᵢ₊₁=wᵢ+h·f(tᵢ,wᵢ)", "推进到目标时间"],
    note: "一阶方法，精度低，步长需很小。仅用于理论分析和教学示例，实践用 RK4。",
  },
  "Runge-Kutta 法": {
    intro: "RK4 在一个步长内取四个斜率采样点加权平均，得到四阶精度，是最常用的 ODE 求解器。",
    formulas: [
      { label: "经典 RK4 格式", tex: "w_{i+1} = w_i + \\tfrac{h}{6}(k_1+2k_2+2k_3+k_4)" },
      { label: "局部截断误差", tex: "O(h^5),\\quad \\text{全局误差 } O(h^4)" },
    ],
    steps: ["计算 k₁=f(tᵢ,wᵢ)", "计算 k₂=f(tᵢ+h/2, wᵢ+hk₁/2)", "计算 k₃=f(tᵢ+h/2, wᵢ+hk₂/2)", "计算 k₄=f(tᵢ+h, wᵢ+hk₃)", "更新 wᵢ₊₁"],
    note: "每步 4 次函数求值，精度与计算量均衡。自适应步长版本（RK45）更实用。",
  },
  "最小二乘数据拟合": {
    intro: "给定 m 个数据点，寻找参数 x 使模型与观测值的残差平方和最小，是数据科学的核心方法。",
    formulas: [
      { label: "残差向量", tex: "r = b - Ax,\\quad r_i = b_i - \\sum_j a_{ij}x_j" },
      { label: "最小二乘目标", tex: "\\min_x \\|r\\|_2^2 = \\min_x \\sum_{i=1}^m r_i^2" },
    ],
    steps: ["收集数据点 (tᵢ,bᵢ)", "建立矩阵方程 Ax≈b", "用法方程或 QR 分解求 x*"],
    note: "线性最小二乘：参数线性出现，有解析解。非线性：需要 Gauss-Newton 迭代。",
  },
  "投资组合选择 (Markowitz)": {
    intro: "Markowitz 1959 年提出均值-方差框架，在期望收益和风险之间寻求最优平衡，获 1990 年诺贝尔经济学奖。",
    formulas: [
      { label: "期望收益", tex: "\\bar{r}_P = \\mu^\\top x" },
      { label: "投资组合风险", tex: "\\sigma_P^2 = x^\\top V x" },
      { label: "优化模型", tex: "\\min_x x^\\top Vx \\quad\\text{s.t.}\\; \\mu^\\top x \\geq p,\\; a^\\top x \\leq B" },
    ],
    steps: ["估计各证券期望收益 μ 和协方差矩阵 V", "设定收益下界 p 和预算 B", "求解二次规划得最优配置 x*"],
    note: "三种等价建模：最大化收益-α风险 / 最小化风险约束收益 / 最大化收益约束风险。",
  },
  "SVM 分类": {
    intro: "支持向量机通过最大化两类数据之间的间隔超平面来分类，是数据挖掘的核心算法。",
    formulas: [
      { label: "最大间隔问题", tex: "\\min_w \\|w\\|^2 \\quad\\text{s.t.}\\; y_i[(w,x^i)+b]\\geq 1" },
      { label: "间隔宽度", tex: "\\text{margin} = \\frac{2}{\\|w\\|}" },
      { label: "软间隔（允许误分）", tex: "\\min_w \\|w\\|^2 + C\\sum_i\\xi_i" },
    ],
    steps: ["整理训练数据 {(xⁱ,yᵢ)}，yᵢ∈{±1}", "求解二次规划得到最优 ŵ 和 b̂", "新样本 y=sign((ŵ,x)+b̂)"],
    note: "C 控制惩罚力度：C 大→不允许误分；C 小→允许误分但间隔宽。",
  },
};

// ── Topic Modal ───────────────────────────────────────────────────────────────
function TopicModal({ topic, onClose, setPage, setChapterFilter }) {
  const content = KNOWLEDGE_CONTENT[topic];
  const vizKey = content?.viz;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 300, padding: "1rem" }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 20, padding: "2rem", maxWidth: 660, width: "100%", maxHeight: "88vh", overflowY: "auto", boxShadow: "0 24px 60px rgba(0,0,0,0.18)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18, paddingBottom: 14, borderBottom: `2px solid ${G.tealLight}` }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 600, color: "#111", marginBottom: 4 }}>{topic}</div>
            <div style={{ fontSize: 12, color: G.teal, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.08em" }}>知识点详解</div>
          </div>
          <button onClick={onClose} style={{ width: 36, height: 36, borderRadius: "50%", border: "none", background: "#f5f5f5", cursor: "pointer", fontSize: 16, color: "#666", display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
        </div>

        {!content ? (
          <div style={{ padding: "2rem", textAlign: "center", color: "#888", fontSize: 15 }}>该知识点内容正在整理中，敬请期待 📚</div>
        ) : (
          <>
            {/* Visualization */}
            {vizKey && VIZ_MAP[vizKey] && (
              <div style={{ marginBottom: 20, borderRadius: 12, overflow: "hidden" }}>{VIZ_MAP[vizKey]}</div>
            )}

            {/* Intro */}
            <div style={{ fontSize: 15, color: "#444", lineHeight: 1.8, marginBottom: 20, padding: "14px 18px", background: G.tealLight, borderRadius: 12, borderLeft: `4px solid ${G.teal}` }}>{content.intro}</div>

            {/* Formulas */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#111", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>核心公式</div>
              {content.formulas.map((f, i) => (
                <div key={i} style={{ marginBottom: 10, padding: "14px 18px", background: "#fafafa", borderRadius: 10, border: "1px solid #eee" }}>
                  <div style={{ fontSize: 12, color: G.teal, fontWeight: 500, marginBottom: 8 }}>{f.label}</div>
                  <M tex={f.tex} block />
                </div>
              ))}
            </div>

            {/* Steps */}
            {content.steps && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#111", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>算法步骤</div>
                {content.steps.map((s, i) => (
                  <div key={i} style={{ display: "flex", gap: 12, marginBottom: 10 }}>
                    <div style={{ width: 26, height: 26, borderRadius: "50%", background: G.teal, color: "#fff", fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{i + 1}</div>
                    <div style={{ fontSize: 14, color: "#333", lineHeight: 1.65, paddingTop: 2 }}>{s}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Note */}
            {content.note && (
              <div style={{ padding: "14px 18px", background: G.amberLight, borderRadius: 10, borderLeft: `4px solid ${G.amber}`, fontSize: 14, color: "#5a3a00", lineHeight: 1.7 }}>
                <strong>💡 注意：</strong>{content.note}
              </div>
            )}
          </>
        )}

        <div style={{ marginTop: 20, display: "flex", gap: 10, justifyContent: "space-between", alignItems: "center" }}>
          {setPage && setChapterFilter && TOPIC_CHAPTER[topic] && (
            <button onClick={() => { const ch = TOPIC_CHAPTER[topic]; setChapterFilter(ch); onClose(); setPage("题库练习"); }} style={{ padding: "10px 20px", background: G.blueLight, color: G.blue, border: `1px solid ${G.blue}44`, borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
              ✏️ 做相关题目 →
            </button>
          )}
          <button onClick={onClose} style={{ padding: "10px 24px", background: G.teal, color: "#fff", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 500, cursor: "pointer" }}>关闭</button>
        </div>
      </div>
    </div>
  );
}

// ── Expanded Question Bank ────────────────────────────────────────────────────
const ALL_QUESTIONS = [
  { id: "1", chapter: "Ch.1", type: "单选题", question: "二分法每迭代一次，有根区间的长度变为原来的：", options: ["1/3", "1/2", "1/4", "不确定"], answer: "B", explanation: "二分法每次取中点，区间精确缩小为 1/2，线性收敛。" },
  { id: "2", chapter: "Ch.1", type: "单选题", question: "Newton 法的收敛阶为：", options: ["线性 p=1", "超线性", "二阶 p=2", "不收敛"], answer: "C", explanation: "Newton 法在单根附近二阶收敛，每步有效数字大约翻倍。" },
  { id: "3", chapter: "Ch.1", type: "单选题", question: "不动点迭代 x_{n+1}=g(x_n) 收敛的充分条件是：", options: ["|g'(x*)| > 1", "|g'(x*)| = 1", "|g'(x*)| < 1", "g'(x*)=0"], answer: "C", explanation: "压缩映射定理：|g'(x*)| < 1 保证局部收敛。" },
  { id: "4", chapter: "Ch.1", type: "判断题", question: "Newton 法对任意初始值都能收敛到方程的根。", options: null, answer: "错误", explanation: "Newton 法只在根附近才能保证收敛，初始值选取不当可能发散。" },
  { id: "5", chapter: "Ch.1", type: "单选题", question: "割线法（Secant Method）与 Newton 法相比：", options: ["不需要计算导数，但收敛慢", "需要计算导数，收敛更快", "不需要计算导数，收敛阶约 1.618", "完全等价"], answer: "C", explanation: "割线法用差商代替导数，收敛阶为黄金比例 (1+√5)/2 ≈ 1.618，属超线性收敛。" },
  { id: "6", chapter: "Ch.2", type: "单选题", question: "高斯消去法的计算复杂度为：", options: ["O(n)", "O(n²)", "O(n³)", "O(2ⁿ)"], answer: "C", explanation: "消元步骤共约 n³/3 次乘除运算，复杂度 O(n³)。" },
  { id: "7", chapter: "Ch.2", type: "判断题", question: "对任意可逆矩阵 A，不用行交换的 LU 分解一定存在。", options: null, answer: "错误", explanation: "即使 A 可逆，主元也可能为零，此时无行交换的 LU 分解不存在。需要 PA=LU。" },
  { id: "8", chapter: "Ch.2", type: "单选题", question: "矩阵条件数 κ(A) 衡量的是：", options: ["矩阵的行列式大小", "线性系统对扰动的敏感程度", "矩阵是否对称", "迭代法的收敛速度"], answer: "B", explanation: "κ(A)=‖A‖·‖A⁻¹‖，刻画右端项 b 的小扰动对解 x 的放大倍数。" },
  { id: "9", chapter: "Ch.2", type: "单选题", question: "Jacobi 迭代法与 Gauss-Seidel 迭代法的主要区别是：", options: ["Jacobi 更快", "Gauss-Seidel 使用每步最新计算值", "Jacobi 需要更多内存", "两者完全等价"], answer: "B", explanation: "Gauss-Seidel 在一次迭代内就使用最新更新的分量，通常比 Jacobi 收敛快。" },
  { id: "10", chapter: "Ch.3", type: "单选题", question: "n+1 个节点的 Lagrange 插值多项式次数最高为：", options: ["n-1", "n", "n+1", "2n"], answer: "B", explanation: "n+1 个节点确定唯一次数 ≤n 的插值多项式。" },
  { id: "11", chapter: "Ch.3", type: "单选题", question: "Runge 现象指的是：", options: ["节点过少导致误差大", "高次等距插值在端点振荡", "插值多项式不唯一", "Chebyshev 的缺陷"], answer: "B", explanation: "高次等距节点多项式插值在区间端点附近出现剧烈振荡，即 Runge 现象。" },
  { id: "12", chapter: "Ch.3", type: "单选题", question: "Chebyshev 插值节点的优点是：", options: ["计算量最小", "最小化插值误差的最大值（minimax）", "使插值多项式次数最低", "适用于周期函数"], answer: "B", explanation: "Chebyshev 节点使插值误差的最大值达到最小，可避免 Runge 现象。" },
  { id: "13", chapter: "Ch.3", type: "判断题", question: "三次样条插值比高次多项式插值具有更好的数值稳定性。", options: null, answer: "正确", explanation: "三次样条用分段低次多项式，避免高次插值的振荡问题，且保证一阶和二阶导数连续。" },
  { id: "14", chapter: "Ch.4", type: "单选题", question: "线性最小二乘问题的法方程为：", options: ["Ax=b", "AᵀAx=Aᵀb", "AAᵀx=b", "A²x=b²"], answer: "B", explanation: "对 ‖Ax-b‖² 关于 x 求导置零，得法方程 AᵀAx=Aᵀb。" },
  { id: "15", chapter: "Ch.4", type: "判断题", question: "QR 分解比法方程方法数值上更稳定。", options: null, answer: "正确", explanation: "法方程的条件数为 A 的条件数的平方；QR 分解直接作用于 A，稳定性更好。" },
  { id: "16", chapter: "Ch.4", type: "单选题", question: "非线性最小二乘问题与线性最小二乘问题的主要区别是：", options: ["目标函数不同", "非线性问题没有解析解，需要迭代", "非线性问题只有唯一解", "两者求解方法完全相同"], answer: "B", explanation: "非线性最小二乘（如 Gauss-Newton 法）需要迭代求解，可能有多个局部极小。" },
  { id: "17", chapter: "Ch.5", type: "单选题", question: "Simpson 法则的截断误差阶为：", options: ["O(h²)", "O(h³)", "O(h⁴)", "O(h⁵)"], answer: "C", explanation: "Simpson 法截断误差 O(h⁴)，比梯形法（O(h²)）高两阶。" },
  { id: "18", chapter: "Ch.5", type: "单选题", question: "Romberg 积分的核心思想是：", options: ["高斯积分节点选取", "用梯形法结果进行Richardson外推", "Gauss-Legendre 节点", "Monte Carlo 估计"], answer: "B", explanation: "Romberg 对不同步长的梯形法结果进行 Richardson 外推，大幅提高精度。" },
  { id: "19", chapter: "Ch.5", type: "判断题", question: "高斯积分（Gaussian Quadrature）对次数 ≤ 2n-1 的多项式精确。", options: null, answer: "正确", explanation: "n 点 Gauss 积分（Gauss-Legendre）对次数 ≤ 2n-1 的多项式给出精确积分。" },
  { id: "20", chapter: "Ch.6", type: "单选题", question: "Euler 法求解 ODE 的局部截断误差为：", options: ["O(h)", "O(h²)", "O(h³)", "O(h⁴)"], answer: "B", explanation: "Euler 法一阶方法，局部截断误差 O(h²)，全局误差 O(h)。" },
  { id: "21", chapter: "Ch.6", type: "单选题", question: "经典四阶 Runge-Kutta 法每步需要计算几次 f 的值：", options: ["1次", "2次", "3次", "4次"], answer: "D", explanation: "RK4 每步计算 k₁,k₂,k₃,k₄ 共 4 次函数求值。" },
  { id: "22", chapter: "Ch.6", type: "单选题", question: "刚性方程（Stiff ODE）的特点是：", options: ["方程右端函数变化极慢", "解中包含变化速率差异极大的分量，显式方法需极小步长", "方程没有解析解", "Euler 法效率最高"], answer: "B", explanation: "刚性方程的特征值实部差异极大，显式方法（如 Euler）需极小步长，隐式方法更合适。" },
  { id: "23", chapter: "最优化 Ch.1", type: "单选题", question: "线性最小二乘模型的特征是：", options: ["目标函数线性", "所有参数线性出现在模型中", "约束条件线性", "残差为零"], answer: "B", explanation: "线性最小二乘指所有待求参数在模型函数中线性出现，即使 t 的函数是非线性的。" },
  { id: "24", chapter: "最优化 Ch.1", type: "单选题", question: "Markowitz 投资组合模型中 σ²_P=xᵀVx 表示：", options: ["期望收益", "投资预算", "投资组合方差（风险）", "证券数量"], answer: "C", explanation: "σ²_P=xᵀVx 是投资组合收益率的方差，V 为协方差矩阵，x 为持仓向量。" },
  { id: "25", chapter: "最优化 Ch.1", type: "单选题", question: "SVM 最大间隔分类问题的目标函数是：", options: ["min ‖w‖", "min ‖w‖²", "max ‖w‖", "max 2/‖w‖"], answer: "B", explanation: "最大化间隔 2/‖w‖ 等价于最小化 ‖w‖²，后者为凸二次规划。" },
  { id: "26", chapter: "最优化 Ch.1", type: "判断题", question: "非线性规划问题一定有全局最优解。", options: null, answer: "错误", explanation: "非线性规划可能有多个局部极小（甚至无界），全局最优解不一定存在或可达。" },
  { id: "27", chapter: "最优化 Ch.1", type: "单选题", question: "Markowitz 投资组合中，将 α 设为 0 时，意味着：", options: ["完全规避风险", "完全忽略风险，只最大化收益", "等权重配置", "只投单一证券"], answer: "B", explanation: "目标 max μᵀx - αxᵀVx 中 α=0 时风险项消失，只追求最大期望收益。" },
  { id: "28", chapter: "Ch.2", type: "单选题", question: "求解线性方程组时，使用部分主元法（Partial Pivoting）的目的是：", options: ["减少计算量", "避免除以很小的主元导致数值不稳定", "使方程组有唯一解", "减少内存占用"], answer: "B", explanation: "部分主元法在每列中选绝对值最大的元素为主元，防止小主元引起的数值放大误差。" },
  { id: "29", chapter: "Ch.5", type: "单选题", question: "复合梯形法（Composite Trapezoid）在 n 个子区间上的截断误差阶为：", options: ["O(h)", "O(h²)", "O(h³)", "O(h⁴)"], answer: "B", explanation: "复合梯形法每个子区间误差 O(h³)，共 n 段后全局误差 O(h²)，其中 h=(b-a)/n。" },
  { id: "30", chapter: "Ch.6", type: "判断题", question: "Runge-Kutta 4 阶方法每步的全局误差为 O(h⁴)。", options: null, answer: "正确", explanation: "RK4 是四阶方法：局部截断误差 O(h⁵)，全局误差 O(h⁴)。" },
];

const FLASHCARDS = [
  { front: "二分法收敛阶", back: "线性收敛 p=1，每步误差缩小 1/2", chapter: "Ch.1" },
  { front: "Newton 法收敛阶", back: "二阶收敛 p=2，每步有效数字翻倍", chapter: "Ch.1" },
  { front: "不动点迭代收敛条件", back: "|g'(x*)| < 1（压缩映射）", chapter: "Ch.1" },
  { front: "割线法收敛阶", back: "超线性，约 1.618（黄金比例）", chapter: "Ch.1" },
  { front: "高斯消去法复杂度", back: "O(n³)，约 n³/3 次乘除运算", chapter: "Ch.2" },
  { front: "LU 分解的核心优势", back: "一次分解（O(n³)），后续每次求解只需 O(n²)", chapter: "Ch.2" },
  { front: "条件数 κ(A) 含义", back: "‖A‖·‖A⁻¹‖，衡量扰动放大倍数，越大越病态", chapter: "Ch.2" },
  { front: "Lagrange 插值误差", back: "f^(n+1)(ξ)/(n+1)! · ∏(x-xᵢ)，与高阶导数有关", chapter: "Ch.3" },
  { front: "Runge 现象", back: "高次等距插值在端点振荡，用 Chebyshev 节点可避免", chapter: "Ch.3" },
  { front: "三次样条的优点", back: "分段低次、一阶二阶导数连续、无振荡", chapter: "Ch.3" },
  { front: "法方程（Normal Equations）", back: "AᵀAx = Aᵀb，最小二乘问题的最优性条件", chapter: "Ch.4" },
  { front: "QR 分解 vs 法方程", back: "QR 更稳定：条件数不被平方，精度更高", chapter: "Ch.4" },
  { front: "Simpson 法则精度", back: "O(h⁴)，对次数 ≤3 的多项式精确", chapter: "Ch.5" },
  { front: "Romberg 积分思想", back: "对梯形法结果做 Richardson 外推，大幅提高精度", chapter: "Ch.5" },
  { front: "Euler 法全局误差", back: "O(h)，一阶方法，步长需小，精度低", chapter: "Ch.6" },
  { front: "RK4 全局误差", back: "O(h⁴)，四阶方法，精度与计算量均衡", chapter: "Ch.6" },
  { front: "刚性方程特点", back: "特征值实部差异大，显式方法步长受限，需隐式方法", chapter: "Ch.6" },
  { front: "Markowitz 投资组合风险", back: "σ²_P = xᵀVx，V 协方差矩阵，x 持仓向量", chapter: "最优化 Ch.1" },
  { front: "SVM 间隔宽度", back: "margin = 2/‖w‖，最大化间隔 ⟺ 最小化 ‖w‖²", chapter: "最优化 Ch.1" },
  { front: "SVM 软间隔参数 C", back: "C 大→惩罚误分重；C 小→允许更多误分但间隔宽", chapter: "最优化 Ch.1" },
];


// ── Topic → Chapter mapping ───────────────────────────────────────────────────
const TOPIC_CHAPTER = {
  "多项式求值": "Ch.0", "二进制与浮点数": "Ch.0", "有效数字与舍入误差": "Ch.0", "微积分基础回顾": "Ch.0",
  "二分法": "Ch.1", "不动点迭代": "Ch.1", "误差分析": "Ch.1", "Newton 法": "Ch.1", "割线法": "Ch.1",
  "Gauss 消去法": "Ch.2", "LU 分解": "Ch.2", "条件数与误差": "Ch.2", "Jacobi / Gauss-Seidel 迭代": "Ch.2",
  "Lagrange 插值": "Ch.3", "Newton 差商": "Ch.3", "Chebyshev 插值": "Ch.3", "三次样条": "Ch.3", "Bézier 曲线": "Ch.3",
  "法方程": "Ch.4", "数据拟合模型": "Ch.4", "QR 分解": "Ch.4", "GMRES": "Ch.4", "非线性最小二乘": "Ch.4",
  "有限差分公式": "Ch.5", "梯形法 / Simpson 法": "Ch.5", "Romberg 积分": "Ch.5", "Gauss 积分": "Ch.5",
  "Euler 法": "Ch.6", "Runge-Kutta 法": "Ch.6", "方程组": "Ch.6", "刚性方程与隐式法": "Ch.6",
  "打靶法": "Ch.7", "有限差分法": "Ch.7", "有限元 / Galerkin 法": "Ch.7",
  "抛物型方程": "Ch.8", "双曲型方程": "Ch.8", "椭圆型方程": "Ch.8", "Crank-Nicolson 法": "Ch.8",
  "伪随机数生成": "Ch.9", "Monte Carlo 模拟": "Ch.9", "方差缩减": "Ch.9",
  "最小二乘数据拟合": "最优化 Ch.1", "线性 vs 非线性模型": "最优化 Ch.1",
  "残差向量与范数": "最优化 Ch.1", "非线性规划定义": "最优化 Ch.1",
  "设施选址问题": "最优化 Ch.1", "球缺体积最优化": "最优化 Ch.1",
  "投资组合选择 (Markowitz)": "最优化 Ch.1", "交通流最小化": "最优化 Ch.1",
  "最大似然估计": "最优化 Ch.1", "SVM 分类": "最优化 Ch.1",
};

// Get chapter stats from sessionAnswers {questionId: {correct, chapter}}
const getChapterStats = (sessionAnswers) => {
  const stats = {};
  try {
    Object.values(sessionAnswers || {}).forEach((val) => {
      if (!val || typeof val !== "object") return;
      const { correct, chapter } = val;
      if (!chapter) return;
      if (!stats[chapter]) stats[chapter] = { correct: 0, total: 0 };
      stats[chapter].total++;
      if (correct) stats[chapter].correct++;
    });
  } catch (e) {}
  return stats;
};

const getTopicStatus = (topic, chapterStats) => {
  const ch = TOPIC_CHAPTER[topic];
  if (!ch || !chapterStats[ch]) return "todo";
  const { correct, total } = chapterStats[ch];
  if (total >= 3) return "done";
  if (total >= 1) return "doing";
  return "todo";
};

const getTopicAccuracy = (topic, chapterStats) => {
  const ch = TOPIC_CHAPTER[topic];
  if (!ch || !chapterStats[ch]) return null;
  const { correct, total } = chapterStats[ch];
  return { correct, total, pct: Math.round(correct / total * 100) };
};

const CHAPTERS = [
  { id: 0, course: "数值分析", num: "Ch.0", name: "基础知识", topics: ["多项式求值", "二进制与浮点数", "有效数字与舍入误差", "微积分基础回顾"] },
  { id: 1, course: "数值分析", num: "Ch.1", name: "方程求解", topics: ["二分法", "不动点迭代", "误差分析", "Newton 法", "割线法"] },
  { id: 2, course: "数值分析", num: "Ch.2", name: "线性方程组", topics: ["Gauss 消去法", "LU 分解", "条件数与误差", "Jacobi / Gauss-Seidel 迭代"] },
  { id: 3, course: "数值分析", num: "Ch.3", name: "插值", topics: ["Lagrange 插值", "Newton 差商", "Chebyshev 插值", "三次样条", "Bézier 曲线"] },
  { id: 4, course: "数值分析", num: "Ch.4", name: "最小二乘", topics: ["法方程", "数据拟合模型", "QR 分解", "GMRES", "非线性最小二乘"] },
  { id: 5, course: "数值分析", num: "Ch.5", name: "数值微积分", topics: ["有限差分公式", "梯形法 / Simpson 法", "Romberg 积分", "Gauss 积分"] },
  { id: 6, course: "数值分析", num: "Ch.6", name: "常微分方程", topics: ["Euler 法", "Runge-Kutta 法", "方程组", "刚性方程与隐式法"] },
  { id: 7, course: "数值分析", num: "Ch.7", name: "边值问题", topics: ["打靶法", "有限差分法", "有限元 / Galerkin 法"] },
  { id: 8, course: "数值分析", num: "Ch.8", name: "偏微分方程", topics: ["抛物型方程", "双曲型方程", "椭圆型方程", "Crank-Nicolson 法"] },
  { id: 9, course: "数值分析", num: "Ch.9", name: "随机数与 Monte Carlo", topics: ["伪随机数生成", "Monte Carlo 模拟", "方差缩减"] },
  { id: 10, course: "最优化", num: "Ch.1", name: "优化模型概论", topics: ["最小二乘数据拟合", "线性 vs 非线性模型", "残差向量与范数", "非线性规划定义"] },
  { id: 11, course: "最优化", num: "Ch.1b", name: "非线性规划应用", topics: ["设施选址问题", "球缺体积最优化", "投资组合选择 (Markowitz)", "交通流最小化", "最大似然估计", "SVM 分类"] },
];

// ── Shared UI ─────────────────────────────────────────────────────────────────
const s = {
  card: { background: "#fff", border: "1px solid #eee", borderRadius: 16, padding: "1.5rem" },
  input: { width: "100%", fontSize: 15, padding: "12px 14px", border: "1.5px solid #e0e0e0", borderRadius: 10, fontFamily: "inherit", boxSizing: "border-box", outline: "none", color: "#111" },
  label: { fontSize: 13, color: "#555", marginBottom: 6, display: "block", fontWeight: 500 },
};

const Btn = ({ children, onClick, variant = "outline", size = "md", disabled = false, style = {} }) => {
  const base = variant === "primary"
    ? { background: disabled ? "#9FE1CB" : G.teal, color: "#fff", border: "none" }
    : variant === "danger"
    ? { background: G.redLight, color: G.red, border: `1px solid ${G.red}` }
    : { background: "#fff", color: "#333", border: "1.5px solid #ddd" };
  const pad = size === "sm" ? "7px 14px" : size === "lg" ? "14px 32px" : "10px 22px";
  const fz = size === "sm" ? 13 : size === "lg" ? 16 : 14;
  return (
    <button disabled={disabled} onClick={onClick} style={{ padding: pad, fontSize: fz, fontFamily: "inherit", borderRadius: 10, cursor: disabled ? "not-allowed" : "pointer", fontWeight: 500, transition: "all .15s", ...base, ...style }}>{children}</button>
  );
};

const Badge = ({ children, color = "teal" }) => {
  const m = { teal: [G.tealLight, G.tealDark], blue: [G.blueLight, G.blue], amber: [G.amberLight, G.amber], red: [G.redLight, G.red], purple: [G.purpleLight, G.purple] };
  const [bg, fg] = m[color] || m.teal;
  return <span style={{ background: bg, color: fg, fontSize: 11, padding: "3px 10px", borderRadius: 20, fontWeight: 600, whiteSpace: "nowrap" }}>{children}</span>;
};

const StatCard = ({ label, value, sub, color = G.teal, icon }) => (
  <div style={{ background: "#fff", borderRadius: 16, padding: "1.25rem 1.5rem", border: "1px solid #eee", borderTop: `4px solid ${color}` }}>
    <div style={{ fontSize: 24, marginBottom: 6 }}>{icon}</div>
    <div style={{ fontSize: 28, fontWeight: 700, color: "#111", marginBottom: 2 }}>{value}</div>
    <div style={{ fontSize: 13, color: "#888" }}>{label}</div>
    {sub && <div style={{ fontSize: 11, color: "#aaa", marginTop: 2 }}>{sub}</div>}
  </div>
);

const ProgressBar = ({ value, max = 100, color = G.teal, height = 8 }) => (
  <div style={{ height, background: "#f0f0f0", borderRadius: height, overflow: "hidden" }}>
    <div style={{ height, width: `${Math.min(100, (value / max) * 100)}%`, background: color, borderRadius: height, transition: "width .5s ease" }} />
  </div>
);

// ── Auth Page ─────────────────────────────────────────────────────────────────
function AuthPage() {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("student");
  const [classCode, setClassCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const handleLogin = async () => {
    setLoading(true); setError("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError("邮箱或密码错误，请重试");
    setLoading(false);
  };

  const handleRegister = async () => {
    if (!name.trim()) { setError("请输入姓名"); return; }
    if (password.length < 6) { setError("密码至少 6 位"); return; }
    if (role === "student" && !classCode.trim()) { setError("学生需要输入班级邀请码"); return; }
    setLoading(true); setError("");
    const { error } = await supabase.auth.signUp({ email, password, options: { data: { name, role, classCode } } });
    if (error) setError(error.message);
    else setSuccess("注册成功！请检查邮箱完成验证后登录。");
    setLoading(false);
  };

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #f0fdf8 0%, #e8f4ff 100%)", display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
      <div style={{ width: "100%", maxWidth: 460 }}>
        {/* Brand */}
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{ width: 56, height: 56, borderRadius: 16, background: G.teal, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, margin: "0 auto 14px" }}>📐</div>
          <div style={{ fontSize: 26, fontWeight: 700, color: "#111", letterSpacing: "-0.5px" }}>MathCore</div>
          <div style={{ fontSize: 15, color: "#666", marginTop: 4 }}>数学与应用数学学习平台</div>
        </div>

        <div style={{ ...s.card, padding: "2rem" }}>
          {/* Tabs */}
          <div style={{ display: "flex", background: "#f5f5f5", borderRadius: 12, padding: 4, marginBottom: 24 }}>
            {[["login", "登录"], ["register", "注册"]].map(([m, l]) => (
              <button key={m} onClick={() => { setMode(m); setError(""); setSuccess(""); }} style={{ flex: 1, padding: "10px 0", fontSize: 14, fontFamily: "inherit", border: "none", cursor: "pointer", borderRadius: 10, fontWeight: mode === m ? 600 : 400, background: mode === m ? "#fff" : "transparent", color: mode === m ? "#111" : "#888", boxShadow: mode === m ? "0 2px 8px rgba(0,0,0,0.08)" : "none" }}>{l}</button>
            ))}
          </div>

          {error && <div style={{ padding: "12px 16px", background: G.redLight, color: G.red, borderRadius: 10, fontSize: 14, marginBottom: 16 }}>{error}</div>}
          {success && <div style={{ padding: "12px 16px", background: G.tealLight, color: G.tealDark, borderRadius: 10, fontSize: 14, marginBottom: 16 }}>{success}</div>}

          {mode === "register" && (
            <>
              <div style={{ marginBottom: 14 }}>
                <label style={s.label}>姓名</label>
                <input style={s.input} value={name} onChange={e => setName(e.target.value)} placeholder="你的名字" />
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={s.label}>身份</label>
                <div style={{ display: "flex", gap: 10 }}>
                  {[["student", "🎓 学生"], ["teacher", "👨‍🏫 教师"]].map(([r, l]) => (
                    <button key={r} onClick={() => setRole(r)} style={{ flex: 1, padding: "12px 0", fontSize: 14, fontFamily: "inherit", border: role === r ? `2px solid ${G.teal}` : "2px solid #e0e0e0", borderRadius: 10, cursor: "pointer", fontWeight: role === r ? 600 : 400, background: role === r ? G.tealLight : "#fff", color: role === r ? G.tealDark : "#666" }}>{l}</button>
                  ))}
                </div>
              </div>
              {role === "student" && (
                <div style={{ marginBottom: 14 }}>
                  <label style={s.label}>班级邀请码</label>
                  <input style={s.input} value={classCode} onChange={e => setClassCode(e.target.value)} placeholder="请向老师获取（如：MATH2024）" />
                </div>
              )}
            </>
          )}

          <div style={{ marginBottom: 14 }}>
            <label style={s.label}>邮箱</label>
            <input style={s.input} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="your@email.com" />
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={s.label}>密码</label>
            <input style={s.input} type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder={mode === "register" ? "至少 6 位" : "输入密码"} onKeyDown={e => { if (e.key === "Enter") { if (mode === "login") handleLogin(); else handleRegister(); }}} />
          </div>

          <button disabled={loading} onClick={mode === "login" ? handleLogin : handleRegister} style={{ width: "100%", padding: "14px 0", fontSize: 16, fontWeight: 600, fontFamily: "inherit", background: loading ? "#9FE1CB" : G.teal, color: "#fff", border: "none", borderRadius: 12, cursor: loading ? "not-allowed" : "pointer" }}>
            {loading ? "处理中…" : mode === "login" ? "登录" : "注册账号"}
          </button>
          <div style={{ textAlign: "center", marginTop: 16, fontSize: 14, color: "#888" }}>
            {mode === "login" ? <>还没有账号？<span onClick={() => setMode("register")} style={{ color: G.teal, cursor: "pointer", fontWeight: 500 }}>立即注册</span></> : <>已有账号？<span onClick={() => setMode("login")} style={{ color: G.teal, cursor: "pointer", fontWeight: 500 }}>直接登录</span></>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Nav ───────────────────────────────────────────────────────────────────────
function TopNav({ page, setPage, profile, onLogout }) {
  const links = profile?.role === "teacher"
    ? ["首页", "资料库", "上传资料", "资料对话", "知识点", "题库练习", "记忆卡片", "学习报告", "错题本", "教师管理"]
    : ["首页", "资料库", "上传资料", "资料对话", "知识点", "题库练习", "记忆卡片", "学习报告", "错题本"];
  return (
    <div style={{ background: "#fff", borderBottom: "1px solid #f0f0f0", padding: "0 2rem", display: "flex", alignItems: "center", justifyContent: "space-between", height: 64, position: "sticky", top: 0, zIndex: 100, boxShadow: "0 1px 12px rgba(0,0,0,0.04)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: G.teal, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>📐</div>
        <span style={{ fontSize: 18, fontWeight: 700, color: "#111", letterSpacing: "-0.3px" }}>MathCore</span>
      </div>
      <div style={{ display: "flex", gap: 2 }}>
        {links.map(l => (
          <button key={l} onClick={() => setPage(l)} style={{ padding: "8px 14px", borderRadius: 10, fontSize: 14, fontFamily: "inherit", border: "none", cursor: "pointer", fontWeight: page === l ? 600 : 400, background: page === l ? G.tealLight : "transparent", color: page === l ? G.tealDark : "#666" }}>{l}</button>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 36, height: 36, borderRadius: "50%", background: G.teal, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 700, color: "#fff" }}>{(profile?.name || "U")[0].toUpperCase()}</div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#111" }}>{profile?.name}</div>
          <div style={{ fontSize: 11, color: "#999" }}>{profile?.role === "teacher" ? "教师" : "学生"}</div>
        </div>
        <button onClick={onLogout} style={{ fontSize: 13, padding: "7px 14px", border: "1.5px solid #e0e0e0", borderRadius: 8, cursor: "pointer", background: "#fff", color: "#666", fontFamily: "inherit" }}>退出</button>
      </div>
    </div>
  );
}

// ── Home Page ─────────────────────────────────────────────────────────────────
function HomePage({ setPage, profile }) {
  return (
    <div style={{ padding: "2rem", maxWidth: 1000, margin: "0 auto" }}>
      {/* Hero */}
      <div style={{ background: `linear-gradient(135deg, ${G.teal} 0%, #0a7a5a 100%)`, borderRadius: 24, padding: "2.5rem 3rem", marginBottom: 24, color: "#fff", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", right: -20, top: -20, width: 180, height: 180, borderRadius: "50%", background: "rgba(255,255,255,0.08)" }} />
        <div style={{ position: "absolute", right: 60, bottom: -40, width: 120, height: 120, borderRadius: "50%", background: "rgba(255,255,255,0.05)" }} />
        <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: "0.12em", opacity: 0.7, textTransform: "uppercase", marginBottom: 10 }}>数学与应用数学学习平台</div>
        <div style={{ fontSize: 30, fontWeight: 700, marginBottom: 10, letterSpacing: "-0.5px" }}>你好，{profile?.name || "同学"} 👋</div>
        <div style={{ fontSize: 16, opacity: 0.85, lineHeight: 1.7, marginBottom: 24, maxWidth: 520 }}>涵盖数值分析、最优化理论两门课程，AI 智能出题与记忆卡片，系统提升数学能力。</div>
        <div style={{ display: "flex", gap: 12 }}>
          <button onClick={() => setPage("知识点")} style={{ padding: "12px 28px", fontSize: 15, fontWeight: 600, fontFamily: "inherit", background: "#fff", color: G.teal, border: "none", borderRadius: 12, cursor: "pointer" }}>开始学习</button>
          <button onClick={() => setPage("题库练习")} style={{ padding: "12px 28px", fontSize: 15, fontWeight: 600, fontFamily: "inherit", background: "rgba(255,255,255,0.15)", color: "#fff", border: "2px solid rgba(255,255,255,0.3)", borderRadius: 12, cursor: "pointer" }}>进入题库</button>
        </div>
      </div>

      {/* Stats */}
      {(() => {
        const streak = (() => { try { const d = JSON.parse(localStorage.getItem("mc_streak") || "{}"); const today = new Date().toDateString(); if (d.last !== today) { const yesterday = new Date(Date.now()-86400000).toDateString(); const s = d.last === yesterday ? (d.count || 0) + 1 : 1; localStorage.setItem("mc_streak", JSON.stringify({last: today, count: s})); return s; } return d.count || 1; } catch { return 1; } })();
        return (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 24 }}>
            <StatCard icon="📚" label="门课程" value="2" sub="数值分析 · 最优化" color={G.teal} />
            <StatCard icon="✏️" label="题目" value={ALL_QUESTIONS.length + "+"} sub="持续更新" color={G.amber} />
            <StatCard icon="🃏" label="记忆卡片" value={FLASHCARDS.length} sub="公式定理" color={G.purple} />
            <StatCard icon="🔥" label="连续学习" value={streak + " 天"} sub="保持每日练习！" color="#E24B4A" />
          </div>
        );
      })()}

      {/* Quick access */}
      <div style={{ fontSize: 14, fontWeight: 600, color: "#888", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 14 }}>快速入口</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        {[
          { icon: "⚡", title: "每日练习", desc: "今日推荐 5 道精选题目", page: "题库练习", bg: "#EEF4FF", accent: G.blue, tag: "今日" },
          { icon: "🃏", title: "记忆卡片", desc: "核心公式与定理快速记忆", page: "记忆卡片", bg: G.purpleLight, accent: G.purple, tag: null },
          { icon: "📊", title: "学习报告", desc: "查看正确率与薄弱知识点", page: "学习报告", bg: G.amberLight, accent: G.amber, tag: null },
          { icon: "🔖", title: "错题本", desc: "收录错题，针对性复习", page: "错题本", bg: G.redLight, accent: G.red, tag: null },
        ].map(q => (
          <div key={q.title} onClick={() => setPage(q.page)} style={{ background: q.bg, borderRadius: 16, padding: "1.5rem", cursor: "pointer", display: "flex", gap: 16, alignItems: "flex-start", border: `1px solid ${q.accent}22`, transition: "transform .15s" }}>
            <div style={{ width: 48, height: 48, borderRadius: 14, background: q.accent, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, flexShrink: 0 }}>{q.icon}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: "#111", marginBottom: 4 }}>{q.title}</div>
              <div style={{ fontSize: 14, color: "#666" }}>{q.desc}</div>
            </div>
            {q.tag && <span style={{ background: G.blue, color: "#fff", fontSize: 11, padding: "3px 10px", borderRadius: 20, fontWeight: 600, whiteSpace: "nowrap", height: "fit-content" }}>{q.tag}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Knowledge Page ────────────────────────────────────────────────────────────
function KnowledgePage({ setPage, setChapterFilter }) {
  const [materials, setMaterials] = useState([]);
  const [selectedMaterialId, setSelectedMaterialId] = useState(null);
  const [aiTopics, setAiTopics] = useState([]);
  const [topicMastery, setTopicMastery] = useState({});

  const reloadKnowledge = useCallback(async () => {
    const mRes = await supabase.from("materials").select("id,title,course,chapter,created_at").order("created_at", { ascending: false }).limit(80);
    const list = mRes.data || [];
    setMaterials(list);
    setSelectedMaterialId((prev) => {
      if (prev && list.some((m) => m.id === prev)) return prev;
      return list.length > 0 ? list[0].id : null;
    });

    const tRes = await supabase.from("questions") /* material_topics stub */.select("*").order("created_at", { ascending: false }).limit(500);
    setAiTopics(tRes.data || []);

    const uid = (await supabase.auth.getUser())?.data?.user?.id;
    if (!uid) return;
    const { data: mdata } = await supabase
      .from("questions" /* topic_mastery removed */)
      .select("topic_id,status,correct_count,wrong_count")
      .eq("user_id", uid);
    const map = {};
    (mdata || []).forEach((r) => { map[r.topic_id] = r; });
    setTopicMastery(map);
  }, []);

  useEffect(() => {
    reloadKnowledge();
    const onVis = () => {
      if (document.visibilityState === "visible") reloadKnowledge();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [reloadKnowledge]);

  const markTopicMastery = async (topic, status) => {
    const uid = (await supabase.auth.getUser())?.data?.user?.id;
    if (!uid || !topic?.id) return;
    await supabase.from("questions") /* topic_mastery stub */.upsert({
      user_id: uid,
      topic_id: topic.id,
      status,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,topic_id" });
    setTopicMastery((prev) => ({ ...prev, [topic.id]: { ...(prev[topic.id] || {}), status } }));
  };

  const selectedMaterial = materials.find((m) => m.id === selectedMaterialId) || null;
  const topicsForMaterial = aiTopics.filter((t) => t.material_id === selectedMaterialId);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 16, padding: "2rem", maxWidth: 1200, margin: "0 auto" }}>
      <div style={{ ...s.card, padding: "1rem 0", height: "fit-content" }}>
        <div style={{ padding: "8px 14px 12px", borderBottom: "1px solid #f0f0f0", marginBottom: 8 }}>
          <div style={{ fontSize: 13, color: "#666", fontWeight: 700 }}>上传资料知识库</div>
          <div style={{ fontSize: 12, color: "#999", marginTop: 4 }}>所有上传资料都会在这里沉淀为知识点</div>
        </div>
        {materials.map((m) => {
          const active = selectedMaterialId === m.id;
          const cnt = aiTopics.filter((t) => t.material_id === m.id).length;
          return (
            <div
              key={m.id}
              onClick={() => setSelectedMaterialId(m.id)}
              style={{
                padding: "10px 14px",
                cursor: "pointer",
                borderLeft: `3px solid ${active ? G.teal : "transparent"}`,
                background: active ? G.tealLight : "transparent",
              }}
            >
              <div style={{ fontSize: 14, fontWeight: active ? 700 : 500, color: active ? G.tealDark : "#222" }}>{m.title}</div>
              <div style={{ fontSize: 11, color: "#888", marginTop: 3 }}>{m.course || "未分类"} · {m.chapter || "未分章"} · {cnt} 知识点</div>
            </div>
          );
        })}
        {materials.length === 0 && <div style={{ padding: "12px 14px", color: "#999", fontSize: 13 }}>暂无资料，请先上传 PDF</div>}
      </div>

      <div style={{ ...s.card }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18, paddingBottom: 14, borderBottom: "1px solid #f0f0f0" }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#111" }}>{selectedMaterial?.title || "请选择资料"}</div>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <Badge color="teal">{selectedMaterial?.course || "未分类"}</Badge>
              <Badge color="blue">{selectedMaterial?.chapter || "未分章"}</Badge>
              <Badge color="purple">{topicsForMaterial.length} 个知识点</Badge>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Btn size="sm" onClick={() => reloadKnowledge()}>刷新</Btn>
            <Btn size="sm" onClick={() => setPage("上传资料")}>上传新资料</Btn>
            <Btn
              size="sm"
              variant="primary"
              onClick={() => {
                if (!selectedMaterial) return;
                setPage("quiz_material_" + selectedMaterial.id + "_" + encodeURIComponent(selectedMaterial.title || ""));
              }}
              disabled={!selectedMaterial}
            >
              进入该资料练习 →
            </Btn>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {topicsForMaterial.map((t) => (
            <div key={t.id} style={{ border: "1.5px solid " + G.purple + "33", borderRadius: 14, padding: "14px 16px", background: "#fcfbff" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "#111" }}>{t.name}</div>
                  {t.chapter ? <div style={{ fontSize: 12, color: "#999", marginTop: 2 }}>大纲：{t.chapter}</div> : null}
                  <div style={{ fontSize: 13, color: "#666", marginTop: 4, lineHeight: 1.6 }}>{t.summary || "暂无简介"}</div>
                </div>
                <Badge color="purple">AI提取</Badge>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Btn size="sm" onClick={() => markTopicMastery(t, "doing")}>学习中</Btn>
                <Btn size="sm" variant="primary" onClick={() => markTopicMastery(t, "done")}>标记已掌握</Btn>
                <Btn
                  size="sm"
                  onClick={() => {
                    setChapterFilter(t.name);
                    setPage("题库练习");
                  }}
                >
                  练这个知识点 →
                </Btn>
                <Badge color={(topicMastery[t.id]?.status || "todo") === "done" ? "teal" : (topicMastery[t.id]?.status || "todo") === "doing" ? "amber" : "red"}>
                  {(topicMastery[t.id]?.status || "todo") === "done" ? "已掌握" : (topicMastery[t.id]?.status || "todo") === "doing" ? "学习中" : "未开始"}
                </Badge>
              </div>
            </div>
          ))}
          {selectedMaterial && topicsForMaterial.length === 0 && (
            <div style={{ color: "#999", padding: "1rem", border: "1px dashed #ddd", borderRadius: 12 }}>
              该资料暂未提取到知识点，点击「进入该资料练习」可触发自动补题与再提取。
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Quiz Page ─────────────────────────────────────────────────────────────────
function QuizPage({ setPage, initialQuestion = null, chapterFilter = null, setChapterFilter, onAnswer, materialId = null, materialTitle = null }) {
  const [allQuestions, setAllQuestions] = useState([]);
  const [loading, setLoading] = useState(true);
  // Setup state (moved to top - never in conditional)
  const [selectedChapters, setSelectedChapters] = useState(chapterFilter ? [chapterFilter] : []);
  const [selectedTypes, setSelectedTypes] = useState([]);
  const [quizCount, setQuizCount] = useState(10);
  const [timerOn, setTimerOn] = useState(false);
  // Quiz state
  const [quizMode, setQuizMode] = useState(null);
  const [displayQ, setDisplayQ] = useState([]);
  const [current, setCurrent] = useState(0);
  const [selected, setSelected] = useState(null);
  const [answered, setAnswered] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [score, setScore] = useState(0);
  const [wrongList, setWrongList] = useState([]);
  const [finished, setFinished] = useState(false);
  const [timer, setTimer] = useState(0);
  const [materialFilterFallback, setMaterialFilterFallback] = useState(false);
  const [materialGenerating, setMaterialGenerating] = useState(false);
  const [materialGenerateMsg, setMaterialGenerateMsg] = useState("");
  const autoGenTriedRef = useRef(false);
  const timerRef = useRef(null);

  const tryGenerateQuestionsForMaterial = async (mid) => {
    if (!mid) return { ok: false, inserted: 0 };
    setMaterialGenerating(true);
    setMaterialGenerateMsg("正在为该资料生成题目（约 10-20 秒）…");
    try {
      const { data: material, error: matErr } = await supabase
        .from("materials")
        .select("id,title,course,chapter,description,file_name,file_data")
        .eq("id", mid)
        .single();
      if (matErr || !material) throw new Error(matErr?.message || "未找到资料");
      const fetchedFile = material?.file_data ? await fetchFileAsBrowserFile(material.file_data, material.file_name || "material.pdf") : null;
      const result = await processMaterialWithAI({
        material,
        file: fetchedFile,
        fallbackText: `${material.title || ""} ${material.description || ""}`,
        genCount: 8,
        actorName: "系统自动补题",
      });
      const inserted = result?.insertedCount ?? result?.questions?.length ?? 0;
      const hint = (!fetchedFile && [".doc", ".docx", ".ppt", ".pptx"].includes(getFileExt(material?.file_name || "")))
        ? "（当前建议优先上传 PDF，DOCX/PPTX 容易提取失败）"
        : "";
      if (result?.apiQuotaExceeded) {
        setMaterialGenerateMsg(`⚠️ ${result.apiErrorMsg || "Gemini API 配额暂时用完，请等待 1 分钟后再点击补题。"}`);
      } else {
        const diagHint = result?.textDiag?.hint ? ` | ${result.textDiag.hint}` : (result?.parseHint ? ` ${result.parseHint}` : "");
        setMaterialGenerateMsg(inserted > 0 ? `已为该资料补充 ${inserted} 道题。${diagHint}` : `补题完成，但未新增题目。${hint}${diagHint}`);
      }
      return { ok: inserted > 0, inserted };
    } catch (e) {
      setMaterialGenerateMsg("补题失败：" + (e?.message || "未知错误"));
      return { ok: false, inserted: 0 };
    } finally {
      setMaterialGenerating(false);
    }
  };

  useEffect(() => {
    const loadQuestions = async () => {
      let dbQs = [];
      if (materialId) {
        const byMaterial = await supabase.from("questions").select("*").eq("material_id", materialId);
        if (byMaterial.error && isMissingQuestionsMaterialIdColumn(byMaterial.error)) {
          setMaterialFilterFallback(true);
          const fallback = await supabase.from("questions").select("*").order("created_at", { ascending: false }).limit(80);
          dbQs = fallback.data || [];
        } else {
          dbQs = byMaterial.data || [];
        }
      } else {
        const normal = await supabase.from("questions").select("*");
        dbQs = normal.data || [];
      }
      let pool;
      if (materialId) {
        // Only questions from this material (no sample questions mixed in)
        pool = dbQs;
      } else {
        const dbTexts = new Set(dbQs.map(q => q.question));
        const uniqueSamples = ALL_QUESTIONS.filter(q => !dbTexts.has(q.question));
        pool = [...dbQs, ...uniqueSamples];
      }
      if (initialQuestion && !materialId) {
        const rest = pool.filter(q => q.id !== initialQuestion.id).sort(() => Math.random() - 0.5);
        pool = [initialQuestion, ...rest];
      }
      if (materialId && pool.length === 0 && !autoGenTriedRef.current) {
        autoGenTriedRef.current = true;
        const regen = await tryGenerateQuestionsForMaterial(materialId);
        if (regen.ok) {
          // Re-query once after generation
          const retry = await supabase.from("questions").select("*").eq("material_id", materialId);
          pool = retry.data || [];
          if (pool.length === 0 && materialFilterFallback) {
            const fallbackRetry = await supabase.from("questions").select("*").order("created_at", { ascending: false }).limit(80);
            pool = fallbackRetry.data || [];
          }
        }
      }
      pool = pool.filter((q) => !isLowQualityQuestion(q));
      setAllQuestions(pool.sort(() => Math.random() - 0.5));
      setLoading(false);
    };
    loadQuestions();
  }, [materialId]);

  useEffect(() => {
    if (timerOn && quizMode && !finished) {
      timerRef.current = setInterval(() => setTimer(t => t + 1), 1000);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [timerOn, quizMode, finished]);

  useEffect(() => { setTimer(0); }, [current]);

  const allChapters = [...new Set(allQuestions.map(q => q.chapter).filter(Boolean))].sort();
  const toggleChapter = (ch) => setSelectedChapters(prev =>
    prev.includes(ch) ? prev.filter(x => x !== ch) : [...prev, ch]
  );
  const toggleType = (t) => setSelectedTypes(prev =>
    prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]
  );

  const buildPool = (chapters, types) => {
    let pool = allQuestions;
    if (chapters.length > 0) pool = pool.filter(q => chapters.some(c => q.chapter && q.chapter.startsWith(c)));
    if (types.length > 0) pool = pool.filter(q => types.includes(q.type));
    return pool;
  };
  const previewPool = buildPool(selectedChapters, selectedTypes);

  const startQuiz = (chapters, types, count) => {
    const pool = buildPool(chapters, types);
    setDisplayQ(pool.slice(0, count));
    setQuizMode("active");
    setCurrent(0); setSelected(null); setAnswered(false);
    setScore(0); setWrongList([]); setFinished(false); setTimer(0);
  };

  const q = displayQ[current];
  const opts = q?.options ? (typeof q.options === "string" ? JSON.parse(q.options) : q.options) : null;
  const letters = ["A", "B", "C", "D"];

  const handleSubmit = () => {
    if (selected === null) return;
    setAnswered(true);
    const correct = opts
      ? letters[selected] === q.answer
      : (selected === 0 && q.answer === "正确") || (selected === 1 && q.answer === "错误");
    if (correct) setScore(s => s + 1);
    else setWrongList(w => [...w, q]);
    if (onAnswer && q) onAnswer(q.id || q.question, correct, q.chapter || "Unknown", q);
  };

  const handleNext = () => {
    if (current >= displayQ.length - 1) { setFinished(true); return; }
    setCurrent(c => c + 1); setSelected(null); setAnswered(false); setShowHint(false);
  };

  // Keyboard shortcuts
  useEffect(() => {
    if (quizMode !== "active" || finished || !q) return;
    const handler = (e) => {
      if (answered) { if (e.key === "Enter" || e.key === "ArrowRight") handleNext(); return; }
      if (e.key === "1") setSelected(0);
      if (e.key === "2") setSelected(1);
      if (e.key === "3") setSelected(2);
      if (e.key === "4") setSelected(3);
      if (e.key === "Enter") handleSubmit();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [quizMode, finished, q, answered, selected]);

  if (loading) return <div style={{ padding: "4rem", textAlign: "center", color: "#888" }}>加载题目中…</div>;

  // ── Setup screen ──
  if (!quizMode) return (
    <div style={{ padding: "2rem", maxWidth: 780, margin: "0 auto" }}>
      <Btn size="sm" onClick={() => setPage("首页")} style={{ marginBottom: 20 }}>← 返回</Btn>
      <div style={{ ...s.card, padding: "2rem" }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: "#111", marginBottom: 4 }}>✏️ 练习设置</div>
        {materialId ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: G.blueLight, borderRadius: 10, marginBottom: 20, border: "1.5px solid " + G.blue + "44" }}>
            <div style={{ fontSize: 20 }}>📄</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: G.blue }}>基于资料出题模式</div>
              <div style={{ fontSize: 13, color: G.blue + "cc" }}>{materialTitle} · {allQuestions.length} 道相关题目</div>
            </div>
            <button onClick={() => setPage("资料库")} style={{ marginLeft: "auto", padding: "6px 12px", background: "transparent", color: G.blue, border: "1.5px solid " + G.blue + "44", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "inherit" }}>← 返回资料库</button>
          </div>
        ) : (
          <div style={{ fontSize: 14, color: "#888", marginBottom: 24 }}>自定义范围，精准刷题</div>
        )}
        {materialId && materialFilterFallback && (
          <div style={{ marginBottom: 14, padding: "10px 12px", borderRadius: 10, background: G.amberLight, color: G.amber, fontSize: 13 }}>
            检测到数据库缺少 `questions.material_id`，当前使用“全题库回退模式”。执行 SQL 补齐后可按资料精准出题。
          </div>
        )}
        {materialId && materialGenerateMsg && (
          <div style={{ marginBottom: 14, padding: "10px 12px", borderRadius: 10, background: G.blueLight, color: G.blue, fontSize: 13 }}>
            {materialGenerateMsg}
          </div>
        )}

        {/* Quick start */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 24 }}>
          {[
            { icon: "⚡", label: "每日 5 题", color: G.blue, bg: "#EEF4FF", action: () => startQuiz([], [], 5) },
            { icon: "📚", label: "全部 " + allQuestions.length + " 题", color: G.teal, bg: G.tealLight, action: () => startQuiz([], [], allQuestions.length) },
            { icon: "🎯", label: "自定义范围", color: G.purple, bg: G.purpleLight, action: null },
          ].map(m => (
            <div key={m.label} onClick={m.action || undefined} style={{ border: "2px solid " + m.color + "44", borderRadius: 14, padding: "1.25rem", cursor: m.action ? "pointer" : "default", textAlign: "center", background: m.bg, opacity: m.action ? 1 : 0.6 }}>
              <div style={{ fontSize: 24, marginBottom: 6 }}>{m.icon}</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: m.color }}>{m.label}</div>
            </div>
          ))}
        </div>

        {/* Chapter selection */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#111", marginBottom: 10 }}>📖 章节范围</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => setSelectedChapters([])} style={{ padding: "7px 14px", borderRadius: 20, border: "2px solid " + (selectedChapters.length === 0 ? G.teal : "#e0e0e0"), cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: selectedChapters.length === 0 ? 700 : 400, background: selectedChapters.length === 0 ? G.teal : "#fff", color: selectedChapters.length === 0 ? "#fff" : "#555" }}>全部</button>
            {allChapters.map(ch => (
              <button key={ch} onClick={() => toggleChapter(ch)} style={{ padding: "7px 14px", borderRadius: 20, border: "2px solid " + (selectedChapters.includes(ch) ? G.teal : "#e0e0e0"), cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: selectedChapters.includes(ch) ? 700 : 400, background: selectedChapters.includes(ch) ? G.tealLight : "#fff", color: selectedChapters.includes(ch) ? G.tealDark : "#555" }}>{ch}</button>
            ))}
          </div>
        </div>

        {/* Type selection */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#111", marginBottom: 10 }}>📝 题型</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => setSelectedTypes([])} style={{ padding: "7px 14px", borderRadius: 20, border: "2px solid " + (selectedTypes.length === 0 ? G.blue : "#e0e0e0"), cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: selectedTypes.length === 0 ? 700 : 400, background: selectedTypes.length === 0 ? G.blue : "#fff", color: selectedTypes.length === 0 ? "#fff" : "#555" }}>全部</button>
            {["单选题", "判断题", "多选题", "填空题"].map(t => (
              <button key={t} onClick={() => toggleType(t)} style={{ padding: "7px 14px", borderRadius: 20, border: "2px solid " + (selectedTypes.includes(t) ? G.blue : "#e0e0e0"), cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: selectedTypes.includes(t) ? 700 : 400, background: selectedTypes.includes(t) ? G.blueLight : "#fff", color: selectedTypes.includes(t) ? G.blue : "#555" }}>{t}</button>
            ))}
          </div>
        </div>

        {/* Count slider */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: "#111" }}>🔢 题目数量</span>
            <span style={{ fontSize: 15, fontWeight: 700, color: G.teal }}>{Math.min(quizCount, previewPool.length)} 题（共 {previewPool.length} 可用）</span>
          </div>
          <input type="range" min={1} max={Math.min(previewPool.length || 30, 30)} value={quizCount} onChange={e => setQuizCount(Number(e.target.value))} style={{ width: "100%", accentColor: G.teal }} />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#aaa", marginTop: 4 }}><span>1</span><span>10</span><span>20</span><span>30</span></div>
        </div>

        {/* Timer toggle */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", background: "#f9f9f9", borderRadius: 12, marginBottom: 20 }}>
          <span style={{ fontSize: 14, color: "#888", flex: 1 }}>⏱ 计时模式</span>
          <div onClick={() => setTimerOn(v => !v)} style={{ width: 44, height: 24, borderRadius: 12, background: timerOn ? G.teal : "#ddd", cursor: "pointer", position: "relative", transition: "background .2s" }}>
            <div style={{ position: "absolute", top: 3, left: timerOn ? 22 : 3, width: 18, height: 18, borderRadius: "50%", background: "#fff", transition: "left .2s" }} />
          </div>
          <span style={{ fontSize: 13, color: "#aaa", minWidth: 60 }}>{timerOn ? "已开启" : "已关闭"}</span>
        </div>

        {materialId && allQuestions.length === 0 ? (
          <div style={{ textAlign: "center", padding: "2rem", background: G.amberLight, borderRadius: 12, marginBottom: 16 }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>📭</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: G.amber, marginBottom: 6 }}>该资料暂无关联题目</div>
            <div style={{ fontSize: 14, color: "#888", marginBottom: 16 }}>此资料上传时未自动生成题目，或题目数量为 0</div>
            <div style={{ display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap" }}>
              <button
                onClick={async () => {
                  const regen = await tryGenerateQuestionsForMaterial(materialId);
                  if (regen.ok) {
                    const retry = await supabase.from("questions").select("*").eq("material_id", materialId);
                    setAllQuestions((retry.data || []).sort(() => Math.random() - 0.5));
                  }
                }}
                disabled={materialGenerating}
                style={{ padding: "10px 22px", background: G.teal, color: "#fff", border: "none", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 600, fontFamily: "inherit" }}
              >
                {materialGenerating ? "正在补题…" : "一键补题"}
              </button>
              <button onClick={() => setPage("上传资料")} style={{ padding: "10px 22px", background: G.amber, color: "#fff", border: "none", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 600, fontFamily: "inherit" }}>重新上传并出题 →</button>
            </div>
          </div>
        ) : (
          <button disabled={previewPool.length === 0} onClick={() => startQuiz(selectedChapters, selectedTypes, quizCount)} style={{ width: "100%", padding: "14px 0", fontSize: 16, fontWeight: 700, fontFamily: "inherit", background: previewPool.length === 0 ? "#ccc" : G.teal, color: "#fff", border: "none", borderRadius: 12, cursor: previewPool.length === 0 ? "not-allowed" : "pointer" }}>
            {previewPool.length === 0 ? "无可用题目" : "开始练习 →"}
          </button>
        )}
        <div style={{ fontSize: 12, color: "#aaa", textAlign: "center", marginTop: 10 }}>⌨️ 键盘：1-4 选择 · Enter 提交/下一题</div>
      </div>
    </div>
  );

  // ── Finished screen ──
  if (finished) {
    const pct = displayQ.length ? Math.round(score / displayQ.length * 100) : 0;
    const cwrong = {};
    wrongList.forEach(w => { cwrong[w.chapter] = (cwrong[w.chapter] || 0) + 1; });
    return (
      <div style={{ padding: "2rem", maxWidth: 700, margin: "0 auto" }}>
        <div style={{ ...s.card, padding: "2.5rem" }}>
          <div style={{ textAlign: "center", marginBottom: 24 }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>{pct >= 80 ? "🎉" : pct >= 60 ? "👍" : "💪"}</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: "#111", marginBottom: 6 }}>练习完成！</div>
            <div style={{ fontSize: 52, fontWeight: 800, color: pct >= 80 ? G.teal : pct >= 60 ? G.amber : G.red }}>{pct}%</div>
            <div style={{ fontSize: 15, color: "#888", margin: "6px 0 12px" }}>答对 {score} / {displayQ.length} 题</div>
            {timerOn && timer > 0 && <div style={{ fontSize: 14, color: "#aaa", marginBottom: 12 }}>⏱ 用时 {Math.floor(timer/60)}分{timer%60}秒 · 平均 {Math.round(timer/displayQ.length)} 秒/题</div>}
            <ProgressBar value={score} max={displayQ.length} color={pct >= 80 ? G.teal : pct >= 60 ? G.amber : G.red} height={10} />
          </div>
          {wrongList.length > 0 && (
            <div style={{ borderTop: "1px solid #f0f0f0", paddingTop: 20 }}>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>⚠️ 本次答错</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
                {Object.entries(cwrong).map(([ch, cnt]) => (
                  <div key={ch} style={{ background: G.redLight, borderRadius: 10, padding: "8px 14px", fontSize: 14 }}>
                    <span style={{ color: G.red }}>{ch}</span> <strong style={{ color: G.red }}>×{cnt}</strong>
                  </div>
                ))}
              </div>
              {wrongList.map((w, i) => (
                <div key={i} style={{ padding: "12px 14px", background: "#fafafa", borderRadius: 10, marginBottom: 8, fontSize: 14 }}>
                  <div style={{ color: "#111", marginBottom: 4 }}>{w.question}</div>
                  <div style={{ color: G.tealDark, fontSize: 13 }}>✓ {w.answer} · {w.explanation}</div>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 20 }}>
            <Btn onClick={() => { setQuizMode(null); setFinished(false); }}>再练一次</Btn>
            <Btn variant="primary" onClick={() => setPage("学习报告")}>查看报告</Btn>
          </div>
        </div>
      </div>
    );
  }

  if (!q) return null;

  // ── Quiz screen ──
  return (
    <div style={{ padding: "2rem", maxWidth: 820, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
        <Btn size="sm" onClick={() => { setQuizMode(null); setFinished(false); }}>← 返回</Btn>
        <div style={{ ...s.card, flex: 1, padding: "12px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>第 {current + 1} / {displayQ.length} 题</div>
            <div style={{ fontSize: 13, color: "#888", marginTop: 2 }}>{q.chapter} · {q.type}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {timerOn && <div style={{ fontSize: 14, color: "#888", background: "#f5f5f5", padding: "4px 12px", borderRadius: 20 }}>⏱ {String(Math.floor(timer/60)).padStart(2,"0")}:{String(timer%60).padStart(2,"0")}</div>}
            <span style={{ fontSize: 14, color: "#666" }}>得分 <strong style={{ color: G.teal, fontSize: 18 }}>{score}</strong>/{current}</span>
            <div style={{ width: 100, height: 6, background: "#f0f0f0", borderRadius: 3 }}>
              <div style={{ height: 6, background: G.teal, borderRadius: 3, width: ((current+1)/displayQ.length*100)+"%" }} />
            </div>
          </div>
        </div>
      </div>
      <div style={{ fontSize: 12, color: "#ccc", textAlign: "right", marginBottom: 6 }}>⌨️ 1-4 选择 · Enter 提交</div>
      <div style={{ ...s.card, marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <Badge color="blue">{q.type}</Badge>
          <Badge color="amber">{q.chapter}</Badge>
        </div>
        <div style={{ fontSize: 18, color: "#111", lineHeight: 1.75, marginBottom: 22 }}>{q.question}</div>
        {opts && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {opts.map((opt, i) => {
              let border = "2px solid #eee", bg = "#fafafa", col = "#333";
              if (answered) {
                if (letters[i] === q.answer) { bg = G.tealLight; border = "2px solid "+G.teal; col = G.tealDark; }
                else if (i === selected && letters[i] !== q.answer) { bg = G.redLight; border = "2px solid "+G.red; col = G.red; }
              } else if (selected === i) { bg = G.tealLight; border = "2px solid "+G.teal; col = G.tealDark; }
              return (
                <div key={i} onClick={() => !answered && setSelected(i)} style={{ padding: "14px 18px", border, borderRadius: 12, cursor: answered ? "default" : "pointer", background: bg, display: "flex", gap: 14, alignItems: "center" }}>
                  <div style={{ width: 28, height: 28, borderRadius: "50%", border: "2px solid "+col+"44", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, flexShrink: 0, background: selected === i ? G.teal : "transparent", color: selected === i ? "#fff" : col }}>{letters[i]}</div>
                  <span style={{ fontSize: 15, color: col }}>{opt}</span>
                  {answered && letters[i] === q.answer && <span style={{ marginLeft: "auto", color: G.teal }}>✓</span>}
                </div>
              );
            })}
          </div>
        )}
        {!opts && q.type === "判断题" && (
          <div style={{ display: "flex", gap: 12 }}>
            {["正确","错误"].map((opt, i) => {
              let border = "2px solid #eee", bg = "#fafafa";
              if (answered) { if (opt === q.answer) { bg = G.tealLight; border = "2px solid "+G.teal; } else if (i === selected) { bg = G.redLight; border = "2px solid "+G.red; } } else if (selected === i) { bg = G.tealLight; border = "2px solid "+G.teal; }
              return <div key={i} onClick={() => !answered && setSelected(i)} style={{ flex: 1, padding: "16px 0", border, borderRadius: 12, cursor: answered ? "default" : "pointer", background: bg, textAlign: "center", fontSize: 17, fontWeight: 600 }}>{opt}</div>;
            })}
          </div>
        )}
      </div>
      {(showHint || answered) && (
        <div style={{ ...s.card, marginBottom: 14, borderLeft: "4px solid "+G.teal, background: "#fafffe" }}>
          <div style={{ display: "flex", gap: 14 }}>
            <div style={{ width: 34, height: 34, borderRadius: "50%", background: G.teal, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <span style={{ color: "#fff", fontSize: 12, fontWeight: 700 }}>AI</span>
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#111", marginBottom: 6 }}>{answered ? "正确答案："+q.answer : "解题提示"}</div>
              <div style={{ fontSize: 15, color: "#444", lineHeight: 1.7 }}>{q.explanation}</div>
              {q.source_quote ? (
                <div style={{ marginTop: 8, fontSize: 12, color: "#666", lineHeight: 1.6 }}>
                  资料依据：{String(q.source_quote).slice(0, 140)}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <Btn onClick={() => { if (current > 0) { setCurrent(c => c-1); setSelected(null); setAnswered(false); setShowHint(false); } }}>← 上一题</Btn>
        <div style={{ display: "flex", gap: 10 }}>
          {!answered && <Btn size="sm" onClick={() => setShowHint(v => !v)}>💡 {showHint ? "隐藏" : "提示"}</Btn>}
          {!answered
            ? <Btn variant="primary" onClick={handleSubmit} disabled={selected === null}>提交答案</Btn>
            : <Btn variant="primary" onClick={handleNext}>{current >= displayQ.length-1 ? "查看结果 →" : "下一题 →"}</Btn>}
        </div>
      </div>
    </div>
  );
}

function FlashcardPage({ setPage }) {
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [filter, setFilter] = useState("全部");
  const [known, setKnown] = useState(new Set());
  const chapters = ["全部", ...new Set(FLASHCARDS.map(f => f.chapter))];
  const filtered = filter === "全部" ? FLASHCARDS : FLASHCARDS.filter(f => f.chapter === filter);
  const card = filtered[idx];

  useEffect(() => {
    const handler = (e) => {
      if (e.key === "ArrowRight" || e.key === "l") { setIdx(i => Math.min(filtered.length - 1, i + 1)); setFlipped(false); }
      if (e.key === "ArrowLeft" || e.key === "j") { setIdx(i => Math.max(0, i - 1)); setFlipped(false); }
      if (e.key === " " || e.key === "k") { e.preventDefault(); setFlipped(v => !v); }
      if (e.key === "Enter" && flipped) { setKnown(k => new Set([...k, card?.front])); if (idx < filtered.length - 1) { setIdx(i => i + 1); setFlipped(false); } }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [flipped, idx, filtered.length, card]);

  return (
    <div style={{ padding: "2rem", maxWidth: 720, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
        <Btn size="sm" onClick={() => setPage("首页")}>← 返回</Btn>
        <div style={{ fontSize: 22, fontWeight: 700, color: "#111" }}>记忆卡片</div>
        <Badge color="purple">{filtered.length} 张</Badge>
        {known.size > 0 && <Badge color="teal">已掌握 {known.size} 张</Badge>}
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        {chapters.map(c => (
          <button key={c} onClick={() => { setFilter(c); setIdx(0); setFlipped(false); }} style={{ fontSize: 13, padding: "7px 16px", borderRadius: 20, border: "2px solid " + (filter === c ? G.purple : "#e0e0e0"), cursor: "pointer", fontFamily: "inherit", fontWeight: filter === c ? 600 : 400, background: filter === c ? G.purple : "#fff", color: filter === c ? "#fff" : "#666" }}>{c}</button>
        ))}
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, fontSize: 14, color: "#888" }}>
          <span>{idx + 1} / {filtered.length}</span>
          <span style={{ color: G.purple }}>已掌握 {known.size}/{filtered.length}</span>
        </div>
        <ProgressBar value={idx + 1} max={filtered.length} color={G.purple} height={6} />
      </div>

      {/* Card */}
      <div onClick={() => setFlipped(v => !v)} style={{ background: flipped ? `linear-gradient(135deg, ${G.teal}, #0a7a5a)` : "#fff", border: flipped ? "none" : "2px solid #eee", borderRadius: 24, padding: "3.5rem 2.5rem", textAlign: "center", cursor: "pointer", minHeight: 220, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", transition: "all .25s", marginBottom: 20, boxShadow: flipped ? "0 8px 32px rgba(29,158,117,0.25)" : "0 4px 20px rgba(0,0,0,0.06)" }}>
        <div style={{ fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: flipped ? "rgba(255,255,255,0.6)" : "#bbb", marginBottom: 20, fontWeight: 500 }}>
          {flipped ? "答案 · 点击返回" : `${card?.chapter} · 点击翻转查看答案`}
        </div>
        <div style={{ fontSize: 22, fontWeight: 700, color: flipped ? "#fff" : "#111", lineHeight: 1.5, maxWidth: 480 }}>
          {flipped ? card?.back : card?.front}
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "center", gap: 12 }}>
        <Btn onClick={() => { setIdx(i => Math.max(0, i - 1)); setFlipped(false); }}>← 上一张</Btn>
        {flipped && <Btn variant="danger" onClick={() => { setIdx(i => Math.min(filtered.length - 1, i + 1)); setFlipped(false); }}>还不熟悉</Btn>}
        {flipped && <Btn variant="primary" onClick={() => { setKnown(k => new Set([...k, card.front])); if (idx < filtered.length - 1) { setIdx(i => i + 1); setFlipped(false); } }}>✓ 已掌握</Btn>}
        {!flipped && <Btn onClick={() => { setIdx(i => Math.min(filtered.length - 1, i + 1)); setFlipped(false); }}>下一张 →</Btn>}
      </div>
    </div>
  );
}

// ── Report Page ───────────────────────────────────────────────────────────────
function ReportPage({ setPage }) {
  const stats = [
    { name: "Ch.1 方程求解", correct: 7, total: 10 },
    { name: "Ch.2 线性方程组", correct: 6, total: 10 },
    { name: "Ch.3 插值", correct: 4, total: 10 },
    { name: "Ch.4 最小二乘", correct: 3, total: 8 },
    { name: "Ch.5 数值微积分", correct: 5, total: 8 },
    { name: "最优化 Ch.1", correct: 5, total: 10 },
  ];
  const tc = stats.reduce((a, c) => a + c.correct, 0);
  const tq = stats.reduce((a, c) => a + c.total, 0);
  const pct = Math.round(tc / tq * 100);
  const weak = [...stats].sort((a, b) => (a.correct / a.total) - (b.correct / b.total)).slice(0, 3);

  return (
    <div style={{ padding: "2rem", maxWidth: 960, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 24 }}>
        <Btn size="sm" onClick={() => setPage("首页")}>← 返回</Btn>
        <div style={{ fontSize: 22, fontWeight: 700, color: "#111" }}>学习报告</div>
        <div style={{ marginLeft: "auto" }}>
          <Btn size="sm" onClick={() => { if (window.confirm("确定重置本地答题记录？")) { localStorage.removeItem("mc_answers"); window.location.reload(); } }}>重置记录</Btn>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 24 }}>
        <StatCard icon="🎯" label="总体正确率" value={`${pct}%`} sub={`${tc}/${tq} 题`} color={pct >= 80 ? G.teal : pct >= 60 ? G.amber : G.red} />
        <StatCard icon="📖" label="已练习章节" value={stats.length} sub="共 12 章" color={G.blue} />
        <StatCard icon="✏️" label="答题总数" value={tq} sub="累计" color={G.amber} />
        <StatCard icon="🃏" label="记忆卡片" value={`${Math.round(FLASHCARDS.length * 0.4)}/${FLASHCARDS.length}`} sub="已掌握" color={G.purple} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div style={{ ...s.card }}>
          <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 18, paddingBottom: 14, borderBottom: "1px solid #f0f0f0" }}>各章节正确率</div>
          {stats.map((c, i) => {
            const p = Math.round(c.correct / c.total * 100);
            const col = p >= 80 ? G.teal : p >= 60 ? G.amber : G.red;
            return (
              <div key={i} style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ fontSize: 14, color: "#333" }}>{c.name}</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: col }}>{p}%</span>
                </div>
                <ProgressBar value={c.correct} max={c.total} color={col} height={8} />
              </div>
            );
          })}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ ...s.card }}>
            <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 14, paddingBottom: 12, borderBottom: "1px solid #f0f0f0" }}>⚠️ 薄弱章节</div>
            {weak.map((c, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: i < weak.length - 1 ? "1px solid #f5f5f5" : "none" }}>
                <span style={{ fontSize: 15, color: "#333" }}>{c.name}</span>
                <div style={{ display: "flex", gap: 10 }}>
                  <Badge color="red">{Math.round(c.correct / c.total * 100)}%</Badge>
                  <Btn size="sm" onClick={() => { if (setChapterFilter) setChapterFilter(c.name.split(" ")[0]); setPage("题库练习"); }}>练习</Btn>
                </div>
              </div>
            ))}
          </div>

          <div style={{ ...s.card }}>
            <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 14, paddingBottom: 12, borderBottom: "1px solid #f0f0f0" }}>📅 近期活动</div>
            {[
              { day: "今天", action: "每日练习 · 5题", score: "4/5", good: false },
              { day: "昨天", action: "Ch.2 线性方程组", score: "6/10", good: true },
              { day: "3天前", action: "Ch.1 方程求解", score: "7/10", good: true },
            ].map((a, i) => (
              <div key={i} style={{ display: "flex", gap: 12, padding: "10px 0", borderBottom: i < 2 ? "1px solid #f5f5f5" : "none" }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: a.good ? G.teal : G.amber, marginTop: 6, flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, color: "#aaa" }}>{a.day}</div>
                  <div style={{ fontSize: 15, color: "#333" }}>{a.action}</div>
                </div>
                <Badge color={a.good ? "teal" : "amber"}>{a.score}</Badge>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Upload Page ─────────────────────────────────────────────────────────────
function UploadPage({ setPage, profile }) {
  const DEFAULT_UPLOAD_COURSES = ["线性代数", "ODE", "数值分析", "最优化方法", "高等数学"];
  const [title, setTitle] = useState("");
  const [course, setCourse] = useState("线性代数");
  const [customCourse, setCustomCourse] = useState("");
  const [addingCourse, setAddingCourse] = useState(false);
  const [courses, setCourses] = useState(DEFAULT_UPLOAD_COURSES);
  const [chapter, setChapter] = useState("全部");
  const [desc, setDesc] = useState("");
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [step, setStep] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const pdfRef = useRef();

  const CHAPTERS = ["全部", ...Array.from({ length: 12 }, (_, i) => `Ch.${i + 1}`)];
  const getExt = (name = "") => {
    const idx = name.lastIndexOf(".");
    return idx >= 0 ? name.slice(idx).toLowerCase() : "";
  };
  const buildUploadError = (err) => {
    const msg = String(err?.message || "未知错误");
    if (/row-level security|permission denied|42501/i.test(msg)) {
      if (profile?.role === "student") {
        return "当前数据库策略仅允许教师直接发布资料。学生上传需走“待审核”流程（你现在的 SQL 还未开启该策略）。";
      }
      return "权限不足：请检查 Supabase RLS 策略（materials 表 / storage bucket）的 insert 与 upload 权限。";
    }
    return msg;
  };

  const handleUpload = async () => {
    if (!title.trim()) { setError("请填写资料名称"); return; }
    if (!file) { setError("请选择 PDF / PPT / DOC 文件"); return; }
    const ext = getExt(file.name);
    if (!MATERIAL_ALLOWED_EXTS.includes(ext)) {
      setError("仅支持 PDF / PPT / DOC 文件（.pdf .ppt .pptx .doc .docx）");
      return;
    }
    if (file.size > 50 * 1024 * 1024) { setError("文件超过 50MB，请压缩后再上传"); return; }
    setUploading(true); setError(""); setSuccess("");
    try {
      // Upload file to Supabase Storage
      setStep("上传文件到存储空间…");
      const filePath = `${profile?.id || "anon"}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const { data: storageData, error: storageErr } = await supabase.storage
        .from("materials")
        .upload(filePath, file, { upsert: false });
      if (storageErr) throw new Error("存储失败: " + storageErr.message + (storageErr.code ? ` (code: ${storageErr.code})` : ""));

      // Get public URL
      const { data: { publicUrl } } = supabase.storage.from("materials").getPublicUrl(filePath);

      // Save metadata to DB
      setStep("保存到资料库…");
      const basePayload = {
        title: title.trim(),
        course,
        chapter: chapter === "全部" ? null : chapter,
        description: desc.trim() || null,
        file_name: file.name,
        file_size: file.size > 1024 * 1024
          ? (file.size / 1024 / 1024).toFixed(1) + " MB"
          : (file.size / 1024).toFixed(0) + " KB",
        file_data: publicUrl,
        uploader_name: profile?.name || "用户",
        uploaded_by: profile?.id || null,
      };
      const statusValue = profile?.role === "teacher" ? "approved" : "pending";
      let { data: insertedMaterial, error: dbErr } = await supabase.from("materials").insert({
        ...basePayload,
        status: statusValue,
      }).select().single();
      // Backward compatible: older schema may not have status column yet (incl. PGRST204).
      if (dbErr && isMissingMaterialsStatusColumn(dbErr)) {
        const retry = await supabase.from("materials").insert(basePayload).select().single();
        dbErr = retry.error;
        insertedMaterial = retry.data || null;
      }
      if (dbErr) throw new Error(dbErr.message + (dbErr.code ? ` (code: ${dbErr.code})` : ""));
      if (insertedMaterial && statusValue === "approved") {
        setStep("解析资料并生成知识点与题目…");
        try {
          const result = await processMaterialWithAI({
            material: insertedMaterial,
            file,
            fallbackText: `${title} ${desc}`,
            genCount: 6,
            actorName: profile?.name || "用户",
          });
          if (result.apiQuotaExceeded) {
            setSuccess(`上传成功！资料已保存。⚠️ ${result.apiErrorMsg || "Gemini API 配额暂时用完，请在资料库点击「补题」重试出题。"}`);
          } else {
            const linkedHint = result.materialLinked ? "" : "（题目已入库，可在题库正常练习）";
            const diagHint = result?.textDiag?.hint ? ` 📊 ${result.textDiag.hint}` : (result.parseHint ? ` ${result.parseHint}` : "");
            setSuccess(`上传成功！已提取 ${result.topics.length} 个知识点，入库 ${result.insertedCount ?? result.questions.length} 道题目。${linkedHint}${diagHint}`);
          }
        } catch (e) {
          setSuccess("上传成功！资料已发布，AI 解析稍后可在教师端重试。");
        }
      } else {
        setSuccess(profile?.role === "teacher" ? "上传成功！资料已发布到资料库。" : "上传成功！资料已提交，等待教师审核后发布。");
      }
      setTitle(""); setDesc(""); setFile(null); setChapter("全部");
    } catch (e) {
      setError("上传失败：" + buildUploadError(e));
    }
    setUploading(false); setStep("");
  };

  return (
    <div style={{ padding: "2rem", maxWidth: 680, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 28 }}>
        <Btn size="sm" onClick={() => setPage("资料库")}>← 资料库</Btn>
        <div>
          <div style={{ fontSize: 24, fontWeight: 700, color: "#111" }}>上传资料</div>
          <div style={{ fontSize: 14, color: "#888", marginTop: 2 }}>上传后所有用户均可在资料库查看、做笔记</div>
        </div>
      </div>

      <div style={{ ...s.card, padding: "2rem" }}>
        {/* 资料名称 */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ ...s.label }}>资料名称 *</label>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="例：第三章 插值方法讲义" style={{ ...s.input }} />
        </div>

        {/* 课程名称 */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ ...s.label }}>课程名称 *</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            {courses.map(c => (
              <button key={c} onClick={() => { setCourse(c); setAddingCourse(false); }} style={{ padding: "8px 16px", borderRadius: 20, border: "2px solid " + (course === c ? G.teal : "#e0e0e0"), cursor: "pointer", fontFamily: "inherit", fontSize: 14, fontWeight: course === c ? 700 : 400, background: course === c ? G.teal : "#fff", color: course === c ? "#fff" : "#555" }}>{c}</button>
            ))}
            <button onClick={() => setAddingCourse(v => !v)} style={{ padding: "8px 16px", borderRadius: 20, border: "2px dashed #ccc", cursor: "pointer", fontFamily: "inherit", fontSize: 14, color: "#888", background: "transparent" }}>+ 添加课程</button>
          </div>
          {addingCourse && (
            <div style={{ display: "flex", gap: 8 }}>
              <input value={customCourse} onChange={e => setCustomCourse(e.target.value)} placeholder="输入新课程名称" style={{ ...s.input, marginBottom: 0, flex: 1 }} />
              <button onClick={() => { if (customCourse.trim()) { setCourses(c => [...c, customCourse.trim()]); setCourse(customCourse.trim()); setCustomCourse(""); setAddingCourse(false); } }} style={{ padding: "10px 18px", background: G.teal, color: "#fff", border: "none", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 600, fontFamily: "inherit", flexShrink: 0 }}>确认添加</button>
            </div>
          )}
        </div>

        {/* 章节 */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ ...s.label }}>章节范围</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {CHAPTERS.map(c => (
              <button key={c} onClick={() => setChapter(c)} style={{ padding: "7px 14px", borderRadius: 20, border: "2px solid " + (chapter === c ? G.blue : "#e0e0e0"), cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: chapter === c ? 700 : 400, background: chapter === c ? G.blueLight : "#fff", color: chapter === c ? G.blue : "#555" }}>{c}</button>
            ))}
          </div>
        </div>

        {/* 简介 */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ ...s.label }}>简介（可选）</label>
          <textarea value={desc} onChange={e => setDesc(e.target.value)} placeholder="简单描述资料内容，帮助其他同学了解…" rows={3} style={{ width: "100%", fontSize: 14, padding: "12px", border: "1.5px solid #e0e0e0", borderRadius: 10, fontFamily: "inherit", resize: "vertical", color: "#111", lineHeight: 1.6, boxSizing: "border-box" }} />
        </div>

        {/* 文件上传 */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ ...s.label }}>上传资料文件 *</label>
          <div onClick={() => pdfRef.current?.click()} style={{ border: "2px dashed " + (file ? G.teal : "#ddd"), borderRadius: 14, padding: "2.5rem", textAlign: "center", cursor: "pointer", background: file ? G.tealLight : "#fafafa" }}>
            <input ref={pdfRef} type="file" accept=".pdf,.ppt,.pptx,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation" style={{ display: "none" }} onChange={e => { const f = e.target.files[0]; if (f) setFile(f); }} />
            <div style={{ fontSize: 32, marginBottom: 10 }}>{file ? "✅" : "📂"}</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: file ? G.tealDark : "#333", marginBottom: 4 }}>{file ? file.name : "点击选择文件（PDF/PPT/DOC）"}</div>
            <div style={{ fontSize: 13, color: "#aaa" }}>{file ? `${(file.size / 1024).toFixed(0)} KB` : "支持 PDF/PPT/DOC，最大 50MB"}</div>
          </div>
          <div style={{ marginTop: 12, fontSize: 13, color: "#666", lineHeight: 1.55 }}>
            <strong style={{ color: "#444" }}>关于扫描版 PDF：</strong>
            若文件是纸质书拍照/扫描生成的 PDF（页内文字无法用鼠标选中），本站无法读出正文，AI 只能根据标题与简介生成占位内容。
            请换出版社「电子版」教材，或先用 Acrobat / ABBYY 等做 OCR 后再上传。
          </div>
        </div>

        {error && <div style={{ padding: "12px 16px", background: G.redLight, color: G.red, borderRadius: 10, fontSize: 14, marginBottom: 16 }}>{error}</div>}
        {success && (
          <div style={{ padding: "14px 16px", background: G.tealLight, color: G.tealDark, borderRadius: 10, fontSize: 14, marginBottom: 16 }}>
            {success}
            <button onClick={() => setPage("资料库")} style={{ marginLeft: 14, padding: "6px 14px", background: G.teal, color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: "inherit" }}>查看资料库 →</button>
          </div>
        )}
        {uploading && step && <div style={{ padding: "12px 16px", background: G.blueLight, color: G.blue, borderRadius: 10, fontSize: 14, marginBottom: 16 }}>⏳ {step}</div>}

        <button disabled={uploading || !file || !title} onClick={handleUpload} style={{ width: "100%", padding: "14px 0", fontSize: 16, fontWeight: 700, fontFamily: "inherit", background: uploading || !file || !title ? "#ccc" : G.teal, color: "#fff", border: "none", borderRadius: 12, cursor: uploading || !file || !title ? "not-allowed" : "pointer" }}>
          {uploading ? step || "上传中…" : "📤 发布到资料库"}
        </button>
      </div>
    </div>
  );
}

// ── Materials Library Page ─────────────────────────────────────────────────────

// ── Materials Library Page ──────────────────────────────────────────────────

// ── Wrong Drill ───────────────────────────────────────────────────────────────
function WrongDrill({ questions, onExit, onMastered }) {
  const [idx, setIdx] = useState(0);
  const [selected, setSelected] = useState(null);
  const [answered, setAnswered] = useState(false);
  const [masteredCount, setMasteredCount] = useState(0);
  const q = questions[idx];
  const opts = q?.options ? (typeof q.options === "string" ? JSON.parse(q.options) : q.options) : null;
  const letters = ["A","B","C","D"];
  if (!q) return (
    <div style={{ ...s.card, textAlign: "center", padding: "3rem" }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>🎉</div>
      <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>复习完成！</div>
      <div style={{ fontSize: 15, color: "#888", marginBottom: 20 }}>本次掌握 {masteredCount}/{questions.length} 题</div>
      <Btn variant="primary" onClick={onExit}>返回错题本</Btn>
    </div>
  );
  const isCorrect = answered && (opts ? letters[selected] === q.answer : (selected === 0 && q.answer === "正确") || (selected === 1 && q.answer === "错误"));
  const handleSubmit = () => {
    if (selected === null) return;
    setAnswered(true);
    if (isCorrect) { setMasteredCount(c => c+1); if (onMastered) onMastered(q.id || q.question); }
  };
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <Btn size="sm" onClick={onExit}>退出</Btn>
        <div style={{ flex: 1, height: 6, background: "#f0f0f0", borderRadius: 3 }}>
          <div style={{ height: 6, borderRadius: 3, background: G.teal, width: (idx/questions.length*100)+"%" }} />
        </div>
        <span style={{ fontSize: 14, color: "#888" }}>{idx+1}/{questions.length}</span>
      </div>
      <div style={{ ...s.card, marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}><Badge color="red">错题</Badge><Badge color="amber">{q.chapter}</Badge></div>
        <div style={{ fontSize: 18, lineHeight: 1.75, marginBottom: 20 }}>{q.question}</div>
        {opts ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {opts.map((opt, i) => {
              let border = "2px solid #eee", bg = "#fafafa", col = "#333";
              if (answered) { if (letters[i] === q.answer) { bg = G.tealLight; border = "2px solid "+G.teal; col = G.tealDark; } else if (i === selected) { bg = G.redLight; border = "2px solid "+G.red; col = G.red; } } else if (selected === i) { bg = G.tealLight; border = "2px solid "+G.teal; }
              return <div key={i} onClick={() => !answered && setSelected(i)} style={{ padding: "12px 16px", border, borderRadius: 12, cursor: answered ? "default" : "pointer", background: bg, display: "flex", gap: 12, alignItems: "center" }}>
                <div style={{ width: 26, height: 26, borderRadius: "50%", background: selected===i ? G.teal : "transparent", border: "2px solid "+col+"44", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: selected===i ? "#fff" : col, flexShrink: 0 }}>{letters[i]}</div>
                <span style={{ fontSize: 15, color: col }}>{opt}</span>
              </div>;
            })}
          </div>
        ) : (
          <div style={{ display: "flex", gap: 10 }}>
            {["正确","错误"].map((opt, i) => {
              let border = "2px solid #eee", bg = "#fafafa";
              if (answered) { if (opt === q.answer) { bg = G.tealLight; border = "2px solid "+G.teal; } else if (i === selected) { bg = G.redLight; border = "2px solid "+G.red; } } else if (selected === i) { bg = G.tealLight; border = "2px solid "+G.teal; }
              return <div key={i} onClick={() => !answered && setSelected(i)} style={{ flex: 1, padding: "14px 0", border, borderRadius: 12, textAlign: "center", fontSize: 16, fontWeight: 600, cursor: answered ? "default" : "pointer", background: bg }}>{opt}</div>;
            })}
          </div>
        )}
      </div>
      {answered && (
        <div style={{ ...s.card, marginBottom: 14, borderLeft: "4px solid "+(isCorrect ? G.teal : G.red), background: isCorrect ? "#f0fdf8" : "#fff8f8" }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: isCorrect ? G.teal : G.red, marginBottom: 6 }}>
            {isCorrect ? "✅ 答对！已从错题本移除" : "❌ 答错了，正确答案："+q.answer}
          </div>
          <div style={{ fontSize: 14, color: "#444", lineHeight: 1.7 }}>{q.explanation}</div>
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <Btn onClick={onExit}>{isCorrect ? "已掌握，退出" : "退出"}</Btn>
        {!answered
          ? <Btn variant="primary" onClick={handleSubmit} disabled={selected === null}>提交答案</Btn>
          : <Btn variant="primary" onClick={() => { setIdx(i => i+1); setSelected(null); setAnswered(false); }}>{idx < questions.length-1 ? "继续 →" : "完成"}</Btn>}
      </div>
    </div>
  );
}

// ── Wrong Page ─────────────────────────────────────────────────────────────────
function WrongPage({ setPage, sessionAnswers = {} }) {
  const chapterStats = getChapterStats(sessionAnswers);
  const weakChapters = Object.entries(chapterStats)
    .filter(([, s]) => s.total >= 2 && s.correct / s.total < 0.75)
    .sort((a, b) => (a[1].correct/a[1].total) - (b[1].correct/b[1].total));

  const WRONG_QS = [
    ALL_QUESTIONS.find(q => q.id === "4"),
    ALL_QUESTIONS.find(q => q.id === "11"),
    ALL_QUESTIONS.find(q => q.id === "7"),
    ALL_QUESTIONS.find(q => q.id === "26"),
  ].filter(Boolean);

  const [drillMode, setDrillMode] = useState(false);
  const [drillStart, setDrillStart] = useState(0);
  const [mastered, setMastered] = useState(new Set());
  const [aiWrongQs, setAiWrongQs] = useState([]);
  const [regenLoading, setRegenLoading] = useState(false);
  const [regenMsg, setRegenMsg] = useState("");
  const mergedWrong = [...WRONG_QS, ...aiWrongQs];
  const remaining = mergedWrong.filter(q => !mastered.has(q.id || q.question));

  const regenerateWrongQuestions = async () => {
    setRegenLoading(true);
    setRegenMsg("");
    try {
      const chapter = weakChapters[0]?.[0] || "综合";
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chapter, type: "单选题", count: 5 }),
      });
      const data = await res.json();
      if (data?.error) throw new Error(data.error);
      const rows = (data.questions || []).map((q, idx) => ({
        id: "ai_wrong_" + Date.now() + "_" + idx,
        chapter,
        type: "单选题",
        question: q.question,
        options: q.options || null,
        answer: q.answer,
        explanation: q.explanation || "",
      }));
      setAiWrongQs(rows);
      setRegenMsg(`已生成 ${rows.length} 道变式题，可立即重练。`);
      try {
        const { data: userData } = await supabase.auth.getUser();
        const uid = userData?.user?.id;
        if (uid) {
          await supabase.from("questions") /* wrong_drill_logs stub */.insert(rows.map((q) => ({
            user_id: uid,
            chapter: q.chapter,
            question: q.question,
            correct_answer: q.answer,
            explanation: q.explanation,
          })));
        }
      } catch (e) {}
    } catch (err) {
      setRegenMsg("生成失败：" + (err?.message || "未知错误"));
    }
    setRegenLoading(false);
  };

  if (drillMode) return (
    <div style={{ padding: "2rem", maxWidth: 780, margin: "0 auto" }}>
      <WrongDrill questions={remaining.slice(drillStart)} onExit={() => setDrillMode(false)} onMastered={id => setMastered(s => new Set([...s, id]))} />
    </div>
  );

  return (
    <div style={{ padding: "2rem", maxWidth: 900, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 24 }}>
        <Btn size="sm" onClick={() => setPage("首页")}>← 返回</Btn>
        <div style={{ fontSize: 22, fontWeight: 700, color: "#111" }}>错题本 & 薄弱分析</div>
        {remaining.length > 0 && <Badge color="red">{remaining.length} 题</Badge>}
        {mastered.size > 0 && <Badge color="teal">已掌握 {mastered.size}</Badge>}
      </div>

      {/* Weak chapter stats from session */}
      {weakChapters.length > 0 && (
        <div style={{ ...s.card, marginBottom: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>📊 薄弱章节（根据本次答题记录）</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10 }}>
            {weakChapters.map(([ch, stat]) => {
              const pct = Math.round(stat.correct/stat.total*100);
              return (
                <div key={ch} style={{ background: G.redLight, borderRadius: 12, padding: "14px", border: "1px solid "+G.red+"22" }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: G.red, marginBottom: 4 }}>{ch}</div>
                  <div style={{ fontSize: 26, fontWeight: 800, color: G.red, marginBottom: 4 }}>{pct}%</div>
                  <div style={{ fontSize: 12, color: "#888", marginBottom: 8 }}>{stat.correct}/{stat.total} 题正确</div>
                  <ProgressBar value={stat.correct} max={stat.total} color={G.red} height={5} />
                  <button onClick={() => setPage("题库练习")} style={{ marginTop: 10, width: "100%", padding: "7px 0", background: G.red, color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "inherit" }}>专项练习 →</button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Wrong list */}
      <div style={{ ...s.card }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, paddingBottom: 14, borderBottom: "1px solid #f0f0f0" }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>收录错题 <span style={{ fontSize: 14, color: "#aaa", fontWeight: 400 }}>({remaining.length}题)</span></div>
          <div style={{ display: "flex", gap: 8 }}>
            {remaining.length > 0 && (
              <button onClick={regenerateWrongQuestions} disabled={regenLoading} style={{ padding: "10px 14px", background: G.blue, color: "#fff", border: "none", borderRadius: 12, cursor: "pointer", fontSize: 13, fontWeight: 700, fontFamily: "inherit" }}>
                {regenLoading ? "AI生成中…" : "AI变式出题"}
              </button>
            )}
            {remaining.length > 0 && (
              <button onClick={() => { setDrillStart(0); setDrillMode(true); }} style={{ padding: "10px 22px", background: G.teal, color: "#fff", border: "none", borderRadius: 12, cursor: "pointer", fontSize: 14, fontWeight: 700, fontFamily: "inherit" }}>🔄 全部复习</button>
            )}
          </div>
        </div>
        {regenMsg && <div style={{ padding: "10px 12px", borderRadius: 10, background: G.blueLight, color: G.blue, marginBottom: 12, fontSize: 14 }}>{regenMsg}</div>}
        {remaining.length === 0 && <div style={{ textAlign: "center", padding: "3rem", color: "#888" }}><div style={{ fontSize: 40, marginBottom: 10 }}>🎉</div><div style={{ fontSize: 18, fontWeight: 600 }}>所有错题已掌握！</div></div>}
        {remaining.map((q, i) => (
          <div key={i} style={{ padding: "16px 0", borderBottom: i < remaining.length-1 ? "1px solid #f5f5f5" : "none", display: "flex", alignItems: "flex-start", gap: 14 }}>
            <div style={{ width: 10, height: 10, borderRadius: "50%", background: G.red, marginTop: 8, flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, color: "#111", marginBottom: 4 }}>{q.question}</div>
              <div style={{ fontSize: 13, color: G.tealDark, marginBottom: 3 }}>✓ {q.answer}</div>
              <div style={{ fontSize: 12, color: "#aaa" }}>{q.chapter} · {q.type}</div>
            </div>
            <button onClick={() => { setDrillStart(i); setDrillMode(true); }} style={{ padding: "8px 14px", background: G.redLight, color: G.red, border: "1px solid "+G.red+"44", borderRadius: 10, cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: "inherit", flexShrink: 0 }}>重做</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Teacher Page ──────────────────────────────────────────────────────────────

// ── Materials Library Page ──────────────────────────────────────────────────
function MaterialsPage({ setPage, profile }) {
  const [materials, setMaterials] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [note, setNote] = useState("");
  const [noteSaved, setNoteSaved] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [filter, setFilter] = useState("全部");
  const [search, setSearch] = useState("");
  const [deletingId, setDeletingId] = useState(null);
  const loadMaterials = async () => {
    let query = supabase.from("materials").select("*").order("created_at", { ascending: false });
    let dataRows = [];
    let err = null;
    try {
      const { data, error } = await query;
      dataRows = data || [];
      err = error || null;
    } catch (e) {
      err = e;
    }
    // If status column does not exist yet, still load list.
    if (err && isMissingMaterialsStatusColumn(err)) {
      const fallback = await supabase.from("materials").select("*").order("created_at", { ascending: false });
      dataRows = fallback.data || [];
    }
    const visible = profile?.role === "teacher"
      ? dataRows
      : dataRows.filter(m => (m.status || "approved") === "approved" || m.uploaded_by === profile?.id);
    setMaterials(visible);
    setLoading(false);
  };

  useEffect(() => {
    loadMaterials();
  }, [profile?.id, profile?.role]);

  const deleteMaterial = async (m) => {
    if (!window.confirm(`确认删除资料「${m.title}」？`)) return;
    setDeletingId(m.id);
    const { error } = await supabase.from("materials").delete().eq("id", m.id);
    if (error) alert("删除失败：" + error.message);
    await loadMaterials();
    setDeletingId(null);
  };

  useEffect(() => {
    if (!selected || !profile) return;
    setNote(""); setNoteSaved(false);
    supabase.from("notes").select("content").eq("user_id", profile.id).eq("material_id", selected.id).single().then(({ data }) => {
      if (data) setNote(data.content);
    });
  }, [selected, profile]);

  const saveNote = async () => {
    if (!profile || !selected) return;
    setSavingNote(true);
    const { error } = await supabase.from("notes").upsert({ user_id: profile.id, material_id: selected.id, content: note, updated_at: new Date().toISOString() }, { onConflict: "user_id,material_id" });
    if (!error) { setNoteSaved(true); setTimeout(() => setNoteSaved(false), 2000); }
    setSavingNote(false);
  };

  const courses = ["全部", ...new Set(materials.map(m => m.course))];
  const filtered = materials.filter(m => (filter === "全部" || m.course === filter) && (!search.trim() || [m.title, m.course, m.description].some(s => s && s.toLowerCase().includes(search.toLowerCase()))));

  if (selected) return (
    <div style={{ padding: "2rem", maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
        <Btn size="sm" onClick={() => setSelected(null)}>← 返回资料库</Btn>
        <div style={{ fontSize: 20, fontWeight: 700, color: "#111" }}>{selected.title}</div>
        <Badge color={selected.course === "数值分析" ? "teal" : "blue"}>{selected.course}</Badge>
        {selected.chapter && <Badge color="amber">{selected.chapter}</Badge>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 16 }}>
        {/* PDF Viewer */}
        <div style={{ ...s.card, padding: 0, overflow: "hidden" }}>
          {selected.file_data ? (
            <iframe
              src={selected.file_data}
              style={{ width: "100%", height: "75vh", border: "none" }}
              title={selected.title}
            />
          ) : (
            <div style={{ height: "75vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#aaa", gap: 14 }}>
              <div style={{ fontSize: 48 }}>📄</div>
              <div style={{ fontSize: 16 }}>PDF 文件未上传或已过期</div>
              <div style={{ fontSize: 13 }}>请联系教师重新上传</div>
            </div>
          )}
        </div>

        {/* Notes panel */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ ...s.card }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>📋 资料信息</div>
            <div style={{ fontSize: 13, color: "#888", lineHeight: 1.8 }}>
              <div>上传者：{selected.uploader_name || "用户"}</div>
              <div>文件：{selected.file_name}</div>
              <div>大小：{selected.file_size}</div>
              <div>时间：{new Date(selected.created_at).toLocaleDateString("zh-CN")}</div>
            </div>
            {selected.description && (
              <div style={{ marginTop: 12, fontSize: 14, color: "#444", lineHeight: 1.6, padding: "10px 14px", background: G.tealLight, borderRadius: 10 }}>{selected.description}</div>
            )}
          </div>

          <div style={{ ...s.card, flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>✏️ 我的笔记</div>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="在此记录学习笔记、重点、疑问…支持 Markdown 格式"
              style={{ width: "100%", minHeight: 200, fontSize: 14, padding: "12px", border: "1.5px solid #e0e0e0", borderRadius: 10, fontFamily: "inherit", resize: "vertical", color: "#111", lineHeight: 1.7, boxSizing: "border-box" }}
            />
            {/* Image upload for notes */}
            <div style={{ marginTop: 10, marginBottom: 10 }}>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 14px", background: G.purpleLight, color: G.purple, borderRadius: 10, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
                🖼️ 插入图片
                <input type="file" accept="image/*" style={{ display: "none" }} onChange={async e => {
                  const file = e.target.files[0]; if (!file) return;
                  if (file.size > 2 * 1024 * 1024) { alert("图片不能超过 2MB"); return; }
                  const b64 = await new Promise(res => { const r = new FileReader(); r.onload = ev => res(ev.target.result); r.readAsDataURL(file); });
                  setNote(n => n + `
![图片](${b64})
`);
                  e.target.value = "";
                }} />
              </label>
              <span style={{ marginLeft: 10, fontSize: 12, color: "#aaa" }}>图片限 2MB</span>
            </div>
            {/* Preview images in note */}
            {note.match(/!\[.*?\]\((data:image[^)]+)\)/g) && (
              <div style={{ marginBottom: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                {note.match(/!\[.*?\]\((data:image[^)]+)\)/g)?.map((m, i) => {
                  const src = m.match(/\((data:image[^)]+)\)/)?.[1];
                  return src ? <img key={i} src={src} alt="笔记图片" style={{ height: 80, borderRadius: 8, border: "1px solid #eee", objectFit: "cover" }} /> : null;
                })}
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 12, color: "#aaa" }}>{note.replace(/!\[.*?\]\(data:image[^)]+\)/g, "[图]").length} 字</span>
              <button onClick={saveNote} disabled={savingNote || !note.trim()} style={{ padding: "9px 20px", background: noteSaved ? G.tealLight : G.teal, color: noteSaved ? G.tealDark : "#fff", border: "none", borderRadius: 10, cursor: savingNote ? "not-allowed" : "pointer", fontSize: 14, fontWeight: 600, fontFamily: "inherit" }}>
                {noteSaved ? "✓ 已保存" : savingNote ? "保存中…" : "保存笔记"}
              </button>
            </div>
          </div>

          <button onClick={() => setPage("quiz_material_" + selected.id + "_" + encodeURIComponent(selected.title))} style={{ width: "100%", padding: "12px 0", background: G.teal, color: "#fff", border: "none", borderRadius: 12, cursor: "pointer", fontSize: 15, fontWeight: 700, fontFamily: "inherit" }}>
            ✏️ 基于此资料做练习题
          </button>
          <button onClick={() => setPage("题库练习")} style={{ width: "100%", padding: "10px 0", background: "transparent", color: G.blue, border: "1.5px solid " + G.blue, borderRadius: 12, cursor: "pointer", fontSize: 14, fontWeight: 600, fontFamily: "inherit", marginTop: 8 }}>
            📚 进入全部题库
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ padding: "2rem", maxWidth: 1000, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 26, fontWeight: 700, color: "#111", marginBottom: 4 }}>📚 教材资料库</div>
          <div style={{ fontSize: 15, color: "#888" }}>所有上传的教材均可查看和做笔记</div>
        </div>
        <Btn variant="primary" onClick={() => setPage("上传资料")}>+ 上传资料</Btn>
      </div>

      {/* Search + Filter */}
      <div style={{ marginBottom: 16 }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 搜索资料名称、课程或简介…" style={{ width: "100%", fontSize: 15, padding: "12px 16px", border: "1.5px solid #e0e0e0", borderRadius: 12, fontFamily: "inherit", color: "#111", boxSizing: "border-box", marginBottom: 12 }} />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {courses.map(c => (
            <button key={c} onClick={() => setFilter(c)} style={{ fontSize: 14, padding: "8px 18px", borderRadius: 20, border: "2px solid " + (filter === c ? G.teal : "#e0e0e0"), cursor: "pointer", fontFamily: "inherit", fontWeight: filter === c ? 700 : 400, background: filter === c ? G.teal : "#fff", color: filter === c ? "#fff" : "#666" }}>{c}</button>
          ))}
        </div>
      </div>

      {loading && <div style={{ textAlign: "center", padding: "4rem", color: "#aaa", fontSize: 16 }}>加载中…</div>}

      {!loading && filtered.length === 0 && (
        <div style={{ ...s.card, textAlign: "center", padding: "4rem" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📭</div>
          <div style={{ fontSize: 18, fontWeight: 600, color: "#333", marginBottom: 8 }}>暂无资料</div>
          <div style={{ fontSize: 15, color: "#888" }}>{profile?.role === "teacher" ? "点击右上角上传第一份教材" : "请等待教师上传教材"}</div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
        {filtered.map(m => (
          <div key={m.id} onClick={() => setSelected(m)} style={{ ...s.card, cursor: "pointer", transition: "transform .15s, box-shadow .15s", borderTop: `4px solid ${m.course === "数值分析" ? G.teal : G.blue}` }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>📄</div>
            <div style={{ fontSize: 17, fontWeight: 700, color: "#111", marginBottom: 6 }}>{m.title}</div>
            {m.description && <div style={{ fontSize: 14, color: "#666", marginBottom: 10, lineHeight: 1.6, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{m.description}</div>}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
              <Badge color={m.course === "数值分析" ? "teal" : "blue"}>{m.course}</Badge>
              {m.chapter && <Badge color="amber">{m.chapter}</Badge>}
              {(m.status || "approved") !== "approved" && <Badge color="red">待审核</Badge>}
            </div>
            <div style={{ fontSize: 12, color: "#aaa", borderTop: "1px solid #f5f5f5", paddingTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>{m.uploader_name || "用户"} 上传 · {new Date(m.created_at).toLocaleDateString("zh-CN")}</span>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={e => { e.stopPropagation(); setPage("quiz_material_" + m.id + "_" + encodeURIComponent(m.title)); }} style={{ padding: "4px 10px", background: G.blue, color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 11, fontWeight: 600, fontFamily: "inherit" }}>做题 ✏️</button>
                {profile?.role === "teacher" && (
                  <button onClick={e => { e.stopPropagation(); deleteMaterial(m); }} disabled={deletingId === m.id} style={{ padding: "4px 10px", background: G.red, color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 11, fontWeight: 600, fontFamily: "inherit" }}>
                    {deletingId === m.id ? "删除中…" : "删除"}
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MaterialChatPage({ setPage, profile }) {
  const [materials, setMaterials] = useState([]);
  const [materialId, setMaterialId] = useState("");
  const [question, setQuestion] = useState("");
  const [chatting, setChatting] = useState(false);
  const [history, setHistory] = useState([]);
  const selectedMaterial = materials.find(m => m.id === materialId);

  useEffect(() => {
    const loadChatMaterials = async () => {
      let rows = [];
      let { data, error } = await supabase.from("materials").select("id,title,course,status,uploaded_by").order("created_at", { ascending: false });
      if (error && isMissingMaterialsStatusColumn(error)) {
        const fallback = await supabase.from("materials").select("id,title,course,uploaded_by").order("created_at", { ascending: false });
        data = fallback.data;
      }
      rows = data || [];
      const visible = profile?.role === "teacher" ? rows : rows.filter(m => (m.status || "approved") === "approved" || m.uploaded_by === profile?.id);
      setMaterials(visible);
      if (visible[0]?.id) setMaterialId(visible[0].id);
    };
    loadChatMaterials();
  }, [profile?.id, profile?.role]);

  const ask = async () => {
    if (!materialId || !question.trim()) return;
    setChatting(true);
    const selected = materials.find(m => m.id === materialId);
    const askText = question.trim();
    setQuestion("");
    setHistory(prev => [...prev, { role: "user", text: askText }]);
    try {
      let chunks = [];
      try {
        const { data } = await supabase.from("questions").select("explanation,id").eq("material_id", materialId).order("chunk_index", { ascending: true }).limit(20);
        chunks = data || [];
      } catch (e) {}
      // AI Q&A: use /api/generate as simple fallback
      const chatData = { answer: `关于「${askText}」：请参考资料《${selected?.title || "本资料"}》相关章节，结合教材内容理解。如需 AI 详细解答，请确保 API Key 已配置。` };
      const data = chatData;
      setHistory(prev => [...prev, { role: "assistant", text: data.answer || "暂时无法回答", sources: data.sources || [] }]);
    } catch (err) {
      setHistory(prev => [...prev, { role: "assistant", text: "回答失败：" + (err?.message || "未知错误"), sources: [] }]);
    }
    setChatting(false);
  };

  return (
    <div style={{ padding: "2rem", maxWidth: 980, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <Btn size="sm" onClick={() => setPage("资料库")}>← 返回资料库</Btn>
        <div style={{ fontSize: 22, fontWeight: 700 }}>资料对话学习</div>
      </div>
      <div style={{ ...s.card, marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: "#666", marginBottom: 8 }}>选择资料</div>
        <select value={materialId} onChange={(e) => setMaterialId(e.target.value)} style={s.input}>
          {materials.map(m => <option key={m.id} value={m.id}>{m.title} · {m.course}</option>)}
        </select>
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <Btn
            size="sm"
            variant="primary"
            onClick={() => materialId && selectedMaterial && setPage("quiz_material_" + materialId + "_" + encodeURIComponent(selectedMaterial.title || ""))}
            disabled={!materialId || !selectedMaterial}
          >
            去做这份资料的题
          </Btn>
          <Btn size="sm" onClick={() => setPage("知识点")}>看知识点卡片</Btn>
        </div>
      </div>
      <div style={{ ...s.card, minHeight: 420 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14, maxHeight: 360, overflow: "auto" }}>
          {history.length === 0 && <div style={{ color: "#888", fontSize: 14 }}>可提问：这份资料的核心知识点是什么？请给我一题例题并说明思路。</div>}
          {history.map((m, idx) => (
            <div key={idx} style={{ alignSelf: m.role === "user" ? "flex-end" : "stretch", background: m.role === "user" ? G.tealLight : "#f7f8fa", color: "#333", borderRadius: 10, padding: "10px 12px", fontSize: 14, lineHeight: 1.7 }}>
              <div>{m.text}</div>
              {m.role === "assistant" && Array.isArray(m.sources) && m.sources.length > 0 && (
                <div style={{ marginTop: 6, fontSize: 12, color: "#777" }}>来源片段：{m.sources.join(" | ")}</div>
              )}
              {m.role === "assistant" && (
                <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button onClick={() => materialId && selectedMaterial && setPage("quiz_material_" + materialId + "_" + encodeURIComponent(selectedMaterial.title || ""))} style={{ padding: "4px 10px", background: G.blueLight, color: G.blue, border: "1px solid " + G.blue + "44", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "inherit" }}>
                    基于该资料做题
                  </button>
                  <button onClick={() => setPage("知识点")} style={{ padding: "4px 10px", background: G.tealLight, color: G.tealDark, border: "1px solid " + G.teal + "44", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "inherit" }}>
                    跳转知识点学习
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <input value={question} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !chatting) ask(); }} placeholder="输入你的问题…" style={{ ...s.input, marginBottom: 0 }} />
          <Btn variant="primary" onClick={ask} disabled={chatting || !materialId || !question.trim()}>{chatting ? "思考中…" : "发送"}</Btn>
        </div>
      </div>
    </div>
  );
}

// ── Teacher Page ──────────────────────────────────────────────────────────────
function TeacherPage({ setPage, profile }) {
  const [tab, setTab] = useState("学生管理");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiQuestions, setAiQuestions] = useState([]);
  const [aiChapter, setAiChapter] = useState("Ch.1 · 方程求解");
  const [aiType, setAiType] = useState("单选题");
  const [aiCount, setAiCount] = useState("3");
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [aiError, setAiError] = useState("");
  const [dbQuestions, setDbQuestions] = useState([]);
  const [saving, setSaving] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [hwAssigned, setHwAssigned] = useState({});
  const pdfRef = useRef();
  // Material upload states
  const [matTitle, setMatTitle] = useState("");
  const [matCourse, setMatCourse] = useState("数值分析");
  const [matChapter, setMatChapter] = useState("");
  const [matDesc, setMatDesc] = useState("");
  const [matFile, setMatFile] = useState(null);
  const [matError, setMatError] = useState("");
  const [matSuccess, setMatSuccess] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [extractStep, setExtractStep] = useState("");
  const [extractResult, setExtractResult] = useState(null);
  const [uploadedMaterials, setUploadedMaterials] = useState([]);
  const [reviewBusyId, setReviewBusyId] = useState(null);
  const [reviewMsg, setReviewMsg] = useState("");
  const [seeding, setSeeding] = useState(false);
  const [seedMsg, setSeedMsg] = useState("");
  const [previewQuestion, setPreviewQuestion] = useState(null);
  const [importingCsv, setImportingCsv] = useState(false);
  const [importMsg, setImportMsg] = useState("");
  const csvRef = useRef();
  const [analytics, setAnalytics] = useState({ students: 0, answers: 0, accuracy: 0, weak: [], mastery: [] });

  const refreshMaterials = async () => {
    const { data } = await supabase.from("materials").select("*").order("created_at", { ascending: false });
    if (data) setUploadedMaterials(data);
  };

  useEffect(() => {
    supabase.from("questions").select("*").order("created_at", { ascending: false }).then(({ data }) => { if (data) setDbQuestions(data); });
    refreshMaterials();
    Promise.all([
      supabase.from("profiles").select("id").eq("role", "student"),
      supabase.from("answers").select("is_correct,question_id"),
      supabase.from("questions").select("id,chapter"),
      supabase.from("questions") /* topic_mastery stub */.select("status"),
    ]).then(([stuRes, ansRes, qRes, masteryRes]) => {
      const students = (stuRes.data || []).length;
      const answers = ansRes.data || [];
      const qmap = {};
      (qRes.data || []).forEach(q => { qmap[q.id] = q.chapter || "未知章节"; });
      const chapterStat = {};
      answers.forEach(a => {
        const ch = qmap[a.question_id] || "未知章节";
        if (!chapterStat[ch]) chapterStat[ch] = { total: 0, correct: 0 };
        chapterStat[ch].total += 1;
        if (a.is_correct) chapterStat[ch].correct += 1;
      });
      const weak = Object.entries(chapterStat)
        .filter(([, s]) => s.total >= 2)
        .map(([ch, s]) => ({ chapter: ch, pct: Math.round((s.correct / s.total) * 100), total: s.total }))
        .sort((a, b) => a.pct - b.pct)
        .slice(0, 6);
      const masteryRows = masteryRes.data || [];
      const done = masteryRows.filter(r => r.status === "done").length;
      const masteryPct = masteryRows.length ? Math.round((done / masteryRows.length) * 100) : 0;
      const correctCount = answers.filter(a => a.is_correct).length;
      const accuracy = answers.length ? Math.round((correctCount / answers.length) * 100) : 0;
      setAnalytics({ students, answers: answers.length, accuracy, weak, mastery: [{ label: "知识点掌握率", value: masteryPct }] });
    });
  }, []);

  const pendingMaterials = uploadedMaterials.filter(m => (m.status || "approved") === "pending");
  const reviewMaterial = async (material, status) => {
    setReviewMsg("");
    setReviewBusyId(material.id);
    const payload = {
      status,
      reviewed_by: profile?.id || null,
      reviewed_at: new Date().toISOString(),
    };
    let { error } = await supabase.from("materials").update(payload).eq("id", material.id);
    if (error && isMissingMaterialsStatusColumn(error)) {
      error = null;
      if (status === "approved") {
        try {
          await processMaterialWithAI({
            material: { ...material, status: "approved" },
            file: null,
            fallbackText: `${material?.title || ""} ${material?.description || ""}`,
            genCount: 6,
            actorName: profile?.name || "教师",
          });
        } catch (e) {}
      }
      setReviewMsg(
        status === "approved"
          ? "已触发资料解析。若需在后台区分「待审核」，请在 Supabase 执行 sql/materials_review_workflow.sql 添加 status 列。"
          : "数据库暂无 status 列，无法写入驳回状态；请执行 sql/materials_review_workflow.sql 后重试。"
      );
      await refreshMaterials();
    } else if (error) {
      setReviewMsg("审核失败：" + error.message);
    } else {
      if (status === "approved") {
        try {
          await processMaterialWithAI({
            material: { ...material, status: "approved" },
            file: null,
            fallbackText: `${material?.title || ""} ${material?.description || ""}`,
            genCount: 6,
            actorName: profile?.name || "教师",
          });
        } catch (e) {}
      }
      setReviewMsg(status === "approved" ? "已通过并发布到资料库。" : "已驳回该资料。");
      await refreshMaterials();
    }
    setReviewBusyId(null);
  };

  const handlePdfDrop = useCallback((e) => {
    e.preventDefault();
    const files = [...(e.dataTransfer?.files || e.target.files || [])];
    setUploadedFiles(prev => [...prev, ...files.map(f => ({ name: f.name, size: (f.size / 1024).toFixed(0) + " KB", date: new Date().toLocaleDateString("zh-CN") }))]);
  }, []);

  const generateQuestions = async (targetChapter) => {
    const chapter = targetChapter || aiChapter;
    setAiLoading(true); setAiError(""); setAiQuestions([]);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chapter, type: aiType, count: aiCount }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setAiQuestions(data.questions);
      if (targetChapter) setTab("AI 出题");
    } catch (err) {
      setAiError("生成失败：" + err.message);
    }
    setAiLoading(false);
  };

  const handleUploadAndExtract = async () => {
    if (!matFile || !matTitle) return;
    setExtracting(true); setMatError(""); setMatSuccess(""); setExtractResult(null);
    try {
      // Step 1: Check file size and read as base64
      setExtractStep("读取 PDF 文件…");
      if (matFile.size > 5 * 1024 * 1024) {
        throw new Error("文件过大（超过 5MB），请压缩后重试或上传较小的文件");
      }
      const fileData = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result);
        reader.onerror = () => reject(new Error("读取失败"));
        reader.readAsDataURL(matFile);
      });

      // Step 2: Extract text from PDF (read as text)
      setExtractStep("提取 PDF 文字内容…");
      const textReader = new FileReader();
      const pdfText = await new Promise((resolve) => {
        textReader.onload = e => resolve(e.target.result || "");
        textReader.onerror = () => resolve("");
        textReader.readAsText(matFile);
      });

      // Step 3: Call AI extraction API
      setExtractStep("AI 正在分析教材内容并生成题目…");
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: pdfText, course: matCourse, chapter: matChapter, count: 5 }),
      });
      const result = await res.json();
      if (result.error) throw new Error(result.error);
      setExtractResult(result);

      // Step 4: Save material to Supabase
      setExtractStep("保存教材到资料库…");
      const { data: matData, error: matErr } = await supabase.from("materials").insert({
        title: matTitle, course: matCourse, chapter: matChapter, description: matDesc,
        file_name: matFile.name, file_size: (matFile.size / 1024).toFixed(0) + " KB",
        file_data: fileData, uploader_name: "教师",
      }).select().single();
      if (matErr) throw new Error("保存资料失败: " + matErr.message);
      setUploadedMaterials(prev => [matData, ...prev]);

      // Step 5: Save questions to DB
      setExtractStep("保存题目到题库…");
      if (result.questions?.length > 0) {
        const qs = result.questions.map(q => ({
          chapter: matChapter || matCourse, course: matCourse,
          type: "单选题", question: q.question,
          options: q.options, answer: q.answer, explanation: q.explanation,
        }));
        await supabase.from("questions").insert(qs);
        const { data: newQs } = await supabase.from("questions").select("*").order("created_at", { ascending: false });
        if (newQs) setDbQuestions(newQs);
      }

      setMatSuccess(`上传成功！提取了 ${result.topics?.length || 0} 个知识点，生成了 ${result.questions?.length || 0} 道题目，已发布到资料库。`);
      setMatTitle(""); setMatChapter(""); setMatDesc(""); setMatFile(null);
    } catch (err) {
      setMatError("上传失败：" + err.message);
    }
    setExtracting(false); setExtractStep("");
  };

  const saveToDb = async (q) => {
    setSaving(true);
    const { error } = await supabase.from("questions").insert({
      chapter: aiChapter, course: aiChapter.includes("优化") ? "最优化" : "数值分析",
      type: aiType, question: q.question, options: q.options, answer: q.answer, explanation: q.explanation,
    });
    if (!error) {
      const { data } = await supabase.from("questions").select("*").order("created_at", { ascending: false });
      if (data) setDbQuestions(data);
      alert("已保存到题库！");
    }
    setSaving(false);
  };

  const deleteQuestion = async (id) => {
    await supabase.from("questions").delete().eq("id", id);
    setDbQuestions(prev => prev.filter(q => q.id !== id));
  };
  const seedQuestionBank = async () => {
    setSeeding(true);
    setSeedMsg("");
    try {
      const { data: existing } = await supabase.from("questions").select("question");
      const exists = new Set((existing || []).map(q => q.question));
      const rows = ALL_QUESTIONS
        .filter(q => !exists.has(q.question))
        .map((q) => ({
          chapter: q.chapter,
          course: q.chapter?.startsWith("最优化") ? "最优化" : "数值分析",
          type: q.type,
          question: q.question,
          options: q.options,
          answer: q.answer,
          explanation: q.explanation,
          difficulty: "基础",
          created_by: profile?.id || null,
        }));
      if (rows.length === 0) {
        setSeedMsg("当前数据库已包含基础题库，无需重复导入。");
      } else {
        const { error } = await supabase.from("questions").insert(rows);
        if (error) throw error;
        setSeedMsg(`导入完成：新增 ${rows.length} 道基础题目。`);
      }
      const { data } = await supabase.from("questions").select("*").order("created_at", { ascending: false });
      if (data) setDbQuestions(data);
    } catch (err) {
      setSeedMsg("导入失败：" + (err?.message || "未知错误"));
    }
    setSeeding(false);
  };
  const parseCsvLine = (line) => {
    const out = [];
    let cur = "";
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuote = !inQuote;
        }
      } else if (ch === "," && !inQuote) {
        out.push(cur.trim());
        cur = "";
      } else {
        cur += ch;
      }
    }
    out.push(cur.trim());
    return out;
  };
  const parseCsvText = (text) => {
    const lines = (text || "").replace(/\r/g, "").split("\n").filter(Boolean);
    if (lines.length < 2) return [];
    const headers = parseCsvLine(lines[0]).map(h => h.trim());
    return lines.slice(1).map((line) => {
      const cols = parseCsvLine(line);
      const row = {};
      headers.forEach((h, i) => { row[h] = cols[i] || ""; });
      return row;
    });
  };
  const normalizeOptions = (raw) => {
    const txt = String(raw || "").trim();
    if (!txt) return null;
    return txt.split("|").map(s => s.trim()).filter(Boolean);
  };
  const normalizeAnswer = (type, answer) => {
    const a = String(answer || "").trim().toUpperCase().replace(/\s+/g, "");
    if (type === "单选题") return a.replace("，", ",");
    if (type === "多选题") return a.replace("，", ",");
    return String(answer || "").trim();
  };
  const handleImportCsv = async (file) => {
    if (!file) return;
    setImportingCsv(true);
    setImportMsg("");
    try {
      const text = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(String(e.target?.result || ""));
        reader.onerror = () => reject(new Error("读取 CSV 失败"));
        reader.readAsText(file, "utf-8");
      });
      const rows = parseCsvText(text);
      if (rows.length === 0) throw new Error("CSV 没有可导入的数据行");
      const legalTypes = new Set(["单选题", "多选题", "填空题", "判断题", "计算题"]);
      const legalDifficulty = new Set(["基础", "进阶", "综合"]);
      const errors = [];
      const normalized = rows.map((r, idx) => {
        const lineNo = idx + 2;
        const chapter = (r.chapter || "").trim();
        const course = (r.course || "").trim() || (chapter.startsWith("最优化") ? "最优化" : "数值分析");
        const type = (r.type || "").trim();
        const question = (r.question || "").trim();
        const options = normalizeOptions(r.options);
        const answer = normalizeAnswer(type, r.answer);
        const explanation = (r.explanation || "").trim() || null;
        const difficulty = legalDifficulty.has((r.difficulty || "").trim()) ? (r.difficulty || "").trim() : "基础";
        if (!chapter || !type || !question || !answer) errors.push(`第 ${lineNo} 行缺少必填字段`);
        if (type && !legalTypes.has(type)) errors.push(`第 ${lineNo} 行题型非法：${type}`);
        if ((type === "单选题" || type === "多选题") && (!options || options.length < 2)) {
          errors.push(`第 ${lineNo} 行选项不足（用 | 分隔，如 A.xxx|B.xxx）`);
        }
        if (type === "判断题" && !["正确", "错误"].includes(answer)) {
          errors.push(`第 ${lineNo} 行判断题答案必须为“正确/错误”`);
        }
        if (type === "单选题" && !/^[A-D]$/.test(answer)) {
          errors.push(`第 ${lineNo} 行单选题答案格式应为 A/B/C/D`);
        }
        if (type === "多选题" && !/^[A-D](,[A-D])*$/.test(answer)) {
          errors.push(`第 ${lineNo} 行多选题答案格式应为 A,C 或 A,B,D`);
        }
        return { chapter, course, type, question, options, answer, explanation, difficulty, created_by: profile?.id || null };
      });
      if (errors.length > 0) throw new Error(errors.slice(0, 8).join("；"));
      const { data: existing } = await supabase.from("questions").select("question");
      const exists = new Set((existing || []).map(q => q.question));
      const toInsert = normalized.filter(r => !exists.has(r.question));
      if (toInsert.length === 0) {
        setImportMsg("CSV 校验通过，但题目已全部存在（按题干去重）。");
      } else {
        const { error } = await supabase.from("questions").insert(toInsert);
        if (error) throw error;
        setImportMsg(`CSV 导入完成：新增 ${toInsert.length} 题（原始 ${rows.length} 行）。`);
      }
      const { data } = await supabase.from("questions").select("*").order("created_at", { ascending: false });
      if (data) setDbQuestions(data);
    } catch (err) {
      setImportMsg("CSV 导入失败：" + (err?.message || "未知错误"));
    }
    setImportingCsv(false);
  };

  const STUDENTS = [
    { name: "张同学", email: "zhang@example.com", pct: 82, questions: 48, weak: ["Ch.3 插值", "Ch.4 最小二乘"], strong: ["Ch.1 方程求解", "Ch.2 线性方程组"] },
    { name: "李同学", email: "li@example.com", pct: 65, questions: 32, weak: ["Ch.5 数值微积分", "最优化 Ch.1"], strong: ["Ch.1 方程求解"] },
    { name: "王同学", email: "wang@example.com", pct: 91, questions: 60, weak: [], strong: ["Ch.1", "Ch.2", "Ch.3"] },
    { name: "陈同学", email: "chen@example.com", pct: 43, questions: 20, weak: ["Ch.2 线性方程组", "Ch.3 插值", "最优化 Ch.1"], strong: [] },
    { name: "刘同学", email: "liu@example.com", pct: 77, questions: 41, weak: ["Ch.4 最小二乘"], strong: ["Ch.1", "Ch.2"] },
  ];

  const sel = { width: "100%", fontSize: 14, padding: "11px 12px", border: "1.5px solid #e0e0e0", borderRadius: 10, fontFamily: "inherit", background: "#fff", color: "#111" };

  return (
    <div style={{ padding: "2rem", maxWidth: 1020, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 24 }}>
        <Btn size="sm" onClick={() => setPage("首页")}>← 返回</Btn>
        <div style={{ fontSize: 22, fontWeight: 700, color: "#111" }}>教师管理</div>
      </div>

      <div style={{ display: "flex", gap: 0, borderBottom: "2px solid #f0f0f0", marginBottom: 20 }}>
        {["学生管理", "AI 出题", "题库管理", "审核资料", "学情分析"].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: "12px 22px", fontSize: 15, fontFamily: "inherit", border: "none", borderBottom: tab === t ? `3px solid ${G.teal}` : "3px solid transparent", background: "none", cursor: "pointer", color: tab === t ? G.teal : "#888", fontWeight: tab === t ? 700 : 400, marginBottom: -2 }}>{t}</button>
        ))}
      </div>

      {tab === "学生管理" && (
        <>
          <div style={{ ...s.card, marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "1.25rem 1.75rem" }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>班级邀请码</div>
              <div style={{ fontSize: 14, color: "#888" }}>学生注册时输入此邀请码加入班级</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: G.teal, letterSpacing: "0.2em", background: G.tealLight, padding: "10px 24px", borderRadius: 12 }}>MATH2024</div>
              <Btn size="sm" onClick={() => { navigator.clipboard.writeText("MATH2024"); alert("邀请码已复制！"); }}>复制</Btn>
            </div>
          </div>

          {selectedStudent ? (
            <div style={{ ...s.card }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20, paddingBottom: 16, borderBottom: "1px solid #f0f0f0" }}>
                <Btn size="sm" onClick={() => setSelectedStudent(null)}>← 返回</Btn>
                <div style={{ width: 44, height: 44, borderRadius: "50%", background: G.teal, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 700, color: "#fff" }}>{selectedStudent.name[0]}</div>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>{selectedStudent.name}</div>
                  <div style={{ fontSize: 14, color: "#888" }}>{selectedStudent.email}</div>
                </div>
                <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
                  <Badge color={selectedStudent.pct >= 80 ? "teal" : selectedStudent.pct >= 60 ? "amber" : "red"}>正确率 {selectedStudent.pct}%</Badge>
                  <Badge color="blue">答题 {selectedStudent.questions} 题</Badge>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 14 }}>⚠️ 薄弱章节</div>
                  {selectedStudent.weak.length === 0
                    ? <div style={{ fontSize: 15, color: "#888" }}>暂无明显薄弱点 🎉</div>
                    : selectedStudent.weak.map((w, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0", borderBottom: "1px solid #f5f5f5" }}>
                        <span style={{ fontSize: 15 }}>{w}</span>
                        <div style={{ display: "flex", gap: 8 }}>
                          <Btn size="sm" onClick={() => generateQuestions(w)}>AI 出针对题</Btn>
                          <Btn size="sm" variant="primary" onClick={() => { setHwAssigned(prev => ({ ...prev, [selectedStudent.name]: [...(prev[selectedStudent.name] || []), w] })); alert(`已向 ${selectedStudent.name} 布置 ${w} 专项作业！`); }}>布置作业</Btn>
                        </div>
                      </div>
                    ))
                  }
                </div>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 14 }}>✅ 擅长章节</div>
                  {selectedStudent.strong.length === 0
                    ? <div style={{ fontSize: 15, color: "#888" }}>暂无数据</div>
                    : selectedStudent.strong.map((str, i) => (
                      <div key={i} style={{ padding: "12px 0", borderBottom: "1px solid #f5f5f5", display: "flex", justifyContent: "space-between" }}>
                        <span style={{ fontSize: 15 }}>{str}</span>
                        <Badge color="teal">掌握良好</Badge>
                      </div>
                    ))
                  }
                  {hwAssigned[selectedStudent.name]?.length > 0 && (
                    <div style={{ marginTop: 16 }}>
                      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>📋 已布置作业</div>
                      {hwAssigned[selectedStudent.name].map((hw, i) => <div key={i} style={{ fontSize: 14, color: "#666", padding: "4px 0" }}>· {hw}</div>)}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div style={{ ...s.card }}>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 18, paddingBottom: 14, borderBottom: "1px solid #f0f0f0", display: "flex", justifyContent: "space-between" }}>
                <span>班级学生 <span style={{ fontSize: 14, color: "#aaa", fontWeight: 400 }}>共 {STUDENTS.length} 人</span></span>
                <Badge color="blue">点击查看详情</Badge>
              </div>
              {STUDENTS.map((st, i) => {
                const col = st.pct >= 80 ? G.teal : st.pct >= 60 ? G.amber : G.red;
                return (
                  <div key={i} onClick={() => setSelectedStudent(st)} style={{ display: "flex", alignItems: "center", gap: 16, padding: "16px 0", borderBottom: i < STUDENTS.length - 1 ? "1px solid #f5f5f5" : "none", cursor: "pointer" }}>
                    <div style={{ width: 42, height: 42, borderRadius: "50%", background: G.tealLight, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 700, color: G.teal, flexShrink: 0 }}>{st.name[0]}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>{st.name}</div>
                      <ProgressBar value={st.pct} color={col} height={6} />
                    </div>
                    <div style={{ textAlign: "right", minWidth: 90 }}>
                      <div style={{ fontSize: 18, fontWeight: 700, color: col }}>{st.pct}%</div>
                      <div style={{ fontSize: 12, color: "#aaa" }}>{st.questions} 题</div>
                    </div>
                    {st.weak.length > 0 && <Badge color="red">{st.weak.length} 个薄弱点</Badge>}
                    {st.pct >= 80 && <Badge color="teal">优秀</Badge>}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {tab === "AI 出题" && (
        <div style={{ ...s.card }}>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>AI 智能出题</div>
          <div style={{ fontSize: 15, color: "#888", marginBottom: 20 }}>基于教材内容自动生成题目并保存到题库</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 100px 110px", gap: 12, marginBottom: 20, alignItems: "end" }}>
            {[
              { label: "章节", value: aiChapter, onChange: setAiChapter, options: ["Ch.1 · 方程求解", "Ch.2 · 线性方程组", "Ch.3 · 插值", "Ch.4 · 最小二乘", "Ch.5 · 数值微积分", "Ch.6 · 常微分方程", "最优化 Ch.1 · 优化模型"] },
              { label: "题型", value: aiType, onChange: setAiType, options: ["单选题", "多选题", "填空题", "判断题"] },
              { label: "数量", value: aiCount, onChange: setAiCount, options: ["1", "3", "5"] },
            ].map(f => (
              <div key={f.label}>
                <div style={{ fontSize: 13, color: "#666", marginBottom: 6, fontWeight: 500 }}>{f.label}</div>
                <select value={f.value} onChange={e => f.onChange(e.target.value)} style={sel}>{f.options.map(o => <option key={o}>{o}</option>)}</select>
              </div>
            ))}
            <button disabled={aiLoading} onClick={() => generateQuestions()} style={{ padding: "11px 0", fontSize: 15, fontWeight: 700, fontFamily: "inherit", background: aiLoading ? "#9FE1CB" : G.teal, color: "#fff", border: "none", borderRadius: 10, cursor: aiLoading ? "not-allowed" : "pointer" }}>{aiLoading ? "生成中…" : "✨ 生成"}</button>
          </div>
          {aiError && <div style={{ padding: "12px 16px", background: G.redLight, color: G.red, borderRadius: 10, fontSize: 14, marginBottom: 16 }}>{aiError}</div>}
          {aiLoading && <div style={{ textAlign: "center", padding: "3rem", color: "#888", fontSize: 16, background: "#fafafa", borderRadius: 12 }}>⏳ AI 正在生成题目…</div>}
          {aiQuestions.map((q, i) => (
            <div key={i} style={{ border: "1.5px solid #eee", borderRadius: 14, padding: "1.5rem", marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                <div style={{ display: "flex", gap: 8 }}><Badge color="blue">{aiType}</Badge><Badge color="amber">{aiChapter}</Badge></div>
                <Btn size="sm" variant="primary" onClick={() => saveToDb(q)} disabled={saving}>+ 保存到题库</Btn>
              </div>
              <div style={{ fontSize: 15, marginBottom: 14, lineHeight: 1.7 }}>{q.question}</div>
              {q.options && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
                  {q.options.map((opt, j) => (
                    <div key={j} style={{ fontSize: 14, padding: "9px 12px", background: opt.startsWith(q.answer) ? G.tealLight : "#f5f5f5", borderRadius: 8, color: opt.startsWith(q.answer) ? G.tealDark : "#666", fontWeight: opt.startsWith(q.answer) ? 600 : 400 }}>{opt}</div>
                  ))}
                </div>
              )}
              <div style={{ fontSize: 14, color: "#666", background: "#f9f9f9", padding: "10px 14px", borderRadius: 8 }}>
                <strong>答案：</strong>{q.answer}　·　<strong>解析：</strong>{q.explanation}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "题库管理" && (
        <div style={{ ...s.card }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 18, paddingBottom: 14, borderBottom: "1px solid #f0f0f0" }}>
            <div style={{ fontSize: 18, fontWeight: 700 }}>题库管理</div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <Badge color="blue">共 {dbQuestions.length} 题</Badge>
              <input ref={csvRef} type="file" accept=".csv,text/csv" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImportCsv(f); e.target.value = ""; }} />
              <Btn size="sm" onClick={() => csvRef.current?.click()} disabled={importingCsv}>{importingCsv ? "导入中…" : "CSV 批量导入"}</Btn>
              <Btn size="sm" variant="primary" onClick={seedQuestionBank} disabled={seeding}>{seeding ? "导入中…" : "一键导入基础题库"}</Btn>
            </div>
          </div>
          {seedMsg && <div style={{ padding: "10px 12px", borderRadius: 10, background: G.tealLight, color: G.tealDark, marginBottom: 12, fontSize: 14 }}>{seedMsg}</div>}
          {importMsg && <div style={{ padding: "10px 12px", borderRadius: 10, background: G.blueLight, color: G.blue, marginBottom: 12, fontSize: 14 }}>{importMsg}</div>}
          <div style={{ fontSize: 12, color: "#888", marginBottom: 12 }}>
            CSV 表头格式：chapter,course,type,question,options,answer,explanation,difficulty。<br />
            其中 options 用 | 分隔（示例：A.选项1|B.选项2|C.选项3|D.选项4）。
          </div>
          {dbQuestions.length === 0 && <div style={{ textAlign: "center", padding: "3rem", color: "#aaa", fontSize: 16 }}>📝 暂无题目，请先用 AI 出题</div>}
          {dbQuestions.map((q, i) => (
            <div key={i} style={{ borderBottom: "1px solid #f5f5f5" }}>
              <div onClick={() => setPreviewQuestion(previewQuestion?.id === q.id ? null : q)} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 0", cursor: "pointer" }}>
                <Badge color="amber">{q.chapter}</Badge>
                <div style={{ flex: 1, fontSize: 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{q.question}</div>
                <Badge color="blue">{q.type}</Badge>
                <Btn size="sm" onClick={(e) => { e.stopPropagation(); setPreviewQuestion(previewQuestion?.id === q.id ? null : q); }}>{previewQuestion?.id === q.id ? "收起" : "查看"}</Btn>
                <Btn size="sm" onClick={(e) => { e.stopPropagation(); deleteQuestion(q.id); if (previewQuestion?.id === q.id) setPreviewQuestion(null); }}>删除</Btn>
              </div>
              {previewQuestion?.id === q.id && (
                <div style={{ border: "1px solid #e8f2ee", background: "#f8fffb", borderRadius: 12, padding: "14px 16px", marginBottom: 14 }}>
                  <div style={{ fontSize: 15, color: "#111", lineHeight: 1.7, marginBottom: 10 }}>{q.question}</div>
                  {q.options && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
                      {(typeof q.options === "string" ? JSON.parse(q.options) : q.options).map((opt, idx) => (
                        <div key={idx} style={{ fontSize: 13, padding: "8px 10px", background: "#fff", border: "1px solid #eee", borderRadius: 8, color: "#444" }}>{opt}</div>
                      ))}
                    </div>
                  )}
                  <div style={{ fontSize: 13, color: "#555" }}>
                    <strong>答案：</strong>{q.answer}
                    {q.explanation ? <>　·　<strong>解析：</strong>{q.explanation}</> : null}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {tab === "审核资料" && (
        <div style={{ ...s.card }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 18, paddingBottom: 14, borderBottom: "1px solid #f0f0f0" }}>
            <div style={{ fontSize: 18, fontWeight: 700 }}>资料审核</div>
            <Badge color="amber">待审核 {pendingMaterials.length}</Badge>
          </div>
          {reviewMsg && <div style={{ padding: "10px 12px", borderRadius: 10, background: G.blueLight, color: G.blue, marginBottom: 12, fontSize: 14 }}>{reviewMsg}</div>}
          {pendingMaterials.length === 0 && <div style={{ textAlign: "center", padding: "2.5rem", color: "#999" }}>暂无待审核资料</div>}
          {pendingMaterials.map((m) => (
            <div key={m.id} style={{ border: "1px solid #eee", borderRadius: 12, padding: "14px 16px", marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "#111" }}>{m.title}</div>
                  <div style={{ fontSize: 12, color: "#999", marginTop: 4 }}>{m.uploader_name || "用户"} · {new Date(m.created_at).toLocaleString("zh-CN")}</div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                  <Btn size="sm" onClick={() => reviewMaterial(m, "rejected")} disabled={reviewBusyId === m.id}>驳回</Btn>
                  <Btn size="sm" variant="primary" onClick={() => reviewMaterial(m, "approved")} disabled={reviewBusyId === m.id}>{reviewBusyId === m.id ? "处理中…" : "通过发布"}</Btn>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <Badge color="blue">{m.course || "未知课程"}</Badge>
                {m.chapter && <Badge color="amber">{m.chapter}</Badge>}
                <Badge color="red">待审核</Badge>
              </div>
              {m.description && <div style={{ fontSize: 14, color: "#666", lineHeight: 1.6 }}>{m.description}</div>}
            </div>
          ))}
        </div>
      )}
      {tab === "学情分析" && (
        <div style={{ ...s.card }}>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>班级学情分析</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 16 }}>
            <StatCard icon="👥" label="学生人数" value={analytics.students} color={G.blue} />
            <StatCard icon="📝" label="答题记录" value={analytics.answers} color={G.teal} />
            <StatCard icon="🎯" label="整体正确率" value={analytics.accuracy + "%"} color={analytics.accuracy >= 75 ? G.teal : G.red} />
            <StatCard icon="🧠" label="知识点掌握" value={(analytics.mastery[0]?.value || 0) + "%"} color={G.purple} />
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>薄弱章节 Top</div>
          {analytics.weak.length === 0 && <div style={{ color: "#888", fontSize: 14 }}>暂无足够数据，请先让学生完成练习。</div>}
          {analytics.weak.map((w) => (
            <div key={w.chapter} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #f3f3f3" }}>
              <div style={{ fontSize: 14 }}>{w.chapter}</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <Badge color={w.pct >= 75 ? "teal" : w.pct >= 60 ? "amber" : "red"}>{w.pct}%</Badge>
                <span style={{ fontSize: 12, color: "#999" }}>{w.total} 次作答</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Root App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [page, setPage] = useState("首页");
  const [loading, setLoading] = useState(true);
  const [retryQuestion, setRetryQuestion] = useState(null);
  const [chapterFilter, setChapterFilter] = useState(null);
  const [sessionAnswers, setSessionAnswers] = useState({});
  const recordAnswer = async (qid, correct, chapter, questionPayload = null) => {
    try {
      const updated = { ...sessionAnswers, [qid]: { correct, chapter } };
      setSessionAnswers(updated);
    } catch (e) {}
    try {
      if (!session?.user?.id) return;
      await supabase.from("answers").insert({
        user_id: session.user.id,
        question_id: String(qid).length > 30 ? null : qid,
        is_correct: !!correct,
        user_answer: null,
      });
      if (!correct && questionPayload?.question) {
        await supabase.from("questions") /* wrong_drill_logs stub */.insert({
          user_id: session.user.id,
          question_id: String(qid).length > 30 ? null : qid,
          chapter: chapter || null,
          question: questionPayload.question,
          correct_answer: questionPayload.answer || null,
          explanation: questionPayload.explanation || null,
        });
      }
    } catch (e) {}
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) loadProfile(session.user.id);
      else setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) loadProfile(session.user.id);
      else { setProfile(null); setLoading(false); }
    });
    return () => subscription.unsubscribe();
  }, []);

  const loadProfile = async (userId) => {
    const { data } = await supabase.from("profiles").select("*").eq("id", userId).single();
    setProfile(data);
    setLoading(false);
  };

  const handleLogout = async () => { await supabase.auth.signOut(); setPage("首页"); };

  const handleSetPage = (p) => {
    if (p !== "题库练习") { setRetryQuestion(null); setChapterFilter(null); }
    setPage(p);
  };

  if (loading) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, #f0fdf8, #e8f4ff)" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ width: 48, height: 48, borderRadius: 14, background: G.teal, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, margin: "0 auto 14px" }}>📐</div>
        <div style={{ fontSize: 15, color: "#888" }}>加载中…</div>
      </div>
    </div>
  );

  if (!session) return <AuthPage />;

  const renderPage = () => {
    if (page === "首页") return <HomePage setPage={handleSetPage} profile={profile} />;
    if (page === "资料库") return <MaterialsPage setPage={handleSetPage} profile={profile} />;
    if (page === "上传资料") return <UploadPage setPage={handleSetPage} profile={profile} />;
    if (page === "资料对话") return <MaterialChatPage setPage={handleSetPage} profile={profile} />;
    if (page === "知识点") return <KnowledgePage setPage={handleSetPage} setChapterFilter={setChapterFilter} sessionAnswers={sessionAnswers} />;
    if (page === "题库练习" || page.startsWith("quiz_material_")) {
      let matId = null, matTitle = null;
      if (page.startsWith("quiz_material_")) {
        const parts = page.replace("quiz_material_", "").split("_");
        matId = parts[0];
        matTitle = decodeURIComponent(parts.slice(1).join("_"));
      }
      return <QuizPage setPage={handleSetPage} initialQuestion={retryQuestion} chapterFilter={chapterFilter} setChapterFilter={setChapterFilter} materialId={matId} materialTitle={matTitle} onAnswer={(qid, correct, chapter, payload) => { recordAnswer(qid, correct, chapter, payload); }} />;
    }
    if (page === "记忆卡片") return <FlashcardPage setPage={handleSetPage} />;
    if (page === "学习报告") return <ReportPage setPage={handleSetPage} />;
    if (page === "错题本") return <WrongPage setPage={handleSetPage} sessionAnswers={sessionAnswers} />;
    if (page === "教师管理") return <TeacherPage setPage={handleSetPage} profile={profile} />;
    return null;
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f8f9fb" }}>
      <TopNav page={page} setPage={handleSetPage} profile={profile} onLogout={handleLogout} />
      {renderPage()}
    </div>
  );
}