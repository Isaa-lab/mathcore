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

    const prompt = `你是一位数学老师，正在为学生制作"${course || "数学"} · ${chapter || ""}"中"${topicName}"这一知识点的**掌握度卡片**——目标是检测学生**会不会用**这个知识点解题，而不是检测他**记不记得**定义。

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
    {"question": "例题 1 题干（必须含具体数值 / 公式 / 条件，需要做计算或判定）", "answer": "完整答案/通解，需展示关键中间步骤", "explanation": "≤80 字解析，说明每一步为什么这么做、易错点在哪"},
    {"question": "例题 2 题干（综合 / 反例 / 边界）", "answer": "完整答案", "explanation": "≤80 字解析"}
  ],
  "viz_hint": "用一句话描述这个知识点最适合什么图来理解，例如 '用斜率场 + 几条特解曲线展示 dy/dx 的几何意义'"
}

要求：
1. formulas 至少 1 条，用标准 LaTeX，公式里数学符号一律 \\\\frac、\\\\int、\\\\sum、\\\\sqrt、\\\\theta、\\\\partial 等命令式。
2. steps 必须 3-5 步，每步以"第 N 步："开头，简练。
3. examples 必须 2 题，**两道都必须是"动手算 / 动手判定"题，禁止纯定义复述题**：
   - ❌ 禁止："${topicName} 的定义是什么"、"下列哪一项正确描述 ${topicName}"、"什么叫 ${topicName}"——这类是概念背诵题，不合格。
   - ✅ 合格题型：给定具体函数 / 矩阵 / 数值 / 条件，让学生算出答案；或给一个命题让学生判定真伪 + 给出反例；或要求构造满足某条件的对象；或要求多步推导。
   - 例题 1：中等难度，1~2 步推导即可得解，必须包含具体的数值 / 公式 / 矩阵 / 函数；answer 要写出关键中间步骤而不只是最终答案。
   - 例题 2：综合 / 反例 / 边界情形——需要 ≥3 步推理、或要求构造反例、或对比相邻概念，难度明显高于例题 1。
4. 整体内容必须基于"${topicName}"这个具体知识点，不要写"如何学好数学"这种鸡汤；也不要写"理解定义很重要"这种空话。
5. 自检："学生即使背了定义但没真正动手练过，能不能做对例题？" 如果能 → 例题过基础，必须重写。`;

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

    // 强力 JSON 解析：先剥 markdown fence、抠出第一个 {...} 外壳、修复常见尾随逗号 / unescaped backslash 问题
    function tryParseLoose(s) {
      const stripped = String(s).replace(/```json\s*/gi, "").replace(/```\s*$/g, "").trim();
      // (1) 直接 parse
      try { return JSON.parse(stripped); } catch {}
      // (2) 抠 outermost {...}
      const m = stripped.match(/\{[\s\S]*\}/);
      if (!m) return null;
      let candidate = m[0];
      try { return JSON.parse(candidate); } catch {}
      // (3) 修尾随逗号
      candidate = candidate.replace(/,(\s*[}\]])/g, "$1");
      try { return JSON.parse(candidate); } catch {}
      // (4) LaTeX 反斜杠双倍转义（\frac → \\frac），但只对 string 内的反斜杠
      try {
        const fixed = candidate.replace(/(?<!\\)\\(?!["\\/bfnrtu])/g, "\\\\");
        return JSON.parse(fixed);
      } catch {}
      return null;
    }

    let parsed = tryParseLoose(raw);

    // 重试一次：用更严格的 prompt 强调"必须只输出 JSON"。某些小模型（Qwen/Mistral 7B）需要
    // 强提示才稳定。第二次失败才报错给用户。
    if (!parsed && used) {
      const retryPrompt = `请只输出一个 JSON 对象，不要写任何解释、不要 markdown 围栏、不要前后空话。结构如下，必须每个字段都有值：
{"intro":"...", "formulas":[{"label":"...","latex":"..."}], "steps":["第1步:...","第2步:..."], "examples":[{"question":"...","answer":"...","explanation":"..."},{"question":"...","answer":"...","explanation":"..."}], "viz_hint":"..."}

主题："${topicName}"。中文输出。LaTeX 公式里的反斜杠请写两次（如 \\\\frac \\\\int \\\\sum）。
两道例题都必须是"动手算 / 动手判定"题（含具体数值或公式，需 1 步以上推导），禁止"X 的定义是什么"这类纯概念题；第二题要比第一题难（综合或反例）。`;
      const [provider] = used.split("(");
      const envName = ({ groq: "GROQ_KEY", gemini: "GEMINI_KEY", zhipu: "ZHIPU_KEY", openrouter: "OPENROUTER_KEY", siliconflow: "SILICONFLOW_KEY", cerebras: "CEREBRAS_KEY", deepseek: "DEEPSEEK_KEY", kimi: "KIMI_KEY" })[provider];
      const k = envName ? process.env[envName] : null;
      if (k && String(k).trim().length > 8) {
        const raw2 = await dispatch(provider, String(k).trim(), retryPrompt);
        if (raw2) parsed = tryParseLoose(raw2);
      }
    }

    if (!parsed) return res.status(200).json({ error: `AI（${used || "未知"}）返回非 JSON，已自动重试一次仍失败。换一个 AI（如 Gemini / 智谱）试试。`, raw: String(raw).slice(0, 200), used });

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
