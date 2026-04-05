export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { chapter, type, count } = req.body;

  const prompt = `你是数学课程出题专家，请为"${chapter}"生成${count}道${type}。要求紧贴数值分析/最优化课程内容，题目有一定难度。请以JSON数组返回，结构：[{"question":"题目内容","options":["A.选项1","B.选项2","C.选项3","D.选项4"],"answer":"A","explanation":"解析内容（50字以内）"}]。判断题和填空题的options设为null，answer直接写答案。仅返回JSON数组，不要其他任何文字。`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await response.json();
    const text = data.content?.map((b) => b.text || "").join("") || "";
    const clean = text.replace(/```json|```/g, "").trim();
    const questions = JSON.parse(clean);
    res.status(200).json({ questions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}