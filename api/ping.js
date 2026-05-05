// /api/ping —— AI 连接测试
// 输入: { provider, userKey?, customUrl? }
// 输出: { ok: boolean, latencyMs, model, error? }
// 用最小 prompt 调一次目标 provider，确认 Key 有效 + 模型可达。

const PROVIDER_TEST = {
  groq:        { url: "https://api.groq.com/openai/v1/chat/completions",       model: "llama-3.1-8b-instant",      auth: "bearer" },
  openrouter:  { url: "https://openrouter.ai/api/v1/chat/completions",         model: "mistralai/mistral-7b-instruct:free", auth: "bearer" },
  siliconflow: { url: "https://api.siliconflow.cn/v1/chat/completions",        model: "Qwen/Qwen2.5-7B-Instruct",  auth: "bearer" },
  zhipu:       { url: "https://open.bigmodel.cn/api/paas/v4/chat/completions", model: "glm-4-flash",               auth: "bearer" },
  cerebras:    { url: "https://api.cerebras.ai/v1/chat/completions",           model: "llama3.1-8b",               auth: "bearer" },
  deepseek:    { url: "https://api.deepseek.com/chat/completions",             model: "deepseek-chat",             auth: "bearer" },
  kimi:        { url: "https://api.moonshot.cn/v1/chat/completions",           model: "moonshot-v1-8k",            auth: "bearer" },
};

async function testOpenAICompat(url, key, model) {
  const t0 = Date.now();
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages: [{ role: "user", content: "ping" }], max_tokens: 5 }),
  });
  const latencyMs = Date.now() - t0;
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    return { ok: false, latencyMs, model, error: `HTTP ${r.status}: ${txt.slice(0, 200)}` };
  }
  return { ok: true, latencyMs, model };
}

async function testGemini(key) {
  const t0 = Date.now();
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: "ping" }] }], generationConfig: { maxOutputTokens: 5 } }),
  });
  const latencyMs = Date.now() - t0;
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    return { ok: false, latencyMs, model: "gemini-2.0-flash", error: `HTTP ${r.status}: ${txt.slice(0, 200)}` };
  }
  return { ok: true, latencyMs, model: "gemini-2.0-flash" };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const { provider, userKey, customUrl } = req.body || {};
    if (!provider) return res.status(400).json({ ok: false, error: "provider required" });

    // 决定使用哪个 Key：用户 Key 优先；否则用 server 端对应 env
    let key = userKey && String(userKey).trim().length > 8 ? String(userKey).trim() : null;
    if (!key) {
      const envNames = {
        groq:["GROQ_KEY"], gemini:["GEMINI_KEY"], deepseek:["DEEPSEEK_KEY"], kimi:["KIMI_KEY"],
        anthropic:["ANTHROPIC_KEY"], openrouter:["OPENROUTER_KEY"],
        siliconflow:["SILICONFLOW_KEY", "GUIJI_KEY"],
        zhipu:["ZHIPU_KEY"], cerebras:["CEREBRAS_KEY"],
      }[provider] || [];
      for (const envName of envNames) {
        if (process.env[envName] && String(process.env[envName]).trim().length > 8) {
          key = String(process.env[envName]).trim();
          break;
        }
      }
    }
    if (!key) {
      return res.status(200).json({ ok: false, error: "未找到 Key：用户没填，平台环境变量也没设置。" });
    }

    let result;
    if (provider === "gemini") {
      result = await testGemini(key);
    } else if (provider === "custom") {
      const base = String(customUrl || "").trim().replace(/\/$/, "");
      if (!base) return res.status(200).json({ ok: false, error: "自定义接口需要先填 baseUrl" });
      result = await testOpenAICompat(`${base}/chat/completions`, key, "gpt-3.5-turbo");
    } else if (PROVIDER_TEST[provider]) {
      const c = PROVIDER_TEST[provider];
      result = await testOpenAICompat(c.url, key, c.model);
    } else {
      return res.status(200).json({ ok: false, error: `未知 provider: ${provider}` });
    }

    return res.status(200).json({ provider, ...result });
  } catch (err) {
    return res.status(200).json({ ok: false, error: String(err?.message || err) });
  }
}
