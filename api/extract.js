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

  const prompt = `You are an expert mathematics professor generating study materials from a textbook excerpt.

CRITICAL WARNING — The text below was extracted from a PDF and may contain GARBLED mathematical notation:
- Superscripts/subscripts may be broken: "x 2" means x², "d t 2" means d²/dt², "x n" means xₙ
- Operators may be separated by spaces: "d y / d x" means dy/dx
- Greek letters may appear as: "theta", "θ", "α", "β", "λ", "μ" etc.
YOU MUST reconstruct all formulas correctly in standard mathematical notation before using them.
NEVER copy garbled text verbatim into questions or topic names.

=== TEXTBOOK EXCERPT (${isEnglish ? "English" : "Chinese"}) ===
${cleanText}
=== END ===

Course: ${course || "Mathematics"} | Topic: ${ch}

TASK 1 — Extract exactly 3 to 5 key concepts (topics). Each must have:
  - "name": short concept name (3–6 words, clean, no garbled text)
  - "summary": one sentence explaining the concept clearly

TASK 2 — Generate exactly ${count} exam questions from the text. Rules:
- Base every question on a SPECIFIC definition, theorem, method, or result in the text
- REWRITE all mathematical expressions in clean standard notation (fix garbled text)
- Multiple-choice (单选题): exactly 4 options A/B/C/D, all plausible distractors
- True/False (判断题): options=null, answer="正确" or "错误"
- Mix types: at least ${Math.max(1, Math.floor(count * 0.6))} multiple-choice and at least 1 true/false
- Explanation ≤ 50 words, must justify the answer

Output ONLY this JSON, no markdown, no extra text:
{
  "topics": [
    { "name": "Separation of Variables", "summary": "A method to solve ODEs by separating x and y terms to opposite sides." }
  ],
  "questions": [
    { "type": "单选题", "question": "Which condition must hold for a first-order ODE dy/dx = f(x,y) to be solvable by separation of variables?", "options": ["A. f can be written as g(x)·h(y)", "B. f is linear in y", "C. f is constant", "D. f depends only on x"], "answer": "A", "explanation": "Separation of variables requires f(x,y) = g(x)·h(y) so each side can be integrated independently." },
    { "type": "判断题", "question": "判断：dy/dx = x·y² 可以用分离变量法求解。", "options": null, "answer": "正确", "explanation": "该方程可改写为 dy/y² = x dx，两侧分别对 x 和 y 积分即可求解。" }
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
