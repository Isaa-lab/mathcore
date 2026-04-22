// src/utils/chapters.js
//
// 从题库 + 错题本聚合"用户真实在学"的章节列表。
// 原来 ExamPlanSection 的 allChaptersOpts 是写死的 8 章，所有用户看到同一套；
// 现在按以下优先级合并：
//   1. 错题本（wrong_items）里出现过的章节 —— 最弱
//   2. 题库（ALL_QUESTIONS）里所有章节 —— 覆盖面
// 资料库/知识树的章节等后续 L3c 接入时再加。

import { getChapterMistakeStats } from "./wrongItems";

/**
 * @param {Array} allQuestions - 题库（ALL_QUESTIONS）
 * @returns {Array<{slug, label, question_count, wrong_count, mastered_count, weakness_score}>}
 */
export function getUserChapters(allQuestions = []) {
  const map = new Map();

  // 1. 从题库聚合
  allQuestions.forEach((q) => {
    const slug = q.chapter || "unclassified";
    if (!map.has(slug)) {
      map.set(slug, { slug, label: slug, question_count: 0, wrong_count: 0, mastered_count: 0 });
    }
    map.get(slug).question_count += 1;
  });

  // 2. 从错题本追加错题计数
  const mistakeStats = getChapterMistakeStats();
  Object.values(mistakeStats).forEach((m) => {
    const slug = m.chapter;
    if (!map.has(slug)) {
      map.set(slug, { slug, label: m.label || slug, question_count: 0, wrong_count: 0, mastered_count: 0 });
    }
    const c = map.get(slug);
    c.wrong_count = m.count; // "待复习"的错题
    c.mastered_count = m.mastered;
    if (m.label) c.label = m.label;
  });

  // 3. 计算薄弱度（错题权重远大于覆盖面）—— 用于计划生成器决定哪些章节多分配时长
  return Array.from(map.values())
    .map((c) => ({
      ...c,
      weakness_score: c.wrong_count * 3 + (c.question_count > 0 ? 1 : 0),
    }))
    .sort((a, b) => b.weakness_score - a.weakness_score || b.question_count - a.question_count);
}
