import { motion } from "framer-motion";
import { useMathStore } from "../store/useMathStore";

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
      <div style={{ background: "#F3F4F6", padding: 4, borderRadius: 9999, display: "inline-flex", position: "relative" }}>
        {options.map((option) => {
          const active = workspaceMode === option.id;
          return (
            <div
              key={option.id}
              onClick={() => setWorkspaceMode(option.id)}
              style={{
                padding: "8px 16px",
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
                position: "relative",
                zIndex: 10,
                userSelect: "none",
                transition: "color 0.2s",
                color: active ? "#111827" : "#9CA3AF",
                borderRadius: 9999,
                fontFamily: "inherit",
              }}
            >
              {active && (
                <motion.div
                  layoutId="pill"
                  style={{
                    position: "absolute",
                    inset: 0,
                    background: "#FFFFFF",
                    boxShadow: "0 2px 10px rgba(0,0,0,0.08)",
                    borderRadius: 9999,
                    zIndex: -1,
                  }}
                  transition={{ type: "spring", stiffness: 400, damping: 30 }}
                />
              )}
              {option.label}
            </div>
          );
        })}
      </div>
    </div>
  );
}

