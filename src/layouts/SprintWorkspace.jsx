import { useState, useMemo, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import InteractiveLab from "./InteractiveLab";
import { storage } from "../utils/storage";
import { getUserChapters } from "../utils/chapters";
import {
  generateDailyPlans,
  dayKey as planDayKey,
  markTaskCompleted,
  rolloverIncompleteTasks,
} from "../utils/planGenerator";

// =============================================================================
// 冲刺日历 —— 月视图，支持考试日标记 + 有任务的日期标小圆点 + 点击打开抽屉
// =============================================================================
function VerticalMiniCalendar({ examPlan, onDayClick, selectedDayKey }) {
  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDow = new Date(viewYear, viewMonth, 1).getDay();
  const monthLabel = `${viewYear} 年 ${viewMonth + 1} 月`;
  const todayKey = planDayKey(new Date());

  const examDateStr = examPlan && examPlan.exam_date;
  const daysUntilExam = useMemo(() => {
    if (!examDateStr) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const exam = new Date(examDateStr + "T00:00:00");
    return Math.ceil((exam - today) / 86400000);
  }, [examDateStr]);

  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  function prevMonth() {
    if (viewMonth === 0) { setViewYear((y) => y - 1); setViewMonth(11); }
    else setViewMonth((m) => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewYear((y) => y + 1); setViewMonth(0); }
    else setViewMonth((m) => m + 1);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {/* 月切换 + 距考徽章 合并一行 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <button onClick={prevMonth} style={navBtn} aria-label="上一月">‹</button>
        <div style={{ fontSize: 14, fontWeight: 700, color: "#111827", flex: 1, textAlign: "center" }}>{monthLabel}</div>
        <button onClick={nextMonth} style={navBtn} aria-label="下一月">›</button>
      </div>

      {daysUntilExam !== null && (
        <div style={{
          padding: "5px 10px",
          background: daysUntilExam <= 3 ? "#FEE2E2" : daysUntilExam <= 7 ? "#FEF3C7" : "#EEF2FF",
          borderRadius: 8, fontSize: 11.5, fontWeight: 700,
          color: daysUntilExam <= 3 ? "#991B1B" : daysUntilExam <= 7 ? "#92400E" : "#4338CA",
          textAlign: "center",
        }}>
          {daysUntilExam > 0 ? `距考试还有 ${daysUntilExam} 天` : daysUntilExam === 0 ? "🎓 今天就是考试日" : "考试已结束"}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3, textAlign: "center" }}>
        {["日", "一", "二", "三", "四", "五", "六"].map((d) => (
          <div key={d} style={{ fontSize: 11, fontWeight: 600, color: "#9CA3AF", padding: "4px 0" }}>{d}</div>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <div key={`e${i}`} style={{ aspectRatio: "1" }} />;
          const date = new Date(viewYear, viewMonth, day);
          const dk = planDayKey(date);
          const isToday = dk === todayKey;
          const isExam = examDateStr === dk;
          const isSelected = selectedDayKey === dk;
          const isPast = dk < todayKey;
          const dayPlan = examPlan && examPlan.daily_plans && examPlan.daily_plans[dk];
          const total = dayPlan ? dayPlan.tasks.length : 0;
          const done = dayPlan ? dayPlan.tasks.filter((t) => t.completed).length : 0;
          const progress = total > 0 ? done / total : 0;
          const hasPlan = total > 0;
          const isComplete = hasPlan && progress === 1;

          return (
            <button
              key={day}
              onClick={() => onDayClick && onDayClick(dk)}
              aria-label={`${viewMonth + 1}月${day}日${hasPlan ? `, ${done}/${total} 任务` : ""}${isExam ? ", 考试日" : ""}`}
              style={{
                width: "100%", aspectRatio: "1",
                borderRadius: "50%",
                fontSize: 13, fontWeight: isToday ? 700 : 500,
                cursor: "pointer",
                border: isSelected ? "2px solid #4F46E5" : "2px solid transparent",
                background: isExam ? "#EF4444" : isToday ? "#111827" : hasPlan ? "#EEF2FF" : "transparent",
                color: isExam || isToday ? "#FFF" : hasPlan ? "#4338CA" : isPast ? "#D1D5DB" : "#374151",
                padding: 0, fontFamily: "inherit", position: "relative",
                transition: "background 0.12s, border-color 0.12s",
                opacity: isPast && !hasPlan ? 0.5 : 1,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
              title={isExam ? "🎓 考试日" : hasPlan ? `${done}/${total} 任务${isComplete ? " · 已完成" : ""}` : ""}
            >
              {day}
              {/* 任务状态小圆点 */}
              {hasPlan && !isExam && (
                <span style={{
                  position: "absolute", bottom: 3, left: "50%", transform: "translateX(-50%)",
                  width: 5, height: 5, borderRadius: "50%",
                  background: isComplete ? "#10B981" : progress >= 0.5 ? "#3B82F6" : "#F59E0B",
                }} />
              )}
            </button>
          );
        })}
      </div>

      {!examDateStr && (
        <div style={{ fontSize: 11, color: "#9CA3AF", textAlign: "center", marginTop: 4 }}>
          还未设置考试日期
        </div>
      )}
    </div>
  );
}

