export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const {
    text, course, chapter, count = 5,
    userProvider, userKey, userCustomUrl,
    // forceProvider: 用户在前端"用 XX 重抽"时强制使用某个 provider，禁止 fallback 到别家
    // 否则会出现"用户点了 Groq，但 Groq 没 Key 静默 fallback 到智谱，写库 provider=zhipu"的诡异情况
    forceProvider = null,
    // 分块管线注入（可选）：让 AI 知道自己在看的是文档片段 N / 共 M，并带上跨片段的引用定义
    chunkIndex = null, chunkCount = null, refContext = null,
  } = req.body;

  const GEMINI_KEY      = process.env.GEMINI_KEY;
  const ANTHROPIC_KEY   = process.env.ANTHROPIC_KEY;
  const GROQ_KEY        = process.env.GROQ_KEY;
  const OPENROUTER_KEY  = process.env.OPENROUTER_KEY;
  // 硅基流动 SiliconFlow 支持两套环境变量名：SILICONFLOW_KEY 或 GUIJI_KEY（拼音简写）
  const SILICONFLOW_KEY = process.env.SILICONFLOW_KEY || process.env.GUIJI_KEY;
  const ZHIPU_KEY       = process.env.ZHIPU_KEY;
  const CEREBRAS_KEY    = process.env.CEREBRAS_KEY;

  // Determine effective API config: user-supplied key takes priority
  const hasUserKey = userKey && String(userKey).trim().length > 8;
  const effectiveProvider = hasUserKey ? (userProvider || "gemini") : null;

  if (!hasUserKey && !GEMINI_KEY && !ANTHROPIC_KEY && !GROQ_KEY && !OPENROUTER_KEY && !SILICONFLOW_KEY && !ZHIPU_KEY && !CEREBRAS_KEY) {
    return res.status(500).json({ error: "未配置 API Key。请在首页点击「AI 设置」输入你的 API Key，或在 Vercel 环境变量里添加 GROQ_KEY / GEMINI_KEY / OPENROUTER_KEY / ZHIPU_KEY 任意一个免费档。" });
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

  // 为"结构化弱"的小模型（Llama-8B / Mistral-7B / Qwen-7B / GLM-4-Flash 等）追加一段
  // 强提醒：它们倾向于偷懒只输出 4~6 个 topic、只出复述定义的概念题。本提醒会顶在 prompt
  // 最前面，反复强调下限要求。强模型（Claude / DeepSeek / Gemini-Pro）也加一份温和版，
  // 因为旧 prompt 的反例语气已经训练它们"愿意只给 5 个就交差"。
  const weakProviders = new Set(["groq", "openrouter", "siliconflow", "cerebras", "zhipu", "kimi"]);
  const targetProvider = (forceProvider || (hasUserKey ? effectiveProvider : null) || "").toLowerCase();
  const isWeakTarget = weakProviders.has(targetProvider) ||
    // 服务端兜底链优先 Groq，没指定 provider 时也按弱模型对待
    (!targetProvider && (GROQ_KEY || ZHIPU_KEY || OPENROUTER_KEY || SILICONFLOW_KEY || CEREBRAS_KEY));
  const granularityBanner = isWeakTarget
    ? `【硬性下限 —— 本次为掌握度测验，不达下限直接判失败】
1. topics 数量必须 ≥ 10 条；少于 10 条 → 你必须回到原文继续拆，把"运算 / 条件 / 反例 / 应用"这类侧面单独立成 topic 再输出。
2. 题目必须能区分"会算"和"只会背"——纯定义复述题、复读课本原句的判断题一律不得出现（详见任务二禁止令）。
3. 至少一半题目要求学生在草稿纸上做 1 步以上的运算 / 推导 / 判定，否则视为题目过基础。
请把这三条当作合格门槛，不要再缩水交差。\n\n`
    : `【掌握度优先 —— 本批输出用于检验"会不会用"，不是考"知不知道"】
请确保 topics ≥ 10 条且足够细粒度，并保证题目都需要真正的运算 / 推导 / 判定才能选对。\n\n`;

  const prompt = `你是一位专业数学教授，正在为中国大学生制作"掌握度测验"——目的是检验学生**会不会用**这些知识点解题，而不是背诵定义。教材原文可能是英文，但所有输出内容必须使用中文。

【重要警告】以下文本由 PDF 自动提取，数学符号可能存在乱码：
- "x 2" 实为 x²，"d t 2" 实为 d²/dt²，"x n" 实为 xₙ
- "d y / d x" 实为 dy/dx，字母间多余空格是乱码
- 所有数学公式必须还原为正确标准符号，绝对不能照抄乱码原文

${granularityBanner}${chunkBanner}${refBanner}=== 教材原文（${isEnglish ? "英文" : "中文"}教材，输出用中文）===
${cleanText}
=== 原文结束 ===

课程：${course || "数学"} | 章节：${ch}

【任务一】提取 **10~16 个细粒度**核心知识点，并组织成**有层次的目录结构**（不是扁平列表）。**少于 10 个视为失败**。

每个知识点必须是 JSON 对象，含以下字段（缺字段视为失败）：
  - "name"：知识点名称（中文，4~14 字，**必须具体到一个可单独出题、可单独讲解的子概念或操作**）。
  - "summary"：30~80 字一句话说明（写"是什么 + 何时用 + 关键约束"，不能只重复 name）。
  - "section"：所属"**大标题**"（中文，4~12 字，例如"矩阵的概念与运算"、"线性方程组"、"特征值与对角化"）。**必须从一个稳定的 section 名集合里挑**——本片段所有 topic 应该聚合在 3~5 个 section 里，而不是每条 topic 一个 section。
  - "parent"：直接父知识点的 name（中文）。如果该 topic 是该 section 下的"小标题"（顶层 child），填 null；否则填它直接依赖 / 隶属于的某条同样在 topics 里的 name。
  - "depth"：层级整数：1 = 节级概念（小标题）；2 = 操作 / 方法 / 性质（叶子）；3 = 综合应用 / 反例 / 边界。
  - "prerequisites"：array of string，列出本知识点依赖的、同批次其它 topic 的 name；无依赖给空数组 []。

【目录结构示意 —— 必须照此组织】：
  section "矩阵的概念与运算"（大标题）
    ├─ depth=1 "矩阵的定义"（parent=null）
    │    ├─ depth=2 "矩阵的加法 / 减法"（parent="矩阵的定义"）
    │    ├─ depth=2 "矩阵的数乘"（parent="矩阵的定义"）
    │    └─ depth=2 "矩阵乘法的可乘条件"（parent="矩阵的定义"）
    └─ depth=1 "矩阵的转置与逆"（parent=null）
         ├─ depth=2 "$(AB)^T = B^T A^T$ 的证明"（parent="矩阵的转置与逆"）
         └─ depth=3 "$AB = I$ 但 $A,B$ 非方阵的反例"（parent="矩阵的转置与逆"）
  注意：每个 section 至少 1 条 depth=1 + 2 条 depth>=2；同一 section 不要超过 6 条。

【知识点拆分指南 —— 同一个大概念至少拆成 3 条】：
- 看到"X 的运算"——拆成 "X 的加法/减法"、"X 的乘法（含交换律是否成立）"、"X 的逆元 / 求逆方法"。
- 看到"Y 的性质"——拆成 "Y 的定义"、"Y 的判定方法"、"Y 的反例 / 边界情形"、"Y 在某场景下的应用"。
- 看到一条定理——拆成 "定理陈述"、"成立条件 / 假设"、"证明思路或关键引理"、"典型应用"、"反例"（条件去掉后会怎样）。
- 看到一种方法（如"分离变量法"、"高斯消元"）——拆成 "适用条件"、"操作步骤"、"易错点"、"与相邻方法的对比"。

【知识点细化要求 —— 出现以下情形视为不合格】：
× 过粗：写"线性代数"、"矩阵"、"积分"这种章节级大类。✓ 正确：写"矩阵的初等行变换"、"行最简形矩阵"、"矩阵秩的判定"。
× 过短：summary < 25 字 或 仅是 name 的同义改写。
× 重复 / 同义：两条 name 高度相似（如"矩阵运算"和"矩阵的运算"）—— 必须合并并挑更精确的那个。
× 章节标题 / 元数据：name 不能是"第 X 章"、"线性代数基础"、"绪论"这类目录文字（这些只能出现在 section 字段，不能成为 topic 的 name）。
× 鸡汤 / 学习方法：name 不能是"如何学好微积分"、"做题技巧"这类。
× section 太碎：不要每条 topic 一个 section；section 必须聚合多个 topic。如果你只想出一条 section，请改名让它能容纳更多子条。
× 教材元数据：禁止出现 "本书的补充章节"、"配套在线练习"、"勘误"、"前言" 这类指代教材产品本身的内容——这是产品介绍，不是数学知识。
若你倾向于只输出 5~8 个知识点，**强制自检**：本片段里有没有可以再拆的运算 / 条件 / 反例 / 应用？拆完再输出。

【任务二】生成恰好 ${count} 道**掌握度测验题**（不是概念背诵题），要求：
- 题目目标：检测学生**会不会用**该知识点完成一次具体的数学操作（计算、推导、判定、构造、反例分析），而不是检测他**知不知道**定义。
- 每道题必须**绑定一个或多个知识点**——在题目对象里加 "knowledge_points": ["任务一中的某条 name", ...]（必填字段）。
- 每道题必须基于原文里某一条具体定理 / 定义 / 公式 / 方法。
- 所有数学公式用标准 LaTeX，行内用 $...$，块级用 $$...$$（如 $A^{-1}$、$\\det(A)$、$\\frac{dy}{dx}$、$\\int_a^b f(x)dx$、$\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}$）。
- 单选题：恰好 4 个选项 A/B/C/D，每个干扰项必须是**学生真实可能犯的错**（漏负号、用错公式、混淆相邻概念、忘记某个条件），不得使用"与原文相反"、"以上都不对"、"教材未提及"等逃避选项。
- 判断题：options 为 null，answer 为"正确"或"错误"；命题必须是**带具体公式 / 数值 / 条件**的、可被推演判定真伪的数学陈述（如 "若 $A$ 可逆则 $A^T$ 也可逆" 才算合格；"理解可逆矩阵很重要" 不合格）。
- 题型分配：至少 ${Math.max(2, Math.floor(count * 0.7))} 道单选题；判断题最多 ${Math.max(1, Math.floor(count * 0.2))} 道；其余可以是单选。
- **难度分布（必须满足）**：
  · 至少 ${Math.max(1, Math.floor(count * 0.5))} 道"中难度"题：需要 1~2 步推导或一次具体计算才能选出答案（不是直接套定义）。
  · 至少 ${Math.max(1, Math.floor(count * 0.2))} 道"高难度"题：需要 ≥3 步推理、或要求构造反例 / 边界情形分析 / 多个定理联用。
  · 纯定义复述题（"下列哪一项是 X 的定义"、"X 的定义是什么"）**最多 0 道，不得出现**。
- 解析 60~120 字，必须说明"为什么对 + 关键中间步骤 + 干扰项错在哪一步"，不能只复述答案。

【严格禁止 —— 概念背诵题与基础题禁止令】（出现即视为失败，必须重写）：
1. **纯定义题**：题干形如"X 的定义是"、"下列哪一项正确描述 X"、"什么叫 X"。这是概念题，禁止。
   反例：❌ "下列哪一项是矩阵秩的定义？" → 应改为：✓ "已知 $A=\\begin{pmatrix}1&2\\\\2&4\\end{pmatrix}$，求 $\\mathrm{rank}(A)$。"
2. **是非套路题**：题干形如"X 是 Y 的特例 是否正确"，但选项 / 命题里没有任何可计算或可验证的具体表达式。
   反例：❌ "线性代数研究向量空间，是否正确？" → 应改为：✓ "向量 $(1,2,3)$ 与 $(2,4,6)$ 线性相关，是否正确？"
3. **学习方法 / 元认知 / 学习态度**类。反例：❌ "学微积分先做题更有效。"
4. **资料元信息**题：问作者、书名、章节号、日期、课程编号。
5. **常识鸡汤**题：❌ "认真听讲对学习有帮助。"
6. **不含具体数学对象**的判断题：判断题题干必须含 ≥1 个具体数学符号 / 公式 / 数值 / 条件，否则丢弃。
7. **答案藏在题干**：题干已经把要算的式子写出最终答案，让选择沦为对照。
8. **过基础**：仅靠"看一眼定义就能选"的题（如把课本原句拆成 ABCD 四种说法挑正确的），即使披着算式外衣也不合格——必须有真正的运算或推理才能过关。

每道题必须考查"**具体的计算 / 推导 / 判定 / 构造 / 反例分析**"中的至少一种，使学生**没真正掌握就做不对**——这是本批次题目唯一的合格标准。

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
  Step 5. 问自己："学生即使背了定义，但没真正会算，能不能做对？" 如果能 → 题目过基础，重写。

仅输出如下 JSON，不附加任何其他文字或 markdown（注意：topics 必须有完整层级字段；questions 必须有 "knowledge_points" 字段——从 topics 中挑 1~3 条 name 填进去）：
{
  "topics": [
    { "name": "可分离方程的判定", "summary": "判断 ODE 是否能写成 dy/dx=f(x)g(y) 形式；要点：右端因子化是否成立、g(y)=0 是否给出特解。", "section": "一阶可分离 ODE", "parent": null, "depth": 1, "prerequisites": [] },
    { "name": "分离变量法的代数操作", "summary": "把 dy/dx=f(x)g(y) 移项为 dy/g(y)=f(x)dx 的具体写法及哪些项不可丢；忽略 g(y)=0 会漏特解。", "section": "一阶可分离 ODE", "parent": "可分离方程的判定", "depth": 2, "prerequisites": ["可分离方程的判定"] },
    { "name": "积分常数 C 的归一", "summary": "两端积分得 H(y)=F(x)+C₀；常用 ln|·| → e^{C₀}=C 合并的技巧；C 必须在解集化简后再带边界条件。", "section": "一阶可分离 ODE", "parent": "分离变量法的代数操作", "depth": 2, "prerequisites": ["分离变量法的代数操作"] },
    { "name": "丢失特解的反例：g(y)=0 处", "summary": "形如 dy/dx=y² 时 y≡0 是特解，但分离变量过程中 1/y² 把它消去；必须单独验证 g(y)=0 是否给出新解。", "section": "一阶可分离 ODE", "parent": "分离变量法的代数操作", "depth": 3, "prerequisites": ["分离变量法的代数操作"] }
  ],
  "questions": [
    { "type": "单选题", "knowledge_points": ["分离变量法的代数操作", "积分常数 C 的归一"], "question": "用分离变量法求解 $\\frac{dy}{dx} = xy$（满足 $y(0)=2$），则 $y(x)=$？", "options": ["A. $2e^{x^2/2}$", "B. $2e^x$", "C. $e^{x^2/2}+1$", "D. $x^2+2$"], "answer": "A", "explanation": "分离得 $dy/y = x\\,dx$，积分得 $\\ln|y| = x^2/2 + C_0$；代入 $y(0)=2$ 得 $C_0=\\ln 2$，故 $y = 2e^{x^2/2}$。B 漏掉了 x 一次方，C 把 C₀ 当作加常数。" },
    { "type": "单选题", "knowledge_points": ["可分离方程的判定"], "question": "下列方程中**不能**直接用分离变量法求解的是？", "options": ["A. $\\frac{dy}{dx}=x^2 \\sin y$", "B. $\\frac{dy}{dx}=\\frac{x+y}{x-y}$", "C. $\\frac{dy}{dx}=e^x e^{-y}$", "D. $\\frac{dy}{dx}=y^2/(1+x^2)$"], "answer": "B", "explanation": "分离变量要求右端能写成 $f(x)g(y)$ 形式；B 中 $(x+y)/(x-y)$ 无法因式拆开，需用齐次代换。A、C、D 均可分离。" }
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
    } else if (effectiveProvider === "openrouter") {
      // OpenRouter: 优先用 :free 模型，免费档每月有上限但日常练习够用
      // Mistral 7B :free 是 OpenRouter 上对中文 + 数学最稳定的免费模型
      responseText = await callOpenAICompat("https://openrouter.ai/api/v1", k, "mistralai/mistral-7b-instruct:free") || "";
      if (!responseText) responseText = await callOpenAICompat("https://openrouter.ai/api/v1", k, "google/gemma-2-9b-it:free") || "";
      if (!responseText) responseText = await callOpenAICompat("https://openrouter.ai/api/v1", k, "meta-llama/llama-3.1-8b-instruct:free") || "";
      if (responseText) apiUsed = "openrouter(user)";
    } else if (effectiveProvider === "siliconflow") {
      // 硅基流动 Qwen2.5-7B-Instruct 免费档
      responseText = await callOpenAICompat("https://api.siliconflow.cn/v1", k, "Qwen/Qwen2.5-7B-Instruct") || "";
      if (!responseText) responseText = await callOpenAICompat("https://api.siliconflow.cn/v1", k, "THUDM/glm-4-9b-chat") || "";
      if (responseText) apiUsed = "siliconflow(user)";
    } else if (effectiveProvider === "zhipu") {
      // 智谱 GLM-4-Flash 完全免费，OpenAI 兼容
      responseText = await callOpenAICompat("https://open.bigmodel.cn/api/paas/v4", k, "glm-4-flash") || "";
      if (responseText) apiUsed = "zhipu(user)";
    } else if (effectiveProvider === "cerebras") {
      // Cerebras 速度王，OpenAI 兼容
      responseText = await callOpenAICompat("https://api.cerebras.ai/v1", k, "llama3.1-8b") || "";
      if (!responseText) responseText = await callOpenAICompat("https://api.cerebras.ai/v1", k, "llama3.3-70b") || "";
      if (responseText) apiUsed = "cerebras(user)";
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

  // forceProvider 严格模式：用户指定了某个 provider 时只走那一家，失败就报错，不偷偷 fallback。
  // 这样能保证"用户点 Groq 重抽 → 写库 provider=groq"的因果链，不会因为 Groq 没 Key 自动落到智谱。
  const allowProvider = (pid) => !forceProvider || forceProvider === pid;

  // ── Priority 2a: server Groq key（最快、最大免费配额，优先用） ─────────────
  if (!responseText && GROQ_KEY && allowProvider("groq")) {
    responseText = await callOpenAICompat("https://api.groq.com/openai/v1", GROQ_KEY, "llama-3.3-70b-versatile") || "";
    if (!responseText) responseText = await callOpenAICompat("https://api.groq.com/openai/v1", GROQ_KEY, "llama-3.1-8b-instant") || "";
    if (responseText) apiUsed = "groq(server)";
  }

  // ── Priority 2b: server Gemini key ─────────────────────────────────────────
  if (!responseText && GEMINI_KEY && allowProvider("gemini")) {
    responseText = await callGemini("gemini-2.0-flash", GEMINI_KEY) || "";
    if (!responseText && quotaExceeded) {
      await new Promise(r => setTimeout(r, 4000));
      quotaExceeded = false;
      responseText = await callGemini("gemini-2.0-flash-lite", GEMINI_KEY) || "";
    }
    if (responseText) apiUsed = "gemini(server)";
  }

  // ── Priority 2c: server 智谱 GLM-4-Flash ─
  if (!responseText && ZHIPU_KEY && allowProvider("zhipu")) {
    responseText = await callOpenAICompat("https://open.bigmodel.cn/api/paas/v4", ZHIPU_KEY, "glm-4-flash") || "";
    if (responseText) apiUsed = "zhipu(server)";
  }

  // ── Priority 2d: 其它免费 server keys ─
  if (!responseText && OPENROUTER_KEY && allowProvider("openrouter")) {
    responseText = await callOpenAICompat("https://openrouter.ai/api/v1", OPENROUTER_KEY, "mistralai/mistral-7b-instruct:free") || "";
    if (!responseText) responseText = await callOpenAICompat("https://openrouter.ai/api/v1", OPENROUTER_KEY, "google/gemma-2-9b-it:free") || "";
    if (responseText) apiUsed = "openrouter(server)";
  }
  if (!responseText && SILICONFLOW_KEY && allowProvider("siliconflow")) {
    responseText = await callOpenAICompat("https://api.siliconflow.cn/v1", SILICONFLOW_KEY, "Qwen/Qwen2.5-7B-Instruct") || "";
    if (responseText) apiUsed = "siliconflow(server)";
  }
  if (!responseText && CEREBRAS_KEY && allowProvider("cerebras")) {
    responseText = await callOpenAICompat("https://api.cerebras.ai/v1", CEREBRAS_KEY, "llama3.1-8b") || "";
    if (responseText) apiUsed = "cerebras(server)";
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

  // 教材元数据题门卫：问"本书 / 本教材 / 补充章节 / 在线练习 / 错误列表"等——
  // 这是产品介绍页的题，不是数学题。即便 prompt 已禁止，弱模型仍会偶尔产出。
  const isMetaBookQuestion = (qText, opts) => {
    const text = String(qText || "");
    const optBlob = Array.isArray(opts) ? opts.join(" ") : "";
    const blob = text + " " + optBlob;
    if (/(?:这份资料|本资料|这本书|本书[中的是包附]|本教材[中的是包附]|关于本书|关于本教材)/.test(text)) return true;
    if (/(?:补充章节|在线练习|错误列表|勘误表?|额外章节|附录章节|教材附带|教材包含|课程网站|配套(?:资源|网站|平台)|封面|目录|前言|序言|致读者)/.test(blob)
        && /(?:正确的|包含|提供|附带|配有|是否|哪一?项|哪个|哪些)/.test(text)) return true;
    return false;
  };

  // 概念背诵 / 过基础题门卫 —— 与新 prompt 的"掌握度优先"目标对齐。
  // 我们要把"会算"和"只会背"分开：纯定义复述题、复读课本原句的判断题、
  // 干扰项全是抽象描述无任何具体计算对象的单选题，统统拦下来。
  const isConceptOnly = (qText, opts, qType) => {
    const text = String(qText || "");
    if (!text) return true;

    // 题干含"具体可算/可判定"的数学线索：公式 / 数值 / 矩阵 / 向量 / 求值动作
    const hasComputable =
      /\$[^$]+\$|\$\$[^$]+\$\$/.test(text) ||                                       // LaTeX 公式
      /\\(?:frac|int|sum|sqrt|prod|lim|partial|det|rank|begin\{(?:pmatrix|bmatrix|cases)\})/i.test(text) ||
      /[=≤≥≠→∈∉][^。.!?]{0,40}[a-zA-Z0-9]/.test(text) ||                            // 含等号 / 关系符 + 表达式
      /-?\d+(?:\.\d+)?(?:\s*[+\-×÷*\/]\s*-?\d+)/.test(text) ||                       // 数值四则运算
      /\b(?:求|计算|判定|证明|化简|展开|展开式|展开至|代入|消元|逼近|估计|构造|反例|何时|当.*时|是否)\b/.test(text) ||
      /\b(?:find|compute|evaluate|determine|prove|show|verify|construct|simplify|solve)\b/i.test(text);

    // 概念背诵句式：题干形如"X 的定义是 / 下列哪一项是 X 的定义 / 什么叫 X / X 是指"
    const isDefRecallStem =
      /(?:下列(?:哪一?项|何者|哪个).{0,8}(?:是|描述|表示|关于).{0,18}(?:的)?(?:定义|含义|描述|说法).{0,6}(?:正确|对的|准确)?)/.test(text) ||
      /(?:^|[^一-龥a-zA-Z0-9])(?:什么(?:叫|是)|何谓)\s*[「『]?[一-鿿A-Za-z][^。.!?]{0,20}[」』]?[？?]?\s*$/.test(text) ||
      /(?:的定义(?:是|为)|是指|定义为)[：:]?\s*$/.test(text);

    if (isDefRecallStem) return true;

    // 判断题：题干必须含具体数学对象，否则视为常识 / 学习方法题
    if (qType === "判断题" || (!opts || opts.length < 2)) {
      if (!hasComputable) return true;
      // 复读课本原句、纯口号式断言（"理解 X 很重要 / 学好 X 要..."）
      if (/(?:很重要|有助于|应该(?:先|多)|是关键|是核心|是基础|建议(?:同时|先)|应当注意)/.test(text) && !/[=<>≤≥]/.test(text)) return true;
    }

    // 单选题：题干 + 选项联合判定。如果题干没有具体对象，且 4 个选项也都是抽象描述，剔除。
    if (qType !== "判断题" && Array.isArray(opts) && opts.length >= 2) {
      const optBlob = opts.join(" ");
      const optHasFormula =
        /\$[^$]+\$|\\(?:frac|int|sum|sqrt|begin\{)/i.test(optBlob) ||
        /[=≤≥≠→][^。.!?]{0,30}[a-zA-Z0-9]/.test(optBlob) ||
        /-?\d+(?:\.\d+)?\s*[+\-×÷*\/^]/.test(optBlob);
      if (!hasComputable && !optHasFormula) return true;
    }

    return false;
  };

  const questions = rawQuestions
    .filter(q => q && String(q.question || q.text || q.content || "").length > 5)
    .map(q => {
      const qText = String(q.question || q.text || q.content || "");
      const opts = Array.isArray(q.options) && q.options.length >= 2 ? q.options : null;
      const kps = Array.isArray(q.knowledge_points) ? q.knowledge_points.map(String).filter(Boolean) :
                  Array.isArray(q.knowledgePoints)   ? q.knowledgePoints.map(String).filter(Boolean) : [];
      return {
        question: qText,
        options: opts,
        answer: String(q.answer || q.correct_answer || (opts ? "A" : "正确")),
        explanation: String(q.explanation || q.rationale || q.reason || ""),
        type: String(q.type || (opts ? "单选题" : "判断题")),
        knowledge_points: kps,
        chapter: ch,
      };
    })
    .filter(q => !isShellOrDangling(q.question, q.options))
    .filter(q => !isMetaBookQuestion(q.question, q.options))
    .filter(q => !isConceptOnly(q.question, q.options, q.type));

  // ── Normalise topics (field name variants across models) ──────────────────
  const rawTopics = Array.isArray(result.topics) ? result.topics
    : Array.isArray(result.concepts) ? result.concepts
    : Array.isArray(result.key_concepts) ? result.key_concepts
    : Array.isArray(result.knowledge_points) ? result.knowledge_points
    : [];

  const topics = rawTopics
    .filter(t => t && String(t.name || t.title || t.concept || "").length > 1)
    .map(t => {
      const name = String(t.name || t.title || t.concept || "");
      const section = String(t.section || t.group || t.category || "").trim();
      const parentRaw = t.parent || t.parent_name || null;
      const parent = parentRaw == null || parentRaw === "" || parentRaw === "null"
        ? null
        : String(parentRaw).trim();
      const depthRaw = t.depth ?? t.level;
      const depthNum = Number.isFinite(Number(depthRaw)) ? Math.max(1, Math.min(3, Math.round(Number(depthRaw)))) : null;
      const prereqs = Array.isArray(t.prerequisites) ? t.prerequisites.map(String).map(s => s.trim()).filter(Boolean) :
                      Array.isArray(t.prereqs)        ? t.prereqs.map(String).map(s => s.trim()).filter(Boolean) : [];
      return {
        name,
        summary: String(t.summary || t.description || t.explanation || ""),
        section: section || null,
        parent: parent === name ? null : parent, // 自指 → 视作根
        depth: depthNum,
        prerequisites: prereqs.filter(p => p !== name),
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
