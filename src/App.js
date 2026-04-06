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

const extractPdfText = async (file) => {
  if (!file) return "";
  try {
    await ensurePdfJs();
    const buf = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
    let text = "";
    const pages = Math.min(pdf.numPages, 50);
    for (let i = 1; i <= pages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      let line = "", lastY = null;
      for (const item of (content.items || [])) {
        const s = item.str || "";
        if (!s) continue;
        const y = item.transform ? item.transform[5] : 0;
        if (lastY !== null && Math.abs(y - lastY) > 4) { text += line.trim() + "\n"; line = ""; }
        if (line && !/\s$/.test(line)) line += " ";
        line += s;
        lastY = y;
      }
      if (line.trim()) text += line.trim() + "\n";
    }
    return text.trim();
  } catch (e) { return ""; }
};

const buildFallbackQuestionsFromText = (text, chapter, count = 5) => {
  const sents = text.replace(/\s+/g, " ").split(/[。.!！?？\n]/).map(s => s.trim()).filter(s => s.length > 15 && s.length < 200);
  const qs = [];
  for (let i = 0; i < sents.length && qs.length < count; i++) {
    const sent = sents[i];
    if (i % 2 === 0) {
      qs.push({ question: `以下说法是否正确：「${sent.slice(0, 60)}」`, options: null, answer: "正确", explanation: sent.slice(0, 100), type: "判断题", chapter });
    } else {
      const key = sent.split(/[，,\s]+/).filter(w => w.length > 1)[0] || "该知识点";
      qs.push({ question: `关于「${key}」，以下哪个描述最准确？`, options: ["A." + sent.slice(0, 35), "B.与原文相反", "C.教材未提及", "D.以上都不对"], answer: "A", explanation: sent.slice(0, 100), type: "单选题", chapter });
    }
  }
  return qs.slice(0, count);
};

const processMaterialWithAI = async ({ material, file, genCount = 5 }) => {
  const materialId = material?.id;
  if (!materialId) return { topics: [], questions: [], insertedCount: 0 };
  const chapter = (material?.chapter && material.chapter !== "全部") ? material.chapter : material?.course || material?.title || "本资料";

  let text = "";
  if (file) text = await extractPdfText(file);
  if (!text && material?.file_data) {
    try {
      const res = await fetch(material.file_data);
      if (res.ok) {
        const blob = await res.blob();
        text = await extractPdfText(new File([blob], material.file_name || "m.pdf", { type: "application/pdf" }));
      }
    } catch (e) {}
  }

  const hasText = text.trim().length > 50;
  let topics = [], questions = [], usedApi = false;

  if (hasText) {
    try {
      const res = await fetch("/api/extract", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.slice(0, 8000), course: material?.course || "数学", chapter, count: genCount }),
      });
      const data = await res.json();
      if (!data.error) { topics = data.topics || []; questions = data.questions || []; usedApi = true; }
    } catch (e) {}
  }

  if (questions.length === 0 && hasText) questions = buildFallbackQuestionsFromText(text, chapter, genCount);
  if (questions.length === 0) questions = [{ question: `关于「${chapter}」，先理解定义再做题通常更有效。`, options: null, answer: "正确", explanation: "先掌握概念与适用条件，可减少机械套题错误。", type: "判断题", chapter }];

  let insertedCount = 0;
  try {
    const rows = questions.map(q => ({ chapter: q.chapter || chapter, course: material?.course || "数学", type: q.type || (q.options ? "单选题" : "判断题"), question: q.question, options: q.options || null, answer: q.answer, explanation: q.explanation || "", material_id: materialId }));
    const { error: e1 } = await supabase.from("questions").insert(rows);
    if (!e1) { insertedCount = rows.length; }
    else {
      const rows2 = rows.map(({ material_id, ...r }) => r);
      const { error: e2 } = await supabase.from("questions").insert(rows2);
      if (!e2) insertedCount = rows2.length;
    }
  } catch (e) {}

  return { topics, questions, insertedCount, hasText, usedApi, pdfLikelyScanned: !hasText, parseHint: !hasText ? "未能从 PDF 提取文字（可能是扫描版），已使用基础题目。" : null };
};


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
        genCount: 8,
      });
      const inserted = result?.insertedCount ?? result?.questions?.length ?? 0;
      const hint = (!fetchedFile && [".doc", ".docx", ".ppt", ".pptx"].includes(getFileExt(material?.file_name || "")))
        ? "（当前建议优先上传 PDF，DOCX/PPTX 容易提取失败）"
        : "";
      const scanHint = result?.parseHint ? ` ${result.parseHint}` : "";
      setMaterialGenerateMsg(inserted > 0 ? `已为该资料补充 ${inserted} 道题。${scanHint}` : `补题完成，但未新增题目。${hint}${scanHint}`);
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
                        genCount: 6,          });
          const linkedHint = result.materialLinked ? "" : "（当前数据库缺少 questions.material_id，题目已入库但未绑定资料；请执行 SQL 补齐后可按资料精准练习）";
          const scanHint = result.parseHint ? ` ${result.parseHint}` : "";
          setSuccess(`上传成功！已提取 ${result.topics.length} 个知识点，入库 ${result.insertedCount ?? result.questions.length} 道题目。${linkedHint}${scanHint}`);
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
      if (data?.error) throw new Error(data.error);
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
        const { data } = await supabase.from("questions").select("chunk_text,chunk_index").eq("material_id", materialId).order("chunk_index", { ascending: true }).limit(20);
        chunks = data || [];
      } catch (e) {}
      // AI Q&A: use /api/generate as fallback since material-chat doesn't exist
      let data = { answer: null };
      try {
        const chatRes = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chapter: selected?.chapter || selected?.course || "本资料",
            type: "单选题",
            count: 1,
            question: askText,
          }),
        });
        const chatData = await chatRes.json();
        if (!chatData?.error) {
          data = { answer: `关于「${askText}」：根据资料《${selected?.title || "本资料"}》，${chatData?.questions?.[0]?.explanation || "建议结合教材内容理解该知识点。"}` };
        }
      } catch (e) {}
      if (!data?.answer) data = { answer: `关于「${askText}」的问题，请参考资料《${selected?.title || "本资料"}》中的相关章节。如需 AI 详细解答，请确保 API Key 已配置并有余额。` };
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
      supabase.from("topic_mastery").select("status"),
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
            genCount: 6,          });
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
            genCount: 6,          });
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
        await supabase.from("wrong_drill_logs").insert({
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