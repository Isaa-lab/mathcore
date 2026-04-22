// src/utils/dialogueMode.js
//
// 对话模式分级：决定本轮 AI 应该用"引导式"还是"讲解式"。
//
// 背景：
//   原先 socratic 模式一视同仁，用户已答对、主动要求"举例/延伸/讲清楚"时
//   AI 还在连环反问（"你认为...吗？""会有什么区别呢？"），把正向反馈窗口
//   打断成质疑。这违反了学习心理学里"答对即奖励"的基本原则。
//
// 设计：
//   · Socratic  —— 多问少讲，引导用户自己想明白（适合答题前 / 答错 / 用户明说要引导）
//   · Exposition —— 直接讲清楚，不反问（适合答对后要求延伸、或用户明确"讲解/举例/对比"）
//
// 这个决策是轻量的正则 + 状态机，不依赖 LLM 调用，前后端都可引用。

// ────────────────────────────────────────────────────────────────────────────
// 用户"明确要讲解"的触发词（优先级高于默认模式）
// ────────────────────────────────────────────────────────────────────────────
const EXPOSITION_PATTERNS = [
  /确认.{0,3}(思路|想法|理解)/,
  /讲.{0,3}(清楚|明白|一下|讲)/,
  /解释/,
  /说明/,
  /举.{0,3}(个|一个|几个).{0,3}例子/,
  /给.{0,3}(个|一个).{0,3}例子/,
  /例子/,
  /延伸/,
  /拓展/,
  /应用场景/,
  /对比/,
  /梳理/,
  /分步.{0,3}(推导|讲解|展示)/,
  /为什么/,
  /是什么/,
  /能.{0,3}说.{0,3}下/,
  /讲讲/,
  /告诉我/,
  /这是.{0,3}(怎么|如何)/,
];

// ────────────────────────────────────────────────────────────────────────────
// 用户"明确要引导"的触发词（反向信号）
// ────────────────────────────────────────────────────────────────────────────
const SOCRATIC_PATTERNS = [
  /引导.{0,3}我/,
  /带.{0,3}我.{0,3}(想|推|思考)/,
  /提示.{0,3}我/,
  /让我.{0,3}(自己|先)(想|试)/,
  /不要.{0,3}直接.{0,3}(告诉|说)/,
];

/**
 * 根据答题上下文推导 quizState
 * @param {{ answered: boolean, isCorrect: boolean, selected: any }} ctx
 * @returns {"before_answer" | "wrong_answer" | "correct_answer"}
 */
export function deriveQuizState(ctx) {
  if (!ctx) return "before_answer";
  const { answered, isCorrect, selected } = ctx;
  if (!answered && (selected === null || selected === undefined)) return "before_answer";
  if (answered && isCorrect === false) return "wrong_answer";
  if (answered && isCorrect === true) return "correct_answer";
  // 选了但未提交 —— 按"答题前"处理（还在犹豫）
  return "before_answer";
}

/**
 * 决定本轮对话用什么模式。
 * @param {{ userMessage: string, quizState: "before_answer"|"wrong_answer"|"correct_answer" }} params
 * @returns {{ mode: "socratic" | "exposition", reason: string }}
 */
export function resolveDialogueMode({ userMessage, quizState }) {
  const text = String(userMessage || "").trim();

  // 1. 用户直接喊"引导我" —— 不管答题状态一律走 Socratic
  for (const p of SOCRATIC_PATTERNS) {
    if (p.test(text)) return { mode: "socratic", reason: "user_asked_socratic" };
  }

  // 2. 答题前 / 答错 —— 默认 Socratic（引导思考、避免直接报答案）
  if (quizState === "before_answer" || quizState === "wrong_answer") {
    return { mode: "socratic", reason: `state_${quizState}` };
  }

  // 3. 答对后：看用户意图
  //    - 明确要讲解 → Exposition
  //    - 无信号 → 默认 Exposition（答对的正反馈窗口不该被反问打断）
  for (const p of EXPOSITION_PATTERNS) {
    if (p.test(text)) return { mode: "exposition", reason: "user_asked_exposition" };
  }
  return { mode: "exposition", reason: "default_post_correct" };
}

/**
 * 面板标题文案（单源真实，前后端共享）
 */
export const DIALOGUE_MODE_LABELS = {
  socratic:   { icon: "💬", title: "AI 正在和你一起拆解这道题" },
  exposition: { icon: "💡", title: "AI 正在帮你深入理解" },
};
