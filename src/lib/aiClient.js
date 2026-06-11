// AI 客户端：统一封装 /api/generate。
// 当前后端不是裸 OpenAI messages 代理，而是以 { mode, question, conversationHistory } 为主。

function getUserAIConfig() {
  try {
    const provider = localStorage.getItem("mc_ai_provider") || "gemini";
    const keys = JSON.parse(localStorage.getItem("mc_ai_keys") || "{}") || {};
    const legacyKey = localStorage.getItem("mc_ai_key") || "";
    return {
      userProvider: provider,
      userKey: keys[provider] || legacyKey || "",
      userCustomUrl: localStorage.getItem("mc_ai_custom_url") || "",
    };
  } catch {
    return { userProvider: "gemini", userKey: "", userCustomUrl: "" };
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

export async function generateQuestions({ chapter, chapterTitle, types, difficulty, count }) {
  const prompt = `请生成 ${count} 道高质量线性代数练习题。

章节：${chapter} ${chapterTitle || ""}
题型范围：${types.join("、")}
难度：${difficulty}

要求：
1. 每题必须是该章节真实知识点的练习题，不要套话、不要超纲
2. 数学公式用 LaTeX 表示
3. 概念/选择题可以给 options；计算/证明题 options 留空数组
4. 每题给出参考答案 answer 和简要解析 explanation
5. 只输出 JSON，不要 Markdown，不要额外解释

JSON 格式：
{"questions":[{"question":"题干","type":"计算","difficulty":"${difficulty}","options":[],"answer":"参考答案","explanation":"解析"}]}`;

  const raw = await postGenerate(prompt, { materialTitle: "AI 出题" });
  const data = parseLooseJSON(raw);
  const arr = Array.isArray(data) ? data : data?.questions;
  return Array.isArray(arr) ? arr.filter((q) => q?.question) : [];
}

export async function solveUploaded(questionText) {
  const prompt = `你是线性代数老师。请解答下面这道题，给出详细分步解析。

【题目】
${questionText}

【要求】
1. 解题思路 → 分步计算 → 最终答案
2. 写出用到的定理/方法名称
3. 公式用 LaTeX
4. 判断章节(Ch.1~Ch.7)、题型(概念/计算/证明/应用)、难度(基础/进阶/挑战)
5. 只输出 JSON，不要 Markdown，不要额外解释

JSON 格式：
{"chapter":"Ch.?","type":"计算","difficulty":"基础","answer":"分步解析","theorems":["定理1"],"explanation":"简要说明"}`;

  const raw = await postGenerate(prompt, { materialTitle: "上传题目求解" });
  return parseLooseJSON(raw);
}
