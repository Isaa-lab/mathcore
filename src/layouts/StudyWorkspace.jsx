import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import InteractiveLab from "./InteractiveLab";

// ── 教材沙盒侧栏 ─────────────────────────────────────────────────────────
// 调整说明：
//   · 删除"资料库"tab：教材已经在画廊（HomePage）里选定，沙盒里不需要再列资料
//   · 新增"复习"tab：错题/薄弱/记忆三池加权抽题（核心：复习不再问科目）
//   · 新增"错题本"tab：从全屏 overlay 收回为侧栏常驻 tab，方便随时查看本教材错题
//   · "AI对话"位置后移，作为辅助工具
const TABS = ["知识点", "知识树", "复习", "小测", "错题本", "AI对话"];
const TAB_ICONS = { "知识点": "📖", "知识树": "🌌", "复习": "🔁", "小测": "🧩", "错题本": "❌", "AI对话": "🤖" };

// 教材沙盒顶部横幅 —— 显示当前教材 + 退出按钮 + 进度
// 通过 layoutId={"material-card-{id}"} 与画廊里的卡片同名 → framer-motion 自动 morph
function MaterialBanner({ currentMaterial, onExit }) {
  if (!currentMaterial) return null;
  const courseColor = ({
    "数值分析": "#1D9E75",
    "线性代数": "#3B82F6",
    "ODE":      "#8B5CF6",
    "概率论":   "#F59E0B",
    "数理统计": "#EF4444",
    "最优化":   "#0EA5E9",
  })[currentMaterial.course] || "#64748B";
  return (
    <motion.div
      layoutId={`material-card-${currentMaterial.id}`}
      transition={{ type: "spring", stiffness: 260, damping: 28 }}
      style={{
        display: "flex", alignItems: "center", gap: 14,
        padding: "10px 18px", marginBottom: 16,
        background: `linear-gradient(135deg, ${courseColor}12 0%, #ffffff 70%)`,
        border: `1px solid ${courseColor}33`,
        borderRadius: 16, boxShadow: "0 1px 0 rgba(15,23,42,0.02)",
      }}
    >
      <button
        onClick={onExit}
        title="返回教材画廊"
        style={{
          padding: "6px 12px", borderRadius: 10,
          background: "#fff", color: "#475569",
          border: "1px solid #E2E8F0", cursor: "pointer",
          fontFamily: "inherit", fontSize: 12.5, fontWeight: 600,
          display: "flex", alignItems: "center", gap: 6,
          transition: "all .15s",
        }}
        onMouseEnter={e => { e.currentTarget.style.background = "#F8FAFC"; e.currentTarget.style.color = "#0F172A"; }}
        onMouseLeave={e => { e.currentTarget.style.background = "#fff"; e.currentTarget.style.color = "#475569"; }}
      >
        ← 教材画廊
      </button>
      <div style={{ display: "inline-block", padding: "3px 10px", borderRadius: 999, background: courseColor, color: "#fff", fontSize: 10.5, fontWeight: 800, letterSpacing: "0.04em" }}>
        {currentMaterial.course || "未分类"}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: "#0F172A", letterSpacing: "-0.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {currentMaterial.title || "未命名资料"}
        </div>
        <div style={{ fontSize: 11.5, color: "#64748B", marginTop: 2 }}>
          {Array.isArray(currentMaterial.chapters) ? currentMaterial.chapters.length : 0} 个章节 · 沙盒内所有功能默认绑定本教材
        </div>
      </div>
    </motion.div>
  );
}

export default function StudyWorkspace({ renderTab, activeTab: controlledTab, setActiveTab: setControlledTab, currentMaterial, onExit }) {
  const [uncontrolledTab, setUncontrolledTab] = useState("知识点");
  const activeTab = controlledTab !== undefined ? controlledTab : uncontrolledTab;
  const setActiveTab = setControlledTab || setUncontrolledTab;

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, padding: 24, gap: 0, overflow: "hidden", boxSizing: "border-box" }}>
      <MaterialBanner currentMaterial={currentMaterial} onExit={onExit} />

      <div style={{ display: "flex", flex: 1, gap: 24, overflow: "hidden", minHeight: 0 }}>
        <div
          className="premium-card"
          style={{ width: 220, flexShrink: 0, padding: 16, display: "flex", flexDirection: "column", gap: 8, borderRadius: 24 }}
        >
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: "10px 14px",
                textAlign: "left",
                background: activeTab === tab ? "#F3F4F6" : "transparent",
                borderRadius: 12,
                border: "none",
                cursor: "pointer",
                fontWeight: 600,
                fontSize: 14,
                color: activeTab === tab ? "#111827" : "#6B7280",
                fontFamily: "inherit",
                transition: "background 0.15s, color 0.15s",
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <span style={{ fontSize: 16 }}>{TAB_ICONS[tab]}</span>
              {tab}
            </button>
          ))}
        </div>

        <div
          className="premium-card"
          style={{ flex: 1, overflowY: "auto", height: "100%", padding: 32, borderRadius: 24, position: "relative" }}
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.2 }}
            >
              {renderTab(activeTab)}
            </motion.div>
          </AnimatePresence>

          {/* Full-screen Interactive Lab overlay (triggered by chat viz cards) */}
          <InteractiveLab />
        </div>
      </div>
    </div>
  );
}
