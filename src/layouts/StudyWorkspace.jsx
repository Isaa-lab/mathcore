export default function StudyWorkspace({
  knowledgeTree,
  knowledgePage,
  materialChatPage,
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "280px 1fr",
        gap: 24,
        alignItems: "start",
      }}
    >
      <aside>{knowledgeTree}</aside>
      <main style={{ display: "grid", gap: 24 }}>
        <section>{knowledgePage}</section>
        <section>{materialChatPage}</section>
      </main>
    </div>
  );
}

