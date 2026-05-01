/* eslint-disable no-console */
// ──────────────────────────────────────────────────────────────────────────
// scripts/upload-textbook.js
// 一键把一本 PDF 教材上传到生产 Supabase + 跑 Groq 细化抽取（refine=true）
//   1) PDF → Storage：materials/<teacher_uid>/<timestamp>_<file>.pdf
//   2) materials 表：status=approved，is_public=true
//   3) pdfjs-dist 抽页 + 表头脚注去重
//   4) 切 6 块，每块调 Groq llama-3.3-70b 出题 + 抽知识点
//   5) 入库 questions / material_topics（带 generated_by/ai_model）
// 用法：node scripts/upload-textbook.js
// 依赖：.env.local 里有 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / GROQ_KEY
// ──────────────────────────────────────────────────────────────────────────

const fs = require("fs");
const path = require("path");

(function loadDotEnv() {
  const p = path.resolve(__dirname, "..", ".env.local");
  if (!fs.existsSync(p)) return;
  const txt = fs.readFileSync(p, "utf8");
  for (const l of txt.split(/\r?\n/)) {
    const m = l.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
})();

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GROQ_KEY = process.env.GROQ_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ 缺少 SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY，请先在 .env.local 里配置。");
  process.exit(1);
}
if (!GROQ_KEY) {
  console.error("❌ 缺少 GROQ_KEY。");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// 默认上传：根目录的 Leon 9th
const DEFAULT_PDF = "打开\u201CLinear Algebra with Applications (Steven J_ Leon) 9th\u201D.pdf";

// 解析命令行参数；
//   --reuse <materialId>  跳过 PDF 上传，给已有 material 补 AI 数据
//   --clean               补题前先清掉该 material 的 questions + material_topics
//   --from-cache          跳过 AI 抽取，直接从 scripts/.cache/<materialId>.json 读结果重试入库
const args = process.argv.slice(2);
const reuseIdx = args.indexOf("--reuse");
const REUSE_MATERIAL_ID = reuseIdx >= 0 ? args[reuseIdx + 1] : null;
const CLEAN = args.includes("--clean");
const FROM_CACHE = args.includes("--from-cache");
const flagIndices = new Set([reuseIdx, reuseIdx + 1, args.indexOf("--clean"), args.indexOf("--from-cache")]);
const positional = args.filter((a, i) => !flagIndices.has(i) && !a.startsWith("--"));

const PDF_PATH = path.resolve(__dirname, "..", positional[0] || DEFAULT_PDF);
const TITLE_OVERRIDE = positional[1] || "Linear Algebra with Applications (Leon, 9th)";
const COURSE = positional[2] || "线性代数";
const CHAPTER = "全书细化";

if (!fs.existsSync(PDF_PATH)) {
  console.error(`❌ 找不到 PDF：${PDF_PATH}`);
  console.error("用法：node scripts/upload-textbook.js [pdf路径] [标题] [课程]");
  process.exit(1);
}

// ── 1) 解析 PDF ──────────────────────────────────────────────────────────
async function extractPdfText(pdfPath) {
  // pdfjs-dist 5.x 全是 ESM；CJS 里只能走 dynamic import
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true, isEvalSupported: false }).promise;
  const total = doc.numPages;
  console.log(`[pdf] 总页数：${total}`);

  // 跨章节均匀采样（跳过封面/目录前 3 页），最多采 80 页
  const startPage = Math.min(4, total);
  const pickCount = Math.min(80, Math.max(20, total - startPage + 1));
  const stride = Math.max(1, Math.floor((total - startPage + 1) / pickCount));
  const sampled = [];
  for (let i = startPage; i <= total && sampled.length < pickCount; i += stride) sampled.push(i);
  console.log(`[pdf] 采样策略：起始页 ${startPage}，stride=${stride}，实际取 ${sampled.length} 页`);

  const rawPageTexts = [];
  for (let idx = 0; idx < sampled.length; idx++) {
    const i = sampled[idx];
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const items = (content.items || [])
      .filter((it) => it.str && it.str.trim())
      .sort((a, b) => {
        const yDiff = (b.transform?.[5] || 0) - (a.transform?.[5] || 0);
        if (Math.abs(yDiff) > 5) return yDiff;
        return (a.transform?.[4] || 0) - (b.transform?.[4] || 0);
      });
    let pageText = "";
    let lastY = null;
    for (const it of items) {
      const y = it.transform?.[5] || 0;
      if (lastY !== null && Math.abs(y - lastY) > 8) pageText += "\n";
      else if (pageText && !pageText.endsWith(" ")) pageText += " ";
      pageText += it.str;
      lastY = y;
    }
    if (pageText.trim()) rawPageTexts.push(pageText.trim());
    if ((idx + 1) % 10 === 0) process.stdout.write(`  · 已抽 ${idx + 1}/${sampled.length} 页\r`);
  }
  console.log(`\n[pdf] 抽到 ${rawPageTexts.length} 页有效文字`);

  // 检测出现 ≥30% 页面的"重复行" → 视为 running header / footer 去掉
  const lineFreq = {};
  rawPageTexts.forEach((pt) => {
    const lines = pt.split("\n");
    [lines[0], lines[lines.length - 1]].forEach((l) => {
      const t = (l || "").trim();
      if (t.length > 0 && t.length < 80) lineFreq[t] = (lineFreq[t] || 0) + 1;
    });
  });
  const threshold = Math.max(2, Math.floor(rawPageTexts.length * 0.3));
  const headerSet = new Set(
    Object.entries(lineFreq).filter(([, c]) => c >= threshold).map(([l]) => l)
  );

  const cleaned = rawPageTexts
    .map((pt) =>
      pt
        .split("\n")
        .filter((l) => !headerSet.has(l.trim()))
        .join("\n")
    )
    .filter((pt) => pt.trim().length > 0);

  let text = cleaned.join("\n\n");
  text = text.replace(/([a-zA-Z])-\n([a-zA-Z])/g, "$1$2");
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, " ");
  return text.trim();
}

