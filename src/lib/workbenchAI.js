import { callGenerate, parseLooseJSON, AUX_TEXT_MODEL, SOLVE_TEXT_MODEL } from "./aiClient";

// 图片识别用的 Qwen 视觉模型，按优先级回退：最强的 qwen3-vl-235b-a22b-thinking 先上，
// 它（在 Hobby 60s 内）跑不完/出错就退到 qwen-vl-max，再退 qwen-vl-plus，保证有结果不 500。
// 想换模型只改这一处（必须是百炼里真实可用的视觉模型 ID）。
const VISION_MODELS = ["qwen3-vl-235b-a22b-thinking", "qwen-vl-max", "qwen-vl-plus"];

// 把 dataURI 等比缩到长边 <= maxPx（已更小则原样返回）。只用于"送整页 OCR 的副本"，
// 让 qwen-vl-max 满页也能在 55~60s 预算内返回；校对展示/框选裁剪仍用原始高清图。
function shrinkDataUri(uri, maxPx = 2000) {
  return new Promise((res) => {
    if (typeof document === "undefined" || !/^data:image\//.test(String(uri || ""))) { res(uri); return; }
    const img = new Image();
    img.onerror = () => res(uri);
    img.onload = () => {
      const long = Math.max(img.width, img.height);
      if (!long || long <= maxPx) { res(uri); return; }
      const s = maxPx / long;
      const w = Math.round(img.width * s), h = Math.round(img.height * s);
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      const ctx = c.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, w, h);
      res(c.toDataURL("image/jpeg", 0.9));
    };
    img.src = uri;
  });
}

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
// 但 \right、\neq、\nabla、\rho、\rangle… 这些是真 LaTeX 命令，开头也是 \r/\n，绝不能当换行删
// （之前的 bug：参考答案里 \right 被删成 "ight)"、\neq 删成 "eq"）。
// 做法：只在【数学 $...$ 之外】处理；命中白名单命令就保留，否则把 \r/\n 当换行、保留其后字母。
const _KEEP_NR_CMD = /^(?:n(?:eq|e|i|u|ot|otin|abla|atural|leq|geq|leqslant|geqslant|less|gtr|mid|parallel|sim|cong|equiv|exists|subseteq|supseteq|subset|supset|rightarrow|leftarrow|leftrightarrow|vdash|vDash|Vdash)|r(?:ight|ightarrow|ightleftharpoons|ightharpoonup|ightharpoondown|angle|ceil|floor|ho|times|moustache|estriction))$/;
export function normalizeNewlineEscapes(s) {
  const t = String(s || "");
  if (!t || (!t.includes("\\n") && !t.includes("\\r"))) return t;
  return t.split(/(\$\$[\s\S]*?\$\$|\$[^$]*\$)/)
    .map((seg, i) => (i % 2 === 1 ? seg
      : seg.replace(/\\([rn])([a-zA-Z]*)/g, (m, c, rest) =>
          (_KEEP_NR_CMD.test(c + rest) ? m : "\n" + rest))))
    .join("");
}

// 清掉 OCR（尤其 qwen-vl-ocr）吐的"文档级 LaTeX"包装：markdown 代码围栏、enumerate/itemize/
// equation 等环境——这些 KaTeX 渲染不了，会显示成原始码。把它们去壳/转成我们能渲染的形式。
export function stripOcrWrappers(s) {
  let t = String(s || "");
  if (!t) return t;
  t = t.replace(/```[a-zA-Z]*\s*/g, "").replace(/```/g, "");                 // 去 markdown 代码围栏
  t = t.replace(/\\begin\{(?:equation|displaymath|align|gather|multline|math)\*?\}/g, "$$")
       .replace(/\\end\{(?:equation|displaymath|align|gather|multline|math)\*?\}/g, "$$"); // 公式环境 → $$
  t = t.replace(/\\begin\{(?:enumerate|itemize)\}/g, "").replace(/\\end\{(?:enumerate|itemize)\}/g, ""); // 列表去壳
  t = t.replace(/\\item\s*/g, "\n");                                          // \item → 换行
  t = t.replace(/\$\$\s*\$\$/g, "").replace(/\n{3,}/g, "\n\n");               // 清空壳/多余空行
  return t.trim();
}

