// /api/analyze-error —— AI 猜错因（决策 1 · 被动 AI + 主动手标）
//
// 设计约束：
// · Node runtime（和其它 api/*.js 一致，不用 edge）
// · 用户 key 优先 → 平台 PLATFORM_API_KEY 兜底
// · 返回严格 JSON：{ tags: string[], reasoning: string }
// · tags 过白名单，空/非法降级为 ["unknown"]
// · 失败不抛 5xx，返回 200 + { error } 由前端决定是否重试（前端显示 "AI 分析失败"）

const VALID_TAGS = new Set(["formula", "concept", "careless", "method", "unknown"]);

function buildPrompt(input) {
  const optionsBlock = Array.isArray(input.options) && input.options.length
    ? `选项:\n${input.options.map((opt, i) => `${String.fromCharCode(65 + i)}. ${opt}`).join("\n")}\n`
    : "";
  return `你是数学学习助手。分析用户做错这道题的可能原因，从下面 4 个预设类别中选择 1-2 个。

题目:
${input.question_stem || ""}

${optionsBlock}正确答案: ${input.correct_answer || ""}
用户答案: ${input.user_answer || "(未作答)"}
所在章节: ${input.chapter || "(未知)"}

## 错因类别
- formula: 公式记错（记错了某个公式的具体形式）
- concept: 概念混淆（把两个相近概念搞混了）
- careless: 计算粗心（思路对但算错了）
- method: 方法错误（用了不适用的方法）

返回严格 JSON（不要 markdown，不要代码块围栏）:
{
  "tags": ["formula", "careless"],
  "reasoning": "一句话说明为什么这么猜（不超过 50 字，不要指责用户）"
}

要求:
- tags 至少 1 个，最多 2 个
- 如果实在无法判断，返回 ["unknown"]
- reasoning 温和、建设性，比如 "选项 B 和 C 公式形式相近，容易混"`;
}

function getEffectiveKey({ userProvider, userKey }) {
  const hasUserKey = userKey && String(userKey).trim().length > 8;
  if (hasUserKey) {
    return { provider: userProvider || "groq", key: String(userKey).trim(), isPlatform: false };
  }
  // 平台兜底：优先走 Groq（便宜快），其次 PLATFORM_API_KEY
  if (process.env.GROQ_KEY && String(process.env.GROQ_KEY).trim().length > 8) {
    return { provider: "groq", key: process.env.GROQ_KEY.trim(), isPlatform: true };
  }
  const platformProvider = String(process.env.PLATFORM_PROVIDER || "").trim().toLowerCase();
  if (platformProvider && process.env.PLATFORM_API_KEY && String(process.env.PLATFORM_API_KEY).trim().length > 8) {
    return { provider: platformProvider, key: process.env.PLATFORM_API_KEY.trim(), isPlatform: true };
  }
  return null;
}

async function callGroq({ key, prompt }) {
  const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.3,
      max_tokens: 300,
    }),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`Groq ${resp.status}: ${errText.slice(0, 200)}`);
  }
  const data = await resp.json();
  return data?.choices?.[0]?.message?.content || "";
}

async function callGemini({ key, prompt }) {
  const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { response_mime_type: "application/json", temperature: 0.3, maxOutputTokens: 300 },
    }),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`Gemini ${resp.status}: ${errText.slice(0, 200)}`);
  }
  const data = await resp.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

function extractJson(raw) {
  const s = String(raw || "").trim();
  // 直接 parse
  try { return JSON.parse(s); } catch {}
  // 抠出第一个 {...}
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first >= 0 && last > first) {
    try { return JSON.parse(s.slice(first, last + 1)); } catch {}
  }
  return null;
}

function sanitize(parsed) {
  const tagsIn = Array.isArray(parsed?.tags) ? parsed.tags : [];
  const tags = Array.from(new Set(tagsIn.filter((t) => VALID_TAGS.has(String(t))))).slice(0, 2);
  const reasoning = typeof parsed?.reasoning === "string" ? parsed.reasoning.slice(0, 120) : "";
  return {
    tags: tags.length ? tags : ["unknown"],
    reasoning: reasoning || "根据题干和答案推断，可能是以上类别之一",
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const input = req.body || {};
    const effective = getEffectiveKey(input);
    if (!effective) {
      return res.status(200).json({ error: "未配置 AI Key。请在 AI 设置中填入你的 Key 或联系管理员。" });
    }

    const prompt = buildPrompt(input);
    const raw = effective.provider === "gemini"
      ? await callGemini({ key: effective.key, prompt })
      : await callGroq({ key: effective.key, prompt }); // 默认 groq（便宜快）

    const parsed = extractJson(raw);
    if (!parsed) {
      return res.status(200).json({ error: "AI 返回不是合法 JSON", tags: ["unknown"], reasoning: "" });
    }
    const out = sanitize(parsed);
    return res.status(200).json(out);
  } catch (err) {
    return res.status(200).json({ error: String(err?.message || err), tags: ["unknown"], reasoning: "" });
  }
}
