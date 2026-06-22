// AI 客户端：统一封装 /api/generate。
// 当前后端不是裸 OpenAI messages 代理，而是以 { mode, question, conversationHistory } 为主。

function getUserAIConfig() {
  try {
    const provider = localStorage.getItem("mc_ai_provider") || "volcengine";
    const keys = JSON.parse(localStorage.getItem("mc_ai_keys") || "{}") || {};
    const legacyKey = localStorage.getItem("mc_ai_key") || "";
    return {
      userProvider: provider,
      userKey: keys[provider] || legacyKey || "",
      userCustomUrl: localStorage.getItem("mc_ai_custom_url") || "",
    };
  } catch {
    return { userProvider: "volcengine", userKey: "", userCustomUrl: "" };
  }
}

function extractText(json) {
  if (typeof json === "string") return json;
  if (json?.answer) return json.answer;
  if (json?.text) return json.text;
  if (json?.content) return json.content;
  if (json?.result) return json.result;
  if (json?.choices?.[0]?.message?.content) return json.choices[0].message.content;
  if (json?.choices?.[0]?.text) return json.choices[0].text;
  return "";
}

export function parseLooseJSON(raw) {
  let s = String(raw || "").trim();
  s = s.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try { return JSON.parse(s); } catch {}

  const objectStart = s.indexOf("{");
  const objectEnd = s.lastIndexOf("}");
  const arrayStart = s.indexOf("[");
  const arrayEnd = s.lastIndexOf("]");
  const start = arrayStart !== -1 && (objectStart === -1 || arrayStart < objectStart) ? arrayStart : objectStart;
  const end = arrayEnd !== -1 && arrayEnd > objectEnd ? arrayEnd : objectEnd;

  if (start !== -1 && end !== -1 && end > start) {
    try { return JSON.parse(s.slice(start, end + 1)); } catch {}
  }
  return null;
}

async function postGenerate(question, { materialTitle = "题库 AI", conversationHistory = [], signal } = {}) {
  const res = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode: "socratic",
      question,
      conversationHistory,
      materialTitle,
      stream: false,
      ...getUserAIConfig(),
    }),
    signal,
  });

  const text = await res.text();
  let data = {};
  try { data = JSON.parse(text); } catch {}

  if (!res.ok || data.error) {
    throw new Error(data.error || data.message || `HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  return extractText(data).trim();
}

export async function callGenerate(input, { json = false, materialTitle = "题库 AI", signal, visionModel } = {}) {
  if (Array.isArray(input)) {
    const hasVision = input.some((m) => Array.isArray(m?.content) && m.content.some((p) => p?.type === "image_url"));
    // 视觉请求：用户自己配了 volcengine key 则直接用，否则让后端 fallback 链决定（Gemini → 豆包 → Kimi）
    const visionConfig = () => {
      try {
        const keys = JSON.parse(localStorage.getItem("mc_ai_keys") || "{}") || {};
        const vKey = keys.volcengine || keys.doubao || "";
        return vKey ? { userProvider: "volcengine", userKey: vKey } : {};
      } catch {
        return {};
      }
    };
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "tutor",
        materialTitle,
        messages: input,
        stream: false,
        ...(hasVision && visionModel ? { qwenVisionModel: visionModel } : {}),
        ...(hasVision ? visionConfig() : getUserAIConfig()),
      }),
      signal,
    });
    const text = await res.text();
    let data = {};
    try { data = JSON.parse(text); } catch {}
    if (!res.ok || data.error) {
      throw new Error(data.error || data.message || `HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    const content = extractText(data).trim();
    return json ? parseLooseJSON(content) : content;
  }
  const content = await postGenerate(String(input || ""), { materialTitle, signal });
  return json ? parseLooseJSON(content) : content;
}

export async function generateQuestions({ chapter, chapterTitle, types, difficulty, count }) {
  const prompt = `请严格生成【正好 ${count} 道】高质量线性代数练习题，一道都不能少。

章节：${chapter} ${chapterTitle || ""}
题型范围：${types.join("、")}
难度：${difficulty}

硬性要求：
1. questions 数组长度必须正好是 ${count}，不足 ${count} 道视为失败
2. 每题必须是该章节真实知识点的练习题，不要套话、不要超纲、不要重复
3. 公式必须用 $...$ 包裹的 LaTeX：行内如 $x_1 + x_2 = 3$；矩阵如 $\\begin{bmatrix}1 & 2 \\\\ 3 & 4\\end{bmatrix}$；分数如 $\\frac{a}{b}$
4. 概念/选择题可以给 options；计算/证明题 options 留空数组
5. 每题给出参考答案 answer 和简要解析 explanation
6. 只输出 JSON，不要 Markdown，不要额外解释

JSON 格式：
{"questions":[{"question":"题干含$公式$","type":"计算","difficulty":"${difficulty}","options":[],"answer":"参考答案","explanation":"解析"}]}`;

  const raw = await postGenerate(prompt, { materialTitle: "AI 出题" });
  const data = parseLooseJSON(raw);
  let arr = (Array.isArray(data) ? data : data?.questions || []).filter((q) => q?.question);

  if (arr.length > 0 && arr.length < count) {
    const need = count - arr.length;
    const supplementRaw = await postGenerate(
      `${prompt}\n\n刚才只生成了 ${arr.length} 道，请再补 ${need} 道不同题目。只输出 JSON，questions 数组长度必须正好是 ${need}。`,
      { materialTitle: "AI 出题补题" }
    );
    const supplement = parseLooseJSON(supplementRaw);
    const more = (Array.isArray(supplement) ? supplement : supplement?.questions || []).filter((q) => q?.question);
    arr = arr.concat(more);
  }

  return arr.slice(0, count);
}

export async function solveUploaded(questionText) {
  const prompt = `你是线性代数老师。请完整解答下面这道题，给出详细分步解析，不要省略步骤。

【题目】
${questionText}

【硬性要求】
1. answer 字段必须包含完整解题过程：解题思路 → 每一步计算（逐步写出，不能跳步）→ 最终答案
2. 不要只写“分步解析如下：”然后就结束，必须真正写出每一步内容
3. 公式必须用 $...$ 包裹的 LaTeX，如 $\\det(A)=ad-bc$、$\\begin{bmatrix}1&2\\\\3&4\\end{bmatrix}$
4. theorems 列出用到的定理/方法名称
5. 判断章节(Ch.1~Ch.7)、题型(概念/计算/证明/应用)、难度(基础/进阶/挑战)
6. 只输出 JSON，不要 Markdown，不要额外解释

JSON 格式：
{"chapter":"Ch.?","type":"计算","difficulty":"基础","answer":"完整分步解析，每步都写清楚，公式用$包裹","theorems":["定理1"],"explanation":"一句话总结"}`;

  const raw = await postGenerate(prompt, { materialTitle: "上传题目求解" });
  return parseLooseJSON(raw);
}