const navBtn = {
  width: 24, height: 24, border: "none", background: "transparent",
  color: "#6B7280", cursor: "pointer", fontSize: 16, borderRadius: 6,
  fontFamily: "inherit", padding: 0,
};

// =============================================================================
// 设置考试日期的弹窗表单
// =============================================================================
// 从章节 label（如 "ODE Ch.1" / "线性代数 Ch.5" / "Ch.3"）解析学科 + 章号
function parseChapterLabel(label = "") {
  const s = String(label).trim();
  let m = s.match(/^(.+?)\s*Ch\.?\s*(\d+)\s*$/i);
  if (m) return { subject: m[1].trim(), chNum: parseInt(m[2], 10), short: `Ch.${parseInt(m[2], 10)}` };
  m = s.match(/^Ch\.?\s*(\d+)\s*$/i);
  if (m) return { subject: "通用", chNum: parseInt(m[1], 10), short: `Ch.${parseInt(m[1], 10)}` };
  return { subject: "其他", chNum: null, short: s };
}

function ExamSetupModal({ availableChapters, initial, onSave, onClose, onDelete }) {
  const [examDate, setExamDate] = useState(initial?.exam_date || "");
  const [subject, setSubject] = useState(initial?.subject || "");
  const [selectedChapters, setSelectedChapters] = useState(new Set(initial?.chapters_in_scope || []));
  const [dailyMinutes, setDailyMinutes] = useState(initial?.daily_minutes_target || 60);
  const [errors, setErrors] = useState({});
  const [collapsedGroups, setCollapsedGroups] = useState(new Set());

  const todayKey = planDayKey(new Date());

  // 按学科分组
  const chapterGroups = useMemo(() => {
    const map = new Map();
    availableChapters.forEach((ch) => {
      const parsed = parseChapterLabel(ch.label);
      const arr = map.get(parsed.subject) || [];
      arr.push({ ...ch, ...parsed });
      map.set(parsed.subject, arr);
    });
    const groups = Array.from(map.entries()).map(([subj, chapters]) => {
      chapters.sort((a, b) => (a.chNum ?? 999) - (b.chNum ?? 999));
      return {
        subject: subj,
        chapters,
        totalWrong: chapters.reduce((s, c) => s + (c.wrong_count || 0), 0),
      };
    });
    // 错题多的学科排前面，其次章节多的
    groups.sort((a, b) => b.totalWrong - a.totalWrong || b.chapters.length - a.chapters.length);
    return groups;
  }, [availableChapters]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function toggleChapter(slug) {
    setSelectedChapters((prev) => {
      const n = new Set(prev);
      n.has(slug) ? n.delete(slug) : n.add(slug);
      return n;
    });
  }
  function toggleGroup(subj) {
    setCollapsedGroups((prev) => {
      const n = new Set(prev);
      n.has(subj) ? n.delete(subj) : n.add(subj);
      return n;
    });
  }
  function toggleGroupSelect(group) {
    const slugs = group.chapters.map((c) => c.slug);
    const allSel = slugs.every((s) => selectedChapters.has(s));
    setSelectedChapters((prev) => {
      const n = new Set(prev);
      if (allSel) slugs.forEach((s) => n.delete(s));
      else slugs.forEach((s) => n.add(s));
      return n;
    });
  }
  function validate() {
    const e = {};
    if (!examDate) e.examDate = "请选择考试日期";
    else if (examDate < todayKey) e.examDate = "考试日期不能早于今天";
    if (!subject.trim()) e.subject = "请填写科目";
    if (selectedChapters.size === 0) e.chapters = "至少选一个章节";
    setErrors(e);
    return Object.keys(e).length === 0;
  }
  function handleSave() {
    if (!validate()) return;
    onSave({
      exam_date: examDate,
      subject: subject.trim(),
      chapters_in_scope: Array.from(selectedChapters),
      daily_minutes_target: dailyMinutes,
    });
  }

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 1050, animation: "mcFadeIn .15s" }} />
      <div role="dialog" aria-label="设置考试日期"
        style={{
          position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
          width: "min(540px, 92vw)", maxHeight: "85vh",
          background: "#fff", borderRadius: 16, zIndex: 1051,
          boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
          display: "flex", flexDirection: "column",
          animation: "mcPopIn .18s ease-out",
        }}>
        <header style={{ padding: "18px 22px", borderBottom: "1px solid #E5E7EB", display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 800, color: "#111" }}>
              {initial ? "修改考试计划" : "设置考试日期"}
            </div>
            {!initial && <div style={{ fontSize: 12, color: "#6B7280", marginTop: 3 }}>填完后系统会为你生成每日复习任务</div>}
          </div>
          <button onClick={onClose} aria-label="关闭" style={{ fontSize: 18, background: "transparent", border: "none", color: "#9CA3AF", cursor: "pointer", padding: 4, lineHeight: 1 }}>✕</button>
        </header>

        <div style={{ flex: 1, overflowY: "auto", padding: "18px 22px" }}>
          {/* 日期 + 科目 */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
            <label style={{ display: "block" }}>
              <span style={fieldLabel}>📅 考试日期</span>
              <input type="date" value={examDate} min={todayKey} onChange={(e) => setExamDate(e.target.value)}
                style={{ ...fieldInput, borderColor: errors.examDate ? "#EF4444" : "#E5E7EB" }} />
              {errors.examDate && <div style={errMsg}>{errors.examDate}</div>}
            </label>
            <label style={{ display: "block" }}>
              <span style={fieldLabel}>📚 科目名称</span>
              <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="如：数值分析期末"
                style={{ ...fieldInput, borderColor: errors.subject ? "#EF4444" : "#E5E7EB" }} />
              {errors.subject && <div style={errMsg}>{errors.subject}</div>}
            </label>
          </div>

          {/* 章节 —— 按学科分组，列表式 disclosure row */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={fieldLabel}>
                📖 考试范围
                <span style={{ marginLeft: 6, color: "#9CA3AF", fontWeight: 500 }}>
                  ({selectedChapters.size} / {availableChapters.length} 已选)
                </span>
              </span>
              {availableChapters.length > 0 && (
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => setSelectedChapters(new Set(availableChapters.map((c) => c.slug)))}
                    style={miniBtn}>全选</button>
                  <button onClick={() => setSelectedChapters(new Set())}
                    style={miniBtn}>清空</button>
                </div>
              )}
            </div>
            {availableChapters.length === 0 ? (
              <div style={{ fontSize: 12.5, color: "#6B7280", padding: "16px 12px", background: "#F9FAFB", borderRadius: 10, textAlign: "center" }}>
                还没有章节数据。先去上传资料或答几道题，章节会自动出现
              </div>
            ) : (
              <div style={{
                maxHeight: "min(360px, 48vh)", overflowY: "auto",
                border: "1px solid #E5E7EB", borderRadius: 10,
                background: "#fff",
              }}>
                {chapterGroups.map((group, idx) => {
                  const selInGroup = group.chapters.filter((c) => selectedChapters.has(c.slug)).length;
                  const total = group.chapters.length;
                  const allSel = selInGroup === total && total > 0;
                  const noneSel = selInGroup === 0;
                  const collapsed = collapsedGroups.has(group.subject);
                  const isLast = idx === chapterGroups.length - 1;
                  return (
                    <div key={group.subject} style={{ borderBottom: isLast ? "none" : "1px solid #F3F4F6" }}>
                      {/* 组头：整行可点击折叠 */}
                      <div
                        onClick={() => toggleGroup(group.subject)}
                        role="button" tabIndex={0}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleGroup(group.subject); } }}
                        style={{
                          display: "flex", alignItems: "center", gap: 8,
                          padding: "10px 12px", cursor: "pointer",
                          background: "transparent", userSelect: "none",
                          transition: "background .12s",
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "#FAFAFA"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                      >
                        <span style={{
                          width: 14, display: "inline-block", fontSize: 10, color: "#9CA3AF",
                          transition: "transform .15s",
                          transform: collapsed ? "rotate(-90deg)" : "rotate(0)",
                        }}>▼</span>
                        <span style={{ fontSize: 13.5, fontWeight: 700, color: "#111" }}>{group.subject}</span>
                        <span style={{
                          fontSize: 11, fontWeight: 600,
                          color: allSel ? "#4F46E5" : noneSel ? "#9CA3AF" : "#6B7280",
                        }}>{selInGroup}/{total}</span>
                        {group.totalWrong > 0 && (
                          <span style={{ fontSize: 10, background: "#FEE2E2", color: "#991B1B", padding: "1px 7px", borderRadius: 999, fontWeight: 700 }}>
                            {group.totalWrong} 错
                          </span>
                        )}
                        <span style={{ flex: 1 }} />
                        <button onClick={(e) => { e.stopPropagation(); toggleGroupSelect(group); }}
                          style={{
                            fontSize: 11, padding: "3px 10px", borderRadius: 6, cursor: "pointer", fontFamily: "inherit", fontWeight: 600,
                            border: "1px solid " + (allSel ? "#4F46E5" : "#E5E7EB"),
                            background: allSel ? "#4F46E5" : "#fff",
                            color: allSel ? "#fff" : (noneSel ? "#6B7280" : "#4F46E5"),
                            whiteSpace: "nowrap",
                          }}>
                          {allSel ? "✓ 全选" : noneSel ? "选本组" : "补齐"}
                        </button>
                      </div>
                      {/* 组内 chip 列表 */}
                      {!collapsed && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "0 14px 12px 34px" }}>
                          {group.chapters.map((ch) => {
                            const sel = selectedChapters.has(ch.slug);
                            return (
                              <button key={ch.slug} onClick={() => toggleChapter(ch.slug)}
                                style={{
                                  padding: "5px 11px", borderRadius: 7,
                                  border: "1.5px solid " + (sel ? "#4F46E5" : "#E5E7EB"),
                                  background: sel ? "#4F46E5" : "#fff",
                                  color: sel ? "#fff" : "#374151",
                                  fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
                                  display: "inline-flex", alignItems: "center", gap: 5,
                                  lineHeight: 1.3, transition: "all .1s",
                                }}
                                title={ch.label}>
                                {ch.short}
                                {ch.wrong_count > 0 && (
                                  <span style={{ fontSize: 9.5, background: sel ? "rgba(255,255,255,0.22)" : "#FEE2E2", color: sel ? "#fff" : "#991B1B", padding: "0 5px", borderRadius: 10, fontWeight: 700 }}>
                                    {ch.wrong_count}
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {errors.chapters && <div style={errMsg}>{errors.chapters}</div>}
          </div>

          {/* 每日时长 */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <span style={fieldLabel}>⏱️ 每日学习时长</span>
              <span style={{ fontSize: 14, fontWeight: 800, color: "#4F46E5" }}>{dailyMinutes} 分钟</span>
            </div>
            <input type="range" min="20" max="180" step="10" value={dailyMinutes}
              onChange={(e) => setDailyMinutes(parseInt(e.target.value, 10))}
              style={{ width: "100%", accentColor: "#4F46E5" }} />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: "#9CA3AF", marginTop: 4 }}>
              <span>20 · 轻度</span><span>60 · 常规</span><span>120 · 高强</span><span>180 · 冲刺</span>
            </div>
            <div style={{ fontSize: 11.5, color: "#6B7280", marginTop: 6 }}>
              上限内系统按优先级保留任务，超出部分会被自动精简
            </div>
          </div>
        </div>

        <footer style={{ padding: "14px 22px", borderTop: "1px solid #E5E7EB", display: "flex", gap: 10, justifyContent: "flex-end" }}>
          {initial && onDelete && (
            <button onClick={() => { if (window.confirm("确定删除当前考试计划？已完成任务记录会清除")) onDelete(); }}
              style={{ padding: "9px 14px", background: "#FEE2E2", color: "#991B1B", border: "none", borderRadius: 10, cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: "inherit", marginRight: "auto" }}>
              删除计划
            </button>
          )}
          <button onClick={onClose} style={{ padding: "9px 16px", background: "#fff", color: "#6B7280", border: "1px solid #E5E7EB", borderRadius: 10, cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: "inherit" }}>取消</button>
          <button onClick={handleSave} style={{ padding: "9px 20px", background: "#4F46E5", color: "#fff", border: "none", borderRadius: 10, cursor: "pointer", fontSize: 13, fontWeight: 700, fontFamily: "inherit", boxShadow: "0 4px 12px rgba(79,70,229,0.3)" }}>
            {initial ? "保存并重新生成" : "生成复习计划"}
          </button>
        </footer>
      </div>
      <SprintAnimations />
    </>
  );
}

const fieldLabel = { fontSize: 12, fontWeight: 700, color: "#374151", display: "inline-block", marginBottom: 5 };
const fieldInput = { width: "100%", padding: "9px 12px", borderRadius: 9, border: "1.5px solid #E5E7EB", fontSize: 13, fontFamily: "inherit", boxSizing: "border-box", outline: "none" };
const errMsg = { fontSize: 11, color: "#DC2626", marginTop: 4, fontWeight: 600 };
const miniBtn = { fontSize: 11, padding: "3px 9px", background: "transparent", border: "1px solid #E5E7EB", borderRadius: 999, cursor: "pointer", color: "#6B7280", fontFamily: "inherit", fontWeight: 600 };

// =============================================================================
// 日详情抽屉 —— 点击日历任一日期打开
// =============================================================================
function DayDetailDrawer({ dayKey, examPlan, onClose, onRefresh, onStartTask }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const todayKey = planDayKey(new Date());
  const isToday = dayKey === todayKey;
  const isPast = dayKey < todayKey;
  const isFuture = dayKey > todayKey;
  const isExamDay = examPlan && examPlan.exam_date === dayKey;
  const dayPlan = examPlan && examPlan.daily_plans && examPlan.daily_plans[dayKey];

  const date = new Date(dayKey + "T00:00:00");
  const weekday = ["日","一","二","三","四","五","六"][date.getDay()];
  const daysFromToday = Math.round((date - new Date(todayKey + "T00:00:00")) / 86400000);

  const phaseMeta = {
    light:  { label: "铺垫期", desc: "打基础，不用太紧张", color: "#14B8A6", bg: "#D1FAE5" },
    normal: { label: "常规期", desc: "按部就班推进",       color: "#10B981", bg: "#D1FAE5" },
    high:   { label: "强化期", desc: "进入高强度练习",     color: "#3B82F6", bg: "#DBEAFE" },
    sprint: { label: "冲刺期", desc: "错题 + 模拟为主",    color: "#DC2626", bg: "#FEE2E2" },
  };

  function handleTaskComplete(task) {
    markTaskCompleted(dayKey, task.id, { attempted: task.target_count || 0, correct: task.target_count || 0 });
    onRefresh && onRefresh();
  }

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 1040, animation: "mcFadeIn .15s" }} />
      <aside role="dialog" aria-label="当日计划详情"
        style={{ position: "fixed", top: 0, right: 0, height: "100vh", width: "min(460px, 100vw)", background: "#fff", boxShadow: "-6px 0 24px rgba(0,0,0,0.12)", zIndex: 1041, display: "flex", flexDirection: "column", animation: "mcSlideInRight .22s ease-out" }}>
        <header style={{ padding: "18px 20px", borderBottom: "1px solid #E5E7EB", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#111" }}>{date.getMonth() + 1} 月 {date.getDate()} 日 · 周{weekday}</div>
            <div style={{ fontSize: 12.5, color: "#6B7280", marginTop: 3 }}>
              {isToday && <span style={{ color: "#4F46E5", fontWeight: 700 }}>今天</span>}
              {isPast && `已过 ${Math.abs(daysFromToday)} 天`}
              {isFuture && `${daysFromToday} 天后`}
              {isExamDay && <span style={{ marginLeft: 8, color: "#92400E", fontWeight: 700 }}>🎓 考试日</span>}
            </div>
          </div>
          <button onClick={onClose} aria-label="关闭" style={{ fontSize: 18, background: "transparent", border: "none", color: "#9CA3AF", cursor: "pointer", padding: 4, lineHeight: 1 }}>✕</button>
        </header>

        <div style={{ flex: 1, overflowY: "auto", padding: "18px 20px" }}>
          {isExamDay ? (
            <div style={{ textAlign: "center", padding: "40px 10px" }}>
              <div style={{ fontSize: 48, marginBottom: 10 }}>🎓</div>
              <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 6 }}>考试日</div>
              <div style={{ fontSize: 13, color: "#6B7280" }}>今天不安排复习任务，祝你考试顺利！</div>
            </div>
          ) : !dayPlan ? (
            <div style={{ textAlign: "center", padding: "40px 10px" }}>
              <div style={{ fontSize: 32, marginBottom: 8, opacity: 0.6 }}>📅</div>
              <div style={{ fontSize: 13, color: "#6B7280" }}>
                {isPast ? "这一天没有计划任务" : isFuture ? "这一天的任务会在接近时生成" : "暂无任务"}
              </div>
            </div>
          ) : (
            <>
              {(() => {
                const ph = phaseMeta[dayPlan.phase] || phaseMeta.normal;
                const total = dayPlan.tasks.length;
                const done = dayPlan.tasks.filter((t) => t.completed).length;
                const totalMin = dayPlan.tasks.reduce((s, t) => s + (t.target_minutes || 0), 0);
                const doneMin = dayPlan.tasks.filter((t) => t.completed).reduce((s, t) => s + (t.target_minutes || 0), 0);
                return (
                  <section style={{ marginBottom: 18 }}>
                    <div style={{ display: "inline-block", padding: "3px 10px", background: ph.bg, color: ph.color, borderRadius: 999, fontSize: 11.5, fontWeight: 700, marginBottom: 6 }}>{ph.label}</div>
                    <div style={{ fontSize: 12.5, color: "#6B7280", marginBottom: 10 }}>{ph.desc}</div>
                    <div style={{ height: 8, background: "#F3F4F6", borderRadius: 999, overflow: "hidden", marginBottom: 6 }}>
                      <div style={{ height: "100%", width: total > 0 ? `${(done / total) * 100}%` : "0%", background: `linear-gradient(90deg, ${ph.color}, ${ph.color}dd)`, transition: "width .3s" }} />
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "#6B7280" }}>
                      <span>{done}/{total} 任务</span>
                      <span>{doneMin}/{totalMin} 分钟</span>
                    </div>
                  </section>
                );
              })()}

              <section>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#6B7280", marginBottom: 8, letterSpacing: "0.05em" }}>任务列表</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {dayPlan.tasks.map((task) => (
                    <DrawerTaskItem key={task.id} task={task} isToday={isToday} isPast={isPast}
                      onStart={() => onStartTask(task)} onComplete={() => handleTaskComplete(task)} />
                  ))}
                </div>
              </section>

              {dayPlan.dropped_count > 0 && (
                <section style={{ marginTop: 14, padding: "8px 12px", background: "#F3F4F6", borderRadius: 8, fontSize: 11.5, color: "#6B7280" }}>
                  💡 按当前时长上限，这一天省略了 {dayPlan.dropped_count} 个低优任务
                </section>
              )}
            </>
          )}
        </div>
      </aside>
      <SprintAnimations />
    </>
  );
}

