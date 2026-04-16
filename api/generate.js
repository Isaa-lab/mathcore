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
11. 如需展示函数图像，使用：[CHART: {"functions": [{"expr": "Math.sin(x)", "label": "$\\sin x$", "color": "#2563eb"}], "xRange": [-6.28, 6.28], "title": "图示"}]`;
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
8. 如需展示函数图像，使用以下格式（JSON必须合法，expr用JavaScript写法）：[CHART: {"functions": [{"expr": "Math.exp(2*x)", "label": "$e^{2x}$", "color": "#2563eb"}, {"expr": "Math.exp(-2*x)", "label": "$Ce^{-2x}$", "color": "#dc2626"}], "xRange": [-2, 3], "title": "图示标题"}]
6. 禁止使用 \\begin{tikzpicture}、\\begin{figure} 等 LaTeX 图形环境，网页无法渲染
7. 需要展示图形时，用简单文字坐标描述，如"当x增大，y呈指数增长"，或用简单ASCII示意，不要tikz代码`;
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