export function autoLatex(s) {
  let t = normalizeNewlineEscapes(stripOcrWrappers(String(s || "")));
  if (!t) return t;
  // 先把 \(...\) / \[...\] 归一化成 $...$ / $$...$$
  t = t.replace(/\\[()]/g, "$").replace(/\\[[\]]/g, () => "$$");
  // 在【$...$ 之外】的散文区做两件事：
  // (a) 清掉 OCR 给英文散文乱加的 LaTeX 间距转义（\ 空格、\, \; \: \! \quad \qquad）→ 普通空格；
  //     这类是"because\ A \in...\ is..."里把空格写成 \ 造成的，KaTeX 渲染不出。
  // (b) 把裸的 \begin{matrix/…}…\end{…} 整体包成 $$…$$（可与已有 $ 公式混排），避免被按行拆碎成原始码。
  t = t.split(/(\$\$[\s\S]*?\$\$|\$[^$]*\$)/)
    .map((seg, i) => (i % 2 === 1 ? seg
      : seg
        .replace(/\\[ ,;:!]/g, " ")
        .replace(/\\(?:qquad|quad)\b/g, " ")
        .replace(/\\begin\{(pmatrix|bmatrix|vmatrix|Vmatrix|matrix|cases|array|aligned|align)\*?\}[\s\S]*?\\end\{\1\*?\}/g, (m) => `$$${m}$$`)))
    .join("");
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

// 专业手写数学 OCR（Mathpix/SimpleTex，后端 /api/mathocr）。配了 key 才有返回，否则空串。
// 对矩阵/上下标远比通用视觉模型准，所以框选精修时优先用它。
async function callMathOCR(dataURI) {
  try {
    const res = await fetch("/api/mathocr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: dataURI }),
    });
    const data = await res.json().catch(() => ({}));
    return normalizeNewlineEscapes(String(data?.latex || "").trim());
  } catch { return ""; }
}

// 框选精修的视觉模型链：先用 DashScope 专用 OCR 模型 qwen-vl-ocr（忠实转写、对矩阵更稳，
// 同一个 QWEN_KEY 就能用，无需第三方账号），再退旗舰/max/plus。
const REGION_VISION_MODELS = ["qwen-vl-ocr", ...VISION_MODELS];

// 识别一张"局部截图"（用户在原图上框选出来的一块）：逐行转写其中手写内容。
// models 可指定模型链：手动框选用全链（含旗舰兜底）；自动逐块精识别传轻链（只 qwen-vl-ocr）求快。
export async function extractRegion(dataURI, models = REGION_VISION_MODELS) {
  // 先试专业数学 OCR（Mathpix/SimpleTex，配了 key 才有）；没有就走下面的 qwen 链（含专用 OCR 模型）。
  const pro = await callMathOCR(dataURI);
  if (pro) return pro;
  const prompt = `这是一张手写数学的**局部截图**（只是某道题答案的一部分）。请把图中**学生本人的手写内容**逐行转写出来：
- 【只抄学生笔迹，忽略红笔】红色的字/勾叉/圈划/批注是老师批改，**不要转写**，只抄学生原本写的；
- 【按学科用规范符号】概率统计用 $\\sigma^2$、$\\bar{x}$、$\\hat{\\theta}$、$\\chi^2$、$N(\\mu,\\sigma^2)$、$F(m,n)$、$t$、$E[\\cdot]$、$\\mathrm{Var}$、$\\sim$、MLE 等；线代用矩阵/特征值符号；微积分用积分/导数符号；
- 数学一律用 $...$ LaTeX 包裹（分数 \\frac、上下标 ^{}/_{}、希腊字母、矩阵 \\begin{pmatrix}...\\end{pmatrix} 等），普通中英文说明保留、不包；
- 【散文纯文本，禁止 LaTeX 化】整句英文说明原样写成普通文字（写 "is diagonalizable"，不要写成 "is\\diagonalizable"，也不要把空格写成反斜杠加空格）；只有真数学符号进 $...$；
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
  // 优先用专用 OCR 模型；按传入的 models 顺序回退。
  let raw = "";
  for (const model of models) {
    try { raw = String(await call(model) || "").trim(); } catch { raw = ""; }
    if (raw) break;
  }
  // qwen-vl-ocr 常吐 ```latex 围栏和 enumerate/equation 文档环境，先清洗再归一化
  return normalizeNewlineEscapes(stripOcrWrappers(raw));
}

