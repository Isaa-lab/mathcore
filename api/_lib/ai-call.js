// ─────────────────────────────────────────────────────────────────────────
// Shared AI calling primitive for Vercel serverless routes.
// Usage: const text = await callAI({ messages, provider, userKey, timeoutMs });
//
// Design goals:
//  · Zero entanglement with any specific route's state (providerDiag/budget)
//  · Same provider resolution semantics as api/generate.js (user key > selected
//    provider's server key > fallback chain: groq → deepseek → gemini → kimi → anthropic)
//  · Per-call timeout via AbortController so a hanging provider can't burn the
//    whole Lambda budget.
//
// Intentionally NOT imported from api/generate.js — that file is stable chat
// infrastructure and mingling this module with its closure-captured state
// would risk regressions. Some duplication is accepted for safety.
// ─────────────────────────────────────────────────────────────────────────

// ── Server-side keys ──
// We accept BOTH naming schemes:
//   · GROQ_KEY / GEMINI_KEY / DEEPSEEK_KEY / KIMI_KEY / ANTHROPIC_KEY — explicit per-provider
//   · PLATFORM_PROVIDER + PLATFORM_API_KEY — the "platform default" slot used by the
//     older deployment. When PLATFORM_PROVIDER matches a known id, we treat
//     PLATFORM_API_KEY as the fallback key for that provider (unless the
//     explicit var is also set, in which case the explicit one wins).
const platformSlotProvider = String(process.env.PLATFORM_PROVIDER || "").trim().toLowerCase();
const platformSlotKey      = process.env.PLATFORM_API_KEY;
const keyFromPlatformSlot = (pid) =>
  (platformSlotProvider === pid && platformSlotKey && platformSlotKey.trim().length > 8)
    ? platformSlotKey
    : null;

const GROQ_KEY      = process.env.GROQ_KEY      || keyFromPlatformSlot("groq");
const GEMINI_KEY    = process.env.GEMINI_KEY    || keyFromPlatformSlot("gemini");
const DEEPSEEK_KEY  = process.env.DEEPSEEK_KEY  || keyFromPlatformSlot("deepseek");
const KIMI_KEY      = process.env.KIMI_KEY      || keyFromPlatformSlot("kimi");
const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY || keyFromPlatformSlot("anthropic");

export const SERVER_KEY_FOR = {
  groq:      GROQ_KEY,
  deepseek:  DEEPSEEK_KEY,
  gemini:    GEMINI_KEY,
  kimi:      KIMI_KEY,
  anthropic: ANTHROPIC_KEY,
};

export const HAS_ANY_SERVER_KEY = Object.values(SERVER_KEY_FOR).some(
  (k) => typeof k === "string" && k.trim().length > 8,
);

// ── Effective-provider resolution ────────────────────────────────────────
// Caller (e.g. concept-graph.js) needs to know in advance which provider will
// actually be used, so it can select provider-specific strategies (e.g. the
// Groq multi-stage pipeline). Mirrors the priority inside callAI():
//   1. user's chosen provider (if they also provided a key OR we have a server key for it)
//   2. first server key in the fallback chain
export function resolveEffectiveProvider({ userProvider, userKey } = {}) {
  const hasUserKey = typeof userKey === "string" && userKey.trim().length > 8;
  const chosen = (userProvider || "").toLowerCase();
  if (chosen && chosen !== "server") {
    if (hasUserKey) return { provider: chosen, keySource: "user" };
    if (SERVER_KEY_FOR[chosen]) return { provider: chosen, keySource: "server" };
  }
  // Fallback chain (same order as callAI): groq → deepseek → gemini → kimi → anthropic
  const chain = ["groq", "deepseek", "gemini", "kimi", "anthropic"];
  for (const pid of chain) {
    if (SERVER_KEY_FOR[pid]) return { provider: pid, keySource: "server" };
  }
  return { provider: null, keySource: "none" };
}

