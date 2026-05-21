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

const FALLBACK_ENV_ORDER = [
  ["groq",        "GROQ_KEY"],
  ["deepseek",    "DEEPSEEK_KEY"],
  ["gemini",      "GEMINI_KEY"],
  ["zhipu",       "ZHIPU_KEY"],
  ["openrouter",  "OPENROUTER_KEY"],
  ["siliconflow", "SILICONFLOW_KEY"],
  ["siliconflow", "GUIJI_KEY"],
  ["cerebras",    "CEREBRAS_KEY"],
  ["kimi",        "KIMI_KEY"],
  ["anthropic",   "ANTHROPIC_KEY"],
];

const PROVIDER_CFG = {
  groq:        { url: "https://api.groq.com/openai/v1",            model: "llama-3.3-70b-versatile" },
  deepseek:    { url: "https://api.deepseek.com",                  model: "deepseek-chat" },
  zhipu:       { url: "https://open.bigmodel.cn/api/paas/v4",      model: "glm-4-flash" },
  openrouter:  { url: "https://openrouter.ai/api/v1",              model: "mistralai/mistral-7b-instruct:free" },
  siliconflow: { url: "https://api.siliconflow.cn/v1",             model: "Qwen/Qwen2.5-7B-Instruct" },
  cerebras:    { url: "https://api.cerebras.ai/v1",                model: "llama3.1-8b" },
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
    const cleanText = String(text).slice(0, 12000); // 单次最多看 ~12KB 文字
    const ch = chapter && chapter !== "全部" ? chapter : (course || "本章");

    const prompt = `你是一位严谨的数学教师。请从下面的教材原文里**逐字摘录**所有"已有的"习题（例题、练习题、课后题、思考题等都算），不要凭空生成新题。

教材原文（${course || "数学"} · ${ch}）：
===
${cleanText}
===

要求：
1. **摘录而非重写**：题干必须忠实保留原文（包括序号、字母、符号），可以补 LaTeX 但不能改意思
2. 选择题保留 A/B/C/D 选项；非选择题 options 为 null
3. 如果原文里有答案，把答案抄出来（不要自己算）；没有 → answer 为 null
4. 数学公式一律 LaTeX：行内 $..$，块级 $$..$$
5. **关键：为每道题加 AI 解析**，包含三块：
   - approach：解题思路（50-100 字，说"为什么这么做 + 关键一步"）
   - concepts：考查的知识点（数组，每条 3-8 字）
   - pitfalls：常见易错点（30-80 字）
6. 题型必须从 [单选题, 多选题, 判断题, 填空题, 解答题, 证明题] 中选

如果原文里**完全没有**题目（只是理论说明），返回空数组。

严格输出 JSON，不要 markdown 围栏：
{
  "problems": [
    {
      "question": "题干（保留原序号，LaTeX 公式）",
      "options": ["A. ...", "B. ...", "C. ...", "D. ..."] 或 null,
      "answer": "原文给出的答案" 或 null,
      "type": "单选题",
      "analysis": {
        "approach": "解题思路（50-100 字）",
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
