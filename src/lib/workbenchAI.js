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

// 批改模式：题目 + 学生手写答案都有
export async function extractPaperFromText(textContent, layout = "together") {
  const layoutHint = layout === "separate"
    ? "题目和答案是分开的：可能题目在前半段，学生手写答案在后半段或另一区域。请按题号把题目和答案配对。"
    : "题目和答案在一起：每道题下方或旁边通常就是学生的答案。";

  const prompt = `你是数学卷子批改助手。下面是从 PDF 提取的卷子文字内容，提取每道题的信息。

${layoutHint}

要提取：
1. 题号 number（如 "1"、"Q2"、"(i)" 等）
2. 题目原文 question（完整题干，公式用 $...$ LaTeX）
3. 学生的答案 studentAnswer（没有则填空字符串）
4. 置信度 answerConfidence：文字清晰 high，内容缺失 low

规则：跳过姓名/班级/页码等非题目内容；子题作为独立 item 输出。
只输出 JSON，无多余文字：
{"items":[{"number":"1","question":"题目$公式$","studentAnswer":"","answerConfidence":"high"}]}

卷子文字内容：
${textContent.slice(0, 8000)}`;

  const raw = await callGenerate([{ role: "user", content: prompt }], { json: false, materialTitle: "卷子文字提取" });
  return parseLooseJSON(raw)?.items || [];
}

// 解题模式：只有题目，无学生答案，直接解题
export async function extractQuestionsFromText(textContent) {
  const prompt = `你是数学老师。下面是从 PDF 提取的试卷/作业文字内容，请识别每道题目并整理。

要提取：
1. 题号 number（如 "Q1"、"Q2(i)"、"1" 等，子题单独列出）
2. 完整题目 question（保持原题干，公式用 $...$ LaTeX）

规则：
- 跳过非题目内容（标题、姓名、页码、说明等）
- 矩阵用 $\\begin{pmatrix}...\\end{pmatrix}$，行内公式用 $...$
- 每个子题（(i)(ii)(iii) 或 (a)(b)(c)）作为独立 item，number 写成 "Q2(i)" 形式
- 重要：如果子题 (ii)/(iii) 引用了 (i) 中定义的矩阵或符号，必须在该子题的 question 中保留那些定义，确保每个 item 独立可读

只输出 JSON，不要多余文字：
{"items":[{"number":"Q1","question":"完整题干$公式$"}]}

试卷文字内容：
${textContent.slice(0, 8000)}`;

  const raw = await callGenerate([{ role: "user", content: prompt }], { json: false, materialTitle: "题目提取" });
  return parseLooseJSON(raw)?.items || [];
}

// 解题模式：对单道题生成完整解答
// 关键设计：{ json: false } 避免把长解答塞进 JSON 字符串（LaTeX 的 \ 和 {} 会破坏 JSON 解析）
// 格式约定：AI 先输出完整解答，最后一行输出简短的元数据 JSON
export async function solveQuestion(number, question) {
  const prompt = `你是线性代数老师。请完整解答下面这道题，给出详细分步解析。

【题号】${number}
【题目】${question}

输出格式（严格遵守）：
1. 先写完整解题过程（可以多段，不要放进 JSON）
2. 最后一行单独输出元数据 JSON，不要加代码块围栏：
{"knowledgePoints":["知识点1"],"chapter":"Ch.X"}

解题过程要求：
- 行内公式用 $...$，例：令 $\\lambda$ 为特征值
- 块级公式单独一行用 $$...$$，例：$$\\det(A - \\lambda I) = 0$$
- 矩阵写法：$\\begin{pmatrix}1 & 0\\\\0 & 1\\end{pmatrix}$
- 每步都写清楚，推导不跳步
- 章节：Ch.1 行列式 / Ch.2 矩阵 / Ch.3 线性方程组 / Ch.4 向量空间 / Ch.5 特征值 / Ch.6 内积空间 / Ch.7 二次型`;

  const raw = await callGenerate([{ role: "user", content: prompt }], { json: false, materialTitle: "AI 解题" });
  if (!raw) return null;

  // 从末尾找元数据 JSON（只有一层花括号，包含 knowledgePoints 字段）
  const metaMatch = raw.match(/\{[^{}]*"knowledgePoints"[^{}]*\}\s*$/);
  const meta = metaMatch ? (parseLooseJSON(metaMatch[0]) || {}) : {};
  const solution = metaMatch ? raw.slice(0, metaMatch.index).trim() : raw.trim();

  return {
    solution: solution || raw.trim(),
    knowledgePoints: meta.knowledgePoints || [],
    chapter: meta.chapter || "",
  };
}