// ── 2) 切块 ─────────────────────────────────────────────────────────────
function buildChunks(text, target = 3500, overlap = 250, maxChunks = 6) {
  const chunks = [];
  if (text.length <= target) return [text];
  let pos = 0;
  while (pos < text.length && chunks.length < maxChunks) {
    let end = Math.min(pos + target, text.length);
    if (end < text.length) {
      const win = text.slice(pos, end);
      const lastBreak = Math.max(win.lastIndexOf("\n\n"), win.lastIndexOf(". "), win.lastIndexOf("。"));
      if (lastBreak > target * 0.6) end = pos + lastBreak;
    }
    chunks.push(text.slice(pos, end));
    if (end === text.length) break;
    pos = end - overlap;
  }
  return chunks;
}

// ── 3) Groq 调用 ─────────────────────────────────────────────────────────
async function callGroqExtract({ chunkText, course, chapter, count, chunkIndex, chunkCount }) {
  const PROMPT_OPENER = `You are a math professor running on Groq (Llama-3.3 70B). Output language: Chinese only.
[Groq-specific] BE STRICT: Output one valid JSON object. No explanations. No markdown fences. No prose before/after.`;

  const prompt = `${PROMPT_OPENER}

【重要警告】以下文本由 PDF 自动提取，数学符号可能存在乱码：
- "x 2" 实为 x²，"d t 2" 实为 d²/dt²，"x n" 实为 xₙ
- "d y / d x" 实为 dy/dx，字母间多余空格是乱码
- 所有数学公式必须还原为正确标准符号，绝对不能照抄乱码原文

【细化模式 REFINE】本次目标是把粗粒度知识点拆得更细，多抽 50%~80%。
- 把宏观技法继续拆成可独立练习的子步骤（如"高斯消元" → "前向消元 / 部分主元 / 回代"）
- 把定理拆成 "定理陈述" / "成立条件" / "反例" / "推论" 四类卡片
- 出题数量比常规多 50%，覆盖至少 4 种题型。

【分块信息】本次只看到整本教材中的第 ${chunkIndex + 1} / ${chunkCount} 片段。
- 不要凭这一小段推测全书结构；只基于本片段里明确出现的定义 / 定理 / 公式出题。
- 若片段讨论到"后文会证明"、"参见第 N 章"这类指代，请忽略。

=== 教材原文（英文教材，输出用中文）===
${chunkText.slice(0, 8000)}
=== 原文结束 ===

课程：${course} | 章节：${chapter}

【任务一】提取 8~14 个核心知识点，每个 topic 必须是 JSON 对象：
  - "name"：知识点名称（中文，4~14 字）
  - "summary"：一句话说明（中文，20~80 字）
  - "kind"：从下列固定取值挑一个：definition / theorem / method / formula / example / pitfall
  - "depth"：1=基础概念 / 2=方法技法 / 3=综合应用
  - "prerequisites"：array of string，列出本知识点依赖的其他 topic 的 name；无依赖时给 []
  - "definition_anchor"：原文里能锚定本知识点的一句话（≤80 字，可清洗乱码），无显式定义给 ""

【任务二】生成恰好 ${count} 道中文习题，要求：
- 每道题必须基于原文的具体定义、定理、公式或方法
- 所有数学公式用标准符号（如 dy/dx、∫、∑、Ax=b、det(A) 等）
- 题型必须混合 4 类，每类至少 1 道：单选题 / 判断题 / 填空题 / 简答题
  · 单选题：恰好 4 个选项 A/B/C/D
  · 判断题：options 为 null，answer 为 "正确" 或 "错误"
  · 填空题：options 为 null，answer 是简短数学表达式，question 用 ___ 标空位
  · 简答题：options 为 null，answer 是 1~3 句完整推理 + 关键中间式
- 难度分配：30% easy / 50% medium / 20% hard
- 每道题需带 "difficulty"（easy / medium / hard）+ "knowledge_points"（array of string，对应任务一的 name）
- 解析 ≤ 80 字

【严格禁止】学习方法 / 元认知 / 资料元信息 / 鸡汤判断题；不含数学符号的判断题；
"方程(1)" 这类悬挂引用（必须把完整公式抄到题干里）；
"(10 marks) True or False" 这种壳子题；
"那么/因此/所以" 等过渡词起头。

仅输出如下 JSON：
{
  "topics": [
    { "name": "高斯消元法", "summary": "...", "kind": "method", "depth": 2, "prerequisites": ["矩阵的初等行变换"], "definition_anchor": "..." }
  ],
  "questions": [
    { "type": "单选题", "question": "...", "options": ["A. ...","B. ...","C. ...","D. ..."], "answer": "A", "explanation": "...", "difficulty": "medium", "knowledge_points": ["高斯消元法"] }
  ]
}`;

  const tryCall = async (model, useJsonMode = true, attempt = 0) => {
    const body = {
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 2400, // 缩 max_tokens 给 TPM 留余量
    };
    if (useJsonMode) body.response_format = { type: "json_object" };
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${GROQ_KEY}` },
      body: JSON.stringify(body),
    });
    if (r.ok) {
      const d = await r.json();
      return { text: d?.choices?.[0]?.message?.content || "", model };
    }
    const errText = await r.text();
    if (r.status === 400 && useJsonMode) return tryCall(model, false, attempt);
    // 命中 TPM 限速：解析建议等待时间，等完再重试一次
    if (r.status === 429 && attempt < 2) {
      const retryMatch = errText.match(/try again in (\d+(?:\.\d+)?)\s*s/i);
      const wait = retryMatch ? Math.ceil(parseFloat(retryMatch[1])) + 3 : 65;
      console.log(`\n[groq] ${model} 触发 TPM 限速，等待 ${wait}s 后重试…`);
      await new Promise((r) => setTimeout(r, wait * 1000));
      return tryCall(model, useJsonMode, attempt + 1);
    }
    console.error(`[groq] ${model} HTTP ${r.status}: ${errText.slice(0, 240)}`);
    return null;
  };

  let res = await tryCall("llama-3.3-70b-versatile");
  if (!res || !res.text) res = await tryCall("llama-3.1-8b-instant");
  if (!res || !res.text) return null;

  const clean = res.text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  let parsed;
  try {
    parsed = JSON.parse(clean);
  } catch {
    const m = clean.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { parsed = JSON.parse(m[0]); } catch { return null; }
  }
  return { ...parsed, _model: res.model };
}

// ── 4) 归一化 + 低质过滤 ─────────────────────────────────────────────────
const ALLOWED_DIFF = new Set(["easy", "medium", "hard"]);
const ALLOWED_KIND = new Set(["definition", "theorem", "method", "formula", "example", "pitfall"]);

function normalizeQuestions(arr, chapter) {
  return (Array.isArray(arr) ? arr : [])
    .filter((q) => q && String(q.question || q.text || "").length > 5)
    .map((q) => {
      const opts = Array.isArray(q.options) && q.options.length >= 2 ? q.options : null;
      const rawType = String(q.type || (opts ? "单选题" : "判断题"));
      const type = (() => {
        if (/单选|multiple\s*choice|MCQ/i.test(rawType)) return "单选题";
        if (/判断|true\s*\/?\s*false|T\/?F/i.test(rawType)) return "判断题";
        if (/填空|fill[- ]?in/i.test(rawType)) return "填空题";
        if (/简答|short\s*answer/i.test(rawType)) return "简答题";
        return opts ? "单选题" : "判断题";
      })();
      const diff = String(q.difficulty || "").toLowerCase();
      const kps = Array.isArray(q.knowledge_points) ? q.knowledge_points : [];
      return {
        question: String(q.question || q.text || ""),
        options: opts,
        answer: String(q.answer || q.correct_answer || (opts ? "A" : "正确")),
        explanation: String(q.explanation || q.rationale || ""),
        type,
        chapter,
        // 一些 Supabase 项目设了 difficulty NOT NULL + check 约束，给个默认值更稳
        difficulty: ALLOWED_DIFF.has(diff) ? diff : "medium",
        knowledge_points: kps.map((s) => String(s).trim()).filter(Boolean).slice(0, 6),
      };
    })
    .filter((q) => !isLowQualityQuestion(q));
}

function normalizeTopics(arr) {
  return (Array.isArray(arr) ? arr : [])
    .filter((t) => t && String(t.name || t.title || "").length > 1)
    .map((t) => {
      const kindRaw = String(t.kind || "").toLowerCase().trim();
      const kind = ALLOWED_KIND.has(kindRaw) ? kindRaw : null;
      let depth = parseInt(t.depth, 10);
      if (!Number.isFinite(depth) || depth < 1 || depth > 3) depth = null;
      const prereqs = Array.isArray(t.prerequisites) ? t.prerequisites : [];
      return {
        name: String(t.name || t.title || "").trim(),
        summary: String(t.summary || t.description || "").trim(),
        kind,
        depth,
        prerequisites: prereqs.map((s) => String(s).trim()).filter(Boolean).slice(0, 8),
        definition_anchor: String(t.definition_anchor || "").trim().slice(0, 240),
      };
    });
}

function isLowQualityQuestion(q) {
  const text = String(q.question || "");
  if (text.length < 10) return true;
  if (/^\s*\(?\s*\d{1,3}\s*(?:marks?|分)\s*\)?\s*(?:True\s*\/?\s*False)?\s*[。.]?\s*$/i.test(text)) return true;
  if (/^(?:Question|Exercise|Problem)\s*[\d.]+\s*[:：.]?\s*$/i.test(text.trim())) return true;
  if (/(?:学习|做题|复习|认真听课|坚持|态度|策略|方法论|元认知)/.test(text) && !/[=∫∑∏√A-Za-z]\s*[=+\-×<>]/.test(text)) return true;
  if (/(?:作者|书名|章节号|课程编号|教材.*出版)/.test(text)) return true;
  return false;
}

// ── 5) 主流程 ──────────────────────────────────────────────────────────
(async () => {
  const start = Date.now();
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`📕 准备处理：${path.basename(PDF_PATH)}`);
  console.log(`   标题   ：${TITLE_OVERRIDE}`);
  console.log(`   课程   ：${COURSE}`);
  if (REUSE_MATERIAL_ID) console.log(`   复用模式：跳过 PDF 上传，给 material=${REUSE_MATERIAL_ID.slice(0, 8)}… 补 AI 数据`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  let materialId = null;
  let pubUrlStr = null;

  if (REUSE_MATERIAL_ID) {
    const r = await supabase.from("materials").select("id,title,file_data").eq("id", REUSE_MATERIAL_ID).single();
    if (r.error || !r.data) {
      console.error(`❌ 找不到 material id = ${REUSE_MATERIAL_ID}：${r.error?.message || "?"}`);
      process.exit(1);
    }
    materialId = r.data.id;
    pubUrlStr = r.data.file_data;
    console.log(`[reuse] 命中 ${r.data.title}`);
    if (CLEAN) {
      const dq = await supabase.from("questions").delete().eq("material_id", materialId);
      const dt = await supabase.from("material_topics").delete().eq("material_id", materialId);
      console.log(`[clean] questions: ${dq.error ? "❌ " + dq.error.message : "ok"}, topics: ${dt.error ? "❌ " + dt.error.message : "ok"}`);
    }
  } else {
    // 0) 找一个 teacher 当 uploaded_by
    const { data: t1 } = await supabase.from("profiles").select("id,name").eq("role", "teacher").limit(1);
    const { data: t1b } = !t1 || !t1.length ? await supabase.from("profiles").select("id,name").limit(1) : { data: t1 };
    const owner = (t1 && t1.length ? t1 : t1b)?.[0];
    if (!owner) {
      console.error("❌ profiles 表里没有任何账号，无法挂 uploaded_by。请先注册一个账号再跑。");
      process.exit(1);
    }
    console.log(`[owner] uploaded_by = ${owner.id.slice(0, 8)}… (${owner.name || "无名"})`);

    // 1) 上传到 Storage
    const fileBuf = fs.readFileSync(PDF_PATH);
    const safeName = path.basename(PDF_PATH).replace(/[^a-zA-Z0-9._-]/g, "_");
    const filePath = `${owner.id}/${Date.now()}_${safeName}`;
    console.log(`[storage] 上传 ${(fileBuf.length / 1024 / 1024).toFixed(2)} MB → materials/${filePath}`);
    const upRes = await supabase.storage.from("materials").upload(filePath, fileBuf, {
      contentType: "application/pdf",
      upsert: false,
    });
    if (upRes.error) {
      console.error("❌ Storage 上传失败：", upRes.error.message);
      process.exit(2);
    }
    const { data: pubUrl } = supabase.storage.from("materials").getPublicUrl(filePath);
    pubUrlStr = pubUrl.publicUrl;
    console.log(`[storage] ok · publicUrl = ${pubUrlStr.slice(0, 80)}…`);

    // 2) 写 materials 行
    const matPayload = {
      title: TITLE_OVERRIDE,
      course: COURSE,
      chapter: null,
      description: null,
      file_name: path.basename(PDF_PATH),
      file_size: (fileBuf.length / 1024 / 1024).toFixed(1) + " MB",
      file_data: pubUrlStr,
      uploader_name: owner.name || "教师",
      uploaded_by: owner.id,
      is_public: true,
    };
    let inserted = null;
    const r = await supabase.from("materials").insert({ ...matPayload, status: "approved" }).select().single();
    if (r.error && /column .*status/i.test(r.error.message || "")) {
      const r2 = await supabase.from("materials").insert(matPayload).select().single();
      if (r2.error) { console.error("❌ materials 写入失败：", r2.error.message); process.exit(3); }
      inserted = r2.data;
    } else if (r.error) {
      console.error("❌ materials 写入失败：", r.error.message);
      process.exit(3);
    } else {
      inserted = r.data;
    }
    materialId = inserted.id;
    console.log(`[materials] ok · id = ${materialId.slice(0, 8)}…`);
  }

  // 3) 解析 PDF 文本 + AI 抽取（或从 cache 读）
  const cacheDir = path.resolve(__dirname, ".cache");
  const cachePath = path.join(cacheDir, `${materialId}.json`);

  let aggregatedTopics = [];
  let aggregatedQuestions = [];
  let usedModel = "llama-3.3-70b-versatile";

  if (FROM_CACHE && fs.existsSync(cachePath)) {
    const cached = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    aggregatedTopics = cached.topics || [];
    aggregatedQuestions = cached.questions || [];
    usedModel = cached.usedModel || usedModel;
    console.log(`\n[cache] 命中 ${cachePath}（${aggregatedTopics.length} 知识点，${aggregatedQuestions.length} 题）`);
  } else {
    console.log("\n[extract] 开始抽 PDF 文字…");
    const fullText = await extractPdfText(PDF_PATH);
    console.log(`[extract] 共 ${fullText.length} 字符`);
    if (fullText.length < 500) {
      console.error("❌ PDF 文本过少（可能扫描版），AI 抽取退出。但 materials 行已写入，PDF 也已上传。");
      process.exit(4);
    }
    // 缩 chunk 大小给 Groq TPM 留余量（input + 2400 max_tokens 要留在 12000 TPM 里）
    const cappedText = fullText.slice(0, 28000);
    const chunks = buildChunks(cappedText, 3500, 200, 6);
    console.log(`[extract] 切成 ${chunks.length} 块（每块 ${chunks.map((c) => c.length).join("/")} 字符）`);

    // 4) 逐块调 Groq
    const seenTopicNames = new Set();
  for (let i = 0; i < chunks.length; i++) {
    process.stdout.write(`\n[ai ${i + 1}/${chunks.length}] Groq 调用中…\r`);
    const t0 = Date.now();
    const data = await callGroqExtract({
      chunkText: chunks[i],
      course: COURSE,
      chapter: CHAPTER,
      count: 8,
      chunkIndex: i,
      chunkCount: chunks.length,
    });
    if (!data) {
      console.warn(`[ai ${i + 1}] ❌ 失败，跳过`);
      continue;
    }
    if (data._model) usedModel = data._model;
    const ts = normalizeTopics(data.topics);
    const qs = normalizeQuestions(data.questions, CHAPTER);
    for (const t of ts) {
      const k = t.name.toLowerCase();
      if (!seenTopicNames.has(k)) { seenTopicNames.add(k); aggregatedTopics.push(t); }
    }
    aggregatedQuestions.push(...qs);
    console.log(`[ai ${i + 1}/${chunks.length}] ok · +${ts.length} topics, +${qs.length} questions  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    // Groq 免费档 12000 TPM 是个滚动窗口；给 65s 把上轮 token 排出去再发下一发
    if (i < chunks.length - 1) {
      const wait = 65;
      console.log(`[ai] 等待 ${wait}s 让 Groq TPM 滚动窗口刷新…`);
      await new Promise((r) => setTimeout(r, wait * 1000));
    }
  }

  console.log(`\n[ai] 合计：${aggregatedTopics.length} 知识点，${aggregatedQuestions.length} 题`);
    // 把这次 AI 结果先 dump 到 cache，万一下面 insert 失败可以 --from-cache 重试，不再烧 LLM
    try {
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(cachePath, JSON.stringify({ topics: aggregatedTopics, questions: aggregatedQuestions, usedModel }, null, 2));
      console.log(`[cache] 已存盘 ${cachePath}`);
    } catch (e) {
      console.warn(`[cache] 写盘失败：${e.message}`);
    }
  }

  // 5) 入库 questions
  // 已知坑：用户当前 Supabase 的 questions_difficulty_check / questions_type_check 约束被部署成
  // 比 SQL 文件里写的更严格（difficulty 只允许 NULL；type 只允许 单选题/判断题/填空题）。
  // 兜底：
  //   · difficulty 列填 null，原值塞进 ai_meta.difficulty（要按难度刷题就跑 sql/fix_questions_constraints.sql）
  //   · "简答题" 全部归并到 "填空题"（answer 已是文本，UI 端展示一致）
  if (aggregatedQuestions.length > 0) {
    const rows = aggregatedQuestions.map((q) => {
      const originalType = q.type;
      const safeType = q.type === "简答题" ? "填空题" : q.type;
      return {
        chapter: q.chapter || CHAPTER,
        course: COURSE,
        type: safeType,
        question: q.question,
        options: q.options,
        answer: q.answer,
        explanation: q.explanation,
        material_id: materialId,
        difficulty: null,
        knowledge_points: q.knowledge_points && q.knowledge_points.length > 0 ? q.knowledge_points : null,
        generated_by: "groq",
        ai_model: usedModel,
        ai_meta: {
          refine: true,
          source: "scripts/upload-textbook.js",
          difficulty: q.difficulty || "medium",
          original_type: originalType !== safeType ? originalType : undefined,
        },
      };
    });
    const { error: qErr, data: qInserted } = await supabase.from("questions").insert(rows).select("id");
    if (qErr) {
      console.warn(`[questions] 全字段插入失败：${qErr.message}`);
      // 降级 1：去掉 v3 来源字段
      const stripped = rows.map((r) => {
        const { generated_by, ai_model, ai_meta, ...rest } = r;
        return rest;
      });
      const { error: qe2, data: q2 } = await supabase.from("questions").insert(stripped).select("id");
      if (qe2) {
        // 降级 2：再去掉 knowledge_points / material_id
        const r3 = stripped.map((r) => {
          const { knowledge_points, material_id, ...rest } = r;
          return rest;
        });
        const { error: qe3, data: q3 } = await supabase.from("questions").insert(r3).select("id");
        if (qe3) console.error(`[questions] 全部降级也失败：${qe3.message}`);
        else console.log(`[questions] 最小集写入 ${q3.length} 题（丢了 material_id / knowledge_points 列）`);
      } else {
        console.log(`[questions] 降级写入 ${q2.length} 题（缺 generated_by 列，请跑 sql/ai_provenance_v3.sql）`);
      }
    } else {
      console.log(`[questions] ok · 写入 ${qInserted.length} 题`);
    }
  }

  // 6) 入库 material_topics
  if (aggregatedTopics.length > 0) {
    const rows = aggregatedTopics.map((t) => ({
      material_id: materialId,
      name: t.name.slice(0, 120),
      summary: t.summary ? t.summary.slice(0, 800) : null,
      chapter: CHAPTER,
      kind: t.kind,
      depth: t.depth,
      prerequisites: t.prerequisites && t.prerequisites.length > 0 ? t.prerequisites : null,
      definition_anchor: t.definition_anchor || null,
      generated_by: "groq",
      ai_model: usedModel,
      ai_meta: { refine: true, source: "scripts/upload-textbook.js" },
    }));
    const { error: tErr, data: tInserted } = await supabase.from("material_topics").insert(rows).select("id");
    if (tErr) {
      console.warn(`[topics] 全字段插入失败：${tErr.message}`);
      // 降级 1：去掉 v3 来源字段
      const r1 = rows.map((r) => {
        const { generated_by, ai_model, ai_meta, ...rest } = r;
        return rest;
      });
      const e1 = await supabase.from("material_topics").insert(r1).select("id");
      if (e1.error) {
        // 降级 2：去掉 v2 细化字段
        const r2 = r1.map((r) => {
          const { kind, depth, prerequisites, definition_anchor, ...rest } = r;
          return rest;
        });
        const e2 = await supabase.from("material_topics").insert(r2).select("id");
        if (e2.error) console.error(`[topics] 全部降级也失败：${e2.error.message}`);
        else console.log(`[topics] 最小集写入 ${e2.data.length} 条（缺 v2/v3 列）`);
      } else {
        console.log(`[topics] 降级写入 ${e1.data.length} 条（缺 generated_by 列）`);
      }
    } else {
      console.log(`[topics] ok · 写入 ${tInserted.length} 条`);
    }
  }

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`✅ 完成！耗时 ${((Date.now() - start) / 1000).toFixed(1)}s`);
  console.log(`   教材 ID：${materialId}`);
  console.log(`   PDF URL：${pubUrlStr}`);
  console.log(`   现在去网站 / 沙盒进入 "${TITLE_OVERRIDE}" 即可看到知识点 + 题库 + 📖 PDF 按钮。`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
})().catch((e) => {
  console.error("\n❌ 致命错误：", e?.stack || e?.message || e);
  process.exit(99);
});
