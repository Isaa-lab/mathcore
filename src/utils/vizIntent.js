// src/utils/vizIntent.js
//
// 可视化意图检测：用"用户有没有明确说想看图"来决定本轮是否生成 [VIZ:...]。
//
// 为什么不让 AI 自己决定：
//   模型倾向于每轮答题复盘都塞一张流程图（因为"多给点就不会被骂"的对齐偏好），
//   但用户实际只是想简单聊两句 / 让 AI 讲讲思路 —— 每次都画图是浪费 token、
//   降低 UI 信噪比。
//
// 本模块只做"信号探测"：前端零延迟、正则驱动、可审计。
// 真正的防线是后端 prompt 分流 + 后端剥离 [VIZ:...] 兜底。

// ────────────────────────────────────────────────────────────────────────────
// 触发词（出现即视为"想看图"）
// 设计原则：宁可漏报不要误报 —— 漏了用户可以再说一遍或点按钮；误报一次就是成本 + 噪音。
// ────────────────────────────────────────────────────────────────────────────
const VIZ_TRIGGER_PATTERNS = [
  // —— 显式"画"/"可视化"字样
  /画.{0,3}图/,
  /画.{0,3}出.{0,3}来/,
  /画.{0,3}一张/,
  /画.{0,3}个/,
  /帮我.{0,3}画/,
  /能.{0,3}画/,                            // 能不能画 / 能否画 / 能画吗
  /给我.{0,3}(画|生成|做).{0,3}(图|结构|示)/,
  /可视化/,
  /图示/,
  /示意图/,
  /配.{0,3}图/,

  // —— 结构类词：梳理/分步/流程（通常伴随可视化期望）
  /梳理.{0,3}(流程|步骤|结构|脉络|思路)/,
  /分.{0,3}步.{0,3}(推导|讲解|分析|展示)/,
  /流程.{0,3}(图|化|看看)/,
  /推导.{0,3}(过程|步骤|路径)/,

  // —— 对比 / 层级 / 关系网络
  /对比.{0,3}(一下|看看|展示|相关|概念)/,
  /(关系|区别|联系|异同).{0,3}(图|网络|展示)/,
  /.{0,6}(和|与|跟).{0,6}的?.{0,3}(关系|区别|异同)/,
  /层级|层次|树状|分类/,
  /结构.{0,3}(图|看看|展示)/,
  /知识(图谱|网络|地图)/,

  // —— 英文触发（用户有时混用）
  /visuali[sz]e/i,
  /\bdiagram\b/i,
  /\bchart\b/i,
  /\bgraph\b/i,          // 注意会误命中"graph theory"；但做题引导里这种概率低
  /\bflowchart\b/i,
];

// ────────────────────────────────────────────────────────────────────────────
// 反向信号（用户明确说"别画图、只用文字"）—— 优先级高于触发词
// ────────────────────────────────────────────────────────────────────────────
const VIZ_REJECT_PATTERNS = [
  /不(用|要|需要).{0,3}(图|可视化|画)/,
  /别.{0,3}(画|可视化)/,
  /只.{0,3}用.{0,3}(文字|文本|说)/,
  /先.{0,3}不.{0,3}(画|要图)/,
  /用?.{0,3}文字.{0,3}(讲|说|描述)(就行|就好|即可)/,
];

/**
 * 检测用户是否想要可视化。
 * @param {string} text 用户输入
 * @returns {{ wantsViz: boolean, reason: string, matched?: string }}
 */
export function detectVizIntent(text) {
  const src = String(text || "").trim();
  if (!src) return { wantsViz: false, reason: "empty" };

  for (const p of VIZ_REJECT_PATTERNS) {
    if (p.test(src)) return { wantsViz: false, reason: "explicit_reject", matched: p.source };
  }
  for (const p of VIZ_TRIGGER_PATTERNS) {
    if (p.test(src)) return { wantsViz: true, reason: "keyword_match", matched: p.source };
  }
  return { wantsViz: false, reason: "no_signal" };
}

/**
 * 开发态日志：把每次意图判定写进 console，方便后续根据真实流量调整正则。
 * 生产环境静默。
 */
export function logVizIntent(text, intent) {
  if (typeof window === "undefined") return;
  if (process.env.NODE_ENV !== "development") return;
  // eslint-disable-next-line no-console
  console.debug("[viz-intent]", { text: String(text || "").slice(0, 80), intent });
}
