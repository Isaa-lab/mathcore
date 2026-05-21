// /api/ocr-problem.js
// 把用户上传的题目图片 / PDF 用 vision 模型 OCR 出来。
// 输入：{ imageBase64, mimeType, userProvider, userKey, userCustomUrl }
// 输出：{ question, options?, answer?, type, explanation?, apiUsed }
//
// Vision 模型优先级（都是免费/低价档）：
//   1. 用户自填 Key 的指定 provider（gemini / anthropic / openrouter）
//   2. server GEMINI_KEY (Gemini 2.0 Flash — 1500 req/day 免费)
//   3. server ANTHROPIC_KEY (Claude Haiku — 便宜但能识别复杂公式)
//   4. server OPENROUTER_KEY (免费 vision 模型 fallback)

const TIMEOUT_MS = 45000; // 图片识别比纯文本慢，给宽一点

function fetchWithTimeout(url, opts) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(id));
}

const SYSTEM_PROMPT = `你是一位精通中英文数学题识别的助手。请准确识别这张图片（或 PDF 页面）里的数学题。

要求：
1. 所有数学符号、公式、矩阵、积分、求和、希腊字母等，**必须**用标准 LaTeX，行内 $..$，块级 $$..$$
2. 中文题干完整保留，英文题干也完整保留
3. 如果是选择题，把 4 个选项也识别出来；选项前缀保留 "A. " / "B. " / "C. " / "D. "
4. 如果图中有标注正确答案，把答案也识别出来；没有就 null
5. 题型按图片判断：单选题 / 多选题 / 判断题 / 填空题 / 解答题 / 证明题

严格输出 JSON，不要 markdown 围栏、不要解释：
{
  "question": "完整题干（公式用 LaTeX）",
  "options": ["A. ...", "B. ...", "C. ...", "D. ..."] 或 null,
  "answer": "正确答案" 或 null,
  "type": "单选题 | 多选题 | 判断题 | 填空题 | 解答题 | 证明题",
  "explanation": "如果图中有解析就保留；否则给一句话思路（≤80字）"
}`;

async function callGeminiVision(key, imageBase64, mime, model = "gemini-2.0-flash") {
  try {
    const r = await fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: SYSTEM_PROMPT },
              { inline_data: { mime_type: mime, data: imageBase64 } },
            ],
          }],
          generationConfig: {
            response_mime_type: "application/json",
            temperature: 0.2,
            maxOutputTokens: 2000,
          },
        }),
      }
    );
    if (!r.ok) {
      const err = await r.text();
      console.error(`Gemini Vision HTTP ${r.status}:`, err.slice(0, 200));
      return null;
    }
    const d = await r.json();
    return d?.candidates?.[0]?.content?.parts?.[0]?.text || null;
  } catch (e) {
    console.error("Gemini Vision exception:", e.message);
    return null;
  }
}

async function callClaudeVision(key, imageBase64, mime, model = "claude-haiku-4-5-20251001") {
  try {
    const r = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 2000,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mime, data: imageBase64 } },
            { type: "text", text: SYSTEM_PROMPT },
          ],
        }],
      }),
    });
    if (!r.ok) {
      const err = await r.text();
      console.error(`Claude Vision HTTP ${r.status}:`, err.slice(0, 200));
      return null;
    }
    const d = await r.json();
    return d?.content?.[0]?.text || null;
  } catch (e) {
    console.error("Claude Vision exception:", e.message);
    return null;
  }
}

async function callOpenRouterVision(key, imageBase64, mime, model = "meta-llama/llama-3.2-11b-vision-instruct:free") {
  try {
    const r = await fetchWithTimeout("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
      body: JSON.stringify({
        model,
        max_tokens: 2000,
        temperature: 0.2,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: SYSTEM_PROMPT },
            { type: "image_url", image_url: { url: `data:${mime};base64,${imageBase64}` } },
          ],
        }],
      }),
    });
    if (!r.ok) {
      const err = await r.text();
      console.error(`OpenRouter Vision HTTP ${r.status}:`, err.slice(0, 200));
      return null;
    }
    const d = await r.json();
    return d?.choices?.[0]?.message?.content || null;
  } catch (e) {
    console.error("OpenRouter Vision exception:", e.message);
    return null;
  }
}

