export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const {
    text, course, chapter, count = 5,
    userProvider, userKey, userCustomUrl,
  } = req.body;

  const GEMINI_KEY = process.env.GEMINI_KEY;
  const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;

  // Determine effective API config: user-supplied key takes priority
  const hasUserKey = userKey && String(userKey).trim().length > 8;
  const effectiveProvider = hasUserKey ? (userProvider || "gemini") : null;

  if (!hasUserKey && !GEMINI_KEY && !ANTHROPIC_KEY) {
    return res.status(500).json({ error: "未配置 API Key。请在首页点击「AI 设置」输入你的 API Key，或在 Vercel 环境变量里添加 GEMINI_KEY。" });
  }

  if (!text || text.trim().length < 30) {
    return res.status(400).json({ error: "PDF 文字太少（可能是扫描版）。请使用可以选中文字的电子版 PDF。" });
  }

  const preCleaned = text
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const filteredLines = preCleaned
    .split("\n")
    .filter(l => {
      const t = l.trim();
      if (t.length === 0) return false;
      if (/^\d+$/.test(t) && t.length <= 4) return false;
      return true;
    })
    .join("\n");

  const cleanText = filteredLines.slice(0, 8000);
  const ch = (chapter && chapter !== "全部") ? chapter : (course || "本章节");
  const englishRatio = (cleanText.match(/[a-zA-Z]/g) || []).length / Math.max(cleanText.length, 1);
  const isEnglish = englishRatio > 0.4;

  const prompt = `你是一位专业数学教授，正在为中国大学生制作习题和知识点卡片。教材原文可能是英文，但所有输出内容必须使用中文。

【重要警告】以下文本由 PDF 自动提取，数学符号可能存在乱码：
- "x 2" 实为 x²，"d t 2" 实为 d²/dt²，"x n" 实为 xₙ
- "d y / d x" 实为 dy/dx，字母间多余空格是乱码
- 所有数学公式必须还原为正确标准符号，绝对不能照抄乱码原文

=== 教材原文（${isEnglish ? "英文" : "中文"}教材，输出用中文）===
${cleanText}
=== 原文结束 ===

课程：${course || "数学"} | 章节：${ch}

【任务一】提取 3~5 个核心知识点，每个知识点必须包含：
  - "name"：知识点名称（中文，4~10字，不能照抄乱码）
  - "summary"：一句话说明该知识点的核心内容（中文，20~60字）

【任务二】生成恰好 ${count} 道中文习题，要求：
- 每道题必须基于原文的具体定义、定理、公式或方法
- 所有数学公式用标准符号（如 dy/dx、∫、∑、e^(at) 等），不照搬乱码
- 单选题（单选题）：恰好 4 个选项 A/B/C/D，干扰项必须是合理的数学表达式，绝对禁止使用"与原文相反""教材未提及""以上都不对"等无效选项
- 判断题（判断题）：options 为 null，answer 为"正确"或"错误"
- 题型分配：至少 ${Math.max(2, Math.floor(count * 0.7))} 道单选题，至少 1 道判断题
- 解析 ≤ 60 字，需明确说明正确理由

仅输出如下 JSON，不附加任何其他文字或 markdown：
{
  "topics": [
    { "name": "分离变量法", "summary": "将 dy/dx = f(x)g(y) 改写为 dy/g(y) = f(x)dx，两端分别积分求解一阶常微分方程的方法。" }
  ],
  "questions": [
    { "type": "单选题", "question": "用分离变量法求解 dy/dx = xy，其通解为？", "options": ["A. y = Ce^(x²/2)", "B. y = Ce^x", "C. y = Ce^(x²)", "D. y = x² + C"], "answer": "A", "explanation": "分离变量得 dy/y = x dx，积分得 ln|y| = x²/2 + C₀，故 y = Ce^(x²/2)。" },
    { "type": "判断题", "question": "方程 dy/dx = x²·sin(y) 可以用分离变量法求解。", "options": null, "answer": "正确", "explanation": "该方程可改写为 dy/sin(y) = x² dx，两端可分别积分，故可用分离变量法。" }
  ]
}`;

  // ── OpenAI-compatible helper (DeepSeek / Kimi / Custom) ────────────────────
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
          temperature: 0.3,
          max_tokens: 4096,
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
  let quotaExceeded = false;
  const callGemini = async (model, key) => {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.3, maxOutputTokens: 4096 },
          }),
        }
      );
      if (r.ok) {
        const d = await r.json();
        const t = d?.candidates?.[0]?.content?.parts?.[0]?.text || "";
        if (t.length > 20) return t;
        return null;
      }
      if (r.status === 429) { quotaExceeded = true; return null; }
      const err = await r.text();
      console.error(`Gemini(${model}) HTTP ${r.status}:`, err.slice(0, 200));
      return null;
    } catch (e) {
      console.error(`Gemini(${model}) exception:`, e.message);
      return null;
    }
  };

  let responseText = "";
  let apiUsed = "";

  // ── Priority 1: user-supplied key ─────────────────────────────────────────
  if (hasUserKey) {
    const k = String(userKey).trim();
    if (effectiveProvider === "groq") {
      responseText = await callOpenAICompat("https://api.groq.com/openai/v1", k, "llama-3.3-70b-versatile") || "";
      if (!responseText) responseText = await callOpenAICompat("https://api.groq.com/openai/v1", k, "llama-3.1-8b-instant") || "";
      if (responseText) apiUsed = "groq(user)";
    } else if (effectiveProvider === "deepseek") {
      responseText = await callOpenAICompat("https://api.deepseek.com", k, "deepseek-chat") || "";
      if (responseText) apiUsed = "deepseek(user)";
    } else if (effectiveProvider === "kimi") {
      responseText = await callOpenAICompat("https://api.moonshot.cn/v1", k, "moonshot-v1-8k") || "";
      if (responseText) apiUsed = "kimi(user)";
    } else if (effectiveProvider === "custom") {
      const base = String(userCustomUrl || "").trim().replace(/\/$/, "");
      if (base) {
        responseText = await callOpenAICompat(base, k, "gpt-3.5-turbo") || "";
        if (responseText) apiUsed = "custom(user)";
      }
    } else {
      // gemini with user key
      responseText = await callGemini("gemini-2.0-flash", k) || "";
      if (!responseText) {
        await new Promise(r => setTimeout(r, 2000));
        responseText = await callGemini("gemini-2.0-flash-lite", k) || "";
      }
      if (responseText) apiUsed = "gemini(user)";
    }
  }

  // ── Priority 2: server Gemini key ─────────────────────────────────────────
  if (!responseText && GEMINI_KEY) {
    responseText = await callGemini("gemini-2.0-flash", GEMINI_KEY) || "";
    if (!responseText && quotaExceeded) {
      await new Promise(r => setTimeout(r, 4000));
      quotaExceeded = false;
      responseText = await callGemini("gemini-2.0-flash-lite", GEMINI_KEY) || "";
    }
    if (responseText) apiUsed = "gemini(server)";
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
          max_tokens: 4096,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (r.ok) {
        const d = await r.json();
        responseText = d.content?.map(b => b.text || "").join("") || "";
        if (responseText) apiUsed = "anthropic(server)";
      }
    } catch (e) {
      console.error("Anthropic exception:", e.message);
    }
  }

  if (!responseText) {
    if (quotaExceeded) {
      return res.status(429).json({
        error: "QUOTA_EXCEEDED",
        message: "Gemini API 每分钟配额已用完，请等待 1 分钟后重新上传/补题。或在首页「AI 设置」换用 DeepSeek / Kimi 等其他 API。",
      });
    }
    return res.status(500).json({
      error: "AI 调用失败。请在首页「AI 设置」配置你的 API Key（支持 DeepSeek / Kimi / Gemini）。",
    });
  }

  // ── Parse JSON ─────────────────────────────────────────────────────────────
  const clean = responseText.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  let result;
  try {
    result = JSON.parse(clean);
  } catch {
    // Try to extract the outermost JSON object
    const m = clean.match(/\{[\s\S]*\}/);
    if (!m) return res.status(500).json({ error: "AI 返回格式错误，请重试", raw: clean.slice(0, 300) });
    try { result = JSON.parse(m[0]); }
    catch { return res.status(500).json({ error: "JSON 解析失败", raw: m[0].slice(0, 300) }); }
  }

  // ── Normalise questions (field name variants across models) ───────────────
  const rawQuestions = Array.isArray(result.questions) ? result.questions
    : Array.isArray(result.problems) ? result.problems
    : Array.isArray(result.exercises) ? result.exercises
    : [];

  const questions = rawQuestions
    .filter(q => q && String(q.question || q.text || q.content || "").length > 5)
    .map(q => {
      const qText = String(q.question || q.text || q.content || "");
      const opts = Array.isArray(q.options) && q.options.length >= 2 ? q.options : null;
      return {
        question: qText,
        options: opts,
        answer: String(q.answer || q.correct_answer || (opts ? "A" : "正确")),
        explanation: String(q.explanation || q.rationale || q.reason || ""),
        type: String(q.type || (opts ? "单选题" : "判断题")),
        chapter: ch,
      };
    });

  // ── Normalise topics (field name variants across models) ──────────────────
  const rawTopics = Array.isArray(result.topics) ? result.topics
    : Array.isArray(result.concepts) ? result.concepts
    : Array.isArray(result.key_concepts) ? result.key_concepts
    : Array.isArray(result.knowledge_points) ? result.knowledge_points
    : [];

  const topics = rawTopics
    .filter(t => t && String(t.name || t.title || t.concept || "").length > 1)
    .map(t => ({
      name: String(t.name || t.title || t.concept || ""),
      summary: String(t.summary || t.description || t.explanation || ""),
    }));

  // ── Fallback: if AI returned no topics, synthesise from questions ─────────
  const finalTopics = topics.length > 0 ? topics : (() => {
    const seen = new Set();
    return questions.slice(0, 3).map((q, i) => {
      const name = ch + ` 知识点 ${i + 1}`;
      if (seen.has(name)) return null;
      seen.add(name);
      return { name, summary: q.explanation || q.question.slice(0, 60) };
    }).filter(Boolean);
  })();

  console.log(`[extract] api=${apiUsed} text=${cleanText.length}ch topics=${finalTopics.length} questions=${questions.length}`);

  return res.status(200).json({ topics: finalTopics, questions, apiUsed });
}
