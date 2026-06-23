import { callGenerate, parseLooseJSON, AUX_TEXT_MODEL, SOLVE_TEXT_MODEL } from "./aiClient";

// 兜底：OCR/用户偶尔把数学写成裸 LaTeX 或纯符号（没 $ 包裹），渲染就成原始文本。
// 这里按"数学片段"分段包裹：把连续的数学 token 包进 $...$，散文 token 原样留下。
const _MATH_WORDS = /^(sin|cos|tan|cot|sec|csc|log|ln|exp|lim|det|rank|tr|dim|var|cov|span|max|min|sup|inf|mod|gcd|lcm|diag|re|im)$/i;
// 判断一个 token 是不是"数学"（不含空格的片段）
function _isMathTok(tk) {
  if (!tk || !tk.trim()) return false;
  if (tk.includes("%")) return false;                 // % 在数学模式是注释 → 当文本
  if (/^[一-龥]/.test(tk)) return false;        // 中文 → 文本
  if (/\\[a-zA-Z]+/.test(tk)) return true;             // 含 LaTeX 命令（\frac \sigma \Rightarrow…）
  // 去掉 LaTeX 命令后看是否还有英文长单词 → 有则当散文
  const bare = tk.replace(/\\[a-zA-Z]+/g, "");
  if (/[A-Za-z]{4,}/.test(bare) && !_MATH_WORDS.test(bare)) return false;
  if (/[=~<>≤≥≠^_{}\\∑∫√±→/]|[a-zA-Z]\^|\d[+\-*/]|[（(][^)]*[=^_]/.test(tk)) return true;
  if (/^[A-Za-z]$/.test(tk)) return true;              // 单字母变量
  if (/^[-+()0-9.,]+$/.test(tk)) return true;          // 纯数字/括号
  return false;
}
// OCR 常把"换行"写成字面量反斜杠-n：JSON 路径里模型按提示写 \\n，JSON.parse 后变成两字符 \n（不是真换行）；
// 纯文本路径模型直接写字面量 \n。这些会漏进渲染显示成乱码（\nso、\n⇒…）。
// 这里把【数学 $...$ 之外】的字面量 \n / \r\n 还原成真换行；数学片段内保持原样，
// 以保护 \nabla、\neq、\ni、矩阵换行 \\ 等真正的 LaTeX 命令。
export function normalizeNewlineEscapes(s) {
  const t = String(s || "");
  if (!t || (!t.includes("\\n") && !t.includes("\\r"))) return t;
  // 按 $$...$$ / $...$ 切成 [文本, 数学, 文本, 数学, …]，只在文本段还原换行
  return t.split(/(\$\$[\s\S]*?\$\$|\$[^$]*\$)/)
    .map((seg, i) => (i % 2 === 1 ? seg : seg.replace(/\\r\\n|\\r|\\n/g, "\n")))
    .join("");
}

export function autoLatex(s) {
  let t = normalizeNewlineEscapes(String(s || ""));
  if (!t) return t;
  // 先把 \(...\) / \[...\] 归一化成 $...$ / $$...$$
  t = t.replace(/\\[()]/g, "$").replace(/\\[[\]]/g, () => "$$");
  if (t.includes("$")) return t; // 已有 LaTeX 包裹就别动
  return t.split("\n").map((line) => {
    if (!line.trim()) return line;
    const tokens = line.split(/(\s+)/); // 保留空白
    let out = "", buf = [];
    const flush = () => { if (buf.length) { out += "$" + buf.join("").trim() + "$"; buf = []; } };
    for (const tk of tokens) {
      if (!tk.trim()) { if (buf.length) buf.push(tk); else out += tk; continue; } // 空白：数学串内保留
      if (_isMathTok(tk)) buf.push(tk);
      else { flush(); out += tk; }
    }
    flush();
    return out;
  }).join("\n");
}

