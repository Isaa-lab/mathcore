// /api/analyze-error —— AI 错因诊断（结构化版）
//
// v2 设计目标：
// · 不只是给个 1~2 个标签 + 一句 50 字 reasoning；而是输出**可被下游消费**的结构化诊断：
//     - tags：扩到 10 个细分类别
//     - wrong_step：明确指出"用户在哪一步走错了"
//     - misconception：用户**可能**持有的错误信念（一句话）
//     - correct_path：正确做法的关键 1~2 步
//     - remedy_focus：建议练什么子技能
//     - weak_topics：从题干中能提取出来的相关知识点 name 数组
//     - confidence：high/medium/low（让前端 UI 可以决定要不要二次让用户确认）
// · 这份输出会同时驱动：
//     - 错题本卡片显示（替代单行 reasoning）
//     - /api/generate 的变式 prompt（按 wrong_step 设计陷阱选项）
//     - SocraticCoachDrawer 的 seed prompt（带着 misconception 提问）
// · 失败时仍返回 200 + 兜底字段，前端不会崩。

// 扩展后的标签集合（10+1）。同时保留 v1 的 4 类（formula / concept / careless / method）
// 以兼容历史错题本上的标签。
const VALID_TAGS = new Set([
  "formula",     // 公式记错 / 写错（既有）
  "concept",     // 概念混淆（既有）
  "careless",    // 计算粗心（既有）
  "method",      // 方法选错（既有）
  "definition",  // 定义没记牢
  "sign",        // 符号 / 正负号
  "algebra",     // 代数变形
  "boundary",    // 边界 / 特殊情形漏掉
  "condition",   // 前提条件忽略
  "derivation",  // 中间步骤跳错
  "unknown",     // 兜底
]);

const TAG_LABEL = {
  formula: "公式记错",
  concept: "概念混淆",
  careless: "计算粗心",
  method: "方法选错",
  definition: "定义不清",
  sign: "符号错误",
  algebra: "代数变形",
  boundary: "边界 / 特殊值",
  condition: "前提条件",
  derivation: "中间步骤",
  unknown: "暂未归类",
};

function buildPrompt(input) {
  const optionsBlock = Array.isArray(input.options) && input.options.length
    ? `选项:\n${input.options.map((opt, i) => `${String.fromCharCode(65 + i)}. ${opt}`).join("\n")}\n`
    : "";
  const explanationBlock = input.explanation ? `官方解析:\n${String(input.explanation).slice(0, 500)}\n\n` : "";
  const knowledgeBlock = Array.isArray(input.knowledge_points) && input.knowledge_points.length
    ? `相关知识点（来自题目元数据）: ${input.knowledge_points.join(" / ")}\n` : "";

  return `你是数学学习诊断助手。学生做错了一道题。请精确诊断他**在哪一步、用了什么错误信念**，给出可下游消费的结构化输出。

题目:
${input.question_stem || ""}

${optionsBlock}正确答案: ${input.correct_answer || ""}
学生作答: ${input.user_answer || "(未作答)"}
所在章节: ${input.chapter || "(未知)"}
${knowledgeBlock}${explanationBlock}
## 错因标签集合（按要点匹配，最多挑 2 个；至少 1 个；实在不确定再用 unknown）
- formula     公式形式记错（写错系数、漏负号、上下标错、记成相邻公式）
- concept     概念混淆（把两个相近概念搞混，例如行阶梯 vs 简化行阶梯）
- careless    计算粗心（思路对，但代入 / 加减 / 单位 / 抄写出错）
- method      方法选错（用了不适用本题的解法或定理）
- definition  定义没记牢（说不出"X 是指 …"或者把判定条件记成必要条件）
- sign        符号 / 正负号错（缺一个负号、积分上限正负、矩阵元素符号）
- algebra     代数变形错（移项、通分、因式分解、合并同类项时崩了）
- boundary    边界 / 特殊情形漏（忘了 g(y)=0 给出特解、忘了零向量 / 单位元）
- condition   前提条件忽略（定理用了但条件没核对、矩阵未必可逆就用 A^-1）
- derivation  中间步骤跳错（一步推到底，跳过了关键步骤导致结论偏离）

## 输出要求 —— 严格 JSON，不要 markdown，不要代码块围栏
{
  "tags": ["formula", "sign"],
  "wrong_step": "在第 2 步对 e^{-2x} 求导时把结果写成了 -e^{-2x}，漏掉了链式法则带来的系数 2",
  "misconception": "你可能以为 (e^{kx})' = -e^{kx}，正确公式是 (e^{kx})' = k·e^{kx}",
  "correct_path": "用链式法则：令 u = -2x，则 (e^u)' = u'·e^u = -2·e^{-2x}",
  "remedy_focus": "复指数函数链式求导：(e^{u(x)})' = u'(x)·e^{u(x)}",
  "weak_topics": ["指数函数求导", "链式法则"],
  "confidence": "high"
}

约束:
- tags：1~2 个（最多 2），从上面集合里挑；都不沾边再用 unknown
- wrong_step：1 句话，**点明步骤编号或子动作**（如"第 N 步"/"代入条件时"/"配方时"）；30~80 字
- misconception：1 句话，写学生**可能信以为真但其实错**的命题；如果他没作答就写 "可能没识别题目要用的是 …"；30~80 字
- correct_path：1~2 句，**写关键定理 / 公式 + 1 个关键中间步骤**；不超过 100 字
- remedy_focus：1 个具体的子技能短语，应当能直接当成"再做一组 5 道针对题"的题源（10~25 字）
- weak_topics：1~3 条短名词；如果题目里没有明确知识点就给空数组 []
- confidence：high（题干 + 选项足以定位错误）/ medium（能猜大方向）/ low（信息不够，多半给 unknown）
- 语气：温和、第二人称"你"，不指责，重点放"下次怎么避免"
- 全部字段都用中文`;
}