// 识别老师"改分单/成绩单"（如 Answer Book：题号 + 手写得分 + 印刷满分 + 总分）。
// 返回 { items:[{number, awarded, max}], total }。用于按老师真分校准 AI 判分。
export async function parseScoreSheet(dataURI) {
  const prompt = `这是一张老师批改的**成绩单/改分单**图片：通常左边是题号（1,2,3… 或 Q1,Q2），右边是"得分 / 满分"（手写的红色得分写在印刷的 "/15 pts"、"/10 pts" 之类前面），底部可能有 Total（总分）。
请提取每道题的得分和满分。
只输出 JSON，不要任何解释：
{"items":[{"number":"1","awarded":15,"max":15},{"number":"2","awarded":4,"max":10}],"total":69}
- number：原样保留题号（"1"、"2"…）；
- awarded：老师给的得分（手写，常是红色）；max：满分（印刷的 /N pts 里的 N）；
- 读不清的项就省略；total：总分（没有就省略该字段）。`;
  const data = await callVision(dataURI, prompt); // json
  const items = (data?.items || [])
    .map((it) => ({ number: String(it.number ?? "").trim(), awarded: Number(it.awarded), max: Number(it.max) }))
    .filter((it) => it.number && Number.isFinite(it.awarded) && Number.isFinite(it.max) && it.max > 0);
  const total = Number(data?.total);
  return { items, total: Number.isFinite(total) ? total : null };
}

