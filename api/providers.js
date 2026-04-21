// /api/providers —— 只读：返回哪些 provider 在服务器端已配置了 API Key
// 前端用这个来决定 popover 里每个卡片是否显示"平台免费·点击即用"徽章。
// ✅ 不返回 Key 本身，只返回 boolean；绝不泄漏秘密。
//
// 支持两套命名：
//   · 显式按 provider 命名：GROQ_KEY / GEMINI_KEY / DEEPSEEK_KEY / KIMI_KEY / ANTHROPIC_KEY
//   · 平台默认槽位：PLATFORM_PROVIDER=<provider id> + PLATFORM_API_KEY
//     （历史遗留命名；用户可以选任一种配置，我们都能识别到）
const looksSet = (v) => typeof v === "string" && v.trim().length > 8;

function hasKeyFor(provider) {
  const explicitVar = {
    groq: "GROQ_KEY",
    gemini: "GEMINI_KEY",
    deepseek: "DEEPSEEK_KEY",
    kimi: "KIMI_KEY",
    anthropic: "ANTHROPIC_KEY",
  }[provider];
  if (explicitVar && looksSet(process.env[explicitVar])) return true;
  const platformProvider = String(process.env.PLATFORM_PROVIDER || "").trim().toLowerCase();
  if (platformProvider === provider && looksSet(process.env.PLATFORM_API_KEY)) return true;
  return false;
}

export default function handler(req, res) {
  try {
    const platformProviders = {
      groq:      hasKeyFor("groq"),
      gemini:    hasKeyFor("gemini"),
      deepseek:  hasKeyFor("deepseek"),
      kimi:      hasKeyFor("kimi"),
      anthropic: hasKeyFor("anthropic"),
    };
    return res.status(200).json({
      platformProviders,
      any: Object.values(platformProviders).some(Boolean),
    });
  } catch (err) {
    return res.status(500).json({
      error: String(err?.message || err),
      platformProviders: { groq: false, gemini: false, deepseek: false, kimi: false, anthropic: false },
      any: false,
    });
  }
}
