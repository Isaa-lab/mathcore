# 免费 API Key 设置指南

MathCore 现在支持 **9 个 AI 服务商**，其中 6 个有免费档（无需信用卡）。
你可以走两条路：

- **个人浏览器**：在网站右上角"AI 设置"里填 Key——只存在你本地浏览器，不上传服务器
- **平台部署**：在 Vercel 项目的 Environment Variables 里加 Key——所有用户共享

下面给出**每家免费 API 怎么领 Key + 推荐组合**。

---

## 🟢 强烈推荐（真免费 + 注册即得）

### 1. Groq（速度最快·14400 req/day 免费）
- 注册：<https://console.groq.com/keys>
- 默认模型：`llama-3.3-70b-versatile`（出题质量好），fallback `llama-3.1-8b-instant`
- Key 长这样：`gsk_xxxx...`
- Vercel 环境变量名：`GROQ_KEY`

### 2. Google Gemini（免费 1500 req/day · 质量最好）
- 注册：<https://aistudio.google.com/apikey>（需要 Google 账号）
- 默认模型：`gemini-2.0-flash`，fallback `gemini-2.0-flash-lite`
- Key 长这样：`AIzaSy...`
- Vercel 环境变量名：`GEMINI_KEY`

### 3. 智谱 GLM（GLM-4-Flash 完全免费 + 无限调用）
- 注册：<https://bigmodel.cn/usercenter/proj-mgmt/apikeys>
- 默认模型：`glm-4-flash`（专门的免费模型，没有日上限）
- Key 形式：长串随机字符
- Vercel 环境变量名：`ZHIPU_KEY`

> 💡 **建议**：以上三个**全部填**！平台会按 Groq → Gemini → 智谱 的顺序自动 fallback。
> 任意一家配额用完，自动切到下一家——日常练习几乎用不完。

---

## 🟡 中阶推荐（注册稍麻烦但免费）

### 4. OpenRouter（聚合多家·选 `:free` 模型完全免费）
- 注册：<https://openrouter.ai/keys>
- 默认模型：`mistralai/mistral-7b-instruct:free`
- Key 长这样：`sk-or-v1-xxxx...`
- Vercel 环境变量名：`OPENROUTER_KEY`

### 5. SiliconFlow 硅基流动（国内访问稳定·Qwen 系列免费）
- 注册：<https://cloud.siliconflow.cn/account/ak>
- 默认模型：`Qwen/Qwen2.5-7B-Instruct`
- Key 长这样：`sk-xxxx...`
- Vercel 环境变量名：`SILICONFLOW_KEY`

### 6. Cerebras（硬件加速·速度炸裂·14400 req/day 免费）
- 注册：<https://cloud.cerebras.ai/platform>
- 默认模型：`llama3.1-8b`（fallback `llama3.3-70b`）
- Key 长这样：`csk-xxxx...`
- Vercel 环境变量名：`CEREBRAS_KEY`

---

## 🔵 付费档（按需）

### 7. DeepSeek
- <https://platform.deepseek.com/api_keys>
- 国内推理强、价格低（约 ¥1/M tokens）
- Vercel 变量名：`DEEPSEEK_KEY`

### 8. Kimi (Moonshot)
- <https://platform.moonshot.cn/console/api-keys>
- Vercel 变量名：`KIMI_KEY`

### 9. Anthropic Claude
- <https://console.anthropic.com/>
- Vercel 变量名：`ANTHROPIC_KEY`

---

## 在 Vercel 部署里配置（一次配好，所有用户都能用）

1. 打开 <https://vercel.com>，进入 `mathcore` 项目
2. **Settings → Environment Variables**
3. 把上面任一组 Key 添加进去（每个都是 Production / Preview / Development 都勾上）
4. **Redeploy**——下次 deploy 时新 Key 才会生效

> ⚠️ **强烈推荐至少配置 `GROQ_KEY` + `GEMINI_KEY` + `ZHIPU_KEY` 三个**，
> 这样任意一家挂掉都不影响平台正常工作。

---

## 在浏览器里配置（个人 Key·只对你自己生效）

1. 打开 mathcore 网站，点首页右上角 **"⚙️ AI 设置"**
2. 选服务商 → 填入 Key → 保存
3. Key 仅保存在 `localStorage.mc_ai_keys`，**不会上传服务器**

---

## 推荐使用策略

### 平台管理员（部署到 Vercel 给学生用）
```
GROQ_KEY = gsk_xxx       # 速度快、配额大，作主力
GEMINI_KEY = AIzaSy xxx  # 质量好，作 fallback 1
ZHIPU_KEY = xxx          # 免费无限，作终极兜底（GLM-4-Flash）
OPENROUTER_KEY = sk-or-v1-xxx  # 可选，再加一层兜底
```

### 个人用户（自己折腾）
- 只想快速试 → 用平台内置（默认 Groq），啥都不配
- 想多 AI 对比知识点抽取 → 各填一个 Key，去"知识点"页用"🔁 用不同 AI 重抽"对比

---

## 不同 AI 的特点对比

| 服务商      | 速度 | 免费额度 | 中文 | 数学推理 | 推荐用途 |
|---|---|---|---|---|---|
| Groq        | ⚡⚡⚡ | 14400/day | 良 | 良   | **主力出题** |
| Gemini      | ⚡⚡  | 1500/day | 优 | 优   | **质量优先时用** |
| 智谱 GLM    | ⚡⚡  | 无限     | 优 | 良   | **终极 fallback** |
| OpenRouter  | ⚡   | 视模型    | 良 | 良   | 模型对比试验 |
| SiliconFlow | ⚡⚡  | 视模型    | 优 | 良   | 国内网络稳定 |
| Cerebras    | ⚡⚡⚡⚡ | 14400/day | 中 | 中   | 速度极致追求 |
| DeepSeek    | ⚡⚡  | 付费     | 优 | 优⭐ | 复杂证明题 |
| Kimi        | ⚡   | 付费     | 优 | 良   | 长上下文 |
| Claude      | ⚡   | 付费     | 优 | 优⭐ | 最高质量解析 |
