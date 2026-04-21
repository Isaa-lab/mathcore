export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const {
    chapter, type, count,
    mode, question: chatQuestion, materialTitle, materialContext,
    conversationHistory,
    userProvider, userKey, userCustomUrl,
  } = req.body;

  const GEMINI_KEY = process.env.GEMINI_KEY;
  const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
  const GROQ_KEY = process.env.GROQ_KEY;
  const DEEPSEEK_KEY = process.env.DEEPSEEK_KEY;

  const hasUserKey = userKey && String(userKey).trim().length > 8;
  const effectiveProvider = hasUserKey ? (userProvider || "groq") : null;
  const hasServerKey = GROQ_KEY || GEMINI_KEY || ANTHROPIC_KEY || DEEPSEEK_KEY;

  if (!hasUserKey && !hasServerKey) {
    return res.status(500).json({ error: "暂无可用 AI 服务。请在首页点击「AI 设置」输入你的 API Key（推荐免费的 Groq）。" });
  }
  

  const isChatMode = (mode === "chat" || mode === "tutor") && chatQuestion;

  // ── 可视化决策心法（四层决策树 + VIZ 协议） ─────────────────────────────
  // AI 必须先完成四层判断，再决定是否下发可视化指令，避免"不管什么都画流程图"
  const VIZ_FRAMEWORK = `
============================================================
【红线一 · 数学公式强约束 — ZERO TOLERANCE】
============================================================
所有数学符号、公式、表达式都 MUST 被 LaTeX 界定符包裹，否则前端会把它当纯文本显示（已多次出事故）：
  · 行内公式：用单美元符号，例：$dy/dx + P(x)y = Q(x)$、$\\int f(x)dx$、$e^{-2x}$、$y'' + y = 0$、$C_1$、$\\alpha$
  · 块级公式：用双美元符号单起一行，例：$$y(x) = C e^{-2x} + \\frac{3}{2}$$
  · 绝对禁止：直接写 "dy/dx + p(x)y = q(x)"、"y = Ce^(-2x)"、"∫ f(x)dx" 等未包裹的裸公式
  · 绝对禁止：一条回答中任何一个导数、积分、指数、下标、希腊字母裸露在 Markdown 文本中
  · 自检：输出前扫一遍，凡出现 /、^、_、'、∫、∑、∏、α-ω、\\frac、\\sum 等数学元素的，必须在 $...$ 内

============================================================
【红线二 · 可视化强契约 — 禁止薛定谔的图】
============================================================
当且仅当可视化能显著降低认知负荷时，输出一个 [VIZ:{...}] 标记，严禁空口说白话：
  · 绝对禁止："下面这张图展示了..."、"如图所示..."、"我为你绘制了架构图..." 而后面并没有 [VIZ:...] 指令
  · 绝对禁止：用 ASCII 符号（树枝 ├── │ └── 等）手绘"图"冒充可视化
  · 绝对禁止：用 Markdown 代码块里写伪代码流程图
  · 若无法提供合法 [VIZ:...]，就不要提任何"图"相关的词，改为文字描述即可
  · [VIZ:...] 标记必须单独成行，且是一行合法 JSON

============================================================
【红线三 · 反模式禁令 — 严禁懒惰可视化】
============================================================
历史事故：过往 AI 几乎把所有问题都硬塞进"参数滑块 + 坐标系"模板。本次起
彻底禁止以下反模式：
  ❌ 对所有问题默认使用 parametric（滑块+坐标系）—— 这是最常见也最可耻的偷懒
  ❌ 把"可视化"狭义理解为"画函数图像" —— 可视化是翻译认知结构，不是画 Chart
  ❌ 对概念定义类问题（"什么是X"）强行用参数图 —— 应该用 annotation（公式标注）
  ❌ 对推导过程类问题（"怎么推X"）用静态图 —— 应该用 process（分步展开）
  ❌ 对对比类问题（"X vs Y"）用单张图 —— 应该用 comparison（并列对比）
  ❌ 口头说"让我画张图/如图所示"却不输出 [VIZ:...] 载荷
  ❌ 用 Markdown 代码块 / ASCII 树枝（├── │ └──）手绘伪装成可视化

============================================================
【结构选择触发词对照表 — 强制先对号入座】
============================================================
用户问什么 → 必须选什么 structure（按此表严格匹配，不得跨选）：

  "什么是X" / "X的定义" / "X的含义" / "X代表"           → annotation (公式标注)
  "有哪几种" / "X分为" / "X的分类" / "种类" / "包括"    → hierarchy  (层级树)
  "X vs Y" / "区别" / "X和Y不同" / "对比" / "哪个好"    → comparison (并列对比)
  "怎么推" / "证明" / "推导" / "如何得到" / "步骤"       → process    (分步)
  "关系" / "关联" / "之间" / "概念图" / "网络"           → concept    (关系图)
  "X改变会怎样" / "参数的作用" / "调整X" / "敏感性"      → parametric (参数图)
    ⚠️ parametric 是最严苛的保留形态，仅当用户真的需要"手动调数值看变化"时才用

============================================================
【可视化四层决策心法】
============================================================
第一层 · structure：
  annotation / hierarchy / comparison / process / concept / parametric

第二层 · 用户画像：初学者建立直觉 / 开发者精确理解 / 面试者清单 / 深度学习者
第三层 · interactionLevel："L0"静态 / "L1"渐进披露 / "L2"参数可调 / "L3"完整模拟
  能用低级别就不用高级别
第四层 · 视觉符号：流程→箭头链 · 层级→缩进树 · 对比→并列卡 · 标注→彩色拆解 · 关系→节点网 · 参数→函数曲线

============================================================
【输出前 3 问自检 — 每次必过】
============================================================
输出 [VIZ:...] 之前，在心里回答这 3 问：
  Q1: 用户问题属于上表哪一类？→ 据此确定 structure。
  Q2: 如果 Q1 选的是 parametric，请再问一次：用户真的需要动手拖滑块吗？
      若答"不需要"，强制降级为 annotation / hierarchy / process 等更合适的形态。
  Q3: 这张图能否让用户"脱离文字"独立看懂这个知识点？
      若答"不能"，换形态。

============================================================
【VIZ 输出协议 — 必须一行合法 JSON】
============================================================
[VIZ:{"structure":"<type>","interactionLevel":"L0|L1|L2|L3","title":"简短标题","description":"一句话说明","data":{...}}]

按 structure 下发对应 data：

  · annotation → 拆解一个公式的每个组成部分，最常用：
    data:{"formula":"\\\\frac{dy}{dx}+P(x)y=Q(x)","parts":[
      {"tex":"\\\\frac{dy}{dx}","label":"一阶导数","desc":"未知函数对自变量的变化率","tone":"indigo"},
      {"tex":"P(x)y","label":"齐次项","desc":"关于 y 的一次项，系数随 x 变化","tone":"emerald"},
      {"tex":"Q(x)","label":"非齐次项","desc":"自由项；为 0 时方程称齐次","tone":"amber"}
    ]}
    tone 可选：indigo / emerald / amber / rose / violet / blue / slate

  · hierarchy → 层级树：
    data:{"root":{"name":"根","children":[{"name":"一级","desc":"可选说明","children":[{"name":"二级"}]}]}}

  · process → 分步展开：
    data:{"steps":[{"title":"第1步","desc":"...","formula":"可选 LaTeX"},{"title":"第2步","desc":"..."}]}

  · comparison → 并列对比：
    data:{"columns":[{"title":"方法A","subtitle":"可选","points":[{"text":"优势","tone":"pro"},{"text":"劣势","tone":"con"},"普通点"]},{"title":"方法B","points":[...]}]}

  · concept → 概念关系网络：
    data:{"nodes":[{"id":"ode","name":"微分方程","primary":true},{"id":"sep","name":"可分离变量"},{"id":"lin","name":"一阶线性"}],"edges":[{"from":"ode","to":"sep","label":"包含"},{"from":"ode","to":"lin","label":"包含"}]}
    必须有且只有 1 个 primary=true 的中心节点；节点总数建议 4-8 个。

  · parametric → 参数曲线族（仅在真的需要调参数时用）：
    data:{"k":2,"steady":1.5,"cMin":-3,"cMax":3,"cInit":1,"equation":"dy/dx + 2y = 3"}

兼容（旧）：[CHART:{"title":"...","k":2,"steady":1.5,"cMin":-3,"cMax":3}] 自动归为 parametric L2。

============================================================
【正反示例 — 严格模仿】
============================================================
❌ 错误："一阶线性微分方程的标准形式是 dy/dx + P(x)y = Q(x)，主要用积分因子法。"
✅ 正确："一阶线性微分方程的标准形式是 $dy/dx + P(x)y = Q(x)$，主要用**积分因子法**。"

❌ 反模式：用户问"什么是一阶线性微分方程" → 输出 parametric 滑块图
✅ 正确：用户问"什么是一阶线性微分方程" → 输出
[VIZ:{"structure":"annotation","interactionLevel":"L1","title":"一阶线性微分方程结构","description":"公式各部分含义","data":{"formula":"\\\\frac{dy}{dx}+P(x)y=Q(x)","parts":[{"tex":"\\\\frac{dy}{dx}","label":"一阶导数","desc":"变化率","tone":"indigo"},{"tex":"P(x)y","label":"齐次项","desc":"一次项","tone":"emerald"},{"tex":"Q(x)","label":"非齐次项","desc":"自由项","tone":"amber"}]}}]

❌ 反模式：用户问"积分因子法怎么推导" → 输出 parametric 滑块图
✅ 正确：用户问"积分因子法怎么推导" → 输出 structure=process 的分步展开

❌ 反模式：用户问"微分方程和代数方程的关系" → 输出 parametric
✅ 正确：用户问"...的关系" → 输出 structure=concept 的关系图

❌ 错误："下面这张图展示了分类：├── 一阶 ├── 高阶 └── 非线性"
✅ 正确：
[VIZ:{"structure":"hierarchy","interactionLevel":"L1","title":"微分方程分类","description":"按阶数与线性性质","data":{"root":{"name":"微分方程","children":[{"name":"一阶","children":[{"name":"可分离变量"},{"name":"线性方程"}]},{"name":"高阶","children":[{"name":"常系数线性"}]}]}}}]

❌ 错误："通解为 y = Ce^(-2x) + 1.5"
✅ 正确："通解为 $$y(x) = Ce^{-2x} + \\frac{3}{2}$$"
`;

  // ── 系统 Prompt ─────────────────────────────────────────────────────────────
  let systemPrompt;
  if (mode === "tutor") {
    systemPrompt = `你是一位专业的数学期末复习助教，名叫"小核"，正在帮学生复习《${materialTitle || "数学课程"}》。
${materialContext ? `\n【课程知识点参考】\n${materialContext}\n` : ""}
【行为准则】
1. 分析资料时先标注 【必考】【高频】【了解】优先级
2. 每次只教一个知识点，教完立刻出2-3道检验题（不一次讲完整章）
3. 数学公式全部用 LaTeX：行内 $公式$，独立 $$公式$$
4. 每讲完一个知识点问"懂了吗？懂了继续，不懂告诉我哪里卡住了"
5. 绝不直接给最终答案，先提示引导
6. 学生说"我会了/下一个/跳过"立刻执行不反复确认
7. 讲前先展示"考试中长什么样"，再教做法，最后给答题模板
8. 答对了夸，答错了分析原因（计算失误/公式误用/概念盲区）
9. 用中文，500字以内，生动有趣
10. 禁止使用 \\begin{tikzpicture} 等LaTeX图形环境
${VIZ_FRAMEWORK}`;
  } else if (isChatMode) {
    systemPrompt = `你是一位亲切、有趣的数学私教，正在陪学生学习《${materialTitle || "数学教材"}》。风格：温暖鼓励、循循善诱、像朋友交流。
${materialContext ? `\n【资料知识点参考】\n${materialContext}\n` : ""}
【回答要求】
1. 数学公式用 LaTeX：行内 $公式$，独立 $$公式$$
2. 先给核心答案（1-2句），再按步骤展开（不超4步），最后总结关键思路
3. 适当加鼓励，复杂问题结尾追问"还有哪里不清楚？"
4. 解题时不直接给最终答案，先给提示引导思考
5. 400字以内，中文，生动自然
6. 禁止使用 \\begin{tikzpicture}、\\begin{figure} 等 LaTeX 图形环境，网页无法渲染
7. 需要展示图形时，用简单文字坐标描述，如"当x增大，y呈指数增长"，或用简单ASCII示意，不要tikz代码
${VIZ_FRAMEWORK}`;
  }

  // ── 构建 messages 数组（含历史） ────────────────────────────────────────────
  let messages;
  if (isChatMode) {
    const sysMsg = { role: "system", content: systemPrompt };
    const histMsgs = Array.isArray(conversationHistory)
      ? conversationHistory.slice(-12).map(h => ({
          role: h.role === "assistant" ? "assistant" : "user",
          content: h.content || h.text || "",
        }))
      : [];
    const userMsg = { role: "user", content: chatQuestion };
    messages = [sysMsg, ...histMsgs, userMsg];
  }

  const prompt = isChatMode ? null : `你是数学课程出题专家。请为"${chapter}"这个数学章节生成${count}道${type}，所有题目和选项必须用中文。

要求：
- 题目紧贴数值分析或最优化理论内容，考察具体概念和计算
- 单选题提供4个选项（A/B/C/D），干扰项合理，不要出现"与原文相反"或"教材未提及"等无意义选项
- 判断题 options 设为 null，answer 为"正确"或"错误"
- 每题附简短解析（40字以内）

严格按以下 JSON 数组格式返回，不要有其他文字：
[{"question":"题目内容","options":["A.选项1","B.选项2","C.选项3","D.选项4"],"answer":"A","explanation":"解析内容","type":"单选题"}]`;

  // ── OpenAI-compatible helper（支持 messages 数组） ───────────────────────────
  const callOpenAICompat = async (baseUrl, key, model) => {
    try {
      const body = isChatMode
        ? { model, messages, temperature: 0.6, max_tokens: 2000 }
        : { model, messages: [{ role: "user", content: prompt }], temperature: 0.5, max_tokens: 3000 };
      const r = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
        body: JSON.stringify(body),
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
  const callGemini = async (key) => {
    try {
      // Convert messages to Gemini format
      let geminiContents;
      if (isChatMode && messages) {
        geminiContents = messages
          .filter(m => m.role !== "system")
          .map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
        if (messages[0]?.role === "system") {
          // Prepend system message to first user message
          const firstUserIdx = geminiContents.findIndex(m => m.role === "user");
          if (firstUserIdx >= 0) {
            geminiContents[firstUserIdx].parts[0].text = messages[0].content + "\n\n" + geminiContents[firstUserIdx].parts[0].text;
          }
        }
      } else {
        geminiContents = [{ parts: [{ text: prompt }] }];
      }
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: geminiContents,
            generationConfig: { temperature: 0.6, maxOutputTokens: 2000 },
          }),
        }
      );
      if (r.ok) {
        const d = await r.json();
        return d?.candidates?.[0]?.content?.parts?.[0]?.text || "";
      }
      return null;
    } catch (e) {
      console.error("Gemini exception:", e.message);
      return null;
    }
  };

  let responseText = "";

  // Priority 1: user key
  if (hasUserKey) {
    const k = String(userKey).trim();
    if (effectiveProvider === "groq") {
      responseText = await callOpenAICompat("https://api.groq.com/openai/v1", k, "llama-3.3-70b-versatile") || "";
      if (!responseText) responseText = await callOpenAICompat("https://api.groq.com/openai/v1", k, "llama-3.1-8b-instant") || "";
    } else if (effectiveProvider === "deepseek") {
      responseText = await callOpenAICompat("https://api.deepseek.com", k, "deepseek-chat") || "";
    } else if (effectiveProvider === "kimi") {
      responseText = await callOpenAICompat("https://api.moonshot.cn/v1", k, "moonshot-v1-8k") || "";
    } else if (effectiveProvider === "custom") {
      const base = String(userCustomUrl || "").trim().replace(/\/$/, "");
      if (base) responseText = await callOpenAICompat(base, k, "gpt-3.5-turbo") || "";
    } else {
      responseText = await callGemini(k) || "";
    }
  }

  // Priority 2: server Groq
  if (!responseText && GROQ_KEY) {
    responseText = await callOpenAICompat("https://api.groq.com/openai/v1", GROQ_KEY, "llama-3.3-70b-versatile") || "";
    if (!responseText) responseText = await callOpenAICompat("https://api.groq.com/openai/v1", GROQ_KEY, "llama-3.1-8b-instant") || "";
  }

  // Priority 3: server DeepSeek
  if (!responseText && DEEPSEEK_KEY) {
    responseText = await callOpenAICompat("https://api.deepseek.com", DEEPSEEK_KEY, "deepseek-chat") || "";
  }

  // Priority 4: server Gemini
  if (!responseText && GEMINI_KEY) {
    responseText = await callGemini(GEMINI_KEY) || "";
  }

  // Priority 5: Anthropic
  if (!responseText && ANTHROPIC_KEY) {
    try {
      const anthropicMessages = isChatMode
        ? messages.filter(m => m.role !== "system").map(m => ({ role: m.role, content: m.content }))
        : [{ role: "user", content: prompt }];
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 2000,
          system: isChatMode ? systemPrompt : undefined,
          messages: anthropicMessages,
        }),
      });
      if (r.ok) {
        const d = await r.json();
        responseText = d.content?.map(b => b.text || "").join("") || "";
      }
    } catch (e) { console.error("Anthropic exception:", e.message); }
  }

  if (!responseText) {
    return res.status(500).json({ error: "暂无可用 AI 服务。请在首页「AI 设置」配置 API Key（推荐免费的 Groq）。" });
  }

  if (isChatMode) {
    return res.status(200).json({ answer: responseText.trim() });
  }

  const clean = responseText.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  let questions;
  try {
    questions = JSON.parse(clean);
  } catch (e) {
    const m = clean.match(/\[[\s\S]*\]/);
    if (m) {
      try { questions = JSON.parse(m[0]); }
      catch { return res.status(500).json({ error: "JSON解析失败: " + clean.slice(0, 100) }); }
    } else {
      return res.status(500).json({ error: "格式错误: " + clean.slice(0, 100) });
    }
  }

  if (!Array.isArray(questions)) {
    const wrapped = questions?.questions || questions?.problems || questions?.exercises;
    if (Array.isArray(wrapped)) questions = wrapped;
    else return res.status(500).json({ error: "返回格式不是数组" });
  }

  const cleaned = questions
    .filter(q => q && (q.question || q.text || q.content))
    .map(q => {
      const qText = q.question || q.text || q.content || "";
      const opts = Array.isArray(q.options) && q.options.length >= 2 ? q.options : null;
      return {
        question: String(qText),
        options: opts,
        answer: String(q.answer || q.correct_answer || (opts ? "A" : "正确")),
        explanation: String(q.explanation || q.rationale || ""),
        type: String(q.type || (opts ? "单选题" : "判断题")),
      };
    });

  res.status(200).json({ questions: cleaned });
}
