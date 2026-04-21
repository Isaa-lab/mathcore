// /api/providers —— 只读：返回哪些 provider 在服务器端已配置了 API Key
// 前端用这个来决定 popover 里每个卡片是否显示"平台免费·点击即用"徽章。
// ✅ 不返回 Key 本身，只返回 boolean；绝不泄漏秘密。
export default function handler(req, res) {
  try {
    const platformProviders = {
      groq:      !!(process.env.GROQ_KEY      && process.env.GROQ_KEY.trim().length      > 8),
      gemini:    !!(process.env.GEMINI_KEY    && process.env.GEMINI_KEY.trim().length    > 8),
      deepseek:  !!(process.env.DEEPSEEK_KEY  && process.env.DEEPSEEK_KEY.trim().length  > 8),
      kimi:      !!(process.env.KIMI_KEY      && process.env.KIMI_KEY.trim().length      > 8),
      anthropic: !!(process.env.ANTHROPIC_KEY && process.env.ANTHROPIC_KEY.trim().length > 8),
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
