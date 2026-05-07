// src/utils/wrongItems.js
//
// 错题表持久化 + SM2 间隔重复推进。
//
// 与现有 App.js 里的 SM2 对象（走 mc_sr 键、卡片记忆曲线）**独立**：
// · 记忆卡片的 SM2 是"今天想不起来就重置"
// · 错题的 SM2 是"做错一次扣 ease，连续对 3 次+14 天才算真掌握"
// 两者用不同阈值体现不同的学习场景，混用会干扰各自曲线。
//
// Schema 完全遵循 L3b 方案 WrongItem 定义（src/utils/storage.js 里 ns+ver 分隔）。

import { storage } from "./storage";

const KEY = "wrong_items";
const DAY = 24 * 60 * 60 * 1000;

// ────────────────────────────────────────────────────────────────────────────
// 内部工具
// ────────────────────────────────────────────────────────────────────────────

// 把入库时的 question 对象瘦身成一份"自包含快照"（snapshot）。
// 为什么需要 snapshot：
//   错题本卡片显示时要重新查找题干，旧实现只在硬编码 ALL_QUESTIONS 里查；
//   而 DB 题（UUID id）不在该数组里，加上服务端低质过滤会把题"从题库移除"，
//   就出现"题目 #xxx 已从题库移除"。把题目本体直接缓存进错题本 → 题永远拿得到。
function snapshotOf(question) {
  if (!question || typeof question !== "object") return null;
  return {
    id: String(question.id || ""),
    question: String(question.question || question.text || question.content || ""),
    options: Array.isArray(question.options) ? question.options.slice(0, 8).map(String) : null,
    options_en: Array.isArray(question.options_en) ? question.options_en.slice(0, 8).map(String) : null,
    answer: question.answer == null ? "" : String(question.answer),
    explanation: question.explanation ? String(question.explanation) : "",
    explanation_en: question.explanation_en ? String(question.explanation_en) : "",
    type: question.type || (Array.isArray(question.options) ? "单选题" : "判断题"),
    chapter: question.chapter || "未分类",
    course: question.course || null,
    knowledgePoints: Array.isArray(question.knowledgePoints) ? question.knowledgePoints :
                     Array.isArray(question.knowledge_points) ? question.knowledge_points : null,
    optionRationales: Array.isArray(question.optionRationales) ? question.optionRationales : null,
    misconceptions: question.misconceptions && typeof question.misconceptions === "object" ? question.misconceptions : null,
  };
}

