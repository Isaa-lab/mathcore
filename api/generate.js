// ── 顶层 try/catch 守卫 ────────────────────────────────────────────────────
// 关键：任何同步/异步异常都必须返回合法 JSON，绝不能让 Vercel 返回 HTML
// ("FUNCTION_INVOCATION_FAILED") —— 那会让前端完全丢失定位信息。
export default async function handler(req, res) {
  try {
    return await runHandler(req, res);
  } catch (err) {
    const msg = err && err.message ? String(err.message) : "unknown";
    const stack = err && err.stack ? String(err.stack).slice(0, 400) : "";
    console.error("[api/generate] FATAL:", msg, stack);
    try {
      return res.status(500).json({
        error: `后端崩溃: ${msg}`,
        diag: `handler_crash`,
        stack: stack,
      });
    } catch {
      return; // headers already sent
    }
  }
}

async function runHandler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const body = req.body || {};
  const {
    chapter, type, count,
    mode, question: chatQuestion, materialTitle, materialContext,
    conversationHistory,
    questionContext, // { stem, options, correctAnswer, userSelection, isCorrect, misconception, knowledgePoints }
    userProvider, userKey, userCustomUrl,
  } = body;

  const GEMINI_KEY    = process.env.GEMINI_KEY;
  const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
  const GROQ_KEY      = process.env.GROQ_KEY;
  const DEEPSEEK_KEY  = process.env.DEEPSEEK_KEY;
  const KIMI_KEY      = process.env.KIMI_KEY;

  // 平台 Key 速查表：用户在前端选了哪个 provider、但没填自己 Key 时，用这里的 server Key 兜底
  const SERVER_KEY_FOR = {
    groq: GROQ_KEY,
    gemini: GEMINI_KEY,
    deepseek: DEEPSEEK_KEY,
    kimi: KIMI_KEY,
    anthropic: ANTHROPIC_KEY,
  };

  const hasUserKey = userKey && String(userKey).trim().length > 8;
  const effectiveProvider = hasUserKey ? (userProvider || "groq") : null;
  const hasServerKey = !!(GROQ_KEY || GEMINI_KEY || ANTHROPIC_KEY || DEEPSEEK_KEY || KIMI_KEY);

  // ── Provider-aware：判断这次请求"最终会落在哪个 provider"，用来选配不同的 VIZ 指令 ──
  // 不同模型的结构化输出能力差异很大：
  //   · Claude / DeepSeek 强 → 给完整 VIZ schema 没问题
  //   · Groq (Llama)       弱 → 必须给简化 schema + 更强约束，否则括号经常失衡
  //   · Gemini             中 → 倾向用自然语言，要强制它出 VIZ 格式
  //   · Kimi               中 → 和 Gemini 类似
  // 这里用"最可能"的 provider 来定 prompt；即使实际因 fallback 跑到另一个 provider，
  // 也能保证至少是兼容的保守 prompt。
  const resolveLikelyProvider = () => {
    if (hasUserKey) return effectiveProvider || "groq";
    if (userProvider && userProvider !== "server" && SERVER_KEY_FOR[userProvider]) return userProvider;
    // server 模式默认走 Groq（最快最便宜）
    if (GROQ_KEY) return "groq";
    if (DEEPSEEK_KEY) return "deepseek";
    if (GEMINI_KEY) return "gemini";
    if (ANTHROPIC_KEY) return "anthropic";
    if (KIMI_KEY) return "kimi";
    return "groq";
  };
  const likelyProvider = resolveLikelyProvider();

  // ── 每个 provider 的 VIZ 能力画像 + 专属指令 ──
  // preferredStructures：该模型下最稳的 structure 类型（短小、嵌套浅）
  // maxVizPerReply：每次回复最多允许几个 [VIZ:...]（弱模型只让画 1 个，少犯错）
  // extraConstraint：附加的硬约束文本，塞进 socratic/tutor prompt
  const VIZ_PROFILE = {
    claude: {
      preferredStructures: ["annotation", "hierarchy", "process", "comparison", "concept", "parametric"],
      maxVizPerReply: 2,
      extraConstraint: "",
    },
    deepseek: {
      preferredStructures: ["annotation", "hierarchy", "process", "comparison", "concept", "parametric"],
      maxVizPerReply: 2,
      extraConstraint: "",
    },
    gemini: {
      preferredStructures: ["hierarchy", "process", "comparison", "concept"],
      maxVizPerReply: 1,
      extraConstraint: "⚠️ Gemini 专属约束：优先用 LaTeX 写公式，只在真的需要『结构图』时画 [VIZ:...]。画图时 structure 必须在 {hierarchy, process, comparison, concept} 四种里选，禁用 annotation 和 parametric（这两种 LaTeX 嵌套多，你画不稳）。",
    },
    groq: {
      // Groq 上 llama-3.1-8b 非常不稳，严格只给 3 种最浅的结构
      preferredStructures: ["hierarchy", "process", "comparison"],
      maxVizPerReply: 1,
      extraConstraint: "⚠️ 你是 Llama 模型，结构化 JSON 能力有限。为避免括号/反斜杠错误：\n· 每轮最多一个 [VIZ:...]\n· structure 只允许用 hierarchy / process / comparison 三种（最简、嵌套最浅）\n· 绝对禁用 annotation 和 parametric（LaTeX 多，你会画崩）\n· data 里不要写超过 4 层嵌套\n· 输出前逐字符数一遍花括号、方括号是否配对；不确定就直接用文字讲，不要硬画",
    },
    kimi: {
      preferredStructures: ["hierarchy", "process", "comparison", "concept"],
      maxVizPerReply: 1,
      extraConstraint: "⚠️ 你画 [VIZ:...] 时优先用 hierarchy/process/comparison/concept 这四种浅结构，避免深嵌套。",
    },
    custom: { preferredStructures: ["hierarchy", "process", "comparison"], maxVizPerReply: 1, extraConstraint: "" },
  };
  const vizProfile = VIZ_PROFILE[likelyProvider] || VIZ_PROFILE.groq;

  if (!hasUserKey && !hasServerKey) {
    return res.status(500).json({ error: "暂无可用 AI 服务。请在 Vercel 配 GROQ_KEY 等环境变量，或在「AI 设置」里填你自己的 Key。" });
  }
  

  const isSocraticMode = mode === "socratic" && chatQuestion;
  // socratic 走 chat 管线（流式对话、纯文本输出），不进入出题分支
  const isChatMode = isSocraticMode || ((mode === "chat" || mode === "tutor") && chatQuestion);

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
【JSON 逃逸铁律 — 违反一次就整条指令废掉】
============================================================
★ LaTeX 反斜杠必须双写。写在 JSON 字符串里的 \\frac 是非法转义，
  必须写成 "\\\\frac"。同理：\\int→"\\\\int"、\\alpha→"\\\\alpha"、
  \\theta→"\\\\theta"、\\left→"\\\\left"、\\right→"\\\\right"、
  \\sum→"\\\\sum"、\\partial→"\\\\partial"、\\mathbb→"\\\\mathbb"。
  唯一合法的单反斜杠转义只有：\\" \\\\ \\/ \\b \\f \\n \\r \\t \\uXXXX。