function parseLoose(raw) {
  if (!raw) return null;
  const stripped = String(raw).replace(/```json?\s*/gi, "").replace(/```\s*$/g, "").trim();
  try { return JSON.parse(stripped); } catch {}
  const m = stripped.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let cand = m[0];
  try { return JSON.parse(cand); } catch {}
  // 修常见尾逗号 + 双反斜杠不足
  cand = cand.replace(/,(\s*[}\]])/g, "$1");
  try { return JSON.parse(cand); } catch {}
  try {
    const fixed = cand.replace(/(?<!\\)\\(?!["\\/bfnrtu])/g, "\\\\");
    return JSON.parse(fixed);
  } catch {}
  return null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const { imageBase64, mimeType, userProvider, userKey } = req.body || {};
    if (!imageBase64 || typeof imageBase64 !== "string") {
      return res.status(400).json({ error: "missing imageBase64" });
    }
    // Base64 大小估算：base64 长度 × 0.75 ≈ 原始字节数。Vercel Hobby 4.5MB 上限。
    // base64 字符上限 6_000_000 ≈ 4.5MB 原始，对应 ~9000×4500 像素的 JPEG，远超合理上限。
    // 实测 1MB JPEG ≈ 1.3M base64，完全在范围内。
    if (imageBase64.length > 6_500_000) {
      return res.status(413).json({ error: "图片太大（> 4.5MB）。请前端压缩到 ~1MB 后再上传。" });
    }
    const mime = mimeType && /^(image\/(jpeg|jpg|png|webp|gif)|application\/pdf)$/i.test(mimeType)
      ? mimeType : "image/jpeg";

    let raw = null;
    let used = "";

    // 1) 用户自填 Key
    const hasUserKey = userKey && String(userKey).trim().length > 8;
    if (hasUserKey) {
      const k = String(userKey).trim();
      if (userProvider === "gemini") {
        raw = await callGeminiVision(k, imageBase64, mime);
        if (raw) used = "gemini(user)";
      } else if (userProvider === "anthropic") {
        raw = await callClaudeVision(k, imageBase64, mime);
        if (raw) used = "anthropic(user)";
      } else if (userProvider === "openrouter") {
        raw = await callOpenRouterVision(k, imageBase64, mime);
        if (raw) used = "openrouter(user)";
      }
      // groq / kimi / deepseek 等不支持视觉，自动落到 server fallback
    }

    // 2) 平台 Gemini（vision 免费档最稳，1500 req/day）
    if (!raw && process.env.GEMINI_KEY) {
      raw = await callGeminiVision(process.env.GEMINI_KEY, imageBase64, mime);
      if (raw) used = "gemini(server)";
    }
    // 3) 平台 Claude（识别复杂公式最强）
    if (!raw && process.env.ANTHROPIC_KEY) {
      raw = await callClaudeVision(process.env.ANTHROPIC_KEY, imageBase64, mime);
      if (raw) used = "anthropic(server)";
    }
    // 4) 平台 OpenRouter 免费 vision
    if (!raw && process.env.OPENROUTER_KEY) {
      raw = await callOpenRouterVision(process.env.OPENROUTER_KEY, imageBase64, mime);
      if (raw) used = "openrouter(server)";
    }

    if (!raw) {
      return res.status(500).json({
        error: "所有 vision provider 都失败。请在 AI 设置里填 Gemini 或 Claude Key，或在 Vercel 配 GEMINI_KEY / ANTHROPIC_KEY / OPENROUTER_KEY。",
      });
    }

    const parsed = parseLoose(raw);
    if (!parsed) {
      return res.status(500).json({
        error: `AI（${used}）返回非 JSON`,
        raw: String(raw).slice(0, 400),
        apiUsed: used,
      });
    }

    return res.status(200).json({
      question: String(parsed.question || "").trim(),
      options: Array.isArray(parsed.options) ? parsed.options : null,
      answer: parsed.answer ? String(parsed.answer).trim() : null,
      type: String(parsed.type || "单选题").trim(),
      explanation: parsed.explanation ? String(parsed.explanation).trim() : "",
      apiUsed: used,
    });
  } catch (err) {
    console.error("[ocr-problem] FATAL:", err?.message);
    return res.status(500).json({ error: err?.message || "server error" });
  }
}