function newItem({ question, userAnswer, timeMs, now }) {
  return {
    id: String(question.id),
    question_id: String(question.id),
    chapter: question.chapter || "unclassified",
    chapter_label: question.chapter || "未分类",
    first_wrong_at: now,
    last_seen_at: now,
    last_wrong_at: now,
    error_tags: [],
    sm2: {
      repetitions: 0,
      ease_factor: 2.5,
      interval_days: 1,
      due_at: now + DAY,
    },
    attempts: [{
      at: now,
      correct: false,
      time_ms: timeMs || 0,
      user_answer: userAnswer == null ? "" : String(userAnswer),
    }],
    status: "active",
    mastered_at: null,
    variants_generated: 0,
    // 入库时把整道题瘦身存一份；后续显示 / 重做都先用这份，不依赖 ALL_QUESTIONS
    question_snapshot: snapshotOf(question),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// 写入：答对 / 答错
// ────────────────────────────────────────────────────────────────────────────

/**
 * 在任何答题入口调用：答错 → 入错题本或刷新 SM2
 */
export function recordWrongAnswer({ question, userAnswer, timeMs }) {
  if (!question || !question.id) return;
  const now = Date.now();

  storage.update(KEY, (items) => {
    const list = Array.isArray(items) ? items : [];
    const idx = list.findIndex((w) => w.id === String(question.id));

    if (idx === -1) {
      // 首次错 —— 入库
      return [...list, newItem({ question, userAnswer, timeMs, now })];
    }

    // 再错 —— 扣 ease、重置 repetitions、1 天后再见
    const next = list.slice();
    const existing = { ...next[idx] };
    existing.last_wrong_at = now;
    existing.last_seen_at = now;
    existing.sm2 = {
      repetitions: 0,
      ease_factor: Math.max(1.3, existing.sm2.ease_factor - 0.2),
      interval_days: 1,
      due_at: now + DAY,
    };
    existing.attempts = [
      ...(existing.attempts || []),
      { at: now, correct: false, time_ms: timeMs || 0, user_answer: userAnswer == null ? "" : String(userAnswer) },
    ];
    // 即使之前 mastered，再错一次就复活回 active —— 说明那不算真掌握
    existing.status = "active";
    existing.mastered_at = null;
    // 治愈旧数据：如果之前那次入库时还没存 snapshot（旧版本错题），趁这次 question 在手补一份
    if (!existing.question_snapshot && question) existing.question_snapshot = snapshotOf(question);
    next[idx] = existing;
    return next;
  }, []);
}

/**
 * 在任何答题入口调用：答对 → 若在错题本里，推进 SM2；否则不处理
 */
export function recordCorrectAnswer({ question, timeMs }) {
  if (!question || !question.id) return;
  const now = Date.now();

  storage.update(KEY, (items) => {
    const list = Array.isArray(items) ? items : [];
    const idx = list.findIndex((w) => w.id === String(question.id));
    if (idx === -1) return list; // 从未做错过 —— 不归错题本管

    const next = list.slice();
    const existing = { ...next[idx] };
    existing.last_seen_at = now;
    existing.attempts = [
      ...(existing.attempts || []),
      { at: now, correct: true, time_ms: timeMs || 0, user_answer: "" },
    ];

    // SM2 推进
    const sm2 = { ...existing.sm2 };
    sm2.repetitions += 1;
    if (sm2.repetitions === 1) sm2.interval_days = 1;
    else if (sm2.repetitions === 2) sm2.interval_days = 3;
    else sm2.interval_days = Math.max(1, Math.round(sm2.interval_days * sm2.ease_factor));
    sm2.ease_factor = Math.max(1.3, sm2.ease_factor + 0.1);
    sm2.due_at = now + sm2.interval_days * DAY;
    existing.sm2 = sm2;

    // 已掌握阈值：连续对 3 次 + 间隔 ≥ 14 天（对齐产品决策）
    if (sm2.repetitions >= 3 && sm2.interval_days >= 14) {
      existing.status = "mastered";
      existing.mastered_at = now;
    }

    next[idx] = existing;
    return next;
  }, []);
}

// ────────────────────────────────────────────────────────────────────────────
// 查询
// ────────────────────────────────────────────────────────────────────────────

/**
 * 取错题列表
 * @param {{ status?: "active"|"mastered"|"all", chapter?: string|null, errorTag?: string|null }} opts
 */
export function getWrongItems(opts = {}) {
  const { status = "active", chapter = null, errorTag = null } = opts;
  const items = storage.get(KEY, []) || [];
  return items.filter((w) => {
    if (status !== "all" && w.status !== status) return false;
    if (chapter && chapter !== "all" && w.chapter !== chapter) return false;
    if (errorTag && errorTag !== "all") {
      if (errorTag === "unknown") {
        if ((w.error_tags || []).length > 0) return false;
      } else if (!(w.error_tags || []).includes(errorTag)) {
        return false;
      }
    }
    return true;
  });
}

/**
 * 取"今日到期"的错题（SM2 due_at ≤ now 且 active）——按到期时间升序（最早到期的先做）
 */
export function getDueWrongItems() {
  const now = Date.now();
  return (storage.get(KEY, []) || [])
    .filter((w) => w.status === "active" && w.sm2 && w.sm2.due_at <= now)
    .sort((a, b) => a.sm2.due_at - b.sm2.due_at);
}

/**
 * 按章节聚合错题数（薄弱章节权重的底层数据）
 * 返回 { [chapter]: { count, due, mastered, total } }
 */
export function getChapterMistakeStats() {
  const items = storage.get(KEY, []) || [];
  const now = Date.now();
  const out = {};
  items.forEach((w) => {
    const ch = w.chapter || "unclassified";
    if (!out[ch]) out[ch] = { chapter: ch, label: w.chapter_label || ch, count: 0, due: 0, mastered: 0, total: 0 };
    out[ch].total += 1;
    if (w.status === "mastered") out[ch].mastered += 1;
    else {
      out[ch].count += 1;
      if (w.sm2 && w.sm2.due_at <= now) out[ch].due += 1;
    }
  });
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// 修改
// ────────────────────────────────────────────────────────────────────────────

export function markMastered(questionId) {
  const now = Date.now();
  storage.update(KEY, (items) => (items || []).map((w) =>
    w.id === String(questionId) ? { ...w, status: "mastered", mastered_at: now } : w
  ), []);
}

export function suspendItem(questionId) {
  storage.update(KEY, (items) => (items || []).map((w) =>
    w.id === String(questionId) ? { ...w, status: "suspended" } : w
  ), []);
}

export function tagWrongItem(questionId, tags) {
  storage.update(KEY, (items) => (items || []).map((w) =>
    w.id === String(questionId) ? { ...w, error_tags: Array.from(new Set(tags || [])) } : w
  ), []);
}

export function incrementVariantsGenerated(questionIds, delta = 1) {
  const ids = new Set((questionIds || []).map(String));
  storage.update(KEY, (items) => (items || []).map((w) =>
    ids.has(w.id) ? { ...w, variants_generated: (w.variants_generated || 0) + delta } : w
  ), []);
}

/**
 * 保存 AI 归因诊断结果 v2（结构化版）。兼容 v1 调用：旧调用 `saveAiReasoning(id, reasoning, tags)`
 * 仍然有效——会把 reasoning 当成 wrong_step 的弱兜底写进新 schema，但 v2 字段为空。
 * 推荐用 saveAiDiagnosis 传完整对象。
 *
 * v2 schema（每条错题项的可选字段）：
 *   ai_reasoning       legacy（一句话），保留给老 UI 兜底显示
 *   ai_wrong_step      "你在第几步出了什么错"（30~200 字）
 *   ai_misconception   "你可能信以为真的错误命题"（30~200 字）
 *   ai_correct_path    "正确做法的关键 1~2 步"（最多 200 字）
 *   ai_remedy_focus    "建议练什么子技能"（短语，10~80 字）
 *   ai_weak_topics     ["指数函数求导", "链式法则"]
 *   ai_confidence      "high" | "medium" | "low"
 *   ai_diagnosed_at    timestamp
 */
export function saveAiDiagnosis(questionId, diagnosis) {
  if (!questionId || !diagnosis || typeof diagnosis !== "object") return;
  storage.update(KEY, (items) => (items || []).map((w) => {
    if (w.id !== String(questionId)) return w;
    const next = { ...w, ai_diagnosed_at: Date.now() };
    // 兼容字段：仍写 ai_reasoning（取 wrong_step → misconception → reasoning）
    next.ai_reasoning = diagnosis.wrong_step || diagnosis.misconception || diagnosis.reasoning || w.ai_reasoning || "";
    next.ai_reasoning_at = Date.now();
    if (typeof diagnosis.wrong_step === "string")    next.ai_wrong_step = diagnosis.wrong_step;
    if (typeof diagnosis.misconception === "string") next.ai_misconception = diagnosis.misconception;
    if (typeof diagnosis.correct_path === "string")  next.ai_correct_path = diagnosis.correct_path;
    if (typeof diagnosis.remedy_focus === "string")  next.ai_remedy_focus = diagnosis.remedy_focus;
    if (Array.isArray(diagnosis.weak_topics))        next.ai_weak_topics = diagnosis.weak_topics.slice(0, 3);
    if (["high", "medium", "low"].includes(diagnosis.confidence)) next.ai_confidence = diagnosis.confidence;
    if (Array.isArray(diagnosis.tags) && diagnosis.tags.length > 0) {
      next.error_tags = Array.from(new Set([...(w.error_tags || []), ...diagnosis.tags]));
    }
    return next;
  }), []);
}

/**
 * v1 兼容入口：旧调用 saveAiReasoning(id, "一句话", ["formula"]) 继续可用。
 * 推荐改用 saveAiDiagnosis 传完整结构。
 */
export function saveAiReasoning(questionId, reasoning, tags) {
  saveAiDiagnosis(questionId, {
    wrong_step: reasoning,
    misconception: "",
    correct_path: "",
    remedy_focus: "",
    weak_topics: [],
    confidence: "medium",
    reasoning: reasoning,
    tags: Array.isArray(tags) ? tags : [],
  });
}

// ────────────────────────────────────────────────────────────────────────────
// 错因标签定义（单源真实，前后端/UI 都从这里取）
// v2：从 4 类扩到 10 类细分类别 + unknown 兜底；旧错题上的 4 类标签自动兼容。
// 颜色按"语义近似度"分组：
//   暖色（公式 / 定义 / 符号 / 边界）—— 知识点本身记错
//   紫色（概念 / 条件）             —— 概念边界 / 适用条件没把握住
//   蓝色（计算 / 代数 / 中间步骤）  —— 思路对但执行掉链子
//   红色（方法 / unknown）          —— 选错方法 / 暂未归类
// ────────────────────────────────────────────────────────────────────────────

export const ERROR_TAGS = [
  { id: "formula",    label: "公式记错",     color: "#F59E0B", bg: "#FFFBEB", group: "knowledge" },
  { id: "definition", label: "定义不清",     color: "#D97706", bg: "#FEF3C7", group: "knowledge" },
  { id: "sign",       label: "符号错误",     color: "#EA580C", bg: "#FFF7ED", group: "knowledge" },
  { id: "boundary",   label: "边界 / 特殊值", color: "#DB2777", bg: "#FDF2F8", group: "knowledge" },
  { id: "concept",    label: "概念混淆",     color: "#A855F7", bg: "#FAF5FF", group: "concept" },
  { id: "condition",  label: "前提条件",     color: "#7C3AED", bg: "#F5F3FF", group: "concept" },
  { id: "careless",   label: "计算粗心",     color: "#3B82F6", bg: "#EFF6FF", group: "execution" },
  { id: "algebra",    label: "代数变形",     color: "#0EA5E9", bg: "#F0F9FF", group: "execution" },
  { id: "derivation", label: "中间步骤",     color: "#06B6D4", bg: "#ECFEFF", group: "execution" },
  { id: "method",     label: "方法选错",     color: "#EF4444", bg: "#FEF2F2", group: "method" },
  { id: "unknown",    label: "暂未归类",     color: "#6B7280", bg: "#F9FAFB", group: "other" },
];