★ JSON 字符串内禁止真实换行；要换行请写 "\\n"。
★ 禁止尾逗号（",}" 或 ",]"）。
★ 禁止智能引号（" " ' '），一律用 ASCII " 和 '。
★ 禁止把 [VIZ:{...}] 包在 Markdown 代码块（三反引号）里。
★ [VIZ:...] 必须完整闭合；宁可不画也不要输出被截断的载荷。

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
${VIZ_FRAMEWORK}
${vizProfile.extraConstraint ? "\n━━━ 本轮模型专属约束（必须遵守）━━━\n" + vizProfile.extraConstraint + `\n· 本轮允许的 structure：${vizProfile.preferredStructures.join(" / ")}\n· 本轮最多 ${vizProfile.maxVizPerReply} 个 [VIZ:...]\n` : ""}`;
  } else if (isSocraticMode) {
    // 苏格拉底式答题复盘：学生刚做完一道题，希望 AI 引导 TA 搞懂自己的错/对。
    // 这里是硬性约束——AI 必须只做"复盘引导"，绝不偏航去"出新题"或"直接报答案"。
    const ctx = questionContext && typeof questionContext === "object" ? questionContext : {};
    const stem = (ctx.stem || "").slice(0, 800);
    const optsArr = Array.isArray(ctx.options) ? ctx.options : null;
    const optLines = optsArr ? optsArr.map((o, i) => `  ${String.fromCharCode(65 + i)}. ${o}`).join("\n") : "";
    const correct = ctx.correctAnswer || "";
    const userPick = ctx.userSelection || "";
    const miscon = ctx.misconception || "";
    const kps = Array.isArray(ctx.knowledgePoints) ? ctx.knowledgePoints.join(" / ") : "";
    const wrong = userPick && correct && userPick !== correct;

    // 场景能力清单：做题引导场景允许的能力子集（不允许的要明确禁止，避免 AI 擅自扩权）
    // ✅ text_reply（始终）
    // ✅ render_visualization（annotation / hierarchy / process / comparison / concept；允许 parametric 但极少用）
    // ❌ generate_practice_question（避免复盘时又出新题）
    // ❌ reveal_answer（绝不直接报答案）
    const userAskedForViz = typeof chatQuestion === "string" &&
      /可视化|画图|画一张|画出|图解|示意图|直观|展示|给我看|visuali[sz]e|diagram|chart|graph/i.test(chatQuestion);

    // 精简版 socratic prompt —— 只保留硬约束，去掉大量冗余和反模式举例
    // （原版 2000+ tokens，精简后 ~600 tokens，配合 llama-3.1-8b-instant 能稳定 < 3s 返回）
    systemPrompt = `你是数学老师，在帮学生复盘 TA 刚做完的题。苏格拉底式引导，多问少讲。