export function pickKeyFor(provider, { userProvider, userKey } = {}) {
  const hasUserKey = typeof userKey === "string" && userKey.trim().length > 8;
  if (hasUserKey && (userProvider || "").toLowerCase() === provider) {
    return { key: userKey.trim(), source: "user" };
  }
  const k = SERVER_KEY_FOR[provider];
  return k ? { key: k, source: "server" } : { key: null, source: "none" };
}

// ── Fetch with timeout ──
async function fetchWithTimeout(url, opts, ms) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(id);
  }
}

// ── OpenAI-compatible (Groq / DeepSeek / Kimi / custom) ──
async function callOpenAICompat({ baseUrl, key, model, messages, timeoutMs, temperature, maxTokens }) {
  if (!key) return { text: "", error: "no_key" };
  try {
    const r = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: temperature ?? 0.3,
        max_tokens: maxTokens ?? 2000,
      }),
    }, timeoutMs);
    if (!r.ok) {
      const bodyText = await r.text().catch(() => "");
      return { text: "", error: `http_${r.status}`, detail: bodyText.slice(0, 240) };
    }
    const data = await r.json();
    const text = data?.choices?.[0]?.message?.content || "";
    return { text: String(text || "").trim(), error: text ? null : "empty" };
  } catch (e) {
    const msg = String(e?.message || e);
    return { text: "", error: /abort/i.test(msg) ? "timeout" : "network", detail: msg.slice(0, 240) };
  }
}

// ── Gemini ──
async function callGemini({ key, messages, timeoutMs, temperature, maxTokens }) {
  if (!key) return { text: "", error: "no_key" };
  // Convert OpenAI-style messages to Gemini contents.
  // Gemini doesn't have a "system" role — prepend system text to the first user message.
  const sys = messages.find((m) => m.role === "system")?.content || "";
  const userTurns = messages.filter((m) => m.role !== "system");
  const contents = userTurns.map((m, i) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: (i === 0 && sys) ? `${sys}\n\n${m.content}` : m.content }],
  }));
  try {
    const r = await fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents,
          generationConfig: {
            temperature: temperature ?? 0.3,
            maxOutputTokens: maxTokens ?? 2000,
          },
        }),
      },
      timeoutMs,
    );
    if (!r.ok) {
      const bodyText = await r.text().catch(() => "");
      return { text: "", error: `http_${r.status}`, detail: bodyText.slice(0, 240) };
    }
    const data = await r.json();
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
    return { text: String(text || "").trim(), error: text ? null : "empty" };
  } catch (e) {
    const msg = String(e?.message || e);
    return { text: "", error: /abort/i.test(msg) ? "timeout" : "network", detail: msg.slice(0, 240) };
  }
}

// ── Anthropic ──
async function callAnthropic({ key, messages, timeoutMs, temperature, maxTokens }) {
  if (!key) return { text: "", error: "no_key" };
  const sys = messages.find((m) => m.role === "system")?.content || "";
  const userTurns = messages.filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));
  try {
    const r = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-3-5-sonnet-20241022",
        system: sys || undefined,
        messages: userTurns,
        max_tokens: maxTokens ?? 2000,
        temperature: temperature ?? 0.3,
      }),
    }, timeoutMs);
    if (!r.ok) {
      const bodyText = await r.text().catch(() => "");
      return { text: "", error: `http_${r.status}`, detail: bodyText.slice(0, 240) };
    }
    const data = await r.json();
    const text = data?.content?.map((c) => c.text).filter(Boolean).join("") || "";
    return { text: String(text || "").trim(), error: text ? null : "empty" };
  } catch (e) {
    const msg = String(e?.message || e);
    return { text: "", error: /abort/i.test(msg) ? "timeout" : "network", detail: msg.slice(0, 240) };
  }
}

