// /api/extract-textbook-problems.js
// 从教材文字里挖出"原书已有的"习题（例题 / 练习 / 课后题等），
// 跟 /api/extract（凭空生成 25 道新题）的区别：
//   · extract.js → 让 AI 用主题"再造"新题
//   · 本接口    → 让 AI 从原文里逐字摘录已有的题，并配 AI 解析（思路 / 知识点 / 易错点）
//
// 输入：{ text, course, chapter, userProvider, userKey, userCustomUrl }
// 输出：{ problems: [{ question, options?, answer?, type, analysis: { approach, concepts, pitfalls } }], apiUsed }

const TIMEOUT_MS = 45000;

function fetchWithTimeout(url, opts) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(id));
}

// 题目提取是高质量 task —— 需要忠实摘录 + 准确生成解析，所以优先用大模型，
// 避免 7B/8B 小模型瞎编。Anthropic Claude / DeepSeek / Gemini 优先。
const FALLBACK_ENV_ORDER = [
  ["anthropic",   "ANTHROPIC_KEY"],  // 摘录任务里 Claude 最稳，公式准确
  ["deepseek",    "DEEPSEEK_KEY"],   // 中文理解力强，能区分例题/练习题
  ["gemini",      "GEMINI_KEY"],     // 大窗口 + 免费
  ["groq",        "GROQ_KEY"],       // 70b versatile 兜底
  ["zhipu",       "ZHIPU_KEY"],
  ["openrouter",  "OPENROUTER_KEY"],
  ["kimi",        "KIMI_KEY"],
  ["siliconflow", "SILICONFLOW_KEY"],
  ["siliconflow", "GUIJI_KEY"],
  ["cerebras",    "CEREBRAS_KEY"],
];

const PROVIDER_CFG = {
  groq:        { url: "https://api.groq.com/openai/v1",            model: "llama-3.3-70b-versatile" },
  deepseek:    { url: "https://api.deepseek.com",                  model: "deepseek-chat" },
  zhipu:       { url: "https://open.bigmodel.cn/api/paas/v4",      model: "glm-4-flash" },
  // OpenRouter 默认 mistral-7b 太弱，本任务换成中文+数学更稳的 deepseek-r1-distill 免费档
  openrouter:  { url: "https://openrouter.ai/api/v1",              model: "deepseek/deepseek-r1-distill-llama-70b:free" },
  siliconflow: { url: "https://api.siliconflow.cn/v1",             model: "Qwen/Qwen2.5-7B-Instruct" },
  cerebras:    { url: "https://api.cerebras.ai/v1",                model: "llama3.3-70b" }, // 升到 70b
  kimi:        { url: "https://api.moonshot.cn/v1",                model: "moonshot-v1-8k" },
};

async function callOpenAICompat(baseUrl, key, model, prompt) {
  try {
    const r = await fetchWithTimeout(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 4096,
        response_format: { type: "json_object" },
      }),
    });
    if (!r.ok) return null;
    const d = await r.json();
    return d?.choices?.[0]?.message?.content || null;
  } catch { return null; }
}

async function callGemini(key, prompt) {
  try {
    const r = await fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { response_mime_type: "application/json", temperature: 0.3, maxOutputTokens: 4096 },
        }),
      }
    );
    if (!r.ok) return null;
    const d = await r.json();
    return d?.candidates?.[0]?.content?.parts?.[0]?.text || null;
  } catch { return null; }
}

async function callAnthropic(key, prompt) {
  try {
    const r = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!r.ok) return null;
    const d = await r.json();
    return d?.content?.[0]?.text || null;
  } catch { return null; }
}

async function dispatch(provider, key, prompt) {
  if (provider === "gemini") return await callGemini(key, prompt);
  if (provider === "anthropic") return await callAnthropic(key, prompt);
  const cfg = PROVIDER_CFG[provider];
  if (!cfg) return null;
  return await callOpenAICompat(cfg.url, key, cfg.model, prompt);
}

