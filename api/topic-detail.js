// /api/topic-detail —— AI 知识点详情即时生成
// 输入：{ topicName, summary, course, chapter, materialContext, userProvider, userKey, userCustomUrl }
// 输出：{ intro, formulas:[{label, latex}], steps:[], examples:[{question, answer, explanation}], viz_hint }
// 全部走免费档优先 fallback 链。

const FALLBACK_ENV_ORDER = [
  ["groq",        "GROQ_KEY"],
  ["gemini",      "GEMINI_KEY"],
  ["zhipu",       "ZHIPU_KEY"],
  ["openrouter",  "OPENROUTER_KEY"],
  ["siliconflow", "SILICONFLOW_KEY"],
  ["siliconflow", "GUIJI_KEY"],
  ["cerebras",    "CEREBRAS_KEY"],
  ["kimi",        "KIMI_KEY"],
  ["deepseek",    "DEEPSEEK_KEY"],
];

const PROVIDER_CFG = {
  groq:        { url: "https://api.groq.com/openai/v1",            model: "llama-3.3-70b-versatile" },
  openrouter:  { url: "https://openrouter.ai/api/v1",              model: "mistralai/mistral-7b-instruct:free" },
  siliconflow: { url: "https://api.siliconflow.cn/v1",             model: "Qwen/Qwen2.5-7B-Instruct" },
  zhipu:       { url: "https://open.bigmodel.cn/api/paas/v4",      model: "glm-4-flash" },
  cerebras:    { url: "https://api.cerebras.ai/v1",                model: "llama3.1-8b" },
  deepseek:    { url: "https://api.deepseek.com",                  model: "deepseek-chat" },
  kimi:        { url: "https://api.moonshot.cn/v1",                model: "moonshot-v1-8k" },
};

async function callOpenAICompat(baseUrl, key, model, prompt) {
  try {
    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.4,
        max_tokens: 1500,
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
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { response_mime_type: "application/json", temperature: 0.4, maxOutputTokens: 1500 },
      }),
    });
    if (!r.ok) return null;
    const d = await r.json();
    return d?.candidates?.[0]?.content?.parts?.[0]?.text || null;
  } catch { return null; }
}

async function dispatch(provider, key, prompt) {
  if (provider === "gemini") return await callGemini(key, prompt);
  const cfg = PROVIDER_CFG[provider];
  if (!cfg) return null;
  return await callOpenAICompat(cfg.url, key, cfg.model, prompt);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const { topicName, summary = "", course = "", chapter = "", materialContext = "", userProvider, userKey, preferProvider } = req.body || {};
    if (!topicName) return res.status(400).json({ error: "topicName required" });

    const prompt = `你是一位数学老师，正在为学生制作"${course || "数学"} · ${chapter || ""}"中"${topicName}"这一知识点的卡片。

已知摘要：${summary || "（无）"}
${materialContext ? `教材上下文：${String(materialContext).slice(0, 800)}` : ""}

请输出严格 JSON（不要 markdown 围栏，不要解释）：
{
  "intro": "150-220 字的核心概念讲解，必须解释为什么用、关键直觉、常见误区。中文。",
  "formulas": [
    {"label": "定义式", "latex": "完整 LaTeX，例如 \\\\frac{dy}{dx}=f(x)g(y)"},
    {"label": "推论 / 通解", "latex": "..."}
  ],
  "steps": ["第 1 步：...", "第 2 步：...", "第 3 步：...", "第 4 步：..."],
  "examples": [
    {"question": "例题 1 题干", "answer": "完整答案/通解", "explanation": "≤80 字解析，说明每一步为什么这么做"},
    {"question": "例题 2 题干", "answer": "完整答案", "explanation": "≤80 字解析"}
  ],
  "viz_hint": "用一句话描述这个知识点最适合什么图来理解，例如 '用斜率场 + 几条特解曲线展示 dy/dx 的几何意义'"
}

要求：
1. formulas 至少 1 条，用标准 LaTeX，公式里数学符号一律 \\\\frac、\\\\int、\\\\sum、\\\\sqrt、\\\\theta、\\\\partial 等命令式。
2. steps 必须 3-5 步，每步以"第 N 步："开头，简练。
3. examples 必须 2 题，难度递增，第二题要难一些（综合应用）。
4. 整体内容必须基于"${topicName}"这个具体知识点，不要写"如何学好数学"这种鸡汤。`;

    let raw = null;
    let used = "";

    // 1) 用户 Key 优先
    if (userKey && String(userKey).trim().length > 8 && userProvider) {
      raw = await dispatch(userProvider, String(userKey).trim(), prompt);
      if (raw) used = `${userProvider}(user)`;
    }

    // 2) 平台兜底 —— 优先尝试 preferProvider 指定的 provider（同源生成），失败再走免费档 fallback
    if (!raw) {
      let order = FALLBACK_ENV_ORDER;
      if (preferProvider) {
        // 把 preferProvider 提到队首，让"智谱抽的 topic → 详情用智谱写"
        const pref = FALLBACK_ENV_ORDER.filter(([pid]) => pid === preferProvider);
        const rest = FALLBACK_ENV_ORDER.filter(([pid]) => pid !== preferProvider);
        order = [...pref, ...rest];
      }
      for (const [pid, env] of order) {
        const k = process.env[env];
        if (!k || String(k).trim().length < 8) continue;
        raw = await dispatch(pid, String(k).trim(), prompt);
        if (raw) { used = `${pid}(server)`; break; }
      }
      // 兼容老 PLATFORM_API_KEY 槽位
      if (!raw) {
        const slotProv = String(process.env.PLATFORM_PROVIDER || "").trim().toLowerCase();
        const slotKey  = process.env.PLATFORM_API_KEY;
        if (slotProv && slotKey && String(slotKey).trim().length > 8) {
          raw = await dispatch(slotProv, String(slotKey).trim(), prompt);
          if (raw) used = `${slotProv}(platform)`;
        }
      }
    }

    if (!raw) return res.status(200).json({ error: "AI 调用失败：所有 provider 都返回空。请检查 Vercel 环境变量是否配了至少一个免费 Key（GROQ_KEY/GEMINI_KEY/ZHIPU_KEY），或在 AI 设置里填自己的 Key。" });

    // 解析 JSON（容错）
    const cleaned = String(raw).replace(/```json\s*/gi, "").replace(/```\s*$/g, "").trim();
    let parsed = null;
    try { parsed = JSON.parse(cleaned); }
    catch {
      const m = cleaned.match(/\{[\s\S]*\}/);
      if (m) { try { parsed = JSON.parse(m[0]); } catch {} }
    }
    if (!parsed) return res.status(200).json({ error: "AI 返回不是合法 JSON，重试一次", raw: cleaned.slice(0, 200), used });

    return res.status(200).json({
      intro: String(parsed.intro || ""),
      formulas: Array.isArray(parsed.formulas) ? parsed.formulas.slice(0, 6) : [],
      steps: Array.isArray(parsed.steps) ? parsed.steps.slice(0, 8) : [],
      examples: Array.isArray(parsed.examples) ? parsed.examples.slice(0, 4) : [],
      viz_hint: String(parsed.viz_hint || ""),
      apiUsed: used,
    });
  } catch (err) {
    return res.status(200).json({ error: String(err?.message || err) });
  }
}
