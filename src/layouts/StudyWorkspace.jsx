import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

const TABS = ["资料库", "AI对话", "知识点", "知识树", "小测"];
const TAB_ICONS = { "资料库": "📚", "AI对话": "🤖", "知识点": "📖", "知识树": "🌌", "小测": "🧩" };

export default function StudyWorkspace({ renderTab }) {
  const [activeTab, setActiveTab] = useState("资料库");

  return (
    <div style={{ display: "flex", flex: 1, padding: 24, gap: 24, overflow: "hidden", boxSizing: "border-box" }}>
      <div
        className="premium-card"
        style={{ width: 240, flexShrink: 0, padding: 16, display: "flex", flexDirection: "column", gap: 8, borderRadius: 24 }}
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
        style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", borderRadius: 24, position: "relative" }}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            transition={{ duration: 0.2 }}
            style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}
          >
            {renderTab(activeTab)}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