【学生状态】${wrong ? "答错" : userPick ? "答对" : "未作答"}${wrong ? "——引导 TA 自己发现错误，不报答案" : userPick ? "——帮 TA 把直觉升级成推理链" : "——从已知条件迈出第一步"}

【能力】
1. 文字对话（默认）
2. 画图：输出一行 [VIZ:{...}] 即可生成可视化；学生明确要求"画图/可视化/直观"时必须用
3. 分步推导：用 [VIZ:{structure:"process",...}]

【硬禁止】
❌ 不能直接说正确答案${correct ? `（本题答案是「${correct}」，你知道但不许告诉学生）` : ""}
❌ 不能出新题、不能说"我们再做一道"
❌ 不能用【题目/选项/答案】这类结构化标签
❌ 不能"说有图却不画"——写了"如图所示/让我们想象一下/下面这张图"就必须紧跟 [VIZ:...]
❌ 不能用 ASCII 树枝 (├──│└──) 或 Markdown 表格冒充可视化

【必做】
✅ 公式用 LaTeX：行内 $...$，块级 $$...$$
✅ 文字回复 ≤150 字；一次只抛 1 个问题
✅ 开场接住情绪（"嗯，你选了 X，我们一起想想..."）

【VIZ 协议】一行合法 JSON：
[VIZ:{"structure":"<type>","interactionLevel":"L0|L1","title":"标题","description":"一句话","data":{...}}]

structure 对号入座（本轮可用：${vizProfile.preferredStructures.join(" / ")}）：
- "什么是X/定义/代表" → annotation（公式拆解）
- "有哪几种/分类" → hierarchy（层级树）
- "X vs Y/区别/对比" → comparison（并列对比）
- "怎么推/证明/步骤" → process（分步）
- "关系/之间" → concept（关系图）

data 骨架（选 structure 对应的那一种即可）：
· annotation: {"formula":"\\\\frac{dy}{dx}+P(x)y=Q(x)","parts":[{"tex":"\\\\frac{dy}{dx}","label":"导数","tone":"indigo"}, ...]}
· hierarchy: {"root":{"name":"根","children":[...]}}
· process: {"steps":[{"title":"第1步","desc":"...","formula":"可选 LaTeX"}]}
· comparison: {"columns":[{"title":"A","points":[{"text":"优势","tone":"pro"}]}]}
· concept: {"nodes":[{"id":"x","name":"X","primary":true}],"edges":[{"from":"x","to":"y","label":""}]}

⚠️ JSON 逃逸铁律：LaTeX 的 \\ 必须双写（\\\\frac 而非 \\frac）。合法转义只有 \\" \\\\ \\/ \\b \\f \\n \\r \\t \\uXXXX，其它都要双写。不要尾逗号、不要智能引号、不要代码块围栏，必须完整闭合。本轮最多 ${vizProfile.maxVizPerReply} 个 [VIZ:...]。
${vizProfile.extraConstraint ? "\n" + vizProfile.extraConstraint + "\n" : ""}
【这道题的背景】
题目：${stem || "（未提供）"}
${optLines ? `选项：\n${optLines}` : ""}${kps ? `\n知识点：${kps}` : ""}${userPick ? `\n学生选：${userPick}` : ""}${miscon ? `\n错项对应的误解：${miscon}` : ""}
${userAskedForViz ? "\n⚠️ 学生本轮明确要求可视化——回复必须含一个合法的 [VIZ:{...}]，不得只用文字。" : ""}

