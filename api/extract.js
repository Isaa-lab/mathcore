export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const {
    text, course, chapter, count = 5,
    userProvider, userKey, userCustomUrl,
    // 分块管线注入（可选）：让 AI 知道自己在看的是文档片段 N / 共 M，并带上跨片段的引用定义
    chunkIndex = null, chunkCount = null, refContext = null,
    // refine=true：用细化版 prompt（多抽 2-3 倍知识点，强制带 prerequisites / depth / kind）
    // 用户在沙盒里点"🔬 细化分析"或资料库的"重新分析"会传 refine=true
    refine = false,
  } = req.body;

  const GEMINI_KEY = process.env.GEMINI_KEY;
  const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;

  // Determine effective API config: user-supplied key takes priority
  const hasUserKey = userKey && String(userKey).trim().length > 8;
  const effectiveProvider = hasUserKey ? (userProvider || "gemini") : null;

  if (!hasUserKey && !GEMINI_KEY && !ANTHROPIC_KEY) {
    return res.status(500).json({ error: "未配置 API Key。请在首页点击「AI 设置」输入你的 API Key，或在 Vercel 环境变量里添加 GEMINI_KEY。" });
  }

  if (!text || text.trim().length < 30) {
    return res.status(400).json({ error: "PDF 文字太少（可能是扫描版）。请使用可以选中文字的电子版 PDF。" });
  }

  const preCleaned = text
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const filteredLines = preCleaned
    .split("\n")
    .filter(l => {
      const t = l.trim();
      if (t.length === 0) return false;
      if (/^\d+$/.test(t) && t.length <= 4) return false;
      return true;
    })
    .join("\n");

  const cleanText = filteredLines.slice(0, 8000);
  const ch = (chapter && chapter !== "全部") ? chapter : (course || "本章节");
  const englishRatio = (cleanText.match(/[a-zA-Z]/g) || []).length / Math.max(cleanText.length, 1);
  const isEnglish = englishRatio > 0.4;

  const chunkBanner = (typeof chunkIndex === "number" && typeof chunkCount === "number" && chunkCount > 1)
    ? `【分块信息】本次只看到整本教材中的第 ${chunkIndex + 1} / ${chunkCount} 片段。
- 不要凭这一小段推测全书结构；只基于本片段里明确出现的定义 / 定理 / 公式出题。
- 若本片段讨论到"后文会证明"、"参见第 N 章"这类指代，请忽略该线索，不要以它为题源。
- 若本片段本身没有自包含的知识点，宁可少出题，也不要硬凑。\n\n`
    : "";

  const refList = Array.isArray(refContext) && refContext.length > 0 ? refContext.slice(0, 8) : [];
  const refBanner = refList.length > 0
    ? `【跨片段引用字典】以下是本片段里出现的编号引用在全书中被定义的完整内容：
${refList.map(r => `- ${r.key} ⇒ ${String(r.body || "").replace(/\s+/g, " ").trim().slice(0, 220)}`).join("\n")}
规则：题干中若需要引用这些编号（例如 "方程(1)"、"Theorem 2.1"），必须把右边的完整内容抄到题干里，不得只写编号。\n\n`
    : "";

  // 细化模式 vs 标准模式：知识点数量 / 题型多样性 / 字段丰富度都不同
  const topicLow  = refine ? 8  : 3;
  const topicHigh = refine ? 14 : 5;
  const refineNote = refine
    ? `【细化模式 REFINE】本次为"重新分析"，目标是把原本粗粒度的知识点拆得更细：
- 把"分离变量法"这种宏观技法继续拆成 "分离变量的代数操作" / "积分常数 C 的归一" / "隐式解的显式化" 等子步骤
- 把定理拆成 "定理陈述" / "成立条件" / "反例" / "推论" 四类卡片
- 出题数量比常规多 50%，覆盖至少 4 种题型（见任务二）。\n\n`
    : "";

  // 题型多样性：refine 模式强制 4 种题型；标准模式仅要求单选+判断
  const typeRule = refine
    ? `- 题型必须混合 4 类，且每类至少 1 道：单选题 / 判断题 / 填空题 / 简答题
  · 单选题：恰好 4 个选项 A/B/C/D
  · 判断题：options 为 null，answer 为 "正确" 或 "错误"
  · 填空题：options 为 null，answer 是一个简短数学表达式（用 LaTeX 或标准符号），question 用 ___ 标出空位
  · 简答题：options 为 null，answer 是 1~3 句完整推理 + 关键中间式
- 难度分配：约 30% 基础（直接套定义）/ 50% 进阶（要选择正确公式 + 一步推导）/ 20% 综合（多步推理或反例）
- 每道题需带 "difficulty"："easy" / "medium" / "hard"
- 每道题需带 "knowledge_points"：array of string，对应"任务一"里 topic 的 name`
    : `- 单选题（单选题）：恰好 4 个选项 A/B/C/D，干扰项必须是合理的数学表达式，绝对禁止使用"与原文相反""教材未提及""以上都不对"等无效选项
- 判断题（判断题）：options 为 null，answer 为"正确"或"错误"
- 题型分配：至少 ${Math.max(2, Math.floor(count * 0.7))} 道单选题，至少 1 道判断题`;

  const prompt = `你是一位专业数学教授，正在为中国大学生制作习题和知识点卡片。教材原文可能是英文，但所有输出内容必须使用中文。

【重要警告】以下文本由 PDF 自动提取，数学符号可能存在乱码：
- "x 2" 实为 x²，"d t 2" 实为 d²/dt²，"x n" 实为 xₙ
- "d y / d x" 实为 dy/dx，字母间多余空格是乱码
- 所有数学公式必须还原为正确标准符号，绝对不能照抄乱码原文

${refineNote}${chunkBanner}${refBanner}=== 教材原文（${isEnglish ? "英文" : "中文"}教材，输出用中文）===
${cleanText}
=== 原文结束 ===

课程：${course || "数学"} | 章节：${ch}

【任务一】提取 ${topicLow}~${topicHigh} 个核心知识点，每个 topic 必须是 JSON 对象：
  - "name"：知识点名称（中文，4~14 字，不能照抄乱码）
  - "summary"：一句话说明（中文，20~80字）
  - "kind"：知识点类型，从下列固定取值里挑一个：
      · "definition"  概念 / 定义
      · "theorem"     定理 / 性质
      · "method"      方法 / 算法
      · "formula"     公式 / 等式
      · "example"     典型例题 / 应用场景
      · "pitfall"     易错点 / 反例
  - "depth"：层级整数。1=基础概念（叶子级别）；2=方法/技法；3=综合应用 / 多步推理。
  - "prerequisites"：array of string，列出本知识点依赖的、本次也抽出的其他 topic 的 name；
      若是该课程从外部带进来的依赖（如"会算偏导数"），允许使用通用名称。无依赖时给空数组 []。
  - "definition_anchor"：原文中能直接锚定本知识点的一句话或公式（≤80 字，可摘抄并清洗乱码）；
      若原文里没有显式定义，给空字符串 ""。

【任务二】生成恰好 ${count} 道中文习题，要求：
- 每道题必须基于原文的具体定义、定理、公式或方法
- 所有数学公式用标准符号（如 dy/dx、∫、∑、e^(at) 等），不照搬乱码
${typeRule}
- 解析 ≤ 80 字，需明确说明正确理由

【严格禁止】以下类型题目一律不得出现（出现即视为失败，必须重写）：
1. 学习方法 / 元认知 / 学习态度类。反例："在学习线性代数时，先明确概念再做题通常更有效。"
2. 学习策略判断题。反例："做题前应该先掌握定义。" / "坚持复习有助于巩固知识。"
3. 资料元信息题。反例：问作者、书名、章节号、日期、课程编号。
4. 常识鸡汤题。反例："认真听讲对学习有帮助。"
5. 不含任何具体数学符号/公式/定理/算法名称的判断题。
每道题必须考查"具体的定义、定理、公式推导、反例、计算步骤或性质判定"，否则不合格。

【自包含铁律 SELF-CONTAINED】题目必须能被任何从未读过原文的学生独立读懂：
A. 禁止悬挂引用：绝对不得出现 "方程(1)"、"Equation (3)"、"Theorem 2"、"Lemma 4"、
   "定理 2.1"、"如上所示"、"the above equation"、"前面的公式"、"如下命题" 这类指代。
   若原文出现 "方程(1)"，你必须在题干里把完整公式抄录出来（例如 "方程 dy/dx = xy" ）后再提问。
   若上下文不足以还原公式 / 条件，你必须放弃本题，不要硬出。
B. 禁止残片壳子：绝对不得出现只含 "(10 marks) True or False"、"Question 3"、
   "Exercise 4.1"、"判断题:"、"True / False:" 这种卷面模板作为题干。
   题干必须包含一个完整、可判断的命题或问题句。
C. 禁止过渡词起头：不得以 "then,"、"therefore,"、"so,"、"furthermore,"、
   "那么,"、"因此,"、"所以," 开头。若需要承接语气，请重写为独立完整句。
D. 每题必须包含至少一个具体的数学对象（公式 / 算子 / 条件 / 集合 / 函数名），
   例如 dy/dx、∫、Ax=b、det(A)、连续可微、Lipschitz 条件等；仅凭文字描述无法
   构成数学命题的，重写或放弃。

出题流程（CoT 自检，不要把这段抄到输出里，但必须在内部照做）：
  Step 1. 从原文里挑一个核心概念或定理。
  Step 2. 判断该概念是否带有 "(n)" 之类的编号引用；若有，先在工作区把被引用的
          完整内容还原出来。
  Step 3. 用还原后的完整内容起草题干，不允许出现 Step 2 中的编号本身。
  Step 4. 再读一遍题干，对照【自包含铁律】A/B/C/D；只要违反任何一条，丢弃重写。

仅输出如下 JSON，不附加任何其他文字或 markdown：
{
  "topics": [
    {
      "name": "分离变量法",
      "summary": "将 dy/dx = f(x)g(y) 改写为 dy/g(y) = f(x)dx，两端分别积分求解一阶常微分方程的方法。",
      "kind": "method",
      "depth": 2,
      "prerequisites": ["不定积分", "一阶微分方程"],
      "definition_anchor": "若 dy/dx = f(x)g(y)，则 dy/g(y) = f(x) dx"
    },
    {
      "name": "积分常数 C 的归并",
      "summary": "求解后 ln|y| = F(x) + C 中的 C 通过取指数 y = ±e^C·e^F(x) 归并为单一常数 C₀。",
      "kind": "pitfall",
      "depth": 1,
      "prerequisites": ["分离变量法"],
      "definition_anchor": "y = Ce^F(x)"
    }
  ],
  "questions": [
    { "type": "单选题", "question": "用分离变量法求解 dy/dx = xy，其通解为？", "options": ["A. y = Ce^(x²/2)", "B. y = Ce^x", "C. y = Ce^(x²)", "D. y = x² + C"], "answer": "A", "explanation": "分离变量得 dy/y = x dx，积分得 ln|y| = x²/2 + C₀，故 y = Ce^(x²/2)。", "difficulty": "medium", "knowledge_points": ["分离变量法"] },
    { "type": "判断题", "question": "方程 dy/dx = x²·sin(y) 可以用分离变量法求解。", "options": null, "answer": "正确", "explanation": "该方程可改写为 dy/sin(y) = x² dx，两端可分别积分，故可用分离变量法。", "difficulty": "easy", "knowledge_points": ["分离变量法"] },
    { "type": "填空题", "question": "分离变量法求解 dy/dx = x/y 的通解为 y² = ___ + C。", "options": null, "answer": "x²", "explanation": "y dy = x dx，两端积分得 y²/2 = x²/2 + C₀，乘 2 后即 y² = x² + C。", "difficulty": "medium", "knowledge_points": ["分离变量法", "积分常数 C 的归并"] }
  ]
}`;

  // ── OpenAI-compatible helper (DeepSeek / Kimi / Custom) ────────────────────
  const callOpenAICompat = async (baseUrl, key, model) => {
    try {
      const r = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${key}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.3,
          max_tokens: 4096,
        }),
      });
      if (r.ok) {
        const d = await r.json();
        return d?.choices?.[0]?.message?.content || "";
      }
      const err = await r.text();
      console.error(`OpenAI-compat(${model}) HTTP ${r.status}:`, err.slice(0, 200));
      return null;
    } catch (e) {
      console.error(`OpenAI-compat(${model}) exception:`, e.message);
      return null;
    }
  };

  // ── Gemini helper ──────────────────────────────────────────────────────────
  let quotaExceeded = false;
  const callGemini = async (model, key) => {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.3, maxOutputTokens: 4096 },
          }),
        }
      );
      if (r.ok) {
        const d = await r.json();
        const t = d?.candidates?.[0]?.content?.parts?.[0]?.text || "";
        if (t.length > 20) return t;
        return null;
      }
      if (r.status === 429) { quotaExceeded = true; return null; }
      const err = await r.text();
      console.error(`Gemini(${model}) HTTP ${r.status}:`, err.slice(0, 200));
      return null;
    } catch (e) {
      console.error(`Gemini(${model}) exception:`, e.message);
      return null;
    }
  };

  let responseText = "";
  let apiUsed = "";

  // ── Priority 1: user-supplied key ─────────────────────────────────────────
  if (hasUserKey) {
    const k = String(userKey).trim();
    if (effectiveProvider === "groq") {
      responseText = await callOpenAICompat("https://api.groq.com/openai/v1", k, "llama-3.3-70b-versatile") || "";
      if (!responseText) responseText = await callOpenAICompat("https://api.groq.com/openai/v1", k, "llama-3.1-8b-instant") || "";
      if (responseText) apiUsed = "groq(user)";
    } else if (effectiveProvider === "deepseek") {
      responseText = await callOpenAICompat("https://api.deepseek.com", k, "deepseek-chat") || "";
      if (responseText) apiUsed = "deepseek(user)";
    } else if (effectiveProvider === "kimi") {
      responseText = await callOpenAICompat("https://api.moonshot.cn/v1", k, "moonshot-v1-8k") || "";
      if (responseText) apiUsed = "kimi(user)";
    } else if (effectiveProvider === "custom") {
      const base = String(userCustomUrl || "").trim().replace(/\/$/, "");
      if (base) {
        responseText = await callOpenAICompat(base, k, "gpt-3.5-turbo") || "";
        if (responseText) apiUsed = "custom(user)";
      }
    } else {
      // gemini with user key
      responseText = await callGemini("gemini-2.0-flash", k) || "";
      if (!responseText) {
        await new Promise(r => setTimeout(r, 2000));
        responseText = await callGemini("gemini-2.0-flash-lite", k) || "";
      }
      if (responseText) apiUsed = "gemini(user)";
    }
  }

  // ── Priority 2: server Gemini key ─────────────────────────────────────────
  if (!responseText && GEMINI_KEY) {
    responseText = await callGemini("gemini-2.0-flash", GEMINI_KEY) || "";
    if (!responseText && quotaExceeded) {
      await new Promise(r => setTimeout(r, 4000));
      quotaExceeded = false;
      responseText = await callGemini("gemini-2.0-flash-lite", GEMINI_KEY) || "";
    }
    if (responseText) apiUsed = "gemini(server)";
  }

  // ── Priority 3: server Anthropic key ──────────────────────────────────────
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
        if (responseText) apiUsed = "anthropic(server)";
      }
    } catch (e) {
      console.error("Anthropic exception:", e.message);
    }
  }

  if (!responseText) {
    if (quotaExceeded) {
      return res.status(429).json({
        error: "QUOTA_EXCEEDED",
        message: "Gemini API 每分钟配额已用完，请等待 1 分钟后重新上传/补题。或在首页「AI 设置」换用 DeepSeek / Kimi 等其他 API。",
      });
    }
    return res.status(500).json({
      error: "AI 调用失败。请在首页「AI 设置」配置你的 API Key（支持 DeepSeek / Kimi / Gemini）。",
    });
  }

  // ── Parse JSON ─────────────────────────────────────────────────────────────
  const clean = responseText.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  let result;
  try {
    result = JSON.parse(clean);
  } catch {
    // Try to extract the outermost JSON object
    const m = clean.match(/\{[\s\S]*\}/);
    if (!m) return res.status(500).json({ error: "AI 返回格式错误，请重试", raw: clean.slice(0, 300) });
    try { result = JSON.parse(m[0]); }
    catch { return res.status(500).json({ error: "JSON 解析失败", raw: m[0].slice(0, 300) }); }
  }

  // ── Normalise questions (field name variants across models) ───────────────
  const rawQuestions = Array.isArray(result.questions) ? result.questions
    : Array.isArray(result.problems) ? result.problems
    : Array.isArray(result.exercises) ? result.exercises
    : [];

  // ── 自包含 / 壳子题 / 悬挂引用的服务端快检（与前端 isLowQualityQuestion 对齐）─
  const isShellOrDangling = (qText, opts) => {
    const text = String(qText || "");
    if (text.length < 10) return true;

    const trimmed = text.trim();
    const stripWrapper = trimmed
      .replace(/^\s*以下说法是否正确[：:]?\s*[「『]?/, "")
      .replace(/[」』]?\s*$/, "")
      .trim();
    const isShell = (s) => {
      if (!s) return true;
      if (/^\s*\(?\s*\d{1,3}\s*(?:marks?|分|points?|pts?)\s*\)?[\s，,。.；;:：]*(?:True\s*(?:or|\/)\s*False|T\s*\/\s*F|判断(?:题|对错)?|是否正确)?\s*[。.；;:：]?\s*$/i.test(s)) return true;
      if (/^(?:Question|Problem|Exercise|Ex\.?|Q|P)\s*[\d.]+\s*[:：.]?\s*$/i.test(s)) return true;
      if (/^(?:True\s*(?:or|\/)\s*False|T\/F|判断对错|是否正确|判断题)\s*[:：]?\s*$/i.test(s)) return true;
      if (s.length < 40 && /(?:marks?|points?|pts?)\b/i.test(s) && !/[=+\-×÷<>∫∑∏√∞≤≥≠→∈∉∀∃]|dy\/dx|\\(?:frac|int|sum|sqrt)/i.test(s)) return true;
      return false;
    };
    if (isShell(stripWrapper) || isShell(trimmed)) return true;

    const hasDanglingRef =
      /\b(?:Equation|Eq\.?|Formula|Theorem|Lemma|Corollary|Proposition|Definition|Example|Figure|Fig\.?|Table)\s*\(?\s*\d+(?:[.\-]\d+)?\s*\)?/i.test(text) ||
      /(?:方程|公式|定理|引理|推论|命题|定义|例题?|图|表)\s*[（(]\s*\d+(?:[.\-]\d+)?\s*[）)]/.test(text);
    const hasRealFormula =
      /\$[^$]{3,}\$|\$\$[^$]+\$\$/.test(text) ||
      /\\(?:frac|int|sum|sqrt|prod|lim|partial|alpha|beta|gamma|theta|lambda|sigma|mathbf|mathcal|mathrm|vec|det|rank)/i.test(text) ||
      /[=<>≤≥≠→∈∉∀∃∫∑∏√].{0,40}[a-zA-Z0-9]|[a-zA-Z]\s*=\s*[^=\s]{2,}|dy\/dx|d\/dt|d\^2/i.test(text);
    if (hasDanglingRef && !hasRealFormula) return true;
    if (/\b(?:the\s+(?:above|following|preceding)|as\s+(?:above|shown\s+above|before))\b/i.test(text)
        && text.length < 100 && !hasRealFormula) return true;
    if (/(?:上述|前面(?:所述|提到|的)|如下(?:所述|所示)?|下面(?:所述|提到|的))[^。.!?]{0,18}(?:所述|命题|结论|内容|说法|情形|公式|方程|定理)/.test(text)
        && !hasRealFormula && text.length < 120) return true;

    if (/^\s*(?:then|therefore|so|thus|hence|furthermore|moreover|consequently|besides|similarly)[,，\s]/i.test(trimmed)) return true;
    if (/^\s*(?:那么|因此|所以|由此|从而|进而|因而|此外|另外|同理)[,，、]/.test(trimmed)) return true;

    return false;
  };

  const ALLOWED_DIFFICULTY = new Set(["easy", "medium", "hard"]);
  const questions = rawQuestions
    .filter(q => q && String(q.question || q.text || q.content || "").length > 5)
    .map(q => {
      const qText = String(q.question || q.text || q.content || "");
      const opts = Array.isArray(q.options) && q.options.length >= 2 ? q.options : null;
      const rawType = String(q.type || (opts ? "单选题" : "判断题"));
      // 题型归一：把 LLM 偶尔返回的英文 / 别名归到 4 类
      const type = (() => {
        if (/单选|multiple\s*choice|MCQ|single\s*choice/i.test(rawType)) return "单选题";
        if (/判断|true\s*\/?\s*false|T\/?F|是否/i.test(rawType)) return "判断题";
        if (/填空|fill[- ]?in|fill\s*the\s*blank|blank/i.test(rawType)) return "填空题";
        if (/简答|short\s*answer|essay|解答|计算/i.test(rawType)) return "简答题";
        return opts ? "单选题" : "判断题";
      })();
      const diff = String(q.difficulty || "").toLowerCase();
      const kps = Array.isArray(q.knowledge_points) ? q.knowledge_points
        : Array.isArray(q.topics) ? q.topics : [];
      return {
        question: qText,
        options: opts,
        answer: String(q.answer || q.correct_answer || (opts ? "A" : "正确")),
        explanation: String(q.explanation || q.rationale || q.reason || ""),
        type,
        chapter: ch,
        difficulty: ALLOWED_DIFFICULTY.has(diff) ? diff : null,
        knowledge_points: kps.map(s => String(s).trim()).filter(Boolean).slice(0, 6),
      };
    })
    .filter(q => !isShellOrDangling(q.question, q.options));

  // ── Normalise topics (field name variants across models) ──────────────────
  const rawTopics = Array.isArray(result.topics) ? result.topics
    : Array.isArray(result.concepts) ? result.concepts
    : Array.isArray(result.key_concepts) ? result.key_concepts
    : Array.isArray(result.knowledge_points) ? result.knowledge_points
    : [];

  const ALLOWED_KIND = new Set(["definition", "theorem", "method", "formula", "example", "pitfall"]);
  const topics = rawTopics
    .filter(t => t && String(t.name || t.title || t.concept || "").length > 1)
    .map(t => {
      const kindRaw = String(t.kind || t.type || "").toLowerCase().trim();
      const kind = ALLOWED_KIND.has(kindRaw) ? kindRaw : null;
      let depth = parseInt(t.depth, 10);
      if (!Number.isFinite(depth) || depth < 1 || depth > 3) depth = null;
      const prereqs = Array.isArray(t.prerequisites) ? t.prerequisites
        : Array.isArray(t.depends_on) ? t.depends_on
        : Array.isArray(t.parents) ? t.parents : [];
      return {
        name: String(t.name || t.title || t.concept || "").trim(),
        summary: String(t.summary || t.description || t.explanation || "").trim(),
        kind,
        depth,
        prerequisites: prereqs.map(s => String(s).trim()).filter(Boolean).slice(0, 8),
        definition_anchor: String(t.definition_anchor || t.anchor || t.source_quote || "").trim().slice(0, 240),
      };
    });

  // ── Fallback: if AI returned no topics, synthesise from questions ─────────
  const finalTopics = topics.length > 0 ? topics : (() => {
    const seen = new Set();
    return questions.slice(0, 3).map((q, i) => {
      const name = ch + ` 知识点 ${i + 1}`;
      if (seen.has(name)) return null;
      seen.add(name);
      return { name, summary: q.explanation || q.question.slice(0, 60) };
    }).filter(Boolean);
  })();

  console.log(`[extract] api=${apiUsed} text=${cleanText.length}ch topics=${finalTopics.length} questions=${questions.length}`);

  return res.status(200).json({ topics: finalTopics, questions, apiUsed });
}
