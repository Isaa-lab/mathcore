export default function ExamWorkspace({
  reportDashboard,
  quizPage,
  wrongBook,
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateRows: "auto 1fr",
        gap: 24,
      }}
    >
      <section>{reportDashboard}</section>
      <section style={{ display: "grid", gap: 24 }}>
        <div>{quizPage}</div>
        <div>{wrongBook}</div>
      </section>
    </div>
  );
}

