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

  // Clean and truncate: remove control chars, collapse whitespace, then pick the
  // most content-dense 8000 chars (skip very short lines that are likely page numbers)
  const preCleaned = text
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // Filter out lines that are clearly noise (page numbers, lone digits, very short fragments)
  const filteredLines = preCleaned
    .split("\n")
    .filter(l => {
      const t = l.trim();
      if (t.length === 0) return false;
      // pure page numbers or very short lines (< 4 chars)
      if (/^\d+$/.test(t) && t.length <= 4) return false;
      return true;
    })
    .join("\n");

  // Prefer the first 8000 chars of content (after the above cleaning)
  const cleanText = filteredLines.slice(0, 8000);

  const ch = (chapter && chapter !== "全部") ? chapter : (course || "本章节");

  // Detect if content is likely English (helps AI respond in the right style)
  const englishRatio = (cleanText.match(/[a-zA-Z]/g) || []).length / Math.max(cleanText.length, 1);
  const isEnglish = englishRatio > 0.4;

  const prompt = `You are an expert mathematics professor. Based ONLY on the textbook excerpt below, complete two tasks.

=== TEXTBOOK CONTENT (${isEnglish ? "English" : "Chinese"}) ===
${cleanText}
=== END ===

Course: ${course || "Mathematics"}, Topic: ${ch}

TASK 1: Extract 3–5 key concepts from the text. Each concept needs a name and a one-sentence summary that directly references the text.

TASK 2: Generate exactly ${count} exam questions based STRICTLY on the textbook content above.
Rules:
- Every question must test a SPECIFIC concept, definition, theorem, formula, or numerical method from the text
- Multiple-choice: provide 4 options (A/B/C/D). All distractors must be plausible mathematical alternatives — NEVER use "none of the above", "opposite of the text", or placeholder options
- True/False: set options to null, answer is "True"/"False" (English) or "正确"/"错误" (Chinese)
- Include at least one computational or application question if the text contains formulas/algorithms
- Explanation must cite the specific part of the text that justifies the answer (≤60 words)
- DO NOT invent theorems, formulas, or values not present in the text

Respond ONLY with valid JSON, no extra text:
{
  "topics": [
    { "name": "concept name", "summary": "one-sentence summary citing the text" }
  ],
  "questions": [
    {
      "type": "单选题",
      "question": "Question text (specific, grounded in the textbook)",
      "options": ["A. option", "B. option", "C. option", "D. option"],
      "answer": "A",
      "explanation": "Why A is correct, citing the text (≤60 words)"
    },
    {
      "type": "判断题",
      "question": "True or False: [specific claim from the text]",
      "options": null,
      "answer": "正确",
      "explanation": "Explanation citing the text (≤40 words)"
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