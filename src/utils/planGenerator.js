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

// 本地时区 YYYY-MM-DD。不能用 toISOString().slice(0,10)：
// 在非 UTC 时区午夜前后会把 23:59 的结果算到"昨天"或"明天"，任务会飘。
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

    let tasks = [];
    let dropped = 0;
    if (isExamDay) {
      tasks = [{ id: `exam_${key}`, type: "exam", title: "🎓 考试日！加油！", subtitle: "相信自己，沉着作答", priority: "high", target_minutes: 0, completed: false }];
    } else if (!isPast) {
      const out = generateDayTasks({ date: key, phase, remainingDays, chaptersInScope, targetMinutes: dailyMinutesTarget, dayOffset: offset });
      tasks = out.tasks;
      dropped = out.dropped;
    }
    plans[key] = {
      date: key,
      phase,
      remainingDays: exam ? remainingDays : null,
      tasks,
      dropped_count: dropped,
      backlog: [],       // 由 rolloverIncompleteTasks 写入
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

  // —— 按硬上限裁尾：优先级 + SM2 最高优 + chapter_practice 超时可缩减题数 ——
  return enforceTimeBudget(tasks, targetMinutes); // { tasks, dropped }
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

// 按预算砍尾：
//   · SM2 到期任务永远最高优（不砍、不缩）
//   · 按 priority 降序累加
//   · 超预算时尝试缩减 chapter_practice 的题数（每题 3 分钟）而不是整个丢
//   · 其他类型超预算直接丢弃
// 返回 { tasks, dropped }，tasks 保持原对象顺序（UI 稳定）
export function enforceTimeBudget(tasks, budgetMinutes) {
  if (!budgetMinutes || budgetMinutes <= 0) return { tasks: [...tasks], dropped: 0 };
  const sorted = [...tasks].sort((a, b) => {
    if (a.type === "sm2_due" && b.type !== "sm2_due") return -1;
    if (b.type === "sm2_due" && a.type !== "sm2_due") return 1;
    return priorityWeight(b.priority) - priorityWeight(a.priority);
  });

  const keptById = new Map();
  let used = 0;
  let dropped = 0;

  for (const t of sorted) {
    const mins = t.target_minutes || 0;
    if (t.type === "sm2_due") {
      keptById.set(t.id, t); used += mins; continue; // 永远保留
    }
    if (used + mins <= budgetMinutes) {
      keptById.set(t.id, t); used += mins; continue;
    }
    // 超预算：尝试缩减 chapter_practice 题数
    if (t.type === "chapter_practice") {
      const remain = budgetMinutes - used;
      if (remain >= 6) {
        const reducedCount = Math.floor(remain / 3);
        if (reducedCount >= 2) {
          keptById.set(t.id, {
            ...t,
            target_count: reducedCount,
            target_minutes: reducedCount * 3,
            title: t.title.replace(/\d+/, reducedCount),
            _budget_adjusted: true,
          });
          used = budgetMinutes;
          continue;
        }
      }
    }
    dropped += 1;
  }

  // 保持原顺序（UI 稳定）
  const resultTasks = tasks.filter((t) => keptById.has(t.id)).map((t) => keptById.get(t.id));
  return { tasks: resultTasks, dropped };
}

// 便捷包装：返回纯 tasks 数组（已废弃 _dropped_count 的调用方用这个）
export function enforceDailyCap(tasks, budgetMinutes) {
  return enforceTimeBudget(tasks, budgetMinutes).tasks;
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
 * 顺延策略（决策 4）：
 *   · sm2_due 类型 + priority: high 的任务 → 自动顺延到今日任务列表（加 [昨日] 前缀）
 *   · 其他未完成任务 → 写入 today.backlog，由 UI banner 展示，用户自己决定"添加到今日"或"跳过"
 * 返回 { auto_rolled, backlog }
 */
export function rolloverIncompleteTasks(now = new Date()) {
  const plan = storage.get("exam_plan", null);
  if (!plan || !plan.daily_plans) return { auto_rolled: 0, backlog: [] };

  const today = dayKey(now);
  const yesterday = dayKey(new Date(now.getTime() - DAY));
  const yd = plan.daily_plans[yesterday];
  const td = plan.daily_plans[today];
  if (!yd || !td) return { auto_rolled: 0, backlog: [] };

  const incomplete = (yd.tasks || []).filter((t) => !t.completed && !String(t.id).endsWith("_r"));
  if (incomplete.length === 0) return { auto_rolled: 0, backlog: td.backlog || [] };

  // 分类：sm2_due / priority:high 自动顺延，其余入 backlog
  const autoRoll = incomplete.filter((t) => t.type === "sm2_due" || t.priority === "high");
  const backlog = incomplete.filter((t) => t.type !== "sm2_due" && t.priority !== "high").map((t) => ({
    id: t.id,
    title: t.title,
    type: t.type,
    chapter: t.chapter || null,
    from_date: yesterday,
    target_minutes: t.target_minutes || 0,
    priority: t.priority || "normal",
  }));

  const existingIds = new Set((td.tasks || []).map((tt) => tt.id));
  const toRoll = autoRoll
    .filter((t) => !existingIds.has(`${t.id}_r`))
    .map((t) => ({ ...t, id: `${t.id}_r`, title: `[昨日] ${t.title}`, completed: false, completed_at: null, _rolled_from: yesterday }));

  const cap = plan.daily_minutes_target || 60;
  const mergedTasks = [...toRoll, ...(td.tasks || [])];
  // 顺延后再裁一次预算（避免超时）
  const { tasks: finalTasks, dropped } = enforceTimeBudget(mergedTasks, cap);

  const newToday = { ...td, tasks: finalTasks, backlog, dropped_count: (td.dropped_count || 0) + dropped };
  newToday.summary = computeSummary(newToday);
  storage.set("exam_plan", { ...plan, daily_plans: { ...plan.daily_plans, [today]: newToday } });

  return { auto_rolled: toRoll.length, backlog };
}

/**
 * 把 backlog 里的任务加入今日任务列表（用户点"添加到今日"时）
 * 返回添加的任务数
 */
export function importBacklogToToday(now = new Date()) {
  const plan = storage.get("exam_plan", null);
  if (!plan || !plan.daily_plans) return 0;
  const today = dayKey(now);
  const td = plan.daily_plans[today];
  if (!td || !(td.backlog || []).length) return 0;

  const existingIds = new Set((td.tasks || []).map((t) => t.id));
  const backlogAsTasks = td.backlog
    .filter((b) => !existingIds.has(`${b.id}_imported`))
    .map((b) => ({
      id: `${b.id}_imported`,
      type: b.type,
      title: `[补做] ${b.title}`,
      chapter: b.chapter,
      target_minutes: b.target_minutes,
      target_count: Math.max(1, Math.round((b.target_minutes || 6) / 3)),
      priority: "normal",
      completed: false,
    }));
  if (backlogAsTasks.length === 0) return 0;

  const cap = plan.daily_minutes_target || 60;
  const { tasks: finalTasks, dropped } = enforceTimeBudget([...(td.tasks || []), ...backlogAsTasks], cap);
  const newToday = { ...td, tasks: finalTasks, backlog: [], dropped_count: (td.dropped_count || 0) + dropped };
  newToday.summary = computeSummary(newToday);
  storage.set("exam_plan", { ...plan, daily_plans: { ...plan.daily_plans, [today]: newToday } });
  return backlogAsTasks.length;
}

/**
 * 用户选择"跳过"积压：清空 today.backlog
 */
export function dismissBacklog(now = new Date()) {
  const plan = storage.get("exam_plan", null);
  if (!plan || !plan.daily_plans) return;
  const today = dayKey(now);
  const td = plan.daily_plans[today];
  if (!td) return;
  storage.set("exam_plan", { ...plan, daily_plans: { ...plan.daily_plans, [today]: { ...td, backlog: [] } } });
}

/**
 * 计算积压任务数（从 today.backlog 读，不再扫昨天）
 */
export function countBacklog(now = new Date()) {
  const plan = storage.get("exam_plan", null);
  if (!plan || !plan.daily_plans) return 0;
  const today = dayKey(now);
  const td = plan.daily_plans[today];
  return td && Array.isArray(td.backlog) ? td.backlog.length : 0;
}

export function getTodayBacklog(now = new Date()) {
  const plan = storage.get("exam_plan", null);
  if (!plan || !plan.daily_plans) return [];
  const today = dayKey(now);
  const td = plan.daily_plans[today];
  return (td && td.backlog) || [];
}

export { dayKey };
