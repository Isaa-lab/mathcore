export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { text, course, chapter, count = 5 } = req.body;
  if (!text) return res.status(400).json({ error: "缺少 PDF 文本内容" });
  const buildLocalFallback = () => {
    const src = String(text || "").replace(/\s+/g, " ").trim();
    const sents = src.split(/[。！？.!?]/).map((s) => s.trim()).filter((s) => s.length >= 10);
    const topics = (sents.slice(0, 4).length ? sents.slice(0, 4) : ["核心概念", "条件与结论"])
      .map((s, i) => ({ name: `${chapter || "资料专题"} 知识点 ${i + 1}`, summary: s.slice(0, 80) }));
    const n = Math.max(2, Math.min(Number(count) || 5, 10));
    const baseQ = [
      {
        question: `关于「${chapter || "资料专题"}」，下列说法最合理的是：`,
        options: [
          "A.应同时关注定义、前提条件与结论",
          "B.只记结论，不看适用条件",
          "C.任何情况下都可直接套用方法",
          "D.无需用例题检验理解",
        ],
        answer: "A",
        explanation: "系统学习应结合定义、条件和结论。",
      },
      {
        question: `学习「${chapter || "资料专题"}」时，先理解概念再做题通常更有效。`,
        options: null,
        answer: "正确",
        explanation: "概念和边界条件清晰后，做题正确率更高。",
      },
    ];
    const questions = [];
    while (questions.length < n) questions.push(baseQ[questions.length % baseQ.length]);
    return { topics, questions };
  };
  if (!process.env.ANTHROPIC_KEY) return res.status(200).json(buildLocalFallback());

  const truncated = text.slice(0, 6000);

  const prompt = `你是数学课程助教，请根据以下教材内容完成两项任务。

【教材内容】（节选）：
${truncated}

【课程】：${course || "数学"}
【章节】：${chapter || "未知章节"}

任务一：提取 3-5 个核心知识点，每个知识点包含名称和一句话简介。
任务二：根据教材内容生成 ${count} 道单选题，每题必须含 4 个选项（A–D），附正确答案和解析。
严禁使用占位题干：不得出现「第几个理解点」「本资料第 N 点」等无实质内容的题目；题干必须直接引用或改写教材中的具体事实、定义或结论。

请严格按照以下 JSON 格式返回，不要包含其他文字：
{
  "topics": [
    {"name": "知识点名称", "summary": "一句话简介"}
  ],
  "questions": [
    {"question": "题目内容", "options": ["A.选项1","B.选项2","C.选项3","D.选项4"], "answer": "A", "explanation": "解析内容（50字以内）"}
  ]
}`;

  try {
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

    if (!response.ok) return res.status(200).json(buildLocalFallback());

    const data = await response.json();
    const raw = data.content?.map(b => b.text || "").join("") || "";
    const clean = raw.replace(/```json|```/g, "").trim();

    let result;
    try {
      result = JSON.parse(clean);
    } catch (e) {
      return res.status(200).json(buildLocalFallback());
    }

    const topics = Array.isArray(result?.topics) ? result.topics : [];
    const questions = Array.isArray(result?.questions) ? result.questions : [];
    if (!topics.length && !questions.length) return res.status(200).json(buildLocalFallback());
    res.status(200).json({ topics, questions });
  } catch (err) {
    res.status(200).json(buildLocalFallback());
  }
}