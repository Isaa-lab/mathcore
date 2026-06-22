import React, { useState } from "react";
import PaperPanel from "./PaperPanel";
import TutorChat from "./TutorChat";
import KnowledgePanel from "./KnowledgePanel";
import { summarizeWeakness } from "../lib/workbenchAI";

const CSS = `
.mw{--ink:#0f1220;--mut:#6b7184;--line:#e7e8ef;--soft:#f0f1f6;--card:#fff;--brand:#4338ca;--brand-soft:#eef0ff;color:var(--ink)}
.mw-weak{background:var(--brand-soft);border:1px solid #dfe2ff;border-radius:12px;padding:13px 16px;margin-bottom:16px;font-size:13px;color:#3730a3;line-height:1.6}
.mw-cols{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;height:calc(100vh - 150px);max-height:100%;min-height:520px}
.mw-cols.review{grid-template-columns:1fr}
.mw-col{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px;overflow:hidden;display:flex;flex-direction:column}
.mw-coltitle{font-size:13px;font-weight:600;color:var(--mut);margin:0 0 12px;font-family:ui-monospace,monospace;letter-spacing:.02em}
@media(max-width:1100px){.mw-cols{grid-template-columns:1fr;height:auto}.mw-col{min-height:420px}}
`;

function useCSS() {
  React.useEffect(() => {
    if (document.getElementById("mw-style")) return;
    const style = document.createElement("style");
    style.id = "mw-style";
    style.textContent = CSS;
    document.head.appendChild(style);
  }, []);
}

export default function MistakeWorkbench({ supabase, userId, existingNotes = {} }) {
  useCSS();
  const [activeItem, setActiveItem] = useState(null);
  const [weakness, setWeakness] = useState("");
  const [reviewMode, setReviewMode] = useState(false);

  const onGraded = async (graded) => {
    const wrong = graded.filter((item) => item.is_correct === false);
    if (!wrong.length) {
      setWeakness("这份卷子全对，掌握得很好！");
      return;
    }
    try {
      setWeakness(await summarizeWeakness(wrong));
    } catch {
      setWeakness("");
    }
  };

  return (
    <div className="mw">
      {weakness && !reviewMode && <div className="mw-weak"><b>薄弱点分析：</b>{weakness}</div>}
      <div className={"mw-cols" + (reviewMode ? " review" : "")}>
        <div className="mw-col">
          <p className="mw-coltitle">卷子</p>
          <PaperPanel
            supabase={supabase}
            userId={userId}
            activeItemId={activeItem?.id}
            onSelectItem={setActiveItem}
            onItemsGraded={onGraded}
            onReviewModeChange={setReviewMode}
          />
        </div>
        {!reviewMode && (
          <>
            <div className="mw-col">
              <p className="mw-coltitle">AI 一对一辅导</p>
              <TutorChat item={activeItem} />
            </div>
            <div className="mw-col">
              <p className="mw-coltitle">知识点展开</p>
              <KnowledgePanel item={activeItem} existingNotes={existingNotes} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