现在根据学生的提问开始引导。第一句温和不打击。`;
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
${VIZ_FRAMEWORK}
${vizProfile.extraConstraint ? "\n━━━ 本轮模型专属约束（必须遵守）━━━\n" + vizProfile.extraConstraint + `\n· 本轮允许的 structure：${vizProfile.preferredStructures.join(" / ")}\n· 本轮最多 ${vizProfile.maxVizPerReply} 个 [VIZ:...]\n` : ""}`;
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

  const prompt = isChatMode ? null : `你是数学课程出题专家。请为"${chapter}"这个数学章节生成${count}道${type}，主版本使用中文。

==================================================
【LAYER 1 · 内容约束（题干必须是"数学命题"）】
==================================================
· 题干只能是数学概念、公式、方法、计算、定理、证明的陈述
· 绝对禁止出现：
  · 资料/书的【标题】【作者姓名】【课程编号】【章节编号】【出版信息】
  · 笔记作者签名、手稿时间戳（如 "Leon 24/12/14 1:09 PM"、"7th January"）
  · 任何非数学类英文专有名词（除 Newton / Euler / Gauss / Taylor / Cauchy / Lagrange /
    Lipschitz / Hermite / Jacobi / Runge / Kutta / Chebyshev / Gram / Schwarz /
    Bernoulli / Galerkin / Riemann / Lebesgue 等经典数学家与算法名外，不得出现其他人名）
  · 对资料本身的元指代（"这份资料"、"这本书"、"原文中"、"本章讲了"）
  · 日期、时间戳（"24/12/14"、"1:09 PM"、"2024-03-15"、"2024 年 3 月"）
· 反例（严禁）：
  ❌ "关于「Leon」，下列描述最恰当的是：A. Leon 24/12/14 1:09 PM 7th Janu"
  ❌ "MATH 2023: Ordinary Differential Equations Xiaoyi Chen, Yu 是否正确"
  ❌ "Ch.2 讲的是行列式吗"
  ❌ "这份资料的作者是"
· 自检问题："这道题换一本讲同样知识点的教材，答案会变吗？"
  - 如果会变 → 你考的是元数据，整道删掉重出
  - 不会变 → 才是真正的数学题

==================================================
【LAYER 2 · 公式格式（ZERO TOLERANCE）】
==================================================
所有数学符号/表达式一律使用 LaTeX，并用 $...$（行内）或 $$...$$（块级）包裹：
· 分数用 \\frac{}{}，不是 /
· 上标用 ^{}；下标用 _{}
· 希腊字母用命令（\\theta \\alpha \\lambda），不要直接写 θ α λ
· 导数：$\\frac{dy}{dx}$、$\\frac{d^2\\theta}{dt^2}$（绝不可写成 "d²θ/dt²"、"d t 2"）
· 积分：$\\int P(x)\\,dx$；积分因子 $\\mu(x)=e^{\\int P(x)\\,dx}$
· 函数名：$\\sin\\theta$、$\\ln x$、$\\exp(kt)$

· 反例：
  ❌ "d²θ/dt² + sinθ = 0"       ✅ "$\\frac{d^2\\theta}{dt^2}+\\sin\\theta=0$"
  ❌ "e^∫p(x)dx"                  ✅ "$e^{\\int p(x)\\,dx}$"
  ❌ "dy/dx + p(x)y = q(x)"       ✅ "$\\frac{dy}{dx}+p(x)y=q(x)$"

自检：生成完逐字扫一遍，凡看到 '/'、'^'、'_'、希腊字符、积分符号∫ 或上下标的地方，必须在 $...$ 中。

==================================================
【LAYER 3 · 题型约束】
==================================================
· 选择题：4 个选项，每个错误选项必须对应"具体的学生误解" misconception
· 绝对禁止 escape options（逃避选项）—— 以下文本一律不得作为选项：
  ❌ 不确定 / 不知道 / 无法判断 / 都有可能 / 视情况而定
  ❌ 以上都对 / 以上都不对 / 以上都不是 / 以上都不正确 / 以上都错
  ❌ 教材未提及 / 与原文相反 / A 和 B / A、B、C 的组合
· 绝对禁止元学习题："学 X 应该怎么做 / 学 X 最重要的是..."
· 判断题：options/options_en/optionRationales/misconceptions 省略，题干必须是明确可判真伪的数学命题

==================================================
【LAYER 4 · 语言规范（中主英辅）】
==================================================
· question / options / explanation 使用中文（主版本）
· 同时提供对应的 question_en / options_en / explanation_en（英文辅版本）
  - 英文版采用学科标准术语（integrating factor、partial derivative、eigenvalue 等）
  - 数学公式两版本保持完全一致
· 选项前缀仍保留 "A."/"B."/"C."/"D."，中英对应

==================================================
【LAYER 5 · 质量约束】
==================================================
· 每题附带 40-80 字中文解析（解释"为什么"，不是复述答案）
· 选择题附 optionRationales（长度 = 选项数，逐一解释每项）
· 附 misconceptions（A/B/C/D → 对应误解简述，仅错误项需要）
· 答案唯一且可被数学推演验证

==================================================
【输出前 6 问自检 — 任意一项不过就整道重写】
==================================================
Q1 题干/选项有没有非数学类英文人名、时间戳、课程号、书名、章节编号？
Q2 所有公式是否都在 $...$ 中且 LaTeX 语法正确（\\frac、^{}、_{}、\\theta 等）？
Q3 选项里有没有"不确定 / 以上都不对"这类逃避选项？
Q4 题干是否在考"该怎么学"（元学习题）？
Q5 正确答案是否唯一且题干未泄露？
Q6 是否同时给出了中文主版本 + 英文辅版本？

==================================================
【输出格式 — 严格 JSON 数组，不要任何其它文字】
==================================================
[{
  "question":"中文题干（含 LaTeX）",
  "question_en":"English stem (with same LaTeX)",
  "options":["A.中文选项","B.中文选项","C.中文选项","D.中文选项"],
  "options_en":["A. English option","B. English option","C. English option","D. English option"],
  "answer":"A",
  "explanation":"40-80 字中文解析（解释为什么）",
  "explanation_en":"English explanation",
  "optionRationales":["A 为何对/错","B 为何对/错","C 为何对/错","D 为何对/错"],
  "type":"单选题",
  "misconceptions":{"A":"","B":"对应误解","C":"对应误解","D":"对应误解"}
}]
判断题只需 question / question_en / answer（"正确"/"错误"）/ explanation / explanation_en / type。`;

  // ── Timeout budget ─────────────────────────────────────────────────────────
  // Vercel Hobby = 10s 硬超时，超过会返回 HTML 错误页（前端解析失败就全归到 5xx）。
  // 这里每个 provider 最多 8s；整个 handler 用 startedAt 追剩余预算，绝不超出。
  const HANDLER_BUDGET_MS = 28000; // Pro 60s 也够用；Hobby 上最多 10s 由 Vercel 兜底
  const PER_PROVIDER_MS = isChatMode ? 8000 : 14000;
  const startedAt = Date.now();
  const remainingBudget = () => Math.max(0, HANDLER_BUDGET_MS - (Date.now() - startedAt));
  const providerDiag = []; // 每个 provider 的诊断信息，失败时一并返回给前端

  const fetchWithTimeout = async (url, opts, ms) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      return await fetch(url, { ...opts, signal: ctrl.signal });
    } finally {
      clearTimeout(t);
    }
  };

  // ── OpenAI-compatible helper（支持 messages 数组） ───────────────────────────
  const callOpenAICompat = async (baseUrl, key, model, label) => {
    const tag = label || `${baseUrl}:${model}`;
    const budget = Math.min(PER_PROVIDER_MS, remainingBudget());
    if (budget < 1500) { providerDiag.push(`${tag}: skipped(budget_exhausted)`); return null; }
    const t0 = Date.now();
    try {
      const body = isChatMode
        ? { model, messages, temperature: 0.6, max_tokens: 1500 }
        : { model, messages: [{ role: "user", content: prompt }], temperature: 0.5, max_tokens: 3000 };
      const r = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
        body: JSON.stringify(body),
      }, budget);
      const dt = Date.now() - t0;
      if (r.ok) {
        const d = await r.json();
        const content = d?.choices?.[0]?.message?.content || "";
        providerDiag.push(`${tag}: ok(${dt}ms, ${content.length}ch)`);
        return content;
      }
      const err = await r.text();
      providerDiag.push(`${tag}: http_${r.status}(${dt}ms)`);
      console.error(`OpenAI-compat(${model}) HTTP ${r.status}:`, err.slice(0, 200));
      return null;
    } catch (e) {
      const dt = Date.now() - t0;
      const reason = e?.name === "AbortError" ? "timeout" : (e?.message || "exception").slice(0, 60);
      providerDiag.push(`${tag}: ${reason}(${dt}ms)`);
      console.error(`OpenAI-compat(${model}) exception:`, e.message);
      return null;
    }
  };

  // ── Gemini helper ──────────────────────────────────────────────────────────
  const callGemini = async (key) => {
    const budget = Math.min(PER_PROVIDER_MS, remainingBudget());
    if (budget < 1500) { providerDiag.push(`gemini: skipped(budget_exhausted)`); return null; }
    const t0 = Date.now();
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
      const r = await fetchWithTimeout(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: geminiContents,
            generationConfig: { temperature: 0.6, maxOutputTokens: 1500 },
          }),
        },
        budget
      );
      const dt = Date.now() - t0;
      if (r.ok) {
        const d = await r.json();
        const content = d?.candidates?.[0]?.content?.parts?.[0]?.text || "";
        providerDiag.push(`gemini: ok(${dt}ms, ${content.length}ch)`);
        return content;
      }
      providerDiag.push(`gemini: http_${r.status}(${dt}ms)`);
      return null;
    } catch (e) {
      const dt = Date.now() - t0;
      const reason = e?.name === "AbortError" ? "timeout" : (e?.message || "exception").slice(0, 60);
      providerDiag.push(`gemini: ${reason}(${dt}ms)`);
      console.error("Gemini exception:", e.message);
      return null;
    }
  };

  let responseText = "";

  // Groq 模型选择：聊天用 8B（快 5-10 倍），出题用 70B（质量敏感）
  const GROQ_CHAT_MODEL = "llama-3.1-8b-instant";
  const GROQ_GEN_MODEL  = "llama-3.3-70b-versatile";

  // 帮手：按 provider name 调用对应 API，支持 user key / server key 复用
  const callProviderWithKey = async (pid, k, source /* "user" | "server" */) => {
    const tagSrc = source === "server" ? "server" : "user";
    if (pid === "groq") {
      const primary  = isChatMode ? GROQ_CHAT_MODEL : GROQ_GEN_MODEL;
      const fallback = isChatMode ? GROQ_GEN_MODEL : GROQ_CHAT_MODEL;
      let out = await callOpenAICompat("https://api.groq.com/openai/v1", k, primary, `groq(${tagSrc}):${primary}`) || "";
      if (!out) out = await callOpenAICompat("https://api.groq.com/openai/v1", k, fallback, `groq(${tagSrc}):${fallback}`) || "";
      return out;
    }
    if (pid === "deepseek") {
      return await callOpenAICompat("https://api.deepseek.com", k, "deepseek-chat", `deepseek(${tagSrc})`) || "";
    }
    if (pid === "kimi") {
      return await callOpenAICompat("https://api.moonshot.cn/v1", k, "moonshot-v1-8k", `kimi(${tagSrc})`) || "";
    }
    if (pid === "gemini") {
      return await callGemini(k) || "";
    }
    if (pid === "custom") {
      const base = String(userCustomUrl || "").trim().replace(/\/$/, "");
      if (!base) { providerDiag.push(`custom(${tagSrc}): no_base_url`); return ""; }
      return await callOpenAICompat(base, k, "gpt-3.5-turbo", `custom(${tagSrc})`) || "";
    }
    return "";
  };

  // Priority 1: 用户填了自己的 Key，用用户指定的 provider
  if (hasUserKey) {
    responseText = await callProviderWithKey(effectiveProvider, String(userKey).trim(), "user");
  }

  // Priority 1.5: 用户选了某个 provider 但没填 Key —— 用该 provider 的平台 Key
  // （这是实现"用户点一下 Gemini 就直接用平台 Gemini"的关键）
  if (!responseText && !hasUserKey && userProvider && userProvider !== "server") {
    const serverKey = SERVER_KEY_FOR[userProvider];
    if (serverKey) {
      providerDiag.push(`using platform key for user-selected provider: ${userProvider}`);
      responseText = await callProviderWithKey(userProvider, serverKey, "server");
    } else {
      providerDiag.push(`${userProvider}: no_platform_key_configured`);
    }
  }

  // Priority 2: 默认 fallback —— Groq server
  if (!responseText && GROQ_KEY) {
    const primary = isChatMode ? GROQ_CHAT_MODEL : GROQ_GEN_MODEL;
    responseText = await callOpenAICompat("https://api.groq.com/openai/v1", GROQ_KEY, primary, `groq(server):${primary}`) || "";
    const fallback = isChatMode ? GROQ_GEN_MODEL : GROQ_CHAT_MODEL;
    if (!responseText) responseText = await callOpenAICompat("https://api.groq.com/openai/v1", GROQ_KEY, fallback, `groq(server):${fallback}`) || "";
  }

  // Priority 3: server DeepSeek
  if (!responseText && DEEPSEEK_KEY) {
    responseText = await callOpenAICompat("https://api.deepseek.com", DEEPSEEK_KEY, "deepseek-chat", "deepseek(server)") || "";
  }

  // Priority 4: server Gemini
  if (!responseText && GEMINI_KEY) {
    responseText = await callGemini(GEMINI_KEY) || "";
  }

  // Priority 4.5: server Kimi
  if (!responseText && KIMI_KEY) {
    responseText = await callOpenAICompat("https://api.moonshot.cn/v1", KIMI_KEY, "moonshot-v1-8k", "kimi(server)") || "";
  }

  // Priority 5: Anthropic
  if (!responseText && ANTHROPIC_KEY) {
    const budget = Math.min(PER_PROVIDER_MS, remainingBudget());
    if (budget < 1500) {
      providerDiag.push("anthropic(server): skipped(budget_exhausted)");
    } else {
      const t0 = Date.now();
      try {
        const anthropicMessages = isChatMode
          ? messages.filter(m => m.role !== "system").map(m => ({ role: m.role, content: m.content }))
          : [{ role: "user", content: prompt }];
        const r = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 1500,
            system: isChatMode ? systemPrompt : undefined,
            messages: anthropicMessages,
          }),
        }, budget);
        const dt = Date.now() - t0;
        if (r.ok) {
          const d = await r.json();
          responseText = d.content?.map(b => b.text || "").join("") || "";
          providerDiag.push(`anthropic(server): ok(${dt}ms, ${responseText.length}ch)`);
        } else {
          providerDiag.push(`anthropic(server): http_${r.status}(${dt}ms)`);
        }
      } catch (e) {
        const dt = Date.now() - t0;
        const reason = e?.name === "AbortError" ? "timeout" : (e?.message || "exception").slice(0, 60);
        providerDiag.push(`anthropic(server): ${reason}(${dt}ms)`);
        console.error("Anthropic exception:", e.message);
      }
    }
  }

  if (!responseText) {
    const diag = providerDiag.join(" | ") || "no_provider_attempted";
    const hasAnyKey = hasUserKey || hasServerKey;
    const baseMsg = hasAnyKey
      ? "AI 上游都不可用（已尝试：" + diag + "）。"
      : "暂无可用 AI 服务。请在首页「AI 设置」配置 API Key（推荐免费的 Groq）。";
    return res.status(500).json({ error: baseMsg, diag, elapsed: Date.now() - startedAt });
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

  // ── 服务端题目门卫（兜底 Layer 1-5 约束） ───────────────────────────────
  // 即使 LLM 没完全守约，这一层也能把脏题拦下
  const ESCAPE_OPTION_RE = /^(?:[A-Da-d][.、．]\s*)?(?:不确定|不知道|无法判断|以上都对|以上都不对|以上都不是|以上都不正确|以上都错|都有可能|视情况而定|教材未提及|与原文相反|都不(?:对|是)|都是对的)\s*$/;
  const META_LEARNING_RE = /(关于[《【][^》】]*[》】].{0,8}(说法|态度|方法)|学习(方法|态度|策略)|应(同时|该)关注定义|应(该)?同时掌握|应.*机械套用|通过例题验证理解)/;
  const METADATA_RE = /(MATH\s?\d{3,}|PHY\s?\d{3,}|CS\s?\d{3,}|Ch\.\s?\d+[^\d]|Chapter\s?\d+|第\s?[一二三四五六七八九十百]{1,3}\s?章(?:节)?(?:的(?:主要)?(?:内容|主题))|《[^《》]{2,40}》\s*(?:的(?:作者|内容|主题|主旨)|是一本))/;
  const TIMESTAMP_RE = /\d{1,2}\/\d{1,2}\/\d{2,4}|\b\d{1,2}:\d{2}\s?(AM|PM|am|pm)\b|\d{4}-\d{2}-\d{2}|\d{4}\s*年\s*\d{1,2}\s*月|\d{1,2}(st|nd|rd|th)\s+(January|February|March|April|May|June|July|August|September|October|November|December|Janu)/;
  const META_REF_RE = /(这份资料|本资料|这本书|本书中|原文(里|中|未提及)|本(章|节|课)(里|中).{0,6}(讲|提到|说|描述))/;
  const TOPIC_HINTS_RE = /(函数|方程|积分|导数|微分|矩阵|向量|极限|连续|概率|分布|期望|方差|收敛|级数|插值|逼近|误差|迭代|特征|秩|线性|范数|内积|空间|变换|样本|估计|检验|假设|信息|算法|多项式|复数|实数|坐标|几何|拓扑|最优|最大|最小|求解|近似|精度|梯度|散度|旋度|行列式|根|解|\\frac|\\int|\\sum|\\partial|\\theta|\\alpha|\\lambda)/;
  // 数学家 / 标准算法 / 术语白名单；不在名单中的英文专有名词会被视作元数据污染
  const MATH_NAME_WHITELIST = new Set([
    "Newton","Euler","Gauss","Laplace","Fourier","Taylor","Maclaurin","Cauchy","Riemann",
    "Lagrange","Hamilton","Lebesgue","Hilbert","Banach","Schwarz","Minkowski","Jordan",
    "Lipschitz","Hermite","Jacobi","Runge","Kutta","Galerkin","Chebyshev","Bernoulli",
    "Gram","Legendre","Wronski","Wronskian","Picard","Peano","Frobenius","Sturm","Liouville",
    "ODE","PDE","BVP","IVP","CFL","LU","QR","SVD","LP","KKT","SGD","BFGS","Adam","LBFGS","ReLU",
    "January","February","March","April","May","June","July","August","September","October",
    "November","December",
  ]);
  const countSuspiciousNames = (s) => {
    const stripped = String(s).replace(/\$[^$]*\$/g, " ").replace(/\$\$[^$]*\$\$/g, " ");
    const nouns = stripped.match(/\b[A-Z][a-z]{2,15}\b/g) || [];
    return nouns.filter(n => !MATH_NAME_WHITELIST.has(n)).length;
  };
  const isValidQuestion = (q) => {
    const stem = String(q.question || "");
    if (!stem || stem.length < 10) return false;
    if (METADATA_RE.test(stem)) return false;
    if (META_LEARNING_RE.test(stem)) return false;
    if (TIMESTAMP_RE.test(stem)) return false;                   // 时间戳 / 日期
    if (META_REF_RE.test(stem)) return false;                     // 元指代
    if (countSuspiciousNames(stem) >= 3) return false;            // 3+ 个非白名单英文专有名词
    if (/^\s*关于\s*[「『]?[A-Z][a-z]+[」』]?\s*[，,、]/.test(stem)) { // "关于 Leon," 这种
      const m = stem.match(/^\s*关于\s*[「『]?([A-Z][a-z]+)[」』]?/);
      if (m && !MATH_NAME_WHITELIST.has(m[1])) return false;
    }
    if (!TOPIC_HINTS_RE.test(stem) && !/[\$=\+\-\*/\^_]/.test(stem)) return false;
    if (Array.isArray(q.options)) {
      if (q.options.length < 2) return false;
      if (q.options.some(o => ESCAPE_OPTION_RE.test(String(o || "").trim()))) return false;
      const optText = q.options.join(" ");
      if (TIMESTAMP_RE.test(optText)) return false;
      if (countSuspiciousNames(optText) >= 2) return false;       // 选项中≥2 个可疑人名
      const stemKey = stem.replace(/[A-D][.、．]/g, "").slice(0, 40);
      if (q.options.some(o => String(o).includes(stemKey) && stemKey.length > 15)) return false;
    }
    return true;
  };

  const cleaned = questions
    .filter(q => q && (q.question || q.text || q.content))
    .map(q => {
      const qText = q.question || q.text || q.content || "";
      const opts = Array.isArray(q.options) && q.options.length >= 2 ? q.options : null;
      const optsEn = Array.isArray(q.options_en) && q.options_en.length === (opts?.length || 0) ? q.options_en.map(String) : null;
      return {
        question: String(qText),
        question_en: q.question_en ? String(q.question_en) : "",
        options: opts,
        options_en: optsEn,
        answer: String(q.answer || q.correct_answer || (opts ? "A" : "正确")),
        explanation: String(q.explanation || q.rationale || ""),
        explanation_en: q.explanation_en ? String(q.explanation_en) : "",
        optionRationales: Array.isArray(q.optionRationales) ? q.optionRationales.map(String) : null,
        misconceptions: q.misconceptions && typeof q.misconceptions === "object" ? q.misconceptions : null,
        type: String(q.type || (opts ? "单选题" : "判断题")),
      };
    })
    .filter(isValidQuestion);

  if (cleaned.length === 0) {
    return res.status(500).json({ error: "本批生成的题目未通过质量门卫（元数据 / 逃避选项 / 元学习题 / 人名污染 / 时间戳）。请重试。" });
  }

  res.status(200).json({ questions: cleaned });
}
