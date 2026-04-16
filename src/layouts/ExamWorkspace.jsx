export default function ExamWorkspace({
  reportDashboard,
  quizPage,
  wrongBook,
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "32px", padding: "24px", maxWidth: "1200px", margin: "0 auto" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "24px" }}>
        {reportDashboard}
      </div>
      <div className="premium-card" style={{ flex: 1, minHeight: "600px", padding: "40px" }}>
        {quizPage}
      </div>
    </div>
  );
}

