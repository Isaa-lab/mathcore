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
    // 每块要抽多少知识点；前端会按总目标 20 / chunk 数下发 6-10 之间的小数，
    // 多 chunk 汇总后去重，一般正好落在 20-25 区间，比"每块 20"快 2-3x
    topicsPerChunk = null,
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

  const prompt = `你是一位专业数学教授，正在为中国大学生制作习题和知识点卡片。教材原文可能是英文，但所有输出内容必须使用中文。

【重要警告】以下文本由 PDF 自动提取，数学符号可能存在乱码：
- "x 2" 实为 x²，"d t 2" 实为 d²/dt²，"x n" 实为 xₙ
- "d y / d x" 实为 dy/dx，字母间多余空格是乱码
- 所有数学公式必须还原为正确标准符号，绝对不能照抄乱码原文

${chunkBanner}${refBanner}=== 教材原文（${isEnglish ? "英文" : "中文"}教材，输出用中文）===
${cleanText}
=== 原文结束 ===

课程：${course || "数学"} | 章节：${ch}

【任务一】从本片段提取**至少 ${Math.max(6, Number(topicsPerChunk) || 8)} 个**细粒度核心知识点（多个片段汇总后总数需 ≥ 20，少于 20 视为不合格）。每个知识点必须包含：
  - "name"：知识点名称（中文，4~12字，必须**具体**到一个可独立讲解 / 可独立出题的概念或方法）
  - "summary"：一句话说明该知识点的核心内容（中文，30~80字，要写出"是什么 + 为什么 / 何时用"）
  - "category"：从以下 5 类中选一个：
      · "核心概念" — 基本定义、术语、符号（如"特征值"、"极限"）
      · "定理性质" — 定理、引理、推论、性质（如"中值定理"、"正定矩阵性质"）
      · "计算方法" — 算法或步骤（如"高斯消元"、"积分因子法"）
      · "公式推导" — 关键公式、恒等式、推导（如"行列式展开式"、"Taylor 展开"）
      · "应用技巧" — 解题技巧、判定准则（如"特殊矩阵识别"、"收敛性判断"）

【知识点细化要求】：
× 过粗：仅写"线性代数"、"矩阵"这种模糊大类。✓ 写"矩阵的初等行变换"、"行最简形矩阵"、"矩阵秩的判定"等具体条目。
× 过短：summary 仅 10 字以内不合格，需写出关键性质或使用场景。
× 重复：name 高度相似的合并保留更精确的一条。
× 章节标题：name 不能是"第 X 章"、"线性代数基础"这类教材目录文字。

【拆分技巧】把同一概念拆成"定义 + 核心性质 + 判定方法 + 典型反例 + 应用场景"等独立条目，比硬列"线性代数 / 矩阵"这种大类更有用。

【任务二】生成恰好 ${count} 道**高质量**中文习题，要求：
- 每道题必须基于原文里某一条具体定理 / 定义 / 公式 / 方法
- 所有数学公式用标准 LaTeX，行内用 $...$，块级用 $$...$$（如 $A^{-1}$、$\\det(A)$、$\\frac{dy}{dx}$、$\\int_a^b f(x)dx$、$\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}$）
- 单选题：恰好 4 个选项 A/B/C/D，每个干扰项必须是**学生真实可能犯的错**（漏负号、用错公式、混淆相邻概念），不得使用"与原文相反"、"以上都不对"、"教材未提及"等逃避选项
- 判断题：options 为 null，answer 为"正确"或"错误"；命题必须是一个**可被推演判定真伪**的具体数学陈述，不能是宽泛的常识
- 题型分配：至少 ${Math.max(2, Math.floor(count * 0.7))} 道单选题，1~2 道判断题
- 难度分布：count >= 5 时至少包含 1 道综合应用题（需要 2 步以上推理）
- 解析 60~120 字，必须说明"为什么对 + 干扰项错在哪里"，不能只复述答案

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
    { "name": "分离变量法", "summary": "将 dy/dx = f(x)g(y) 改写为 dy/g(y) = f(x)dx，两端分别积分求解一阶常微分方程的方法。", "category": "计算方法" }
  ],
  "questions": [
    { "type": "单选题", "question": "用分离变量法求解 dy/dx = xy，其通解为？", "options": ["A. y = Ce^(x²/2)", "B. y = Ce^x", "C. y = Ce^(x²)", "D. y = x² + C"], "answer": "A", "explanation": "分离变量得 dy/y = x dx，积分得 ln|y| = x²/2 + C₀，故 y = Ce^(x²/2)。" },
    { "type": "判断题", "question": "方程 dy/dx = x²·sin(y) 可以用分离变量法求解。", "options": null, "answer": "正确", "explanation": "该方程可改写为 dy/sin(y) = x² dx，两端可分别积分，故可用分离变量法。" }
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
      // 速度优先：8b-instant 先打，仅在它失败时升 70b 兜底
      responseText = await callOpenAICompat("https://api.groq.com/openai/v1", k, "llama-3.1-8b-instant") || "";
      if (!responseText) responseText = await callOpenAICompat("https://api.groq.com/openai/v1", k, "llama-3.3-70b-versatile") || "";
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
  // 速度优先策略：8b-instant 大约比 70b 快 3-5x，对于结构化 JSON 抽取够用。
  // 只有当 8b 返回空（被审查/挂了）时才升级到 70b 兜底。
  if (!responseText && GROQ_KEY && allowProvider("groq")) {
    responseText = await callOpenAICompat("https://api.groq.com/openai/v1", GROQ_KEY, "llama-3.1-8b-instant") || "";
    if (!responseText) responseText = await callOpenAICompat("https://api.groq.com/openai/v1", GROQ_KEY, "llama-3.3-70b-versatile") || "";
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

  const questions = rawQuestions
    .filter(q => q && String(q.question || q.text || q.content || "").length > 5)
    .map(q => {
      const qText = String(q.question || q.text || q.content || "");
      const opts = Array.isArray(q.options) && q.options.length >= 2 ? q.options : null;
      return {
        question: qText,
        options: opts,
        answer: String(q.answer || q.correct_answer || (opts ? "A" : "正确")),
        explanation: String(q.explanation || q.rationale || q.reason || ""),
        type: String(q.type || (opts ? "单选题" : "判断题")),
        chapter: ch,
      };
    })
    .filter(q => !isShellOrDangling(q.question, q.options));

  // ── Normalise topics (field name variants across models) ──────────────────
  const rawTopics = Array.isArray(result.topics) ? result.topics
    : Array.isArray(result.concepts) ? result.concepts
    : Array.isArray(result.key_concepts) ? result.key_concepts
    : Array.isArray(result.knowledge_points) ? result.knowledge_points
    : [];

  const topics = rawTopics
    .filter(t => t && String(t.name || t.title || t.concept || "").length > 1)
    .map(t => ({
      name: String(t.name || t.title || t.concept || ""),
      summary: String(t.summary || t.description || t.explanation || ""),
    }));

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
