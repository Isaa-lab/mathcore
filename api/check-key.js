// /api/check-key.js
// 用最小开销 ping 一次目标 provider，告诉前端：
//   { ok: true, model, latencyMs }            ← Key 通了
//   { ok: false, status, errorBody, hint }    ← 拿到了 HTTP 状态码 / 错误体，可以定位
// 设计目的：让用户在 AI 设置里点 "测试" 后立刻知道是 Key 错 / 配额满 / 网络断 还是模型下线
//
// 注意：这里只做最便宜的探活（max_tokens=1，prompt="hi"），不浪费配额。

const TIMEOUT_MS = 10000;

function fetchWithTimeout(url, opts) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(id));
}

// 把 provider 返回的错误体翻译成用户能看懂的提示
function classifyError(provider, status, body) {
  const text = String(body || "").toLowerCase();
  if (status === 401 || status === 403 || /invalid|unauthorized|forbidden|api[_\s-]?key/.test(text)) {
    return "Key 无效或已被撤销 —— 检查是否复制完整、没多空格，或去官网重新生成。";
  }
  if (status === 429 || /rate[_\s-]?limit|quota|too many|exceeded/.test(text)) {
    return "已触发限流或配额用尽 —— 等 1 分钟再试，或换一个 provider。";
  }
  if (status === 404 || /not found|model.*not/.test(text)) {
    return "模型名不存在 —— 这家 provider 可能下线了该模型；换一家试试。";
  }
  if (status === 400 || /bad request|invalid/.test(text)) {
    return "请求格式被 provider 拒绝 —— 通常说明 Key 类型对了但权限不足，或这家 provider 自家服务异常。";
  }
  if (status >= 500) {
    return `${provider} 服务器自己挂了（HTTP ${status}），等几分钟再试。`;
  }
  if (status === 0) {
    return "请求根本没发出去 —— 网络问题 / 域名被墙 / 浏览器 CORS / Key 太短被前端拦了。";
  }
  return `HTTP ${status} —— 错误体已附在 errorBody 字段，照着搜一下就能定位。`;
}

async function pingOpenAICompat(baseUrl, key, model) {
  const t0 = Date.now();
  try {
    const r = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
      body: JSON.stringify({ model, messages: [{ role: "user", content: "hi" }], max_tokens: 1, temperature: 0 }),
    });
    const latencyMs = Date.now() - t0;
    if (r.ok) return { ok: true, model, latencyMs };
    const errorBody = (await r.text()).slice(0, 400);
    return { ok: false, status: r.status, errorBody, latencyMs };
  } catch (e) {
    const latencyMs = Date.now() - t0;
    return { ok: false, status: 0, errorBody: e?.message || "exception", latencyMs };
  }
}

async function pingGemini(model, key) {
  const t0 = Date.now();
  try {
    const r = await fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: "hi" }] }], generationConfig: { maxOutputTokens: 1 } }) }
    );
    const latencyMs = Date.now() - t0;
    if (r.ok) return { ok: true, model, latencyMs };
    const errorBody = (await r.text()).slice(0, 400);
    return { ok: false, status: r.status, errorBody, latencyMs };
  } catch (e) {
    const latencyMs = Date.now() - t0;
    return { ok: false, status: 0, errorBody: e?.message || "exception", latencyMs };
  }
}

async function pingAnthropic(key) {
  const t0 = Date.now();
  try {
    const r = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 1, messages: [{ role: "user", content: "hi" }] }),
    });
    const latencyMs = Date.now() - t0;
    if (r.ok) return { ok: true, model: "claude-haiku-4-5", latencyMs };
    const errorBody = (await r.text()).slice(0, 400);
    return { ok: false, status: r.status, errorBody, latencyMs };
  } catch (e) {
    const latencyMs = Date.now() - t0;
    return { ok: false, status: 0, errorBody: e?.message || "exception", latencyMs };
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const { provider, key, customUrl } = req.body || {};
    if (!provider) return res.status(400).json({ error: "missing provider" });
    if (provider !== "server" && (!key || String(key).trim().length < 8)) {
      return res.status(200).json({
        ok: false, status: 0,
        errorBody: "Key 字段为空或长度 < 8，前端就拦下了",
        hint: "你在「AI 设置」点了保存吗？保存后再来测试。",
      });
    }
    const k = String(key || "").trim();
    let result;
    switch (provider) {
      case "groq":
        // 优先用 8b（速度王、对 hi 也快），失败再 70b
        result = await pingOpenAICompat("https://api.groq.com/openai/v1", k, "llama-3.1-8b-instant");
        if (!result.ok && result.status !== 401 && result.status !== 403) {
          const r2 = await pingOpenAICompat("https://api.groq.com/openai/v1", k, "llama-3.3-70b-versatile");
          if (r2.ok) result = r2;
        }
        break;
      case "deepseek":
        result = await pingOpenAICompat("https://api.deepseek.com", k, "deepseek-chat");
        break;
      case "kimi":
        result = await pingOpenAICompat("https://api.moonshot.cn/v1", k, "moonshot-v1-8k");
        break;
      case "openrouter":
        result = await pingOpenAICompat("https://openrouter.ai/api/v1", k, "mistralai/mistral-7b-instruct:free");
        break;
      case "siliconflow":
        result = await pingOpenAICompat("https://api.siliconflow.cn/v1", k, "Qwen/Qwen2.5-7B-Instruct");
        break;
      case "zhipu":
        result = await pingOpenAICompat("https://open.bigmodel.cn/api/paas/v4", k, "glm-4-flash");
        break;
      case "cerebras":
        result = await pingOpenAICompat("https://api.cerebras.ai/v1", k, "llama3.1-8b");
        break;
      case "gemini":
        result = await pingGemini("gemini-2.0-flash", k);
        if (!result.ok && result.status !== 401 && result.status !== 403) {
          const r2 = await pingGemini("gemini-2.0-flash-lite", k);
          if (r2.ok) result = r2;
        }
        break;
      case "anthropic":
        result = await pingAnthropic(k);
        break;
      case "custom": {
        const base = String(customUrl || "").trim().replace(/\/$/, "");
        if (!base) {
          return res.status(200).json({ ok: false, status: 0, errorBody: "自定义 provider 必须先填 Base URL", hint: "在 AI 设置里填上 https://你的网关/v1 这样的地址再测试。" });
        }
        result = await pingOpenAICompat(base, k, "gpt-3.5-turbo");
        break;
      }
      default:
        return res.status(400).json({ error: `unsupported provider: ${provider}` });
    }
    if (!result.ok) result.hint = classifyError(provider, result.status, result.errorBody);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ ok: false, status: 0, errorBody: err?.message || "server error", hint: "/api/check-key 自己挂了，看 Vercel 日志。" });
  }
}