function DrawerTaskItem({ task, isToday, isPast, onStart, onComplete }) {
  const icons = { sm2_due: "🔁", chapter_practice: "📝", concept_study: "📖", mock_exam: "⏱️", light_review: "🧘", wrong_review: "❌" };
  const prioColor = task.priority === "high" ? "#DC2626" : task.priority === "low" ? "#94A3B8" : "#4F46E5";
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12, padding: "10px 12px",
      background: task.completed ? "#F9FAFB" : "#fff",
      border: "1px solid #E5E7EB",
      borderLeft: `3px solid ${task.completed ? "#D1D5DB" : prioColor}`,
      borderRadius: 10, opacity: task.completed ? 0.7 : 1,
    }}>
      <div style={{ fontSize: 20, flexShrink: 0 }}>{icons[task.type] || "•"}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: task.completed ? "#9CA3AF" : "#111", textDecoration: task.completed ? "line-through" : "none" }}>{task.title}</div>
        {task.subtitle && <div style={{ fontSize: 11.5, color: "#888", marginTop: 2 }}>{task.subtitle}</div>}
        <div style={{ fontSize: 11, color: "#aaa", marginTop: 3, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <span>⏱ {task.target_minutes || 0} 分钟</span>
          {task.priority === "high" && <span style={{ color: "#DC2626", fontWeight: 700 }}>高优</span>}
          {task._rolled_from && <span style={{ color: "#B45309", fontWeight: 700 }}>昨日顺延</span>}
        </div>
      </div>
      {task.completed ? (
        <span style={{ fontSize: 12, fontWeight: 700, color: "#047857", background: "#D1FAE5", padding: "4px 10px", borderRadius: 8, flexShrink: 0 }}>✓ 已完成</span>
      ) : isToday ? (
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <button onClick={onStart} style={{ padding: "6px 14px", background: "#4F46E5", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 12.5, fontWeight: 700, fontFamily: "inherit" }}>开始</button>
          <button onClick={onComplete} title="手动标记为已完成" style={{ padding: "6px 10px", background: "#fff", color: "#6B7280", border: "1px solid #E5E7EB", borderRadius: 8, cursor: "pointer", fontSize: 12.5, fontFamily: "inherit" }}>✓</button>
        </div>
      ) : isPast ? (
        <span style={{ fontSize: 11.5, color: "#9CA3AF", background: "#F3F4F6", padding: "3px 10px", borderRadius: 8, flexShrink: 0 }}>未完成</span>
      ) : (
        <span style={{ fontSize: 11.5, color: "#6B7280", background: "#EEF2FF", padding: "3px 10px", borderRadius: 8, flexShrink: 0 }}>待开启</span>
      )}
    </div>
  );
}

