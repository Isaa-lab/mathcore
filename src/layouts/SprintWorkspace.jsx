export default function SprintWorkspace({ calendar, quizPage, chatPage, onViewPlan, onViewWrong }) {
  return (
    <div style={{ display: "flex", height: "calc(100vh - 64px)", padding: 24, gap: 24, boxSizing: "border-box" }}>
      <div style={{ width: 320, flexShrink: 0, display: "flex", flexDirection: "column", gap: 24 }}>
        <div
          className="premium-card"
          style={{ flex: 1, padding: 24, display: "flex", flexDirection: "column" }}
        >
          <h3 style={{ margin: "0 0 16px 0", fontSize: 16, fontWeight: 700, color: "#111827" }}>复习日历</h3>
          <div style={{ flex: 1, overflowY: "auto" }}>
            {calendar}
          </div>
        </div>
        <div
          className="premium-card"
          style={{ flex: 1, padding: 24, display: "flex", flexDirection: "column", gap: 12 }}
        >
          <button
            onClick={onViewPlan}
            style={{
              padding: 12,
              textAlign: "center",
              background: "#F3F4F6",
              borderRadius: 12,
              border: "none",
              cursor: "pointer",
              fontWeight: 600,
              fontSize: 14,
              color: "#111827",
              fontFamily: "inherit",
            }}
          >
            查看复习计划
          </button>
          <button
            onClick={onViewWrong}
            style={{
              padding: 12,
              textAlign: "center",
              background: "#F3F4F6",
              borderRadius: 12,
              border: "none",
              cursor: "pointer",
              fontWeight: 600,
              fontSize: 14,
              color: "#111827",
              fontFamily: "inherit",
            }}
          >
            进入错题本
          </button>
        </div>
      </div>

      <div
        className="premium-card"
        style={{ flex: 1, padding: 32, overflowY: "auto", display: "flex", flexDirection: "column", gap: 24 }}
      >
        <div style={{ flex: 1, display: "flex", gap: 16 }}>
          <div style={{ flex: 1, overflowY: "auto" }}>
            {chatPage}
          </div>
          <div style={{ flex: 1, overflowY: "auto" }}>
            {quizPage}
          </div>
        </div>
      </div>
    </div>
  );
}
