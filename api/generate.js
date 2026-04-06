export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { chapter, type, count } = req.body;
  const n = Math.max(2, Math.min(Number(count) || 6, 12));
  const buildLocalQuestions = () => {
    const c = chapter || "资料专题";
    const base = [
      {
        question: `关于「${c}」，下列说法最合理的是：`,
        options: [
          "A.应同时关注定义、适用条件与结论",
          "B.只需要记结论，条件可忽略",
          "C.方法可不加判断直接套用",
          "D.不需要通过例题验证理解",
        ],
        answer: "A",
        explanation: "学习应同时掌握定义、条件与结论，避免机械套用。",
      },
      {
        question: `学习「${c}」时，先理解概念再做题通常更有效。`,
        options: null,
        answer: "正确",
        explanation: "先理解概念和边界条件，有助于提高做题质量。",
      },
    ];
    const out = [];
    while (out.length < n) out.push(base[out.length % base.length]);
    return out.map((q) => ({ ...q, type: q.options ? "单选题" : "判断题", chapter: c }));
  };

  const prompt = `你是数学课程出题专家，请为"${chapter}"生成${count}道${type}。要求紧贴数值分析或最优化课程内容。单选题和多选题提供4个选项（A/B/C/D格式），填空题和判断题options设为null，每题提供简短解析（不超过60字）。请严格按照以下JSON数组格式返回，不要包含任何其他文字或代码块标记：[{"question":"题目内容","options":["A.选项1","B.选项2","C.选项3","D.选项4"],"answer":"A","explanation":"解析内容"}]`;

  try {
    if (!process.env.ANTHROPIC_KEY) {
      return res.status(200).json({ questions: buildLocalQuestions(), warning: "missing_key_fallback" });
    }
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-20241022",
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) return res.status(200).json({ questions: buildLocalQuestions(), warning: "anthropic_error_fallback" });

    const data = await response.json();
    const text = data.content?.map((b) => b.text || "").join("") || "";
    const clean = text.replace(/```json|```/g, "").trim();

    let questions;
    try {
      questions = JSON.parse(clean);
    } catch (e) {
      return res.status(200).json({ questions: buildLocalQuestions(), warning: "json_parse_fallback" });
    }
    if (!Array.isArray(questions) || questions.length === 0) {
      return res.status(200).json({ questions: buildLocalQuestions(), warning: "empty_result_fallback" });
    }
    res.status(200).json({ questions });
  } catch (err) {
    res.status(200).json({ questions: buildLocalQuestions(), warning: "exception_fallback" });
  }
}
