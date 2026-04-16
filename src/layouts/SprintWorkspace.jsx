import { useState, useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";

function VerticalMiniCalendar() {
  const [selectedDate, setSelectedDate] = useState(new Date().getDate());
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDow = new Date(year, month, 1).getDay();
  const monthName = `${year} 年 ${month + 1} 月`;

  const examDateStr = typeof localStorage !== "undefined" ? localStorage.getItem("mc_exam_date") : null;
  const examDay = useMemo(() => {
    if (!examDateStr) return null;
    const d = new Date(examDateStr);
    if (d.getFullYear() === year && d.getMonth() === month) return d.getDate();
    return null;
  }, [examDateStr, year, month]);

  const daysUntilExam = useMemo(() => {
    if (!examDateStr) return null;
    return Math.ceil((new Date(examDateStr) - new Date()) / 86400000);
  }, [examDateStr]);

  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: "#111827", textAlign: "center" }}>{monthName}</div>
      {daysUntilExam !== null && (
        <div style={{ padding: "8px 12px", background: "#FEF3C7", borderRadius: 10, fontSize: 12, fontWeight: 600, color: "#92400E", textAlign: "center" }}>
          距离考试还有 {daysUntilExam > 0 ? daysUntilExam : 0} 天
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, textAlign: "center" }}>
        {["日", "一", "二", "三", "四", "五", "六"].map((d) => (
          <div key={d} style={{ fontSize: 10, fontWeight: 600, color: "#9CA3AF", padding: 4 }}>{d}</div>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <div key={`e${i}`} />;
          const isToday = day === now.getDate();
          const isExam = day === examDay;
          const isSelected = day === selectedDate;
          return (
            <div
              key={day}
              onClick={() => setSelectedDate(day)}
              style={{
                width: 32, height: 32, lineHeight: "32px",
                borderRadius: "50%", fontSize: 12, fontWeight: isToday ? 700 : 500, cursor: "pointer",
                margin: "0 auto",
                background: isSelected ? "#111827" : isExam ? "#EF4444" : isToday ? "#E5E7EB" : "transparent",
                color: isSelected || isExam ? "#FFF" : isToday ? "#111827" : "#374151",
                transition: "background 0.12s",
              }}
            >
              {day}
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 11, color: "#9CA3AF", textAlign: "center" }}>点击日期查看当天计划</div>
    </div>
  );
}

export default function SprintWorkspace({ chatPage, quizPage, onViewPlan, onViewWrong }) {
  const [rightPanelMode, setRightPanelMode] = useState("chat");

  return (
    <div style={{ display: "flex", flex: 1, padding: 24, gap: 24, overflow: "hidden", boxSizing: "border-box" }}>
      <div style={{ width: 320, flexShrink: 0, display: "flex", flexDirection: "column", gap: 24 }}>
        <div
          className="premium-card"
          style={{ flex: "1 1 50%", padding: 20, overflowY: "auto", display: "flex", flexDirection: "column" }}
        >
          <h3 style={{ margin: "0 0 16px 0", fontSize: 16, fontWeight: 700, color: "#111827" }}>冲刺日历</h3>
          <VerticalMiniCalendar />
        </div>

        <div
          className="premium-card"
          style={{ flex: "1 1 50%", padding: 20, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}
        >
          <h3 style={{ margin: "0 0 8px 0", fontSize: 16, fontWeight: 700, color: "#111827" }}>目标与错题</h3>
          <button
            onClick={() => setRightPanelMode("chat")}
            style={{
              padding: 12, textAlign: "center", borderRadius: 12, border: "none", cursor: "pointer",
              fontWeight: 600, fontSize: 14, fontFamily: "inherit", transition: "background 0.12s",
              background: rightPanelMode === "chat" ? "#111827" : "#F3F4F6",
              color: rightPanelMode === "chat" ? "#FFFFFF" : "#111827",
            }}
          >
            🤖 AI 复习对讲
          </button>
          <button
            onClick={() => setRightPanelMode("quiz")}
            style={{
              padding: 12, textAlign: "center", borderRadius: 12, border: "none", cursor: "pointer",
              fontWeight: 600, fontSize: 14, fontFamily: "inherit", transition: "background 0.12s",
              background: rightPanelMode === "quiz" ? "#10B981" : "#F3F4F6",
              color: rightPanelMode === "quiz" ? "#FFFFFF" : "#111827",
            }}
          >
            🧩 AI 出题检测
          </button>
          <button
            onClick={onViewPlan}
            style={{
              padding: 12, textAlign: "center", background: "#F3F4F6", borderRadius: 12,
              border: "none", cursor: "pointer", fontWeight: 600, fontSize: 14,
              color: "#111827", fontFamily: "inherit",
            }}
          >
            📋 查看复习计划
          </button>
          <button
            onClick={onViewWrong}
            style={{
              padding: 12, textAlign: "center", background: "#F3F4F6", borderRadius: 12,
              border: "none", cursor: "pointer", fontWeight: 600, fontSize: 14,
              color: "#111827", fontFamily: "inherit",
            }}
          >
            📝 进入错题本
          </button>

          <div style={{ marginTop: "auto", paddingTop: 12, borderTop: "1px solid #F3F4F6" }}>
            <div style={{ fontSize: 12, color: "#9CA3AF", marginBottom: 6 }}>今日目标</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#111827" }}>完成 20 道练习题</div>
            <div style={{ marginTop: 8, height: 6, borderRadius: 3, background: "#E5E7EB", overflow: "hidden" }}>
              <div style={{ width: "35%", height: "100%", borderRadius: 3, background: "#10B981", transition: "width 0.3s" }} />
            </div>
            <div style={{ fontSize: 11, color: "#6B7280", marginTop: 4 }}>7 / 20 已完成</div>
          </div>
        </div>
      </div>

      <div
        className="premium-card"
        style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", borderRadius: 24 }}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={rightPanelMode}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            style={{ height: "100%", width: "100%", display: "flex", flexDirection: "column" }}
          >
            {rightPanelMode === "chat" ? (
              chatPage
            ) : (
              <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
                <div style={{ padding: "16px 24px", borderBottom: "1px solid #E5E7EB", display: "flex", alignItems: "center", flexShrink: 0 }}>
                  <h2 style={{ fontSize: 18, margin: 0, fontWeight: 700, color: "#111827" }}>AI 出题检测</h2>
                </div>
                <div style={{ flex: 1, overflowY: "auto" }}>
                  {quizPage}
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
