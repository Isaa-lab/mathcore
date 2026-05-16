// /api/translate-questions.js
// 把一批中文数学题翻译成英文，返回 question_en / options_en / explanation_en
// 每次最多处理 10 道题，前端负责分批调用

const TIMEOUT_MS = 25000;

function fetchWithTimeout(url, opts, ms = TIMEOUT_MS) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(id));
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    return await run(req, res);
  } catch (err) {
    console.error("[translate-questions] FATAL:", err?.message);
    return res.status(500).json({ error: String(err?.message || "server error") });
  }
}

async function run(req, res) {
  const { questions = [], userProvider, userKey, userCustomUrl } = req.body || {};
  if (!Array.isArray(questions) || questions.length === 0) {
    return res.status(400).json({ error: "no questions provided" });
  }

  const batch = questions.slice(0, 10); // 硬限最多 10 道

  // ── env keys ──
  const GROQ_KEY      = process.env.GROQ_KEY;
  const GEMINI_KEY    = process.env.GEMINI_KEY;
  const DEEPSEEK_KEY  = process.env.DEEPSEEK_KEY;
  const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
  const KIMI_KEY      = process.env.KIMI_KEY;

  // ── build prompt ──
  const items = batch.map((q, i) => {
    const opts = Array.isArray(q.options) ? q.options : [];
    return `[${i}]
题干: ${q.question}
${opts.length ? "选项:\n" + opts.map((o, j) => `  ${["A","B","C","D"][j] || j}. ${o}`).join("\n") : ""}
解析: ${q.explanation || ""}`;
  }).join("\n\n");

  const prompt = `You are a bilingual mathematics educator. Translate the following Chinese math questions into English.
Preserve ALL LaTeX expressions exactly as-is (do not modify anything inside $ or $$).
Return ONLY a valid JSON array, no markdown, no explanation.
Each element must be: {"i": <index>, "question_en": "...", "options_en": ["A...","B...","C...","D..."], "explanation_en": "..."}
For true/false questions with no options, set options_en to [].
Keep mathematical rigor; do not simplify or paraphrase.

Questions to translate:

${items}

Return JSON array only:`;

  // ── call AI ──
  const callOpenAI = async (baseUrl, key, model) => {
    try {
      const r = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
        body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], temperature: 0.2, max_tokens: 4000 }),
      });
      if (!r.ok) return null;
      const d = await r.json();
      return d?.choices?.[0]?.message?.content || null;
    } catch { return null; }
  };

  const callGemini = async (key) => {
    try {
      const r = await fetchWithTimeout(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 4000 } }) }
      );
      if (!r.ok) return null;
      const d = await r.json();
      return d?.candidates?.[0]?.content?.parts?.[0]?.text || null;
    } catch { return null; }
  };

  const callAnthropic = async (key) => {
    try {
      const r = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 4000, messages: [{ role: "user", content: prompt }] }),
      });
      if (!r.ok) return null;
      const d = await r.json();
      return d?.content?.[0]?.text || null;
    } catch { return null; }
  };

  let raw = null;
  const hasUserKey = userKey && String(userKey).trim().length > 8;

  if (hasUserKey) {
    const pid = userProvider || "groq";
    if (pid === "groq") raw = await callOpenAI("https://api.groq.com/openai/v1", userKey, "llama-3.3-70b-versatile");
    else if (pid === "deepseek") raw = await callOpenAI("https://api.deepseek.com", userKey, "deepseek-chat");
    else if (pid === "kimi") raw = await callOpenAI("https://api.moonshot.cn/v1", userKey, "moonshot-v1-8k");
    else if (pid === "gemini") raw = await callGemini(userKey);
    else if (pid === "anthropic") raw = await callAnthropic(userKey);
    else if (pid === "custom") {
      const base = String(userCustomUrl || "").trim().replace(/\/$/, "");
      if (base) raw = await callOpenAI(base, userKey, "gpt-3.5-turbo");
    }
  }

  if (!raw && GROQ_KEY)      raw = await callOpenAI("https://api.groq.com/openai/v1", GROQ_KEY, "llama-3.3-70b-versatile");
  if (!raw && DEEPSEEK_KEY)  raw = await callOpenAI("https://api.deepseek.com", DEEPSEEK_KEY, "deepseek-chat");
  if (!raw && GEMINI_KEY)    raw = await callGemini(GEMINI_KEY);
  if (!raw && ANTHROPIC_KEY) raw = await callAnthropic(ANTHROPIC_KEY);
  if (!raw && KIMI_KEY)      raw = await callOpenAI("https://api.moonshot.cn/v1", KIMI_KEY, "moonshot-v1-8k");

  if (!raw) return res.status(503).json({ error: "暂无可用 AI 服务来翻译题目" });

  // ── parse JSON ──
  let parsed;
  try {
    const m = raw.match(/\[[\s\S]*\]/);
    parsed = JSON.parse(m ? m[0] : raw);
  } catch {
    return res.status(500).json({ error: "AI 返回格式无法解析", raw: raw.slice(0, 300) });
  }

  if (!Array.isArray(parsed)) {
    return res.status(500).json({ error: "AI 返回不是数组", raw: raw.slice(0, 300) });
  }

  // 把 AI 的翻译结果 + 原题 id 合并
  const translated = parsed
    .filter(item => typeof item.i === "number" && batch[item.i])
    .map(item => ({
      id: batch[item.i].id,
      question_en: String(item.question_en || ""),
      options_en: Array.isArray(item.options_en) ? item.options_en.map(String) : [],
      explanation_en: String(item.explanation_en || ""),
    }))
    .filter(item => item.question_en.length > 0);

  return res.status(200).json({ translated });
}
