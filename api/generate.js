export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const {
    chapter, type, count,
    mode, question: chatQuestion, materialTitle, materialContext,
    userProvider, userKey, userCustomUrl,
  } = req.body;

  const GEMINI_KEY = process.env.GEMINI_KEY;
  const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;

  const hasUserKey = userKey && String(userKey).trim().length > 8;
  const effectiveProvider = hasUserKey ? (userProvider || "gemini") : null;

  if (!hasUserKey && !GEMINI_KEY && !ANTHROPIC_KEY) {
    return res.status(500).json({ error: "未配置任何 API Key。请在首页点击「AI 设置」输入你的 API Key。" });
  }

  // ── Chat 模式 prompt ───────────────────────────────────────────────────────
  const isChatMode = mode === "chat" && chatQuestion;
  const prompt = isChatMode
    ? `你是一位亲切、有趣的数学私教，正在陪伴学生一起学习《${materialTitle || "数学教材"}》。你的风格：温暖鼓励、循循善诱、像朋友一样交流。
${materialContext ? `\n【资料知识点参考】\n${materialContext}\n` : ""}
【学生问题】${chatQuestion}

【回答要求】
1. 数学公式必须用 LaTeX 格式：行内公式用 $公式$，独立公式用 $$公式$$。例如：分离变量法的核心是 $\\frac{dy}{dx} = f(x)g(y)$，积分得 $$\\int \\frac{dy}{g(y)} = \\int f(x)dx + C$$
2. 先给出核心答案（1-2句），再按步骤展开（不超过4步），最后用一句话总结关键思路
3. 适当加入鼓励：如"这个问题问得很好！""你已经掌握了难点！""再理解一下这步就完全通了～"
4. 如果问题比较复杂，结尾可以追问一下："还有哪里不清楚？" 或 "要不要我再出一道类似的题试试？"
5. 绝对不要直接给最终答案（如果是在解题），先给提示引导学生思考
6. 回答控制在 400 字以内，用中文，生动自然，避免机械罗列`
    : `你是数学课程出题专家。请为"${chapter}"这个数学章节生成${count}道${type}。

要求：
- 题目紧贴数值分析或最优化理论内容，考察具体概念和计算
- 单选题提供4个选项（A/B/C/D），干扰项合理
- 判断题 options 设为 null，answer 为"正确"或"错误"
- 每题附简短解析（40字以内）

严格按以下 JSON 数组格式返回，不要有其他文字：
[{"question":"题目内容","options":["A.选项1","B.选项2","C.选项3","D.选项4"],"answer":"A","explanation":"解析内容","type":"单选题"}]`;

  // ── OpenAI-compatible helper ───────────────────────────────────────────────
  const callOpenAICompat = async (baseUrl, key, model) => {
    try {
      const r = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${key}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.5,
          max_tokens: 3000,
        }),
      });
      if (r.ok) {
        const d = await r.json();
        return d?.choices?.[0]?.message?.content || "";
      }
      const err = await r.text();
      console.error(`OpenAI-compat(${model}) HTTP ${r.status}:`, err.slice(0, 200));
      return null;
    } catch (e) {
      console.error(`OpenAI-compat(${model}) exception:`, e.message);
      return null;
    }
  };

  // ── Gemini helper ──────────────────────────────────────────────────────────
  const callGemini = async (key) => {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.5, maxOutputTokens: 3000 },
          }),
        }
      );
      if (r.ok) {
        const d = await r.json();
        return d?.candidates?.[0]?.content?.parts?.[0]?.text || "";
      }
      const err = await r.text();
      console.error("Gemini HTTP error:", r.status, err.slice(0, 200));
      return null;
    } catch (e) {
      console.error("Gemini exception:", e.message);
      return null;
    }
  };

  let responseText = "";

  // ── Priority 1: user-supplied key ─────────────────────────────────────────
  if (hasUserKey) {
    const k = String(userKey).trim();
    if (effectiveProvider === "groq") {
      responseText = await callOpenAICompat("https://api.groq.com/openai/v1", k, "llama-3.3-70b-versatile") || "";
      if (!responseText) responseText = await callOpenAICompat("https://api.groq.com/openai/v1", k, "llama-3.1-8b-instant") || "";
    } else if (effectiveProvider === "deepseek") {
      responseText = await callOpenAICompat("https://api.deepseek.com", k, "deepseek-chat") || "";
    } else if (effectiveProvider === "kimi") {
      responseText = await callOpenAICompat("https://api.moonshot.cn/v1", k, "moonshot-v1-8k") || "";
    } else if (effectiveProvider === "custom") {
      const base = String(userCustomUrl || "").trim().replace(/\/$/, "");
      if (base) responseText = await callOpenAICompat(base, k, "gpt-3.5-turbo") || "";
    } else {
      responseText = await callGemini(k) || "";
    }
  }

  // ── Priority 2: server Gemini key ─────────────────────────────────────────
  if (!responseText && GEMINI_KEY) {
    responseText = await callGemini(GEMINI_KEY) || "";
  }

  // ── Priority 3: server Anthropic key ──────────────────────────────────────
  if (!responseText && ANTHROPIC_KEY) {
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 3000,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (r.ok) {
        const d = await r.json();
        responseText = d.content?.map(b => b.text || "").join("") || "";
      }
    } catch (e) {
      console.error("Anthropic exception:", e.message);
    }
  }

  if (!responseText) {
    return res.status(500).json({ error: "AI 服务不可用。请在首页「AI 设置」配置 DeepSeek / Kimi / Groq / Gemini API Key。" });
  }

  // Chat 模式：直接返回文本
  if (isChatMode) {
    return res.status(200).json({ answer: responseText.trim() });
  }

  const clean = responseText.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  let questions;
  try {
    questions = JSON.parse(clean);
  } catch (e) {
    const m = clean.match(/\[[\s\S]*\]/);
    if (m) {
      try { questions = JSON.parse(m[0]); }
      catch { return res.status(500).json({ error: "JSON解析失败: " + clean.slice(0, 100) }); }
    } else {
      return res.status(500).json({ error: "格式错误: " + clean.slice(0, 100) });
    }
  }

  // Normalise: accept array directly or wrapped in an object
  if (!Array.isArray(questions)) {
    const wrapped = questions?.questions || questions?.problems || questions?.exercises;
    if (Array.isArray(wrapped)) questions = wrapped;
    else return res.status(500).json({ error: "返回格式不是数组" });
  }

  const cleaned = questions
    .filter(q => q && (q.question || q.text || q.content))
    .map(q => {
      const qText = q.question || q.text || q.content || "";
      const opts = Array.isArray(q.options) && q.options.length >= 2 ? q.options : null;
      return {
        question: String(qText),
        options: opts,
        answer: String(q.answer || q.correct_answer || (opts ? "A" : "正确")),
        explanation: String(q.explanation || q.rationale || ""),
        type: String(q.type || (opts ? "单选题" : "判断题")),
      };
    });

  res.status(200).json({ questions: cleaned });
}