// ── Dispatch by provider id + key ──
async function callByProvider(pid, key, callOpts) {
  switch (pid) {
    case "groq":
      // Groq: try 8b first (fast, good enough for graph JSON), fall back to 70b if empty
      {
        const r1 = await callOpenAICompat({
          baseUrl: "https://api.groq.com/openai/v1",
          key, model: "llama-3.1-8b-instant", ...callOpts,
        });
        if (r1.text) return r1;
        const r2 = await callOpenAICompat({
          baseUrl: "https://api.groq.com/openai/v1",
          key, model: "llama-3.3-70b-versatile", ...callOpts,
        });
        return r2.text ? r2 : r1;
      }
    case "deepseek":
      return callOpenAICompat({
        baseUrl: "https://api.deepseek.com",
        key, model: "deepseek-chat", ...callOpts,
      });
    case "kimi":
      return callOpenAICompat({
        baseUrl: "https://api.moonshot.cn/v1",
        key, model: "moonshot-v1-8k", ...callOpts,
      });
    case "gemini":
      return callGemini({ key, ...callOpts });
    case "anthropic":
    case "claude":
      return callAnthropic({ key, ...callOpts });
    default:
      return { text: "", error: "unknown_provider" };
  }
}

/**
 * Main entry point.
 *
 * @param {object} opts
 * @param {Array<{role:"system"|"user"|"assistant", content:string}>} opts.messages
 * @param {string} [opts.userProvider] — "groq" | "deepseek" | "kimi" | "gemini" | "anthropic" | "server"
 * @param {string} [opts.userKey]      — user-supplied API key (optional)
 * @param {number} [opts.timeoutMs]    — per-provider timeout, default 20000
 * @param {number} [opts.temperature]  — default 0.3
 * @param {number} [opts.maxTokens]    — default 2000
 * @returns {Promise<{text:string, provider:string, keySource:"user"|"server"|"none", diag:string[], error?:string}>}
 */
export async function callAI({
  messages,
  userProvider,
  userKey,
  timeoutMs = 20000,
  temperature,
  maxTokens,
}) {
  const diag = [];
  const callOpts = { messages, timeoutMs, temperature, maxTokens };

  // Priority 1: user-supplied key on their chosen provider
  const hasUserKey = typeof userKey === "string" && userKey.trim().length > 8;
  if (hasUserKey && userProvider && userProvider !== "server") {
    diag.push(`try user:${userProvider}`);
    const r = await callByProvider(userProvider, userKey.trim(), callOpts);
    if (r.text) return { text: r.text, provider: userProvider, keySource: "user", diag };
    diag.push(`user:${userProvider} failed (${r.error || "empty"})`);
  }

  // Priority 2: server key for the provider the user explicitly selected
  if (!hasUserKey && userProvider && userProvider !== "server") {
    const sk = SERVER_KEY_FOR[userProvider];
    if (sk) {
      diag.push(`try server:${userProvider}`);
      const r = await callByProvider(userProvider, sk, callOpts);
      if (r.text) return { text: r.text, provider: userProvider, keySource: "server", diag };
      diag.push(`server:${userProvider} failed (${r.error || "empty"})`);
    } else {
      diag.push(`no server key for ${userProvider}`);
    }
  }

  // Priority 3: server fallback chain (Groq is fastest & cheapest; last resort Anthropic)
  const chain = [
    ["groq", SERVER_KEY_FOR.groq],
    ["deepseek", SERVER_KEY_FOR.deepseek],
    ["gemini", SERVER_KEY_FOR.gemini],
    ["kimi", SERVER_KEY_FOR.kimi],
    ["anthropic", SERVER_KEY_FOR.anthropic],
  ];
  for (const [pid, k] of chain) {
    if (!k) continue;
    diag.push(`try fallback:${pid}`);
    const r = await callByProvider(pid, k, callOpts);
    if (r.text) return { text: r.text, provider: pid, keySource: "server", diag };
    diag.push(`fallback:${pid} failed (${r.error || "empty"})`);
  }

  return { text: "", provider: userProvider || "none", keySource: "none", diag, error: "all_providers_failed" };
}
