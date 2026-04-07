export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { text, course, chapter, count = 5 } = req.body;

  const GEMINI_KEY = process.env.GEMINI_KEY;
  const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;

  if (!GEMINI_KEY && !ANTHROPIC_KEY) {
    return res.status(500).json({ error: "未配置 API Key。请在 Vercel → Settings → Environment Variables 添加 GEMINI_KEY（免费获取：aistudio.google.com/apikey）" });
  }

  if (!text || text.trim().length < 30) {
    return res.status(400).json({ error: "PDF 文字太少（可能是扫描版）。请使用可以选中文字的电子版 PDF。" });
  }

  // Clean and truncate text - remove garbage characters
  const cleanText = text
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 6000);

  const ch = (chapter && chapter !== "全部") ? chapter : (course || "本章节");

  const prompt = `你是一位专业的数学课程教师，请根据以下教材内容完成两个任务。

=== 教材内容 ===
${cleanText}
=== 结束 ===

课程：${course || "数学"}，章节：${ch}

任务一：从教材中提取 3~5 个核心知识点，每个知识点给出名称和一句话摘要。

任务二：根据教材内容出 ${count} 道题目，要求：
- 题目必须考察教材中出现的具体概念、定义、公式或方法
- 单选题：4个选项（A/B/C/D），选项内容都要有实际意义，不能用"与原文相反"或"以上都不对"之类的占位选项
- 判断题：options 设为 null，answer 为"正确"或"错误"
- 解析要说明正确答案的原因，并引用教材原文
- 题目数量：单选题和判断题混合，共 ${count} 道

请严格按以下 JSON 格式返回，不要有任何额外文字：
{
  "topics": [
    { "name": "知识点名称", "summary": "核心内容摘要（30字以内）" }
  ],
  "questions": [
    {
      "type": "单选题",
      "question": "题目内容（具体，来自教材）",
      "options": ["A.选项内容", "B.选项内容", "C.选项内容", "D.选项内容"],
      "answer": "A",
      "explanation": "解析：为什么选A，引用教材内容（50字以内）"
    },
    {
      "type": "判断题",
      "question": "判断该说法是否正确：[具体陈述]",
      "options": null,
      "answer": "正确",
      "explanation": "解析内容（30字以内）"
    }
  ]
}`;

  let responseText = "";
  let apiUsed = "";

  // ── Gemini (free) ──────────────────────────────────────────────────────────
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
              temperature: 0.3,
              maxOutputTokens: 4096,
            },
          }),
        }
      );
      if (r.ok) {
        const d = await r.json();
        const t = d?.candidates?.[0]?.content?.parts?.[0]?.text || "";
        if (t.length > 20) { responseText = t; apiUsed = "gemini"; }
        else {
          const reason = d?.candidates?.[0]?.finishReason;
          console.error("Gemini empty response, reason:", reason, JSON.stringify(d).slice(0, 300));
        }
      } else {
        const err = await r.text();
        console.error("Gemini HTTP error:", r.status, err.slice(0, 300));
      }
    } catch (e) {
      console.error("Gemini exception:", e.message);
    }
  }

  // ── Anthropic fallback ─────────────────────────────────────────────────────
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
        if (responseText) apiUsed = "anthropic";
      } else {
        const err = await r.text();
        console.error("Anthropic HTTP error:", r.status, err.slice(0, 300));
      }
    } catch (e) {
      console.error("Anthropic exception:", e.message);
    }
  }

  if (!responseText) {
    return res.status(500).json({
      error: "AI 调用失败。" + (GEMINI_KEY ? "GEMINI_KEY 已配置，请检查 Key 是否有效（去 aistudio.google.com/apikey 验证）" : "请配置 GEMINI_KEY"),
    });
  }

  // ── Parse JSON ─────────────────────────────────────────────────────────────
  const clean = responseText.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  let result;
  try {
    result = JSON.parse(clean);
  } catch {
    const m = clean.match(/\{[\s\S]*\}/);
    if (!m) return res.status(500).json({ error: "AI 返回格式错误，请重试", raw: clean.slice(0, 300) });
    try { result = JSON.parse(m[0]); }
    catch { return res.status(500).json({ error: "JSON 解析失败", raw: m[0].slice(0, 300) }); }
  }

  const questions = (Array.isArray(result.questions) ? result.questions : [])
    .filter(q => q?.question?.length > 5)
    .map(q => ({
      question: String(q.question),
      options: Array.isArray(q.options) && q.options.length >= 2 ? q.options : null,
      answer: String(q.answer || (q.options ? "A" : "正确")),
      explanation: String(q.explanation || ""),
      type: String(q.type || (q.options ? "单选题" : "判断题")),
      chapter: ch,
    }));

  const topics = (Array.isArray(result.topics) ? result.topics : [])
    .filter(t => t?.name?.length > 0)
    .map(t => ({ name: String(t.name), summary: String(t.summary || "") }));

  console.log(`[extract] api=${apiUsed} text_len=${cleanText.length} topics=${topics.length} questions=${questions.length}`);

  return res.status(200).json({ topics, questions, apiUsed });
}