function SprintAnimations() {
  useEffect(() => {
    const id = "mc-sprint-anim-style";
    if (document.getElementById(id)) return;
    const style = document.createElement("style");
    style.id = id;
    style.textContent = `
      @keyframes mcFadeIn { from { opacity: 0 } to { opacity: 1 } }
      @keyframes mcSlideInRight { from { transform: translateX(100%) } to { transform: translateX(0) } }
      @keyframes mcPopIn { from { transform: translate(-50%,-50%) scale(.92); opacity: 0 } to { transform: translate(-50%,-50%) scale(1); opacity: 1 } }
    `;
    document.head.appendChild(style);
  }, []);
  return null;
}

// =============================================================================
// 主组件
// =============================================================================
export default function SprintWorkspace({ chatPage, quizPage, onViewWrong, allQuestions = [], onStartTask }) {
  const [rightPanelMode, setRightPanelMode] = useState("chat");
  const [setupOpen, setSetupOpen] = useState(false);
  const [selectedDayKey, setSelectedDayKey] = useState(null);
  const [tick, setTick] = useState(0); // 驱动 re-read storage

  void tick;
  const examPlan = storage.get("exam_plan", null);

  // 进入页面时跑一次顺延
  useEffect(() => {
    if (examPlan) rolloverIncompleteTasks();
    setTick((v) => v + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const availableChapters = useMemo(() => getUserChapters(allQuestions), [allQuestions]);

  function refresh() { setTick((v) => v + 1); }

  function handleSave(values) {
    // 写 localStorage（保持和 ReportPage 那边的读取逻辑一致）
    localStorage.setItem("mc_exam_date", values.exam_date);
    localStorage.setItem("mc_exam_subject", values.subject);
    localStorage.setItem("mc_exam_chapters", JSON.stringify(values.chapters_in_scope));
    localStorage.setItem("mc_daily_minutes", String(values.daily_minutes_target));

    // 生成每日计划
    const chaptersInScope = availableChapters.filter((c) => values.chapters_in_scope.includes(c.slug));
    const oldPlan = storage.get("exam_plan", null);
    const fresh = generateDailyPlans({
      examDate: values.exam_date,
      chaptersInScope,
      dailyMinutesTarget: values.daily_minutes_target,
    });
    // 合并：保留旧计划里的已完成状态
    const merged = {};
    Object.keys(fresh).forEach((dk) => {
      const freshDay = fresh[dk];
      const oldDay = oldPlan && oldPlan.daily_plans && oldPlan.daily_plans[dk];
      if (!oldDay) { merged[dk] = freshDay; return; }
      const oldMap = new Map((oldDay.tasks || []).map((t) => [t.id, t]));
      const tasks = (freshDay.tasks || []).map((t) => {
        const old = oldMap.get(t.id);
        if (old && old.completed) return { ...t, completed: true, completed_at: old.completed_at, actual_correct: old.actual_correct, actual_attempted: old.actual_attempted };
        return t;
      });
      merged[dk] = {
        ...freshDay, tasks,
        summary: {
          total_tasks: tasks.length,
          completed_tasks: tasks.filter((t) => t.completed).length,
          total_minutes: tasks.reduce((s, x) => s + (x.target_minutes || 0), 0),
          completed_minutes: tasks.filter((t) => t.completed).reduce((s, x) => s + (x.target_minutes || 0), 0),
        },
      };
    });

    storage.set("exam_plan", {
      exam_date: values.exam_date,
      subject: values.subject,
      chapters_in_scope: values.chapters_in_scope,
      daily_minutes_target: values.daily_minutes_target,
      daily_plans: merged,
      plan_generated_at: Date.now(),
      plan_version: 1,
    });

    setSetupOpen(false);
    refresh();
  }

  function handleDelete() {
    ["mc_exam_date","mc_exam_subject","mc_exam_chapters","mc_daily_minutes"].forEach((k) => localStorage.removeItem(k));
    storage.remove("exam_plan");
    setSetupOpen(false);
    refresh();
  }

  function handleStartTaskInternal(task) {
    if (!task) return;
    onStartTask && onStartTask(task);
    if (task.type === "concept_study") setRightPanelMode("chat");
    else setRightPanelMode("quiz");
    setSelectedDayKey(null);
  }

  const hasPlan = !!examPlan;

  return (
    <div style={{ display: "flex", flex: 1, padding: 24, gap: 24, overflow: "hidden", boxSizing: "border-box" }}>
      <div style={{ width: 320, flexShrink: 0, display: "flex", flexDirection: "column", gap: 24 }}>
        <div className="premium-card" style={{ flex: "1 1 auto", padding: 16, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexShrink: 0 }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#111827" }}>冲刺日历</h3>
            <button onClick={() => setSetupOpen(true)} title={hasPlan ? "修改考试计划" : "设置考试日期"}
              style={{
                padding: "5px 10px", borderRadius: 8, border: "1px solid #E5E7EB",
                background: hasPlan ? "#fff" : "#4F46E5", color: hasPlan ? "#374151" : "#fff",
                fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                boxShadow: hasPlan ? "none" : "0 2px 8px rgba(79,70,229,0.3)",
              }}>
              {hasPlan ? "⚙️ 修改" : "⚙️ 设置"}
            </button>
          </div>

          {!hasPlan && (
            // 紧凑 CTA 横幅：放在日历上方，不占用日历空间
            <div style={{
              background: "linear-gradient(135deg,#EEF2FF,#F0F9FF)",
              border: "1.5px dashed #C7D2FE", borderRadius: 10,
              padding: "10px 12px", marginBottom: 12,
              display: "flex", alignItems: "center", gap: 10, flexShrink: 0,
            }}>
              <div style={{ fontSize: 22, lineHeight: 1 }}>🎯</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: "#111", lineHeight: 1.3 }}>还没有考试计划</div>
                <div style={{ fontSize: 10.5, color: "#6B7280", lineHeight: 1.4, marginTop: 1 }}>
                  告诉系统考试哪天、复习哪几章
                </div>
              </div>
              <button onClick={() => setSetupOpen(true)}
                style={{ padding: "6px 11px", background: "#4F46E5", color: "#fff", border: "none", borderRadius: 7, cursor: "pointer", fontSize: 11.5, fontWeight: 700, fontFamily: "inherit", whiteSpace: "nowrap", boxShadow: "0 2px 6px rgba(79,70,229,0.3)" }}>
                设置
              </button>
            </div>
          )}
          <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
            <VerticalMiniCalendar
              examPlan={examPlan}
              selectedDayKey={selectedDayKey}
              onDayClick={setSelectedDayKey}
            />
          </div>
        </div>

        <div className="premium-card" style={{ flex: "0 0 auto", padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
          <h3 style={{ margin: "0 0 2px 0", fontSize: 15, fontWeight: 700, color: "#111827" }}>目标与错题</h3>
          <button onClick={() => setRightPanelMode("chat")}
            style={{
              padding: "9px 12px", textAlign: "center", borderRadius: 10, border: "none", cursor: "pointer",
              fontWeight: 600, fontSize: 13, fontFamily: "inherit", transition: "background 0.12s",
              background: rightPanelMode === "chat" ? "#111827" : "#F3F4F6",
              color: rightPanelMode === "chat" ? "#FFFFFF" : "#111827",
            }}>
            🤖 AI 复习对讲
          </button>
          <button onClick={() => setRightPanelMode("quiz")}
            style={{
              padding: "9px 12px", textAlign: "center", borderRadius: 10, border: "none", cursor: "pointer",
              fontWeight: 600, fontSize: 13, fontFamily: "inherit", transition: "background 0.12s",
              background: rightPanelMode === "quiz" ? "#10B981" : "#F3F4F6",
              color: rightPanelMode === "quiz" ? "#FFFFFF" : "#111827",
            }}>
            🧩 AI 出题检测
          </button>
          <button onClick={onViewWrong}
            style={{ padding: "9px 12px", textAlign: "center", background: "#F3F4F6", borderRadius: 10, border: "none", cursor: "pointer", fontWeight: 600, fontSize: 13, color: "#111827", fontFamily: "inherit" }}>
            📝 进入错题本
          </button>

          <div style={{ paddingTop: 8, marginTop: 2, borderTop: "1px solid #F3F4F6" }}>
            {(() => {
              const today = planDayKey(new Date());
              const todayPlan = examPlan && examPlan.daily_plans && examPlan.daily_plans[today];
              if (!todayPlan || todayPlan.tasks.length === 0) {
                return (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 11.5, color: "#9CA3AF" }}>今日目标</span>
                    <span style={{ fontSize: 12, color: "#9CA3AF" }}>暂无任务</span>
                  </div>
                );
              }
              const done = todayPlan.tasks.filter((t) => t.completed).length;
              const total = todayPlan.tasks.length;
              const pct = Math.round((done / total) * 100);
              return (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                    <span style={{ fontSize: 11.5, color: "#6B7280", fontWeight: 600 }}>今日 · {done}/{total} 任务</span>
                    <span style={{ fontSize: 11, color: pct >= 100 ? "#047857" : "#4F46E5", fontWeight: 700 }}>{pct}%</span>
                  </div>
                  <div style={{ height: 5, borderRadius: 3, background: "#E5E7EB", overflow: "hidden" }}>
                    <div style={{ width: `${pct}%`, height: "100%", borderRadius: 3, background: pct >= 100 ? "#10B981" : "#4F46E5", transition: "width 0.3s" }} />
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      </div>

      <div className="premium-card" style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", borderRadius: 24 }}>
        <AnimatePresence mode="wait">
          <motion.div key={rightPanelMode}
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}
            style={{ height: "100%", width: "100%", display: "flex", flexDirection: "column" }}>
            {rightPanelMode === "chat" ? (
              chatPage
            ) : (
              <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
                <div style={{ padding: "16px 24px", borderBottom: "1px solid #E5E7EB", display: "flex", alignItems: "center", flexShrink: 0 }}>
                  <h2 style={{ fontSize: 18, margin: 0, fontWeight: 700, color: "#111827" }}>AI 出题检测</h2>
                </div>
                <div style={{ flex: 1, overflowY: "auto" }}>{quizPage}</div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
      <InteractiveLab />

      {/* Modal + Drawer */}
      {setupOpen && (
        <ExamSetupModal
          availableChapters={availableChapters}
          initial={examPlan}
          onSave={handleSave}
          onClose={() => setSetupOpen(false)}
          onDelete={examPlan ? handleDelete : undefined}
        />
      )}
      {selectedDayKey && (
        <DayDetailDrawer
          dayKey={selectedDayKey}
          examPlan={examPlan}
          onClose={() => setSelectedDayKey(null)}
          onRefresh={refresh}
          onStartTask={handleStartTaskInternal}
        />
      )}
    </div>
  );
}
