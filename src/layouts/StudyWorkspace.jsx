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

// 教材沙盒顶部横幅 —— 显示当前教材 + 退出按钮 + PDF 预览按钮 + 当前 AI 主题色条
// 通过 layoutId={"material-card-{id}"} 与画廊里的卡片同名 → framer-motion 自动 morph
function MaterialBanner({ currentMaterial, onExit, onPreviewPdf, onReanalyze, reanalyzing, onCompareAI, comparing, providerLabel = null }) {
  if (!currentMaterial) return null;
  const courseColor = ({
    "数值分析": "#1D9E75",
    "线性代数": "#3B82F6",
    "ODE":      "#8B5CF6",
    "概率论":   "#F59E0B",
    "数理统计": "#EF4444",
    "最优化":   "#0EA5E9",
  })[currentMaterial.course] || "#64748B";
  const hasPdf = !!currentMaterial.file_data;
  return (
    <motion.div
      layoutId={`material-card-${currentMaterial.id}`}
      transition={{ type: "spring", stiffness: 260, damping: 28 }}
      style={{
        position: "relative",
        display: "flex", alignItems: "center", gap: 14,
        padding: "10px 18px", marginBottom: 16,
        background: `linear-gradient(135deg, ${courseColor}12 0%, #ffffff 70%)`,
        border: `1px solid ${courseColor}33`,
        // 顶部 3px 高的条 = 当前 AI 主题色，由 var(--mc-ai-accent) 控制
        borderTop: "3px solid var(--mc-ai-accent, #10B981)",
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
        <div style={{ fontSize: 11.5, color: "#64748B", marginTop: 2, display: "flex", alignItems: "center", gap: 8 }}>
          {Array.isArray(currentMaterial.chapters) ? currentMaterial.chapters.length : 0} 个章节 · 沙盒内所有功能默认绑定本教材
          {providerLabel && (
            <span title="当前 AI 引擎" style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              padding: "1px 8px", borderRadius: 999,
              background: "var(--mc-ai-soft, #ECFDF5)",
              color: "var(--mc-ai-ink, #047857)",
              fontSize: 10.5, fontWeight: 700, letterSpacing: "0.04em",
              border: "1px solid var(--mc-ai-accent, #10B981)33",
            }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--mc-ai-accent, #10B981)" }} />
              {providerLabel}
            </span>
          )}
        </div>
      </div>
      {/* 右侧操作区 */}
      <div style={{ display: "flex", gap: 8 }}>
        {hasPdf && onPreviewPdf && (
          <button
            onClick={onPreviewPdf}
            title="预览本教材的 PDF 原文"
            style={{
              padding: "6px 12px", borderRadius: 10,
              background: "#fff", color: "#0EA5E9",
              border: "1px solid #BAE6FD", cursor: "pointer",
              fontFamily: "inherit", fontSize: 12.5, fontWeight: 600,
            }}
          >
            📖 查看 PDF
          </button>
        )}
        {onReanalyze && (
          <button
            onClick={onReanalyze}
            disabled={reanalyzing}
            title="用当前 AI + 最新细化 prompt 重抽本教材"
            style={{
              padding: "6px 12px", borderRadius: 10,
              background: reanalyzing ? "#E5E7EB" : "var(--mc-ai-soft, #ECFDF5)",
              color: reanalyzing ? "#94A3B8" : "var(--mc-ai-ink, #047857)",
              border: `1px solid ${reanalyzing ? "#E5E7EB" : "var(--mc-ai-accent, #10B981)"}`,
              cursor: reanalyzing ? "wait" : "pointer",
              fontFamily: "inherit", fontSize: 12.5, fontWeight: 600,
            }}
          >
            {reanalyzing ? "🤖 分析中…" : "🔬 细化分析"}
          </button>
        )}
        {onCompareAI && (
          <button
            onClick={onCompareAI}
            disabled={comparing || reanalyzing}
            title="选另一个 AI 同时跑一遍，结果一起入库便于对比"
            style={{
              padding: "6px 12px", borderRadius: 10,
              background: (comparing || reanalyzing) ? "#E5E7EB" : "#fff",
              color: (comparing || reanalyzing) ? "#94A3B8" : "#0F172A",
              border: `1px solid #CBD5E1`,
              cursor: (comparing || reanalyzing) ? "wait" : "pointer",
              fontFamily: "inherit", fontSize: 12.5, fontWeight: 600,
            }}
          >
            {comparing ? "🆚 对比中…" : "🆚 双 AI 对比"}
          </button>
        )}
      </div>
    </motion.div>
  );
}

export default function StudyWorkspace({
  renderTab,
  activeTab: controlledTab,
  setActiveTab: setControlledTab,
  currentMaterial,
  onExit,
  onPreviewPdf,
  onReanalyze,
  reanalyzing,
  onCompareAI,
  comparing,
  providerLabel,
}) {
  const [uncontrolledTab, setUncontrolledTab] = useState("知识点");
  const activeTab = controlledTab !== undefined ? controlledTab : uncontrolledTab;
  const setActiveTab = setControlledTab || setUncontrolledTab;

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, padding: 24, gap: 0, overflow: "hidden", boxSizing: "border-box" }}>
      <MaterialBanner
        currentMaterial={currentMaterial}
        onExit={onExit}
        onPreviewPdf={onPreviewPdf}
        onReanalyze={onReanalyze}
        reanalyzing={reanalyzing}
        onCompareAI={onCompareAI}
        comparing={comparing}
        providerLabel={providerLabel}
      />

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
                background: activeTab === tab ? "var(--mc-ai-soft, #F3F4F6)" : "transparent",
                borderRadius: 12,
                border: "none",
                borderLeft: activeTab === tab ? "3px solid var(--mc-ai-accent, #111827)" : "3px solid transparent",
                cursor: "pointer",
                fontWeight: 600,
                fontSize: 14,
                color: activeTab === tab ? "var(--mc-ai-ink, #111827)" : "#6B7280",
                fontFamily: "inherit",
                transition: "background 0.15s, color 0.15s, border-left-color 0.15s",
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