function getEffectiveKey({ userProvider, userKey }) {
  const hasUserKey = userKey && String(userKey).trim().length > 8;
  if (hasUserKey) {
    return { provider: userProvider || "groq", key: String(userKey).trim(), isPlatform: false };
  }
  // 平台兜底：按"免费档优先"顺序尝试（Groq > Gemini > Zhipu > OpenRouter > SiliconFlow > Cerebras > Kimi > DeepSeek）
  const FALLBACK_ORDER = [
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
  for (const [pid, env] of FALLBACK_ORDER) {
    const v = process.env[env];
    if (v && String(v).trim().length > 8) return { provider: pid, key: String(v).trim(), isPlatform: true };
  }
  // 兼容老 PLATFORM_PROVIDER + PLATFORM_API_KEY 槽位
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
      max_tokens: 700,
    }),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`Groq ${resp.status}: ${errText.slice(0, 200)}`);
  }
  const data = await resp.json();
  return data?.choices?.[0]?.message?.content || "";
}

async function callOpenAICompat({ baseUrl, key, model, prompt, structured = true }) {
  const body = {
    model,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
    max_tokens: 700,
  };
  if (structured) body.response_format = { type: "json_object" };
  const resp = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`${baseUrl} ${resp.status}: ${errText.slice(0, 200)}`);
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
      generationConfig: { response_mime_type: "application/json", temperature: 0.3, maxOutputTokens: 700 },
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
  try { return JSON.parse(s); } catch {}
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first >= 0 && last > first) {
    try { return JSON.parse(s.slice(first, last + 1)); } catch {}
  }
  return null;
}

function clip(s, n) {
  const t = typeof s === "string" ? s : "";
  return t.length > n ? t.slice(0, n) : t;
}

function sanitize(parsed) {
  const tagsIn = Array.isArray(parsed?.tags) ? parsed.tags : [];
  const tags = Array.from(new Set(tagsIn.map(String).filter(t => VALID_TAGS.has(t)))).slice(0, 2);
  const finalTags = tags.length ? tags : ["unknown"];
  const wrong_step = clip(parsed?.wrong_step, 200);
  const misconception = clip(parsed?.misconception, 200);
  const correct_path = clip(parsed?.correct_path, 200);
  const remedy_focus = clip(parsed?.remedy_focus, 80);
  const weak_topics = Array.isArray(parsed?.weak_topics)
    ? parsed.weak_topics.map(String).map(s => s.trim()).filter(Boolean).slice(0, 3)
    : [];
  const confidence = ["high", "medium", "low"].includes(parsed?.confidence) ? parsed.confidence : "medium";

  // 兼容 v1：把 reasoning 字段拼出来，方便仍只读 ai_reasoning 的旧前端展示
  const reasoning = wrong_step || misconception || "未给出诊断";
  return {
    tags: finalTags,
    wrong_step,
    misconception,
    correct_path,
    remedy_focus,
    weak_topics,
    confidence,
    reasoning, // legacy
  };
}

function emptyDiagnosis(message) {
  return {
    tags: ["unknown"],
    wrong_step: "",
    misconception: "",
    correct_path: "",
    remedy_focus: "",
    weak_topics: [],
    confidence: "low",
    reasoning: message || "",
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const input = req.body || {};
    const effective = getEffectiveKey(input);
    if (!effective) {
      return res.status(200).json({ error: "未配置 AI Key。请在 AI 设置中填入你的 Key 或联系管理员。", ...emptyDiagnosis() });
    }

    const prompt = buildPrompt(input);
    let raw = "";
    const p = effective.provider;
    if (p === "gemini") {
      raw = await callGemini({ key: effective.key, prompt });
    } else if (p === "openrouter") {
      raw = await callOpenAICompat({ baseUrl: "https://openrouter.ai/api/v1", key: effective.key, model: "mistralai/mistral-7b-instruct:free", prompt });
    } else if (p === "siliconflow") {
      raw = await callOpenAICompat({ baseUrl: "https://api.siliconflow.cn/v1", key: effective.key, model: "Qwen/Qwen2.5-7B-Instruct", prompt });
    } else if (p === "zhipu") {
      raw = await callOpenAICompat({ baseUrl: "https://open.bigmodel.cn/api/paas/v4", key: effective.key, model: "glm-4-flash", prompt });
    } else if (p === "cerebras") {
      raw = await callOpenAICompat({ baseUrl: "https://api.cerebras.ai/v1", key: effective.key, model: "llama3.1-8b", prompt });
    } else if (p === "deepseek") {
      raw = await callOpenAICompat({ baseUrl: "https://api.deepseek.com", key: effective.key, model: "deepseek-chat", prompt });
    } else if (p === "kimi") {
      raw = await callOpenAICompat({ baseUrl: "https://api.moonshot.cn/v1", key: effective.key, model: "moonshot-v1-8k", prompt });
    } else {
      raw = await callGroq({ key: effective.key, prompt }); // 默认 groq（便宜快）
    }

    const parsed = extractJson(raw);
    if (!parsed) {
      return res.status(200).json({ error: "AI 返回不是合法 JSON", ...emptyDiagnosis("AI 返回格式不对") });
    }
    const out = sanitize(parsed);
    return res.status(200).json(out);
  } catch (err) {
    return res.status(200).json({ error: String(err?.message || err), ...emptyDiagnosis() });
  }
}

// 给前端用：导出标签集合（如果前端走 import 的话）；同时附在 handler 文件里方便测试。
export const TAG_LABEL_MAP = TAG_LABEL;
