import { callGenerate, parseLooseJSON } from "./aiClient";

async function callVision(dataURI, promptText, { json = true } = {}) {
  const content = await callGenerate([{
    role: "user",
    content: [
      { type: "text", text: promptText },
      { type: "image_url", image_url: { url: dataURI } },
    ],
  }], { json: false, materialTitle: "卷子视觉提取" });
  return json ? parseLooseJSON(content) : content;
}

export async function extractPaper(dataURI) {
  const prompt = `你是数学卷子批改助手。仔细看这张卷子图片，提取每道题的信息。

要提取：
1. 题号 number
2. 题目原文 question（通常是打印的）
3. 学生的手写答案 studentAnswer（如果空着没写，填空字符串）
4. 识别置信度 answerConfidence：手写清晰 high，潦草/模糊/涂改 low

要求：
- 公式用 $...$ 包裹的 LaTeX，手写的数学符号也要尽力识别
- 不要编造：看不清就如实标 low，不要猜一个答案填上
- 跳过非题目内容（姓名、班级、页码等）

只输出 JSON，无多余文字：
{"items":[{"number":"1","question":"题目$公式$","studentAnswer":"学生答案","answerConfidence":"low"}]}`;
  const data = await callVision(dataURI, prompt);
  return data?.items || [];
}

export async function gradeItem({ question, studentAnswer }) {
  const prompt = `你是线性代数老师。判断学生答案是否正确，并分析。

【题目】${question}
【学生答案】${studentAnswer || "(空白)"}

要求：
1. 先自己解出正确答案 correctAnswer（完整步骤，公式用 $..$）
2. 对比学生答案，判断 isCorrect（true/false）
3. 若错，给 errorType（概念/计算/方法 三选一）和 errorDetail（错在哪一步）
4. 列出这道题考的知识点 knowledgePoints（1-3个）和章节 chapter（Ch.1~Ch.7）

只输出 JSON：
{"correctAnswer":"正确答案含步骤","isCorrect":false,"errorType":"计算","errorDetail":"第2步符号错","knowledgePoints":["行列式展开"],"chapter":"Ch.2"}`;
  return await callGenerate([{ role: "user", content: prompt }], { json: true, materialTitle: "错题批改" });
}

export async function summarizeWeakness(wrongItems) {
  const brief = wrongItems.map((item, index) =>
    `${index + 1}. [${item.chapter || "Ch.?"}] ${(item.knowledge_points || []).join("/")} · 错因:${item.error_type || "?"}`
  ).join("\n");
  const prompt = `这是学生的错题分布：
${brief}

用 2-3 句话总结这个学生的薄弱点和复习建议，口语化、鼓励性，不要列清单。直接输出文字，不要 JSON。`;
  return await callGenerate([{ role: "user", content: prompt }], { json: false, materialTitle: "薄弱点总结" });
}

export async function tutorReply({ item, history, userMessage }) {
  const sys = `你是耐心的线性代数私教，正在辅导学生订正一道错题。
【题目】${item.question}
【学生的错误答案】${item.student_answer}
【正确答案】${item.correct_answer}
【错因】${item.error_detail || ""}

辅导原则：
- 不要一上来就报正确答案，用引导式提问帮学生自己发现错在哪
- 一次只讲一个点，简短，像对话不像讲义
- 公式用 $...$ 包裹
- 学生答对/想通了就肯定他，并可以追问加深理解`;

  const messages = [{ role: "user", content: sys }];
  for (const h of history || []) messages.push(h);
  if (userMessage) messages.push({ role: "user", content: userMessage });
  return await callGenerate(messages, { json: false, materialTitle: "错题辅导" });
}

export async function explainKnowledge({ point, existingNote }) {
  const prompt = `你是线性代数老师。请讲解知识点「${point}」，帮助学生彻底理解。
${existingNote ? `\n已有教材资料，优先参考：\n${existingNote}\n` : ""}
输出 JSON：
{"summary":"一句话核心","detail":"详细讲解含$公式$","keyPoints":["要点1","要点2"],"visualHint":"建议的可视化方式","example":"一个简单例子"}`;
  return await callGenerate([{ role: "user", content: prompt }], { json: true, materialTitle: "知识点详解" });
}

export async function generateVariant(item) {
  const prompt = `根据这道学生做错的题，出一道同知识点、不同数字/情境的新题，让学生重新练。

【原题】${item.question}
【考的知识点】${(item.knowledge_points || []).join("、")}

要求：难度相当，换数字或换情境，公式用 $...$。
只输出 JSON：
{"question":"新题$公式$","answer":"答案","explanation":"解析","knowledgePoints":${JSON.stringify(item.knowledge_points || [])}}`;
  return await callGenerate([{ role: "user", content: prompt }], { json: true, materialTitle: "变式练习" });
}
