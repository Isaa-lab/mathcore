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
  questionSecondary = "",
  options = [],
  optionsSecondary = [],
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
  hideFooter = false,
  correctIndex = -1,
  revealed = false,
}) {
  const scaffoldSteps = renderScaffoldSteps(explanation);
  const render = (txt) => (mathRenderer ? mathRenderer(txt) : txt);

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "12px 10px 20px" }}>
      <div className="premium-card" style={{ padding: 28 }}>
        <div
          style={{
            fontSize: "1.125rem",
            lineHeight: 1.7,
            color: "var(--text-primary)",
            marginBottom: questionSecondary ? 6 : 18,
            fontWeight: 600,
          }}
        >
          {render(question)}
        </div>
        {questionSecondary && (
          <div
            style={{
              fontSize: "0.85rem",
              lineHeight: 1.55,
              color: "var(--text-secondary)",
              marginBottom: 18,
              fontStyle: "italic",
              opacity: 0.82,
              paddingLeft: 2,
              borderLeft: "2px solid rgba(99,102,241,0.2)",
              paddingInlineStart: 10,
            }}
          >
            {render(questionSecondary)}
          </div>
        )}

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
              style={(() => {
                const isSel = selectedIndex === idx;
                const isCorrectOpt = correctIndex === idx;
                let border = "1px solid rgba(0,0,0,0.08)";
                let background = "#FFFFFF";
                if (!submitted && isSel) border = "2px solid #111827";
                if (submitted && isSel && isCorrect) { background = "var(--accent-mint)"; border = "2px solid #10b981"; }
                if (submitted && isSel && !isCorrect) { background = "var(--accent-coral)"; border = "2px solid #ef4444"; }
                // 揭示正确答案时高亮正确项（仅用户已答错且主动要求看答案时）
                if (submitted && revealed && isCorrectOpt && !isSel) {
                  background = "var(--accent-mint)";
                  border = "2px dashed #10b981";
                }
                return {
                  padding: "14px 16px",
                  borderRadius: 16,
                  border,
                  background,
                  cursor: submitted ? "default" : "pointer",
                  pointerEvents: submitted ? "none" : "auto",
                };
              })()}
            >
              <div>{render(opt)}</div>
              {optionsSecondary && optionsSecondary[idx] && (
                <div
                  style={{
                    fontSize: "0.78rem",
                    color: "var(--text-secondary)",
                    fontStyle: "italic",
                    opacity: 0.72,
                    marginTop: 4,
                    lineHeight: 1.45,
                  }}
                >
                  {render(optionsSecondary[idx])}
                </div>
              )}
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

        {!hideFooter && (
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
        )}
      </div>
    </div>
  );
}

