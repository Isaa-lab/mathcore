import { motion } from "framer-motion";
import { useMathStore } from "../store/useMathStore";

const pillTransition = { type: "spring", stiffness: 300, damping: 25 };

export default function TopNav({ title = "MathCore" }) {
  const workspaceMode = useMathStore((s) => s.workspaceMode);
  const setWorkspaceMode = useMathStore((s) => s.setWorkspaceMode);

  const options = [
    { id: "study", label: "学习模式" },
    { id: "exam", label: "冲刺模式" },
  ];

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 20 }}>
      <div style={{ fontSize: 20, fontWeight: 800, color: "#111827", letterSpacing: "-0.02em" }}>{title}</div>
      <div
        style={{
          background: "#F3F4F6",
          borderRadius: 9999,
          padding: 4,
          display: "flex",
          position: "relative",
        }}
      >
        {options.map((option) => {
          const active = workspaceMode === option.id;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => setWorkspaceMode(option.id)}
              style={{
                position: "relative",
                border: "none",
                background: "transparent",
                color: active ? "#111827" : "#6B7280",
                padding: "10px 18px",
                borderRadius: 9999,
                zIndex: 10,
                fontSize: 13,
                fontWeight: 700,
                fontFamily: "inherit",
                cursor: "pointer",
              }}
            >
              {active && (
                <motion.div
                  layoutId="activeWorkspacePill"
                  transition={pillTransition}
                  style={{
                    position: "absolute",
                    inset: 0,
                    background: "#FFFFFF",
                    boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                    borderRadius: 9999,
                    zIndex: 0,
                  }}
                />
              )}
              <span style={{ position: "relative", zIndex: 10 }}>{option.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

