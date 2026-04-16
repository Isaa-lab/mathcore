import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

const TABS = ["资料库", "AI对话", "知识点", "知识树", "小测"];

export default function StudyWorkspace({ renderTab }) {
  const [activeTab, setActiveTab] = useState("资料库");

  return (
    <div style={{ display: "flex", height: "calc(100vh - 64px)", padding: 24, gap: 24, boxSizing: "border-box" }}>
      <div
        className="premium-card"
        style={{ width: 200, flexShrink: 0, padding: "24px 16px", display: "flex", flexDirection: "column", gap: 16, borderRadius: 32 }}
      >
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: 12,
              textAlign: "center",
              background: activeTab === tab ? "#F3F4F6" : "transparent",
              borderRadius: 12,
              border: "none",
              cursor: "pointer",
              fontWeight: 600,
              fontSize: 14,
              color: activeTab === tab ? "#111827" : "#6B7280",
              fontFamily: "inherit",
              transition: "background 0.15s, color 0.15s",
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      <div
        className="premium-card"
        style={{ flex: 1, padding: 32, overflowY: "auto", position: "relative" }}
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
      </div>
    </div>
  );
}
