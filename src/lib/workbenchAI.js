import { callGenerate, parseLooseJSON } from "./aiClient";

// 兜底：OCR/用户偶尔把数学写成纯文本（没 $ 包裹），渲染就成原始文本。
// 这里把"整行就是数学、且不含中文/英文长单词"的行补上 $...$；含散文的行保持原样不破坏。
const _MATH_WORDS = /^(sin|cos|tan|cot|sec|csc|log|ln|exp|lim|det|rank|tr|dim|var|cov|span|max|min|sup|inf|mod|gcd|lcm|diag|re|im|so|let|set|if|and|then)$/i;
export function autoLatex(s) {
  const t = String(s || "");
  if (!t || t.includes("$")) return t; // 已有 LaTeX 包裹就别动
  const hasMathSym = (l) => /[=~<>≤≥≠^_/]|\\[a-zA-Z]+|\^|\bN\(|\bF\(|σ|λ|∑|∫|√|±|→/.test(l);
  return t.split("\n").map((line) => {
    const ln = line.trim();
    if (!ln || /[一-龥]/.test(ln)) return line;   // 空行 / 含中文 → 不动
    if (!hasMathSym(ln)) return line;
    const words = ln.match(/[A-Za-z]{2,}/g) || [];
    const hasProse = words.some((w) => w.length >= 4 && !_MATH_WORDS.test(w)); // 有英文长单词 → 当散文，不包
    return hasProse ? line : `$${ln}$`;
  }).join("\n");
}

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

  // 取"最后一个"含 knowledgePoints 的小 JSON（不强求在结尾——模型常多带一句话/换行）
  const metaMatches = [...raw.matchAll(/\{[^{}]*"knowledgePoints"[^{}]*\}/g)];
  const metaMatch = metaMatches.length ? metaMatches[metaMatches.length - 1] : null;
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
0. 【从最顶端开始，逐块往下，第一题绝不能漏】请从图片**最上方**开始，按从上到下顺序识别。
   - 页面顶部往往有标题/姓名/学号（如 "Linear Algebra Quiz 2"、姓名、一串数字），**跳过这些**；
   - 但紧接其后的**第一个带编号的解答块（通常是 "1." 或 "1 "）必须作为第一条输出**，常见错误就是把第一题当成标题区一起略过——绝对不要跳过第 1 题。
   - 哪怕第一题的解答很短、或夹在标题下面，也要识别。
1. 这一页通常有多道题（如 1、2、3…，含子题 (i)(ii)(iii) 或 (a)(b)(c)）。每个独立题号/子题输出为一条 item，**不要把整页合并成一条**，也**不要漏掉任何一个编号块**。
2. 题号 number：${list.length > 0 ? "从上面【已知题号清单】里选" : '**原样保留学生写的编号**，如 "1"、"2(i)"、"3(b)"，不要自己加 "Q" 前缀'}。
3. 答案 studentAnswer：把该题号下学生写的**全部手写过程**都放进来——每一步推导、每个中间式、最终结论，一步都不要省。
   - 多行内容用 \\n 分隔，保留学生的推导顺序。
   - 【数学一律用 LaTeX 并用 $...$ 包裹，这条是硬性要求】行内公式 $...$，矩阵 $\\begin{pmatrix}...\\end{pmatrix}$，
     行列式 $\\begin{vmatrix}...\\end{vmatrix}$，分数 $\\frac{a}{b}$，上标 $x^2$，下标 $x_1$，
     希腊字母 $\\sigma$、$\\lambda$，服从 $\\sim$，正态 $N(0,\\sigma^2)$，分布 $F(1,1)$。
   - 【反例（禁止这样输出纯文本）】❌ "(X+Y)^2 / (X-Y)^2 ~ F(1,1)"
     【正例】✅ "$\\frac{(X+Y)^2}{(X-Y)^2} \\sim F(1,1)$"
   - 普通中文/英文说明文字不用包 $；只把数学符号/表达式包进 $...$。
   - 字迹潦草也要尽力辨认，猜出大意也比空白好；完全没作答才填 ""。
4. 【绝对禁止】不要凭手写过程反推、编造或补全"题目"——你的任务只有识别学生写了什么，question 字段一律不要输出。
5. 置信度 answerConfidence：清晰易读 → "high"；潦草但能辨认 → "low"；空白 → "low"。
6. 【区域定位 bbox — 用整数 0~1000 坐标系】给出该题所有手写行的**紧致外接框**（刚好框住，不要框到别题）：
   格式 [x0, y0, x1, y1]，整数，范围 0~1000，左上角 (0,0)、右下角 (1000,1000)，x 向右、y 向下。
   x0,y0 左上角，x1,y1 右下角，必须 x1>x0、y1>y0。这是你擅长的视觉定位，请尽量精确贴合。无法确定才省略 bbox。

【重要】即使只有一道题，也要输出 items 数组。不要输出任何多余解释。

只输出 JSON：
{"items":[{"number":"1","studentAnswer":"$CX = Y$\\n$X^T X C = X^T Y$\\n最终 $C_0=\\frac{6}{7},\\ C_1=\\frac{15}{14}$","answerConfidence":"high","bbox":[50,80,950,320]},{"number":"2(i)","studentAnswer":"$X,Y \\sim N(0,\\sigma^2)$，所以 $\\frac{(X+Y)^2}{(X-Y)^2} \\sim F(1,1)$","answerConfidence":"low","bbox":[50,340,950,600]}]}`;
  const data = await callVision(dataURI, prompt);
  // 归一化 bbox：模型可能给 0~1000（Qwen 原生）/ 0~100 / 0~1；按量级判断
  return (data?.items || []).map((it) => {
    const b = Array.isArray(it.bbox) && it.bbox.length === 4 ? it.bbox.map(Number) : null;
    let bbox = null;
    if (b && b.every((n) => Number.isFinite(n))) {
      const mx = Math.max(...b.map(Math.abs));
      const div = mx > 100 ? 1000 : mx > 1.5 ? 100 : 1;
      const [x0, y0, x1, y1] = b.map((n) => n / div);
      if (x1 > x0 && y1 > y0 && x0 >= 0 && y0 >= 0 && x1 <= 1.2 && y1 <= 1.2) {
        bbox = [Math.max(0, x0), Math.max(0, y0), Math.min(1, x1), Math.min(1, y1)];
      }
    }
    return { ...it, bbox };
  });
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

// 语义对齐：按"答案实际在解哪道题"的内容来配对，而不只看题号。
// 用于解决学生手写编号（②③）和官方题号（Q2(ii)/Q3(i)）对不上的错配。
// 返回 { 题目下标: 答案下标 }；失败返回 null（调用方回退到题号匹配）。
export async function alignAnswersToQuestions(questions, answers) {
  if (!Array.isArray(questions) || !Array.isArray(answers) || !questions.length || !answers.length) return null;
  const clip = (s) => String(s || "").replace(/\s+/g, " ").trim().slice(0, 220);
  const qList = questions.map((q, i) => `Q${i}「${q.number || "?"}」: ${clip(q.question)}`).join("\n");
  const aList = answers.map((a, i) => `A${i}「${a.number || "?"}」: ${clip(a.studentAnswer)}`).join("\n");
  const prompt = `你是阅卷助手。下面是一份卷子的"官方题目"和学生的"手写答案段"。
学生的编号常和官方编号对不上（如学生写 ②③，官方是 Q2(ii)/Q3(i)）。
请**按数学内容判断**每段答案到底在解哪道题（例如：答案在用对角化算 A^7，就对应"求 X、Λ 并计算 A^7"那道题；答案在证明 A^T 可对角化，就对应那道证明题），**不要只看编号**。

【官方题目】
${qList}

【学生答案段】
${aList}

只输出一个 JSON 数组，元素是 [题目下标, 答案下标]（即上面 Q/A 后面的整数）：
- 一段答案最多配一道题，一道题最多配一段答案；
- 配不上的就不出现；
- 数组里**只能有整数**，禁止任何公式、文字、反斜杠。
示例：[[0,0],[1,3],[2,1]]`;

  const raw = await callGenerate([{ role: "user", content: prompt }], { json: false, materialTitle: "答案语义对齐" });
  const parsed = parseLooseJSON(raw);
  if (!Array.isArray(parsed)) return null;
  const map = {};
  const usedA = new Set();
  for (const pair of parsed) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    const qi = Number(pair[0]); const ai = Number(pair[1]);
    if (!Number.isInteger(qi) || !Number.isInteger(ai)) continue;
    if (qi < 0 || qi >= questions.length || ai < 0 || ai >= answers.length) continue;
    if (qi in map || usedA.has(ai)) continue; // 保持一对一
    map[qi] = ai; usedA.add(ai);
  }
  return Object.keys(map).length ? map : null;
}

export async function gradeItem({ question, studentAnswer }) {
  // 关键：不把含 LaTeX 的"正确答案"塞进 JSON（反斜杠会破坏 JSON 解析，导致解析失败→默认判错）。
  // 仿 solveQuestion：正文输出参考解答（带公式），最后一行只输出"不含公式/反斜杠"的小 JSON。
  const prompt = `你是严谨而公正的线性代数老师，给学生的"订正答案"批改。

【题目】${question}
【学生答案】${studentAnswer || "(空白)"}

判分原则（务必遵守）：
- 这是学生订正后的答案，很可能是对的。只要**最终结论正确、关键步骤合理**，就判对（isCorrect=true），允许书写习惯、记号、排版差异。
- 不要因为"和你的解法不完全一样"就判错；不要吹毛求疵。
- 只有当结论确实错误、或关键步骤有实质错误、或学生空白时，才判错。

输出格式（严格遵守，分两部分）：
1. 先写「参考解答」：完整步骤，公式用 $...$ 包裹，可多段——这部分**不要放进 JSON**。
2. 最后**单独一行**输出元数据 JSON（放在整个回复的**最末尾**，后面不要再加任何文字/标点/换行）。该 JSON 里**绝对不能出现 LaTeX、反斜杠、美元符号或公式**，errorDetail 用纯中文口语说明错在哪：
{"isCorrect": true, "errorType": "", "errorDetail": "", "knowledgePoints": ["最小二乘法","正规方程"], "chapter": "Ch.3"}
说明：
- isCorrect 为布尔值（true/false）；
- errorType 仅在判错时给（"概念"/"计算"/"方法" 三选一），判对时留空字符串；
- **knowledgePoints 必填，给 1~3 个这道题考查的具体知识点名称（中文），不能是空数组**；
- chapter 形如 Ch.1~Ch.7。`;

  const raw = await callGenerate([{ role: "user", content: prompt }], { json: false, materialTitle: "错题批改" });
  if (!raw) return null;
  // 抓"最后一个"含 isCorrect 的小 JSON（无嵌套花括号）。不强求在结尾——
  // 模型常在 JSON 后多带一句话/换行，旧的 \s*$ 锚点会整体匹配失败 → 元数据全丢 → 误判错 + 知识点空。
  const metaMatches = [...raw.matchAll(/\{[^{}]*"isCorrect"[^{}]*\}/g)];
  const metaMatch = metaMatches.length ? metaMatches[metaMatches.length - 1] : null;
  const meta = metaMatch ? (parseLooseJSON(metaMatch[0]) || {}) : {};
  const correctAnswer = metaMatch ? raw.slice(0, metaMatch.index).trim() : raw.trim();
  return {
    correctAnswer,
    isCorrect: meta.isCorrect === true || meta.isCorrect === "true",
    errorType: meta.errorType || "",
    errorDetail: meta.errorDetail || "",
    knowledgePoints: Array.isArray(meta.knowledgePoints) ? meta.knowledgePoints : [],
    chapter: meta.chapter || "",
  };
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

// 知识点讲解缓存（localStorage）：同一个知识点不必每次点开都重调 AI，省时省钱。
// 带教材资料(existingNote)时不走缓存，保证个性化讲解新鲜。
const KP_CACHE_KEY = "mc_kp_explain_v1";
function readKpCache() {
  try { return JSON.parse(localStorage.getItem(KP_CACHE_KEY) || "{}") || {}; } catch { return {}; }
}
function writeKpCache(point, data) {
  try {
    const c = readKpCache();
    c[point] = { data, at: Date.now() };
    // 简单容量控制：超过 200 个时丢掉最旧的一半
    const keys = Object.keys(c);
    if (keys.length > 200) {
      keys.sort((a, b) => (c[a].at || 0) - (c[b].at || 0)).slice(0, keys.length - 100).forEach((k) => delete c[k]);
    }
    localStorage.setItem(KP_CACHE_KEY, JSON.stringify(c));
  } catch {}
}

export async function explainKnowledge({ point, existingNote }) {
  // 命中缓存（仅无教材资料时）直接返回
  if (point && !existingNote) {
    const hit = readKpCache()[point];
    if (hit && hit.data) return hit.data;
  }
  // 用分段标记而非 JSON：讲解里全是 $LaTeX$，塞进 JSON 会被反斜杠破坏解析 → 整段空白。
  const prompt = `你是线性代数老师。请讲解知识点「${point}」，帮助学生彻底理解。
${existingNote ? `\n已有教材资料，优先参考：\n${existingNote}\n` : ""}
严格按以下分段输出，每段以独立一行的标记开头，公式一律用 $...$ 包裹（不要用 JSON，不要代码块围栏）：

@@概要@@
（一句话核心）
@@详解@@
（详细讲解，可多段，含 $公式$）
@@要点@@
- 要点一
- 要点二
@@例子@@
（一个简单具体的例子）`;

  const raw = await callGenerate([{ role: "user", content: prompt }], { json: false, materialTitle: "知识点详解" });
  if (!raw) return null;
  // 按 @@标记@@ 切段
  const pick = (tag) => {
    const re = new RegExp(`@@${tag}@@\\s*([\\s\\S]*?)(?=@@[^@]+@@|$)`, "i");
    const m = raw.match(re);
    return m ? m[1].trim() : "";
  };
  const summary = pick("概要");
  const detail = pick("详解");
  const example = pick("例子");
  const keyPoints = pick("要点")
    .split("\n")
    .map((l) => l.replace(/^[-•·*]\s*/, "").trim())
    .filter(Boolean);
  // 完全没解析到分段时，退回把整段当详解，避免空白
  if (!summary && !detail && !keyPoints.length && !example) {
    const fallback = { summary: "", detail: raw.trim(), keyPoints: [], example: "" };
    if (point && !existingNote && fallback.detail) writeKpCache(point, fallback);
    return fallback;
  }
  const result = { summary, detail, keyPoints, example };
  if (point && !existingNote) writeKpCache(point, result);
  return result;
}

export async function generateVariant(item) {
  // 分段标记替代 JSON：题目/答案/解析全是 $LaTeX$，塞 JSON 容易因反斜杠解析失败。
  const prompt = `根据这道学生做错的题，出一道同知识点、不同数字/情境的新题，让学生重新练。

【原题】${item.question}
【考的知识点】${(item.knowledge_points || []).join("、")}

要求：难度相当，换数字或换情境，公式用 $...$。严格按以下分段输出（不要 JSON、不要代码块围栏）：
@@题目@@
（新题，含 $公式$）
@@答案@@
（最终答案）
@@解析@@
（简要解题过程，含 $公式$）`;
  const raw = await callGenerate([{ role: "user", content: prompt }], { json: false, materialTitle: "变式练习" });
  if (!raw) return null;
  const pick = (tag) => {
    const m = raw.match(new RegExp(`@@${tag}@@\\s*([\\s\\S]*?)(?=@@[^@]+@@|$)`, "i"));
    return m ? m[1].trim() : "";
  };
  const question = pick("题目");
  const answer = pick("答案");
  const explanation = pick("解析");
  const knowledgePoints = item.knowledge_points || [];
  if (!question && !answer && !explanation) {
    return { question: raw.trim(), answer: "", explanation: "", knowledgePoints };
  }
  return { question, answer, explanation, knowledgePoints };
}