async function callVision(dataURI, promptText, { json = true } = {}) {
  const call = (model) => callGenerate([{
    role: "user",
    content: [
      { type: "text", text: promptText },
      { type: "image_url", image_url: { url: dataURI } },
    ],
  }], { json: false, materialTitle: "卷子视觉提取", visionModel: model });
  // 整页优先最强模型，超时/出错按 VISION_MODELS 顺序回退（Hobby 60s 下最强模型可能退到 max/plus）。
  let content = "";
  for (const model of VISION_MODELS) {
    try { content = String(await call(model) || "").trim(); } catch { content = ""; }
    if (content) break;
  }
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
   - 【只抄学生本人笔迹，忽略红笔】红色的字/勾叉/圈划/批注是老师批改，**不要混进 studentAnswer**，只转写学生原本写的
   - 学生未作答才填空字符串 ""
   - 【全部写完，不要中途截断】把该题学生写的全部过程都识别进来；若一道题内部分成 ①②③ / (a)(b)(c) / 多个小证明，必须把每个小部分都识别全，一直到该题最后一行——只写开头一两步就停是常见错误，禁止
   - 数学公式用 $...$ LaTeX；**英文/中文说明句子写成纯文本，禁止在英文单词前加反斜杠、禁止把空格写成反斜杠加空格**（写 "is diagonalizable"，不要 "is\\diagonalizable"），只有真数学符号进 $...$
4. 识别置信度 answerConfidence：清晰可读 → "high"，潦草但辨认出内容 → "low"，完全未作答 → "low"
5. 【满分与老师红笔批改 — 没有就省略；只认红色笔迹】maxScore：题目印着分值时填数字。teacherMark：红笔对该题的整体判定——大红叉/划掉="wrong"，打勾="correct"，只圈出部分="partial"。teacherScorePct：仅当红笔写了数字得分/扣分时填（0~100）。teacherComment：红笔文字批注。没有红笔则全省略。

跳过非题目内容（姓名、班级、页码、说明）。不要输出多余解释。

只输出 JSON：
{"items":[{"number":"1","question":"题目$公式$","studentAnswer":"学生答案","answerConfidence":"high"}]}`;
  const data = await callVision(await shrinkDataUri(dataURI), prompt);
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

【先判断学科，按该学科规范符号转写】若是概率统计：用 $\\sigma^2$、$\\bar{x}$、$\\hat{\\theta}$、$\\chi^2$、$N(\\mu,\\sigma^2)$、$F(m,n)$、$t$、$E[\\cdot]$、$\\mathrm{Var}$、$\\sim$、$\\sum$、$\\int$、MLE、置信区间等统计符号（别把 $\\hat\\theta$ 读成普通 θ、$\\sigma^2$ 别读成其它）；若线代用矩阵/特征值符号；若微积分用积分/导数符号。

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
   - 【只抄学生本人的笔迹，红色笔迹一律忽略】学生用黑/蓝/铅笔书写；**红色的字、勾叉、圈划、批注、得分都是老师批改，绝对不要混进 studentAnswer**——只转写学生原本写的内容，当作没有那些红笔。
   - 【绝对不要中途截断】一道题的答案常常很长、跨很多行，或内部分成 ①②③ / (a)(b)(c) / 多个小证明（例如"求 A、B=A^4、C=… 三个矩阵的特征值"要把三个都写全；一道证明题写了"证明等式"又写了"证明特征值模为1"要两段都写全）。**必须一直识别到该题最后一行为止，把所有小部分都包含进来**，常见错误就是只写了开头一两步就停——禁止这样。
   - 多行内容用 \\n 分隔，保留学生的推导顺序。
   - 【数学一律用 LaTeX 并用 $...$ 包裹，这条是硬性要求】行内公式 $...$，矩阵 $\\begin{pmatrix}...\\end{pmatrix}$，
     行列式 $\\begin{vmatrix}...\\end{vmatrix}$，分数 $\\frac{a}{b}$，上标 $x^2$，下标 $x_1$，
     希腊字母 $\\sigma$、$\\lambda$，服从 $\\sim$，正态 $N(0,\\sigma^2)$，分布 $F(1,1)$。
   - 【反例（禁止这样输出纯文本）】❌ "(X+Y)^2 / (X-Y)^2 ~ F(1,1)"
     【正例】✅ "$\\frac{(X+Y)^2}{(X-Y)^2} \\sim F(1,1)$"
   - 普通中文/英文说明文字不用包 $；只把数学符号/表达式包进 $...$。
   - 【散文必须是纯文本，禁止 LaTeX 化】整句英文说明（如 "because A is diagonalizable"、"Since D is a diagonal matrix"、"So there exist an invertible matrix"）**原样写成普通文字**：绝不要在英文单词前加反斜杠、也不要把空格写成反斜杠加空格（写 "is diagonalizable"，不要写 "is\\diagonalizable" 或 "So\\there"）。只有真正的数学符号才进 $...$，例如 "because $A\\in\\mathbb{R}^{n\\times n}$ is diagonalizable."。
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
  const data = await callVision(await shrinkDataUri(dataURI), prompt);
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
  const clip = (s) => String(s || "").replace(/\s+/g, " ").trim().slice(0, 600);
  const qList = questions.map((q, i) => `Q${i}「${q.number || "?"}」: ${clip(q.question)}`).join("\n");
  const aList = answers.map((a, i) => `A${i}「${a.number || "?"}」: ${clip(a.studentAnswer)}`).join("\n");
  const prompt = `你是阅卷助手。下面是"官方题目"和学生的"手写答案段"（OCR 自多页，顺序/编号都不可靠）。
任务：判断每段答案在解哪道官方题。

【铁律】
1. **以内容为主**：看每段答案实际在做什么数学、最终在证/算什么，去对应题目的要求。
   - 但**当多道题题型/内容高度相似、单看内容难区分时（如本卷有多道 MLE、多道置信区间、多道 likelihood、多道求分布），务必结合学生写的题号/小题号（如 (a)(b)(c)、Q6、"7."、"5."）来定位到底是哪一道**——编号不一定完全可靠，但在相似题之间它是最强的区分线索，不要无视。
   - 同一道大题的 (a)(b)(c) 各小问，分别配到对应的小题（如 Q6(a)/Q6(b)/Q6(c)）。
2. 看答案的**主题与结论**对应题目的**要求**，逐题区分。例如：
   - 证 "A^T 可对角化"（出现 A=XDX^{-1}, A^T=(X^{-1})^T D^T X^T）→ 配"证明 A^T 可对角化"那题；
   - 证 "Σ q_i q_i^T = I_n 且 |λ|=1"（出现 Q^T Q=I、正交矩阵）→ 配那道正交矩阵题；
   - 证 "正定 ⟺ 特征值全正"（出现 x^T A x>0、A=PDP^T）→ 配那道正定题；
   - 算某具体矩阵 A 的特征值/特征空间、以及 "B=A^4""C=A^6−A+3I" 的特征值 → **都属于同一道"求 A、B=A^4、C 的特征值"题**（B、C 是该题的子部分，不要配给"对角化求 A^7"那道）；
   - "求 X、Λ 使 A=XΛX^{-1} 并算 A^7"（出现 X、Λ、X^{-1}、A^7）→ 配那道对角化题。
3. **一道题可配多段**（被拆成多段/跨页续写时全配给它）；**每段最多配一道题**。
4. **顺序只作为"同一大题相邻小问"之间的微弱兜底**：仅当几段答案内容几乎一样、又同属一道大题的相邻小问（如 Q6 的 (c)(d)）、实在分不清时，才参考它们的先后顺序。
   ⚠️**其它一切情况都以"内容 + 学生题号"为准**：学生常常跳着答题、跨页续写、顺序很乱——**绝对不要为了"保持顺序"把内容明显属于某题的答案，硬配给它前后相邻的题**。内容说它是哪题就配哪题，哪怕打乱顺序。

【官方题目】
${qList}

【学生答案段】
${aList}

只输出一个 JSON 数组，元素是 [题目下标, 答案下标]（上面 Q/A 后的整数），按需多对一：
- 配不上任何题的段就不出现；数组里**只能有整数**，禁止公式/文字/反斜杠。
示例（Q0 由 A0,A1 两段组成，Q1 配 A3）：[[0,0],[0,1],[1,3]]`;

  // 对齐是"判断哪段解哪题"的推理活，交给 DeepSeek（更强）；不通回退默认文本模型。
  const raw = await callGenerate([{ role: "user", content: prompt }], { json: false, materialTitle: "答案语义对齐", textProvider: "deepseek" });
  const parsed = parseLooseJSON(raw);
  if (!Array.isArray(parsed)) return null;
  const map = {};        // 题目下标 → [答案下标,…]
  const usedA = new Set();
  for (const pair of parsed) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    const qi = Number(pair[0]); const ai = Number(pair[1]);
    if (!Number.isInteger(qi) || !Number.isInteger(ai)) continue;
    if (qi < 0 || qi >= questions.length || ai < 0 || ai >= answers.length) continue;
    if (usedA.has(ai)) continue;          // 一段答案只用一次
    (map[qi] || (map[qi] = [])).push(ai); // 一道题可收多段
    usedA.add(ai);
  }
  // 每题内部按答案出现顺序排，保证 ①②③ 拼接顺序正确
  for (const k of Object.keys(map)) map[k].sort((a, b) => a - b);
  return Object.keys(map).length ? map : null;
}

// OCR 校正（保守）：不看图、只用文本模型把每段答案"顺一遍"，**只修字符/符号的系统性误读**
// （μ 读成 M、χ² 读成 x²、γ↔λ、a↔9、z_{0.975} 读成 8.0975、7σ/15 读成 70/15 …），
// **绝不改学生的数字/结论/逻辑**——这是批改系统，必须保留学生真实写的（哪怕他算错了）。
// 一次批处理所有段（不走 JSON，用 ===A{i}=== 分隔，避免 LaTeX 反斜杠破坏 JSON）。
export async function repairOcr(answers) {
  const arr = Array.isArray(answers) ? answers : [];
  if (!arr.some((a) => String(a?.studentAnswer || "").trim())) return arr;
  const segs = arr.map((a, i) => `===A${i}===\n${String(a?.studentAnswer || "")}`).join("\n\n");
  const prompt = `下面是 OCR 自动转写的多段手写数学答案，可能有"识别错误"（不是学生写错）。请逐段只修正明显的**转写/符号误读**，其余原样保留。

【只修这类 OCR 误读】
- 希腊字母/记号被读错：μ 读成 M、σ 读成 s/o、χ² 读成 x²、θ̂ 读成普通 θ、γ↔λ、π 读错等；
- 字符混淆：a↔9、i↔1、l↔1、O↔0、S↔5、B↔8；
- 明显被读乱的标准量：如 z_{0.975}/z_{0.95} 被读成 8.0975、80.95、70.975 这类怪数；7σ/15 被读成 70/15、10/5 等；
- 多余的反斜杠/把英文散文 LaTeX 化。

【绝对不要做】
- 不要改学生写的**数字、最终答案、推导结论、对错**——**哪怕你认为学生算错了，也必须原样保留**（这是批改系统，要看到学生真实写了什么）；
- 不确定某处是不是 OCR 误读，就**保持原样**，宁可不改；
- 不要补全学生没写的步骤，不要重排。

【输出格式】每段仍以 ===A{编号}=== 开头（原样保留这些分隔标记和编号），其后是该段修正后的内容；数学用 $...$；只输出各段，不要任何解释。

${segs}`;
  let raw = "";
  try { raw = String(await callGenerate([{ role: "user", content: prompt }], { json: false, materialTitle: "OCR 校正", textProvider: "deepseek" }) || ""); }
  catch { raw = ""; }
  if (!raw.trim()) return arr;
  // 按 ===A{i}=== 切回各段
  const parts = raw.split(/===\s*A\s*(\d+)\s*===/);
  const fixed = {};
  for (let k = 1; k + 1 < parts.length; k += 2) {
    const idx = Number(parts[k]);
    const content = String(parts[k + 1] || "").trim();
    if (Number.isInteger(idx) && content) fixed[idx] = content;
  }
  return arr.map((a, i) => (fixed[i] ? { ...a, studentAnswer: fixed[i] } : a));
}

export async function gradeItem({ question, studentAnswer, teacherStyle = "" }) {
  // 关键：不把含 LaTeX 的"正确答案"塞进 JSON（反斜杠会破坏 JSON 解析，导致解析失败→默认判错）。
  // 仿 solveQuestion：正文输出参考解答（带公式），最后一行只输出"不含公式/反斜杠"的小 JSON。
  const prompt = `你是公正的线性代数老师，给学生的"订正答案"批改。先自己把题目完整解出最终结果，再对照学生答案，**按数学正确性公正判分，既不放水也不吹毛求疵**。
${teacherStyle ? `\n【按这位命题老师的评分风格判分（重要，尽量贴合）】${teacherStyle}\n` : ""}
【题目】${question}
【学生答案】${studentAnswer || "(空白)"}

【最重要：学生答案是 OCR 自动转写的，先分清"识别错误"还是"学生写错"，按学生真实手写意图判分，而不是按 OCR 字面判】
- 你的目标是**尽量还原学生真正写在纸上的内容**再判分。学生没耐心逐条核对识别结果，所以你要主动纠正明显的 OCR 失误。
- 常见 OCR 失误（这些都不是学生的错，要按本意还原，**绝不能据此判错或扣分**）：
  · 数字/字母混淆：9↔a、i↔1、l↔1、O↔0、S↔5、z↔2、B↔8；
  · 占位/重复向量：特征向量被读成 [i,i,i]、[2,i,3] 这种带 i 或几个分量一模一样的，几乎一定是把数字 1 等读成了 i 或漏读——按"这是某个合理实向量"理解，别当学生写错；
  · 矩阵维度/元素读乱、行列塌缩、矩阵被读小一维、逗号当换行、多余符号、奇异矩阵其实是元素读错；
  · 散文里多余的反斜杠/LaTeX 化。
- **判定方法**：看学生的**解题方法、结构、最终结论**是否数学正确。只要方法对、主线通、最终结果（还原 OCR 噪声后）正确，就判 correct/minor；**只有当确实是学生本人的数学错误（方法错、概念错、算错、漏解、没做完）才判 wrong**。判 wrong 前先自问：这个"错"是 OCR 读出来的，还是学生真的写错了？拿不准就当 OCR 噪声、从宽。
- 拼写错误（如 define↔definite、漏字母）、英文术语不标准、记号差异、笔误，**一律不作为判错依据**。

判分档位（三选一，写进 verdict）：
- "correct"（判对）：最终结果/结论正确，核心步骤合理。**解法不同、记号差异、排版不同、明显的笔误或拼写错（如 define↔definite）、把变量名标反但实际计算正确、OCR 把中间式读乱——都仍判 correct**。证明题只要逻辑主线成立即 correct。
- "minor"（基本正确，有小瑕疵）：最终结果对、主线对，但有**不影响结论的小问题**（如个别记号写错、漏写一句过渡、某个等价号用得不严谨）。这种也算学生掌握了，note 里一句话点出小瑕疵。
- "wrong"（判错）：仅当**最终结果确实错误 / 缺少题目要求的部分（如漏解、漏证某方向、题目要求对三个矩阵都求但只做了一个）/ 有实质概念或计算错误 / 没做完 / 空白**。
重要：**不要因为"写法不够规范""不是你的解法""有笔误/拼写错""OCR 看着乱"就判 wrong**——只看数学对不对。判 wrong 前先确认：学生的最终答案是不是真的和正确答案不一致？

输出格式（分两部分）：
1. 先写「参考解答」：完整步骤。**每一处数学都必须用 $...$（行内）或 $$...$$（独立公式）包裹，包括 \\left\\right、\\frac、矩阵 \\begin{pmatrix}...\\end{pmatrix} 等——禁止输出任何没被 $ 包裹的裸 LaTeX**（否则前端渲染成原始码）。不要放进 JSON。
2. 最后**单独一行**输出元数据 JSON（放回复最末尾，之后不要再有任何字符）。JSON 里**禁止 LaTeX/反斜杠/美元符号/公式**，note 与 errorDetail 用纯中文口语（要点用文字描述，如"特征值零"而不是 "λ=0"）：
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

// Stage 2：从"AI 判分 vs 老师真实分 + 红笔批注"学这位老师的评分风格 + 出题风格，并入已有档案。
// rows: [{ number, question, studentAnswer, aiPct, teacherPct, teacherComment }]。返回 { gradingStyle, questionStyle }。
export async function learnTeacherStyle({ subject, teacherName, prevGradingStyle = "", prevQuestionStyle = "", rows = [] }) {
  const clip = (s, n = 200) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);
  const list = rows.map((r) =>
    `【${r.number}】题:${clip(r.question)} | 学生:${clip(r.studentAnswer)} | AI给:${r.aiPct ?? "?"}% 老师给:${r.teacherPct ?? "?"}%${r.teacherComment ? " | 批注:" + clip(r.teacherComment, 80) : ""}`
  ).join("\n");
  const prompt = `你在为"${subject} · ${teacherName}老师"建立个性化档案。下面每行是一道题的：题目、学生答案、AI 给的分%、老师真实给的分%、老师批注。
通过对比 AI 与老师的分差，总结这位老师的**评分风格**（严/松、爱在哪扣分、步骤分/最终答案/书写规范各占多重、对漏步/术语/笔误的态度等），以及从题目能看出的**出题风格**（题型、难度、常考点、风格偏好）。

${prevGradingStyle ? `已有评分风格档案（在此基础上更新、别推翻）：${prevGradingStyle}\n` : ""}${prevQuestionStyle ? `已有出题风格档案：${prevQuestionStyle}\n` : ""}
本次数据：
${list}

只输出 JSON（中文、纯文字、禁止公式/反斜杠/美元符号）：
{"gradingStyle":"这位老师评分风格：…（3-5 句，具体可执行，便于以后照此判分）","questionStyle":"这位老师出题风格：…（2-4 句，便于据此出同风格模拟题）"}`;
  const raw = await callGenerate([{ role: "user", content: prompt }], { json: false, materialTitle: "学习老师风格", textProvider: "deepseek" });
  const meta = parseLooseJSON(raw) || {};
  return {
    gradingStyle: String(meta.gradingStyle || prevGradingStyle || "").trim(),
    questionStyle: String(meta.questionStyle || prevQuestionStyle || "").trim(),
  };
}

