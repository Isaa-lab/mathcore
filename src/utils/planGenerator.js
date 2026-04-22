// src/utils/planGenerator.js
//
// 把"日历上每天 2 个硬编码文案"升级为：
//   · 基于真实错题（SM2 到期）
//   · 基于真实薄弱章节（wrong_items 聚合）
//   · 按距离考试的阶段（light / normal / high / sprint）决定任务密度和类型
//   · 支持每日硬上限时长（默认 60 分钟），按优先级裁尾
//
// 所有"今天要做什么"都由这里一次性生成，存入 exam_plan.daily_plans[date]。
// 任务完成由 markTaskCompleted 改写 completed 字段 —— 后续再生成时会保留已完成状态。

import { storage } from "./storage";
import { getDueWrongItems } from "./wrongItems";

const DAY = 24 * 60 * 60 * 1000;

function dayKey(date) {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function resolvePhase(remainingDays) {
  if (remainingDays <= 1) return "sprint";  // 最后一天（轻松回顾+早睡）
  if (remainingDays <= 3) return "sprint";  // 冲刺
  if (remainingDays <= 7) return "high";    // 高强度
  if (remainingDays <= 14) return "normal"; // 常规
  return "light";                            // 早期铺垫
}

/**
 * 生成从今天到考试日的每日计划。
 * @param {{examDate:string, chaptersInScope:Array, dailyMinutesTarget?:number, now?:Date}} params
 * @returns {Object<string, DayPlan>}
 */
export function generateDailyPlans({ examDate, chaptersInScope, dailyMinutesTarget = 60, now = new Date() }) {
  const today = startOfDay(now);
  const exam = examDate ? startOfDay(new Date(examDate)) : null;
  const daysUntilExam = exam ? Math.ceil((exam - today) / DAY) : 14;
  if (daysUntilExam < 0) return {};

  const plans = {};
  const maxHorizon = Math.min(Math.max(daysUntilExam, 7), 30);

  for (let offset = 0; offset <= maxHorizon; offset++) {
    const day = new Date(today);
    day.setDate(today.getDate() + offset);
    const key = dayKey(day);
    const remainingDays = exam ? daysUntilExam - offset : 999;
    const isExamDay = remainingDays === 0;
    const isPast = remainingDays < 0;
    const phase = isExamDay ? "exam_day" : isPast ? "past" : resolvePhase(remainingDays);

    plans[key] = {
      date: key,
      phase,
      remainingDays: exam ? remainingDays : null,
      tasks: isExamDay
        ? [{ id: `exam_${key}`, type: "exam", title: "🎓 考试日！加油！", subtitle: "相信自己，沉着作答", priority: "high", target_minutes: 0, completed: false }]
        : isPast
        ? []
        : generateDayTasks({ date: key, phase, remainingDays, chaptersInScope, targetMinutes: dailyMinutesTarget, dayOffset: offset }),
      summary: null,
    };
    plans[key].summary = computeSummary(plans[key]);
  }

  return plans;
}

function computeSummary(dayPlan) {
  const tasks = dayPlan.tasks || [];
  return {
    total_tasks: tasks.length,
    completed_tasks: tasks.filter((t) => t.completed).length,
    total_minutes: tasks.reduce((s, t) => s + (t.target_minutes || 0), 0),
    completed_minutes: tasks.filter((t) => t.completed).reduce((s, t) => s + (t.target_minutes || 0), 0),
  };
}

function generateDayTasks({ date, phase, remainingDays, chaptersInScope, targetMinutes, dayOffset }) {
  const tasks = [];

  // —— 任务 1：SM2 到期错题 —— 每天（考前 1 天除外：那天要轻松回顾不要压力）
  const dueWrong = getDueWrongItems();
  if (dueWrong.length > 0 && remainingDays !== 1) {
    const count = Math.min(dueWrong.length, phase === "sprint" ? 15 : 10);
    tasks.push({
      id: `task_sm2_${date}`,
      type: "sm2_due",
      title: `复习今日到期错题 ${count} 道`,
      subtitle: "SM2 间隔重复推荐",
      target_count: count,
      target_minutes: count * 2,
      related_ids: dueWrong.slice(0, count).map((w) => w.id),
      priority: "high",
      completed: false,
    });
  }

  // —— 任务 2：薄弱章节练习 —— 按阶段决定章节数
  const weakChapters = pickWeakChapters(chaptersInScope);
  const chapterSlotCount = phase === "sprint" ? 3 : phase === "high" ? 2 : phase === "light" ? 1 : 2;
  const chaptersForToday = rotateChaptersForDay(weakChapters, dayOffset, chapterSlotCount);

  chaptersForToday.forEach((ch) => {
    const questionCount = phase === "sprint" ? 5 : phase === "high" ? 8 : 5;
    const minutes = questionCount * 3;
    const hasWrong = (ch.wrong_count || 0) > 0;
    tasks.push({
      id: `task_practice_${ch.slug}_${date}`,
      type: "chapter_practice",
      title: `${ch.label} 练习 ${questionCount} 道`,
      subtitle: hasWrong ? `有 ${ch.wrong_count} 道错题未攻克` : "巩固章节内容",
      chapter: ch.slug,
      target_count: questionCount,
      target_minutes: minutes,
      priority: hasWrong && ch.wrong_count >= 3 ? "high" : "normal",
      completed: false,
    });
  });

  // —— 任务 3：模拟考 —— 仅考前 2-3 天
  if (phase === "sprint" && remainingDays >= 2 && remainingDays <= 3) {
    tasks.push({
      id: `task_mock_${date}`,
      type: "mock_exam",
      title: "限时模拟考 30 分钟",
      subtitle: "按真实节奏做一套",
      target_count: 10,
      target_minutes: 30,
      priority: "high",
      completed: false,
    });
  }

  // —— 任务 4：考前 1 天轻松回顾 ——
  if (remainingDays === 1) {
    tasks.push({
      id: `task_review_${date}`,
      type: "light_review",
      title: "轻松回顾全部重点",
      subtitle: "公式卡速览 · 不新增压力 · 早睡",
      target_minutes: 20,
      priority: "normal",
      completed: false,
    });
  }

  // —— 按硬上限裁尾：按优先级排序后累加时长到上限 ——
  return enforceDailyCap(tasks, targetMinutes);
}

function pickWeakChapters(chaptersInScope) {
  return (chaptersInScope || []).slice().sort((a, b) => (b.weakness_score || 0) - (a.weakness_score || 0));
}

function rotateChaptersForDay(weakChapters, dayOffset, slots) {
  if (weakChapters.length === 0) return [];
  const pool = weakChapters.slice(0, Math.max(slots * 2, 4));
  const out = [];
  for (let i = 0; i < slots; i++) {
    const idx = (dayOffset + i * 2) % pool.length;
    const candidate = pool[idx];
    if (candidate && !out.find((c) => c.slug === candidate.slug)) out.push(candidate);
  }
  // 如果 pool 太小导致重复，补足
  if (out.length < slots) {
    weakChapters.forEach((c) => {
      if (out.length < slots && !out.find((o) => o.slug === c.slug)) out.push(c);
    });
  }
  return out;
}

// 按优先级裁任务到每日硬上限
function enforceDailyCap(tasks, cap) {
  if (!cap || cap <= 0) return tasks;
  const sorted = [...tasks].sort((a, b) => priorityWeight(b.priority) - priorityWeight(a.priority));
  const kept = [];
  let acc = 0;
  for (const t of sorted) {
    const mins = t.target_minutes || 0;
    if (acc + mins <= cap * 1.2) { // 允许超 20%（避免过分严格）
      kept.push(t);
      acc += mins;
    }
  }
  // 恢复原顺序
  return tasks.filter((t) => kept.includes(t));
}

export function priorityWeight(p) {
  return p === "high" ? 3 : p === "normal" ? 2 : p === "low" ? 1 : 2;
}

// ────────────────────────────────────────────────────────────────────────────
// 任务完成追踪
// ────────────────────────────────────────────────────────────────────────────

export function markTaskCompleted(dateKey, taskId, result = {}) {
  storage.update("exam_plan", (plan) => {
    if (!plan || !plan.daily_plans || !plan.daily_plans[dateKey]) return plan;
    const day = { ...plan.daily_plans[dateKey] };
    day.tasks = (day.tasks || []).map((t) =>
      t.id === taskId
        ? {
            ...t,
            completed: true,
            completed_at: Date.now(),
            actual_correct: result.correct || t.actual_correct || 0,
            actual_attempted: result.attempted || t.actual_attempted || 0,
          }
        : t
    );
    day.summary = computeSummary(day);
    return { ...plan, daily_plans: { ...plan.daily_plans, [dateKey]: day } };
  }, null);
}

export function markTaskUncompleted(dateKey, taskId) {
  storage.update("exam_plan", (plan) => {
    if (!plan || !plan.daily_plans || !plan.daily_plans[dateKey]) return plan;
    const day = { ...plan.daily_plans[dateKey] };
    day.tasks = (day.tasks || []).map((t) =>
      t.id === taskId ? { ...t, completed: false, completed_at: null, actual_correct: 0, actual_attempted: 0 } : t
    );
    day.summary = computeSummary(day);
    return { ...plan, daily_plans: { ...plan.daily_plans, [dateKey]: day } };
  }, null);
}

/**
 * 未完成顺延策略：
 *   · 只自动顺延 priority: high + type: sm2_due 的任务（不滚雪球）
 *   · 其他未完成任务保持在昨天，今日 UI 显示"积压"提示让用户自己决定
 * 每次用户打开今日计划时调用即可。
 */
export function rolloverIncompleteTasks(now = new Date()) {
  const plan = storage.get("exam_plan", null);
  if (!plan || !plan.daily_plans) return;

  const today = dayKey(now);
  const yesterday = dayKey(new Date(now.getTime() - DAY));
  const yd = plan.daily_plans[yesterday];
  const td = plan.daily_plans[today];
  if (!yd || !td) return;

  const highPrioIncomplete = (yd.tasks || []).filter((t) =>
    !t.completed && (t.priority === "high" || t.type === "sm2_due") && !String(t.id).endsWith("_rollover")
  );
  if (highPrioIncomplete.length === 0) return;

  const todayIds = new Set((td.tasks || []).map((t) => t.id));
  const toRoll = highPrioIncomplete
    .filter((t) => !todayIds.has(`${t.id}_rollover`))
    .map((t) => ({ ...t, id: `${t.id}_rollover`, title: `[昨日未完成] ${t.title}`, completed: false, completed_at: null }));
  if (toRoll.length === 0) return;

  const newToday = { ...td, tasks: [...toRoll, ...(td.tasks || [])] };
  newToday.summary = computeSummary(newToday);
  storage.set("exam_plan", { ...plan, daily_plans: { ...plan.daily_plans, [today]: newToday } });
}

/**
 * 计算积压：昨天未完成的非 high 优先任务数（今日 UI 显示提示）
 */
export function countBacklog(now = new Date()) {
  const plan = storage.get("exam_plan", null);
  if (!plan || !plan.daily_plans) return 0;
  const yesterday = dayKey(new Date(now.getTime() - DAY));
  const yd = plan.daily_plans[yesterday];
  if (!yd) return 0;
  return (yd.tasks || []).filter((t) => !t.completed && t.priority !== "high" && t.type !== "sm2_due").length;
}

export { dayKey };
