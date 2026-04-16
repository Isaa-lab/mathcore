export default function StudyWorkspace({
  knowledgeTree,
  knowledgePage,
  materialChatPage,
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: "32px", height: "calc(100vh - 80px)", padding: "24px", boxSizing: "border-box" }}>
      <div className="premium-card" style={{ height: "100%", overflowY: "auto" }}>
        {knowledgeTree}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "24px", overflowY: "auto", paddingRight: "12px" }}>
        {knowledgePage}
        {materialChatPage}
      </div>
    </div>
  );
}