// Stage 3：按某老师的出题风格生成模拟题。返回 [{question, answer, explanation}]。
export async function generateMockExam({ subject, teacherName, questionStyle = "", count = 5, topics = "" }) {
  const prompt = `你是${subject}老师"${teacherName}"，请按**你一贯的出题风格**出 ${count} 道模拟练习题，供学生考前训练。
${questionStyle ? `你的出题风格（务必贴合）：${questionStyle}\n` : ""}${topics ? `侧重知识点：${topics}\n` : ""}
要求：题型、难度、风格贴近该老师；公式用 $...$；每题给完整参考答案和简要解析。
严格按分段输出（不要 JSON、不要代码块围栏），每道题用如下三段、题与题之间空一行：
@@题目@@
（题干，含 $公式$）
@@答案@@
（最终答案，含 $公式$）
@@解析@@
（简要步骤，含 $公式$）`;
  const raw = await callGenerate([{ role: "user", content: prompt }], { json: false, materialTitle: "老师风格模拟题", textProvider: "deepseek" });
  if (!raw) return [];
  // 按"@@题目@@"切成多道
  const blocks = String(raw).split(/(?=@@题目@@)/).map((b) => b.trim()).filter(Boolean);
  const pick = (b, tag) => { const m = b.match(new RegExp(`@@${tag}@@\\s*([\\s\\S]*?)(?=@@[^@]+@@|$)`, "i")); return m ? m[1].trim() : ""; };
  return blocks.map((b) => ({ question: pick(b, "题目"), answer: pick(b, "答案"), explanation: pick(b, "解析") }))
    .filter((q) => q.question);
}

export async function tutorReply({ item, history, userMessage }) {
  const sys = `你是严格、直接、负责的线性代数私教，正在辅导学生订正一道错题。
【题目】${item.question}
【学生的错误答案】${item.student_answer}
【正确答案】${item.correct_answer}
【错因】${item.error_detail || ""}

辅导风格（坚定、不啰嗦、不过度温柔）：
- **第一句就明确、直接地指出错在哪**（一句话点破核心错误，例如"你漏了 λ=0 这个特征值"），不要用"我们一点点来""先从你做对的入手"这类铺垫绕弯子。
- 指出错误后，再用一个**有针对性的问题**引导学生想清楚为什么错、怎么改；一次只问一个点。
- 语气像认真的老师：肯定对的地方一句带过即可，重点放在纠错；少用语气词和表情（最多偶尔一个），不要堆"好呀～""加油😊"。
- 不要一上来就把完整正确答案抄给他；但学生卡住或问了两次还不懂，就直接讲清楚那一步，别继续兜圈子。
- 公式用 $...$ 包裹。学生想通了简短肯定并可追问加深。`;

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
