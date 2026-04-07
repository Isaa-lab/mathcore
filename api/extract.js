export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { text, course, chapter, count = 5 } = req.body;

  const GEMINI_KEY = process.env.GEMINI_KEY;
  const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;

  // ── If no text, we can't do anything useful ──────────────────────────────
  if (!text || text.trim().length < 30) {
    return res.status(400).json({ error: "PDF 文字提取失败或内容太少（可能是扫描版 PDF）" });
  }

  const truncated = text.slice(0, 8000);
  const ch = chapter || course || "本章节";

  const prompt = `你是专业数学课程出题专家。请仔细阅读以下教材内容，根据内容出${count}道高质量题目。

【教材原文】：
${truncated}

【课程】：${course || "数学"}
【章节】：${ch}

出题要求：
1. 题目必须来源于上面的教材原文，考察具体知识点
2. 单选题：提供4个选项，只有一个正确，干扰项要合理
3. 判断题：options 设为 null，answer 为"正确"或"错误"
4. 解析要引用原文内容，说明为什么这个答案正确
5. 混合出单选题和判断题

严格按以下 JSON 格式返回（不要有任何其他文字、不要有代码块标记）：
{
  "topics": [
    {"name": "知识点名称", "summary": "该知识点的核心内容（30字以内）"}
  ],
  "questions": [
    {
      "question": "题目内容（具体，来自原文）",
      "options": ["A.选项1", "B.选项2", "C.选项3", "D.选项4"],
      "answer": "A",
      "explanation": "解析：为什么选A（40字以内，引用原文）",
      "type": "单选题"
    },
    {
      "question": "判断题题目内容",
      "options": null,
      "answer": "正确",
      "explanation": "解析内容",
      "type": "判断题"
    }
  ]
}`;

  let responseText = "";
  let apiUsed = "";

  // ── Try Gemini first (FREE) ───────────────────────────────────────────────
  if (GEMINI_KEY) {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.4,
              maxOutputTokens: 4000,
              responseMimeType: "application/json",
            },
          }),
        }
      );
      if (r.ok) {
        const d = await r.json();
        const candidate = d?.candidates?.[0];
        if (candidate?.finishReason === "SAFETY") {
          console.error("Gemini blocked by safety filter");
        } else {
          responseText = candidate?.content?.parts?.[0]?.text || "";
          if (responseText) apiUsed = "gemini";
        }
      } else {
        const errText = await r.text();
        console.error("Gemini error:", r.status, errText.slice(0, 200));
      }
    } catch (e) {
      console.error("Gemini fetch error:", e.message);
    }
  }

  // ── Fallback to Anthropic ─────────────────────────────────────────────────
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
          max_tokens: 4000,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (r.ok) {
        const d = await r.json();
        responseText = d.content?.map(b => b.text || "").join("") || "";
        if (responseText) apiUsed = "anthropic";
      } else {
        const errText = await r.text();
        console.error("Anthropic error:", r.status, errText.slice(0, 200));
      }
    } catch (e) {
      console.error("Anthropic error:", e.message);
    }
  }

  // ── No API available ──────────────────────────────────────────────────────
  if (!responseText) {
    const keyStatus = GEMINI_KEY ? "GEMINI_KEY 已配置但调用失败" : "未配置 GEMINI_KEY";
    return res.status(500).json({
      error: `AI 服务不可用（${keyStatus}）。请在 Vercel → Settings → Environment Variables 添加 GEMINI_KEY`,
    });
  }

  // ── Parse JSON ────────────────────────────────────────────────────────────
  const clean = responseText.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  let result;
  try {
    result = JSON.parse(clean);
  } catch (e) {
    // Try extracting JSON object
    const m = clean.match(/\{[\s\S]*\}/);
    if (m) {
      try { result = JSON.parse(m[0]); }
      catch {
        return res.status(500).json({ error: "AI 返回格式错误，请重试", raw: clean.slice(0, 200) });
      }
    } else {
      return res.status(500).json({ error: "AI 返回格式错误", raw: clean.slice(0, 200) });
    }
  }

  // ── Validate and clean questions ──────────────────────────────────────────
  const questions = (Array.isArray(result.questions) ? result.questions : [])
    .filter(q => q && q.question && q.question.length > 5)
    .map(q => ({
      question: q.question,
      options: q.options || null,
      answer: q.answer || (q.options ? "A" : "正确"),
      explanation: q.explanation || "",
      type: q.type || (q.options ? "单选题" : "判断题"),
      chapter: ch,
    }));

  const topics = (Array.isArray(result.topics) ? result.topics : [])
    .filter(t => t && t.name);

  console.log(`[extract] apiUsed=${apiUsed} questions=${questions.length} topics=${topics.length}`);

  res.status(200).json({ topics, questions, apiUsed });
}