export async function extractPaper(dataURI, layout = "together") {
  const layoutHint = layout === "separate"
    ? "这份卷子的【题目和答案是分开的】：可能题目在前面/上方，学生手写答案在后面/下方或另一区域。请按题号把题目和对应答案配对，不要把答案错配到相邻题。"
    : "这份卷子的【题目和答案在一起】：每道题下方或旁边通常就是学生的手写答案。";

  const prompt = `你是专业的数学卷子批改助手。仔细看这张卷子图片，提取每道题的信息。

${layoutHint}

要提取：
1. 题号 number（原样保留，如 "1"、"Q2(i)" 等）
2. 题目原文 question（通常是印刷体，公式用 $...$ LaTeX）
3. 学生的手写答案 studentAnswer：
   - 尽力识别，字迹潦草也要尝试，不要因为模糊就留空
   - 学生未作答才填空字符串 ""
   - 数学公式用 $...$ LaTeX
4. 识别置信度 answerConfidence：清晰可读 → "high"，潦草但辨认出内容 → "low"，完全未作答 → "low"

跳过非题目内容（姓名、班级、页码、说明）。不要输出多余解释。

只输出 JSON：
{"items":[{"number":"1","question":"题目$公式$","studentAnswer":"学生答案","answerConfidence":"high"}]}`;
  const data = await callVision(dataURI, prompt);
  return data?.items || [];
}

// 从手写答案图片提取答案列表（分开模式专用）
// questionNumbers：已知的题号清单（来自题目文件）。传入后，模型会把每段解答对号到清单里的题号，
//                  极大降低 "2(ii) 的答案被挂到 Q1" 这类错配。
export async function extractAnswersFromImage(dataURI, questionNumbers = []) {
  const list = Array.isArray(questionNumbers) ? questionNumbers.filter(Boolean) : [];
  const rosterBlock = list.length > 0
    ? `\n【已知题号清单（必须对号入座）】这份卷子的题号是：${list.join(" , ")}
- 请把你识别到的每一段解答，对应到清单里**最匹配的那个题号**：学生写的 "1" 对应 "1"，"2.(i)" 或 "2 i" 对应 "2(i)"，依此类推。
- number 字段**必须从上面清单里原样选一个**，不要自己发明或改写格式。
- 如果某段解答实在对不上清单里任何题号，number 填 "?"（宁可标未知，也不要硬塞给某道题）。
- 学生的题号顺序未必和清单一致，请**按内容判断**归属，不要只按出现先后机械对应。\n`
    : "";

  const prompt = `你是专业的数学卷子 OCR 助手。这张图片是学生的**手写答案页**——整页可能包含多道题的解答，但**没有印刷题目**。

任务：把这一页按题号切分成多条，逐题识别学生写下的完整解答。
${rosterBlock}
【识别规则】
1. 这一页通常有多道题（如 1、2、3…，含子题 (i)(ii)(iii) 或 (a)(b)(c)）。每个独立题号/子题输出为一条 item，**不要把整页合并成一条**。
2. 题号 number：${list.length > 0 ? "从上面【已知题号清单】里选" : '**原样保留学生写的编号**，如 "1"、"2(i)"、"3(b)"，不要自己加 "Q" 前缀'}。
3. 答案 studentAnswer：把该题号下学生写的**全部手写过程**都放进来——每一步推导、每个中间式、最终结论，一步都不要省。
   - 多行内容用 \\n 分隔，保留学生的推导顺序。
   - 数学符号/公式用 $...$ LaTeX；矩阵用 $\\begin{pmatrix}...\\end{pmatrix}$，行列式用 $\\begin{vmatrix}...\\end{vmatrix}$。
   - 字迹潦草也要尽力辨认，猜出大意也比空白好；完全没作答才填 ""。
4. 【绝对禁止】不要凭手写过程反推、编造或补全"题目"——你的任务只有识别学生写了什么，question 字段一律不要输出。
5. 置信度 answerConfidence：清晰易读 → "high"；潦草但能辨认 → "low"；空白 → "low"。

【重要】即使只有一道题，也要输出 items 数组。不要输出任何多余解释。

只输出 JSON：
{"items":[{"number":"1","studentAnswer":"$C X = Y$\\n$X^T X C = X^T Y$\\n... 最终 $C_0=6/7,\\ C_1=15/14$","answerConfidence":"high"},{"number":"2(i)","studentAnswer":"...","answerConfidence":"low"}]}`;
  const data = await callVision(dataURI, prompt);
  return data?.items || [];
}

// 从纯文字答案内容提取答案列表（分开模式专用）
export async function extractAnswersFromText(text, questionNumbers = []) {
  const list = Array.isArray(questionNumbers) ? questionNumbers.filter(Boolean) : [];
  const roster = list.length > 0
    ? `\n已知题号清单：${list.join(" , ")}。number 必须从清单里选；学生写的 "2(i)" 对应清单里的 "2(i)" / "Q2(i)"；对不上填 "?"。\n`
    : "";
  const prompt = `下面是学生答案的文字内容，请提取每道题的题号和对应答案。${roster}
只输出 JSON，无多余文字：
{"items":[{"number":"1","studentAnswer":"答案内容"}]}

文字内容：
${text.slice(0, 6000)}`;
  const raw = await callGenerate([{ role: "user", content: prompt }], { json: false, materialTitle: "答案提取" });
  return parseLooseJSON(raw)?.items || [];
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