function tryParseLoose(raw) {
  if (!raw) return null;
  const stripped = String(raw).replace(/```json?\s*/gi, "").replace(/```\s*$/g, "").trim();
  try { return JSON.parse(stripped); } catch {}
  const m = stripped.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let cand = m[0];
  try { return JSON.parse(cand); } catch {}
  cand = cand.replace(/,(\s*[}\]])/g, "$1");
  try { return JSON.parse(cand); } catch {}
  try {
    const fixed = cand.replace(/(?<!\\)\\(?!["\\/bfnrtu])/g, "\\\\");
    return JSON.parse(fixed);
  } catch {}
  return null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const { text, course, chapter, userProvider, userKey, userCustomUrl } = req.body || {};
    if (!text || String(text).trim().length < 50) {
      return res.status(400).json({ error: "text 太短，无法提取题目" });
    }
    const cleanText = String(text).slice(0, 24000); // 上限提到 24KB（大模型够吃）
    const ch = chapter && chapter !== "全部" ? chapter : (course || "本章");

    const prompt = `你是一位严谨的数学教师。请从下面的教材原文里**只摘录原文里实际存在的**习题（例题 Example / 练习题 Exercise / 课后题 Problem / 思考题 等），**严禁凭空生成不在原文里的新题**。

教材原文（${course || "数学"} · ${ch}，前 24KB）：
===
${cleanText}
===

【任务】
1. **识别**：扫描原文找带有题号 / "例 N" / "Exercise N" / "习题 N.M" / "1.", "(a)", "Q1" 之类的题目段落
2. **摘录**：题干 verbatim 复制（必要时把混乱排版整理顺，但**不改语义、不补题**）
3. **答案**：原文给出答案就抄上（A/B/C/D 或具体值），原文没明确答案 → **不要自己算**，answer 字段为 null
4. **解析**：每道题加 AI 自己写的 analysis 三件套（approach / concepts / pitfalls）

【严格输出规则】
- 数学公式一律 LaTeX：行内 $..$，块级 $$..$$（不要写 \\(..\\) 或裸公式）
- 选择题 options 是 4 元素数组 ["A. ...", "B. ...", "C. ...", "D. ..."]；非选择题 → null
- type 必须从这 6 类选一个：单选题 / 多选题 / 判断题 / 填空题 / 解答题 / 证明题
- analysis.concepts 是数组，每条 3-8 字（如"高斯消元"、"特征值计算"）
- 整段输出**严格 JSON**，不要 markdown 围栏、不要解释

【判别原则】
✅ 原文有 "例 3.2" "Exercise 5" "习题 1" "(1) 求..." → 摘录
❌ 原文只有定理 / 推论 / 概念说明 → 不算题，不要硬编出题来填充
❌ 原文是目录 / 前言 / 参考文献 → 跳过

如果原文里完全没有任何习题，返回 { "problems": [] }，**绝对不要**为了交差凭空造题。

输出：
{
  "problems": [
    {
      "question": "题干 verbatim（含原序号），LaTeX 公式",
      "options": ["A. ...", "B. ...", "C. ...", "D. ..."] 或 null,
      "answer": "原文给出的答案" 或 null,
      "type": "单选题",
      "analysis": {
        "approach": "解题思路（50-100 字，说为什么+关键一步）",
        "concepts": ["知识点1", "知识点2"],
        "pitfalls": "常见易错点（30-80 字）"
      }
    }
  ]
}`;

    let raw = null;
    let used = "";
    const hasUserKey = userKey && String(userKey).trim().length > 8;

    // 1) 用户自填 Key 优先
    if (hasUserKey) {
      const k = String(userKey).trim();
      const provider = userProvider || "groq";
      raw = await dispatch(provider, k, prompt);
      if (raw) used = `${provider}(user)`;
    }

    // 2) 平台 fallback
    if (!raw) {
      for (const [pid, env] of FALLBACK_ENV_ORDER) {
        const k = process.env[env];
        if (!k || String(k).trim().length < 8) continue;
        raw = await dispatch(pid, String(k).trim(), prompt);
        if (raw) { used = `${pid}(server)`; break; }
      }
    }

    if (!raw) {
      return res.status(500).json({
        error: "AI 调用全部失败。请在 AI 设置里填 Key 或 Vercel 配 GROQ_KEY / GEMINI_KEY / 任一 server key。",
      });
    }

    const parsed = tryParseLoose(raw);
    if (!parsed) {
      return res.status(500).json({
        error: `AI（${used}）返回非 JSON`,
        raw: String(raw).slice(0, 400),
        apiUsed: used,
      });
    }

    const problems = Array.isArray(parsed.problems) ? parsed.problems : [];
    // 过滤明显垃圾：question 太短 / 缺 question 字段
    const cleaned = problems
      .filter((p) => p && p.question && String(p.question).trim().length >= 10)
      .map((p) => ({
        question: String(p.question).trim(),
        options: Array.isArray(p.options) && p.options.length >= 2 ? p.options.map(String) : null,
        answer: p.answer ? String(p.answer).trim() : null,
        type: String(p.type || "单选题"),
        analysis: {
          approach: String(p.analysis?.approach || "").trim(),
          concepts: Array.isArray(p.analysis?.concepts) ? p.analysis.concepts.map(String) : [],
          pitfalls: String(p.analysis?.pitfalls || "").trim(),
        },
      }));

    return res.status(200).json({ problems: cleaned, apiUsed: used });
  } catch (err) {
    console.error("[extract-textbook-problems] FATAL:", err?.message);
    return res.status(500).json({ error: err?.message || "server error" });
  }
}