// 把用户随便写的数学（如 "(X+Y)^2/(X-Y)^2 ~ F(1,1)"）转写成规范 LaTeX 并用 $...$ 包裹。
// 让用户不必懂 LaTeX：敲普通写法 → AI 转 → 直接渲染。
export async function toLatex(text) {
  const t = String(text || "").trim();
  if (!t) return t;
  const prompt = `把下面的数学内容转写成规范 LaTeX：把所有数学符号/表达式用 $...$ 包裹（行内）或 $$...$$（独立成行的大公式）；普通中文/英文说明文字保留原样、不要包。
矩阵用 $\\begin{pmatrix}...\\end{pmatrix}$，分数用 \\frac，上标 ^{}，下标 _{}，希腊字母用命令（\\sigma 等），服从用 \\sim。
只输出转写后的文本本身，不要任何解释、不要代码块围栏。

原始内容：
${t}`;
  const raw = await callGenerate([{ role: "user", content: prompt }], { json: false, materialTitle: "公式转写", textModel: AUX_TEXT_MODEL });
  const out = String(raw || "").replace(/^```[a-z]*\s*/i, "").replace(/```$/i, "").trim();
  return out || t;
}

// 识别一张"局部截图"（用户在原图上框选出来的一块）：逐行转写其中手写内容。
export async function extractRegion(dataURI) {
  const prompt = `这是一张手写数学的**局部截图**（只是某道题答案的一部分）。请把图中所有手写内容逐行转写出来：
- 数学一律用 $...$ LaTeX 包裹（分数 \\frac、上下标 ^{}/_{}、希腊字母、矩阵 \\begin{pmatrix}...\\end{pmatrix} 等），普通中英文说明保留、不包；
- 【矩阵/向量要逐行逐列数清楚】先数清这个矩阵有几行几列，再逐个元素抄写，**行数列数必须和图里完全一致**——常见错误是把 4 行的列向量/矩阵少抄成 3 行、或把两个相邻元素合并。矩阵每一行用 \\\\ 分隔、同行元素用 & 分隔，务必核对行数。
- 多行用 \\n 分隔，保持从上到下的顺序；字迹潦草也尽力辨认。
只输出转写后的纯文本，不要 JSON、不要解释、不要代码块。`;
  const call = (model) => callGenerate([{
    role: "user",
    content: [
      { type: "text", text: prompt },
      { type: "image_url", image_url: { url: dataURI } },
    ],
  }], { json: false, materialTitle: "区域识别", visionModel: model });
  // 笔记检测统一用 qwen-vl-max；若不通再退到 qwen3-vl-plus 兜底。
  let raw = "";
  try { raw = String(await call("qwen-vl-max") || "").trim(); } catch { raw = ""; }
  if (!raw) { try { raw = String(await call("qwen3-vl-plus") || "").trim(); } catch { raw = ""; } }
  return normalizeNewlineEscapes(raw);
}

