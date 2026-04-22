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
 * 保存 AI 归因诊断结果（持久化到卡片）
 * @param {string|number} questionId
 * @param {string} reasoning - AI 生成的错因文字
 * @param {string[]} tags - AI 建议的错因标签（可选，非空则覆盖现有）
 */
export function saveAiReasoning(questionId, reasoning, tags) {
  storage.update(KEY, (items) => (items || []).map((w) => {
    if (w.id !== String(questionId)) return w;
    const next = { ...w, ai_reasoning: reasoning || "", ai_reasoning_at: Date.now() };
    if (Array.isArray(tags) && tags.length > 0) {
      next.error_tags = Array.from(new Set([...(w.error_tags || []), ...tags]));
    }
    return next;
  }), []);
}

// ────────────────────────────────────────────────────────────────────────────
// 错因标签定义（单源真实，前后端/UI 都从这里取）
// ────────────────────────────────────────────────────────────────────────────

export const ERROR_TAGS = [
  { id: "formula",  label: "公式记错", color: "#F59E0B", bg: "#FFFBEB" },
  { id: "concept",  label: "概念混淆", color: "#A855F7", bg: "#FAF5FF" },
  { id: "careless", label: "计算粗心", color: "#3B82F6", bg: "#EFF6FF" },
  { id: "method",   label: "方法错误", color: "#EF4444", bg: "#FEF2F2" },
];
