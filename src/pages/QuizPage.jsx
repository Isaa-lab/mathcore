import { motion, AnimatePresence } from "framer-motion";

const springTransition = { type: "spring", stiffness: 260, damping: 25 };

function renderScaffoldSteps(text) {
  const rows = String(text || "")
    .split(/\n|。/)
    .map((s) => s.trim())
    .filter(Boolean);
  return rows.map((row, idx) => ({
    id: idx,
    text: row.replace(/^\d+[).、]\s*/, ""),
  }));
}

export default function QuizPage({
  question,
  options = [],
  selectedIndex,
  onSelectOption,
  submitted,
  isCorrect,
  onSubmit,
  onNext,
  explanation,
  showScaffold,
  wrongShake,
  mathRenderer,
}) {
  const scaffoldSteps = renderScaffoldSteps(explanation);

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "12px 10px 20px" }}>
      <div className="premium-card" style={{ padding: 28 }}>
        <div
          style={{
            fontSize: "1.125rem",
            lineHeight: 1.7,
            color: "var(--text-primary)",
            marginBottom: 18,
            fontWeight: 600,
          }}
        >
          {mathRenderer ? mathRenderer(question) : question}
        </div>

        <div style={{ display: "grid", gap: 10 }}>
          {options.map((opt, idx) => (
            <motion.div
              key={idx}
              role="button"
              tabIndex={0}
              onClick={() => onSelectOption?.(idx)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") onSelectOption?.(idx);
              }}
              whileHover={{ scale: 1.01, backgroundColor: "#F9FAFB" }}
              whileTap={{ scale: 0.98 }}
              animate={submitted && !isCorrect && selectedIndex === idx && wrongShake ? { x: [0, -8, 8, -8, 8, 0] } : { x: 0 }}
              transition={submitted && !isCorrect && selectedIndex === idx && wrongShake ? { duration: 0.4 } : springTransition}
              style={{
                padding: "14px 16px",
                borderRadius: 16,
                border:
                  selectedIndex === idx
                    ? "2px solid #111827"
                    : "1px solid rgba(0,0,0,0.08)",
                background:
                  submitted && selectedIndex === idx
                    ? isCorrect
                      ? "var(--accent-mint)"
                      : "var(--accent-coral)"
                    : "#FFFFFF",
                cursor: "pointer",
              }}
            >
              {mathRenderer ? mathRenderer(opt) : opt}
            </motion.div>
          ))}
        </div>

        <AnimatePresence>
          {showScaffold && (
            <motion.div
              aria-live="polite"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={springTransition}
              style={{ overflow: "hidden", marginTop: 14 }}
            >
              <div
                className="premium-card"
                style={{ padding: 16, borderLeft: "4px solid #6366F1" }}
              >
                <div style={{ fontWeight: 800, marginBottom: 10 }}>解题架构</div>
                <div style={{ display: "grid", gap: 8 }}>
                  {scaffoldSteps.map((step, idx) => (
                    <div
                      key={step.id}
                      style={{
                        padding: "10px 12px",
                        borderRadius: 12,
                        background: idx === 0 ? "#EEF2FF" : "#F8FAFC",
                        fontWeight: idx === 0 ? 700 : 500,
                        color: "var(--text-primary)",
                      }}
                    >
                      {step.text}
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end", gap: 10 }}>
          {!submitted ? (
            <motion.button
              type="button"
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.98 }}
              onClick={onSubmit}
              disabled={selectedIndex == null}
              style={{
                border: "none",
                borderRadius: 12,
                padding: "10px 16px",
                background: "#111827",
                color: "#fff",
                cursor: selectedIndex == null ? "not-allowed" : "pointer",
              }}
            >
              提交答案
            </motion.button>
          ) : (
            <motion.button
              type="button"
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.98 }}
              onClick={onNext}
              style={{
                border: "none",
                borderRadius: 12,
                padding: "10px 16px",
                background: "#111827",
                color: "#fff",
                cursor: "pointer",
              }}
            >
              下一题
            </motion.button>
          )}
        </div>
      </div>
    </div>
  );
}