async function callVision(dataURI, promptText, { json = true } = {}) {
  const content = await callGenerate([{
    role: "user",
    content: [
      { type: "text", text: promptText },
      { type: "image_url", image_url: { url: dataURI } },
    ],
  }], { json: false, materialTitle: "卷子视觉提取", visionModel: "qwen-vl-max" }); // 笔记检测统一用 qwen-vl-max（手写更准）
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

  const raw = await callGenerate([{ role: "user", content: prompt }], { json: false, materialTitle: "卷子文字提取", textModel: AUX_TEXT_MODEL });
  return (parseLooseJSON(raw)?.items || []).map((it) => ({ ...it, studentAnswer: normalizeNewlineEscapes(it.studentAnswer) }));
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

  const raw = await callGenerate([{ role: "user", content: prompt }], { json: false, materialTitle: "题目提取", textModel: AUX_TEXT_MODEL });
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

  const raw = await callGenerate([{ role: "user", content: prompt }], { json: false, materialTitle: "AI 解题", textModel: SOLVE_TEXT_MODEL });
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
   - 【全部写完，不要中途截断】把该题学生写的全部过程都识别进来；若一道题内部分成 ①②③ / (a)(b)(c) / 多个小证明，必须把每个小部分都识别全，一直到该题最后一行——只写开头一两步就停是常见错误，禁止
   - 数学公式用 $...$ LaTeX
4. 识别置信度 answerConfidence：清晰可读 → "high"，潦草但辨认出内容 → "low"，完全未作答 → "low"
5. 【满分与老师红笔批改 — 没有就省略；只认红色笔迹】maxScore：题目印着分值时填数字。teacherMark：红笔对该题的整体判定——大红叉/划掉="wrong"，打勾="correct"，只圈出部分="partial"。teacherScorePct：仅当红笔写了数字得分/扣分时填（0~100）。teacherComment：红笔文字批注。没有红笔则全省略。

跳过非题目内容（姓名、班级、页码、说明）。不要输出多余解释。

只输出 JSON：
{"items":[{"number":"1","question":"题目$公式$","studentAnswer":"学生答案","answerConfidence":"high"}]}`;
  const data = await callVision(dataURI, prompt);
  return (data?.items || []).map((it) => ({ ...it, studentAnswer: normalizeNewlineEscapes(it.studentAnswer), ...pickScoreFields(it) }));
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
   - 【绝对不要中途截断】一道题的答案常常很长、跨很多行，或内部分成 ①②③ / (a)(b)(c) / 多个小证明（例如"求 A、B=A^4、C=… 三个矩阵的特征值"要把三个都写全；一道证明题写了"证明等式"又写了"证明特征值模为1"要两段都写全）。**必须一直识别到该题最后一行为止，把所有小部分都包含进来**，常见错误就是只写了开头一两步就停——禁止这样。
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
7. 【满分与老师红笔批改 — 没有就一律省略这些字段；只认红色笔迹，黑色学生原笔迹不算】
   - maxScore：题目附近**印着该题分值**（如 "(10 marks)"、"[5分]"）时填数字，否则省略。
   - teacherMark：老师红笔对这道题的**整体判定**，看红笔符号判断——
       整道题被**大红叉/红线划掉/打 ✗** → "wrong"；
       红笔**打勾 ✓/√** → "correct"；
       只**圈出或划掉其中一部分、或个别地方标错**（其余没动） → "partial"。
   - teacherScorePct：**只有老师真的用红笔写了数字得分/扣分**才填（换算成 0~100，如满分 10 给 8→80，只写"-2"且满分 10→80）；只打符号没写数字就**不要填这个字段**，用 teacherMark 即可。
   - teacherComment：红笔的文字批注原文（如有）。
   - 没有任何红笔批改 → 以上 teacher* 字段全部省略。

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
    return { ...it, studentAnswer: normalizeNewlineEscapes(it.studentAnswer), bbox, ...pickScoreFields(it) };
  });
}

// 从 OCR item 里取出"满分 / 老师红笔批改"字段并归一化（缺失则不带这些键）
// 关键：老师红笔常常是符号标记（打叉/圈错/打勾/划掉），不是分数。teacherMark 捕获这种"整体判定"，
// teacherScorePct 只在老师真写了数字时才有。
function pickScoreFields(it) {
  const out = {};
  const max = Number(it.maxScore);
  if (Number.isFinite(max) && max > 0) out.maxScore = max;
  const tc = String(it.teacherComment || "").trim();
  if (tc) out.teacherComment = tc;
  const ts = Number(it.teacherScorePct);
  // 防幻觉：模型在没有红笔时常默认回 0。裸的 0（没有红笔批注佐证）一律丢弃，不当作"老师给了 0 分"。
  if (Number.isFinite(ts) && (ts > 0 || tc)) out.teacherScorePct = Math.max(0, Math.min(100, Math.round(ts)));
  const tm = String(it.teacherMark || "").trim().toLowerCase();
  if (tm) {
    if (/correct|right|tick|check|对|✓|√/.test(tm)) out.teacherMark = "correct";
    else if (/partial|part|部分|半/.test(tm)) out.teacherMark = "partial";
    else if (/wrong|incorrect|cross|错|✗|✘|x|×/.test(tm)) out.teacherMark = "wrong";
  }
  return out;
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
  const raw = await callGenerate([{ role: "user", content: prompt }], { json: false, materialTitle: "答案提取", textModel: AUX_TEXT_MODEL });
  return (parseLooseJSON(raw)?.items || []).map((it) => ({ ...it, studentAnswer: normalizeNewlineEscapes(it.studentAnswer) }));
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

  const raw = await callGenerate([{ role: "user", content: prompt }], { json: false, materialTitle: "答案语义对齐", textModel: AUX_TEXT_MODEL });
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
  const prompt = `你是公正的线性代数老师，给学生的"订正答案"批改。先自己把题目完整解出最终结果，再对照学生答案，**按数学正确性公正判分，既不放水也不吹毛求疵**。

【题目】${question}
【学生答案】${studentAnswer || "(空白)"}

【重要：学生答案是 OCR 转写的，可能有噪声，判分前先"读懂学生真正写了什么"】
- 矩阵维度/元素、上下标、分隔符可能被 OCR 读乱（例如把 4×2 设计矩阵读成 2 维向量、逗号当成换行、多余符号）。**遇到看起来"维度不对/写法奇怪"的中间式，先假设是 OCR 噪声，结合上下文还原学生本意，不要据此判错。**
- 判分以**最终答案/最终结论**为主：只要学生的最终结果正确、推导主线合理，即使某些中间步骤被 OCR 弄乱，也判 correct。
- 拼写错误（如 define↔definite、漏字母）、英文术语不标准、记号差异、笔误，**一律不作为判错依据**——这是硬性规定，违反即误判。

判分档位（三选一，写进 verdict）：
- "correct"（判对）：最终结果/结论正确，核心步骤合理。**解法不同、记号差异、排版不同、明显的笔误或拼写错（如 define↔definite）、把变量名标反但实际计算正确、OCR 把中间式读乱——都仍判 correct**。证明题只要逻辑主线成立即 correct。
- "minor"（基本正确，有小瑕疵）：最终结果对、主线对，但有**不影响结论的小问题**（如个别记号写错、漏写一句过渡、某个等价号用得不严谨）。这种也算学生掌握了，note 里一句话点出小瑕疵。
- "wrong"（判错）：仅当**最终结果确实错误 / 缺少题目要求的部分（如漏解、漏证某方向、题目要求对三个矩阵都求但只做了一个）/ 有实质概念或计算错误 / 没做完 / 空白**。
重要：**不要因为"写法不够规范""不是你的解法""有笔误/拼写错""OCR 看着乱"就判 wrong**——只看数学对不对。判 wrong 前先确认：学生的最终答案是不是真的和正确答案不一致？

输出格式（分两部分）：
1. 先写「参考解答」：完整步骤，公式用 $...$ 包裹——不要放进 JSON。
2. 最后**单独一行**输出元数据 JSON（放回复最末尾，之后不要再有任何字符）。JSON 里**禁止 LaTeX/反斜杠/美元符号/公式**，note 与 errorDetail 用纯中文口语：
{"verdict": "correct", "scorePct": 100, "note": "", "errorType": "", "errorDetail": "", "knowledgePoints": ["最小二乘法","正规方程"], "chapter": "Ch.3"}
- verdict 取 "correct"/"minor"/"wrong"；
- scorePct：0~100 的整数，这道题的**得分百分比**（按数学正确性与完成度给，像阅卷老师那样）。correct 一般 90~100；minor 78~92；wrong 按完成度与错误严重程度给 0~65（做对了一半给一半分，完全空白/没做给 0）。务必和 verdict 自洽。
- note 仅 minor 时给（一句话点小瑕疵），其余留空；
- errorType+errorDetail 仅 wrong 时给（errorType 取 "概念"/"计算"/"方法"），errorDetail 说清错在哪一步、最终结果应是什么；
- knowledgePoints 必填 1~3 个中文知识点，不能空；chapter 形如 Ch.1~Ch.7。`;

  // 批改判断优先走 DeepSeek（数学推理更强，避免 qwen-plus 自相矛盾乱判）；deepseek 不通时后端自动回退 qwen。
  const raw = await callGenerate([{ role: "user", content: prompt }], { json: false, materialTitle: "错题批改", textProvider: "deepseek" });
  if (!raw) return null;
  const metaMatches = [...raw.matchAll(/\{[^{}]*"verdict"[^{}]*\}/g)];
  const metaMatch = metaMatches.length ? metaMatches[metaMatches.length - 1] : null;
  const meta = metaMatch ? (parseLooseJSON(metaMatch[0]) || {}) : {};
  const correctAnswer = metaMatch ? raw.slice(0, metaMatch.index).trim() : raw.trim();
  const verdict = String(meta.verdict || "").toLowerCase();
  const isWrong = verdict === "wrong";
  // 得分百分比：模型给了就用（夹到 0~100），没给则按档位兜底
  let scorePct = Number(meta.scorePct);
  if (!Number.isFinite(scorePct)) scorePct = isWrong ? 30 : verdict === "minor" ? 85 : 100;
  scorePct = Math.max(0, Math.min(100, Math.round(scorePct)));
  return {
    correctAnswer,
    isCorrect: !isWrong,                          // correct 与 minor 都算对
    scorePct,
    minorNote: verdict === "minor" ? (meta.note || "有小瑕疵，已基本掌握") : "",
    errorType: isWrong ? (meta.errorType || "计算") : "",
    errorDetail: isWrong ? (meta.errorDetail || "") : "",
    knowledgePoints: Array.isArray(meta.knowledgePoints) ? meta.knowledgePoints : [],
    chapter: meta.chapter || "",
  };
}

// 关键题复核：只兜底抓"明显没做完 / 最终结果明显错"这类硬伤，**不做严格性挑刺**。
// 返回 { ok, reason }：ok=false 时 reason 是一句话原因（用于翻转后填错因，避免"未给出具体说明"）。
export async function verifyGrade({ question, studentAnswer }) {
  if (!studentAnswer || !String(studentAnswer).trim()) return { ok: false, reason: "未作答（空白）" };
  const prompt = `复核一道已被判"对"的题，只判断它有没有**硬伤**：是否没做完（缺最终结果/写到一半中断）、或最终结果与正确答案明显不一致。
注意：解法不同、记号差异、笔误、写法不规范都**不算硬伤**，这些仍算 OK。只有"没做完"或"最终结果确实错"才算有硬伤。

【题目】${question}
【学生答案】${studentAnswer}

只输出一行 JSON（禁止公式/反斜杠）：{"ok": true, "reason": ""}
ok=true 表示没硬伤（保持判对）；ok=false 表示确有硬伤，reason 用一句纯中文说明（如"只算到第二步就没了，缺最终结果"）。`;
  const raw = await callGenerate([{ role: "user", content: prompt }], { json: false, materialTitle: "判分复核", textProvider: "deepseek" });
  const m = [...String(raw || "").matchAll(/\{[^{}]*"ok"[^{}]*\}/g)];
  const meta = m.length ? (parseLooseJSON(m[m.length - 1].toString ? m[m.length - 1][0] : m[m.length - 1][0]) || {}) : {};
  if (meta.ok === false || meta.ok === "false") return { ok: false, reason: meta.reason || "复核发现答案未完成或最终结果不正确" };
  return { ok: true, reason: "" }; // 拿不准不误伤
}

export async function summarizeWeakness(wrongItems) {
  const brief = wrongItems.map((item, index) =>
    `${index + 1}. [${item.chapter || "Ch.?"}] ${(item.knowledge_points || []).join("/")} · 错因:${item.error_type || "?"}`
  ).join("\n");
  const prompt = `这是学生的错题分布：
${brief}

用 2-3 句话总结这个学生的薄弱点和复习建议，口语化、鼓励性，不要列清单。直接输出文字，不要 JSON。`;
  return await callGenerate([{ role: "user", content: prompt }], { json: false, materialTitle: "薄弱点总结", textModel: AUX_TEXT_MODEL });
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
  return await callGenerate(messages, { json: false, materialTitle: "错题辅导", textModel: AUX_TEXT_MODEL });
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

  const raw = await callGenerate([{ role: "user", content: prompt }], { json: false, materialTitle: "知识点详解", textModel: AUX_TEXT_MODEL });
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
  const raw = await callGenerate([{ role: "user", content: prompt }], { json: false, materialTitle: "变式练习", textModel: AUX_TEXT_MODEL });
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
