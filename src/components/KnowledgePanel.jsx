import React, { useEffect, useState } from "react";
import MathText from "../lib/MathText";
import { explainKnowledge } from "../lib/workbenchAI";

const CSS = `
.kp{--ink:#0f1220;--mut:#6b7184;--faint:#9aa0b4;--line:#e7e8ef;--soft:#f0f1f6;--brand:#4338ca;--amber:#d97706;--amber-soft:#fef3e2;color:var(--ink);height:100%;overflow-y:auto}
.kp-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px}.kp-tab{font-size:12px;border:1px solid var(--line);background:#fff;color:#3a3f55;border-radius:8px;padding:6px 11px;cursor:pointer;font-family:ui-monospace,monospace}.kp-tab.on{background:var(--brand);border-color:var(--brand);color:#fff}
.kp-sec{margin-bottom:18px}.kp-ey{font-family:ui-monospace,monospace;font-size:10px;letter-spacing:.12em;color:var(--faint);text-transform:uppercase;margin:0 0 8px}.kp-summary{font-size:15px;font-weight:600;line-height:1.5;margin-bottom:12px}.kp-detail{font-size:14px;line-height:1.75;color:#3a3f55}
.kp-points{list-style:none;padding:0;margin:0;display:grid;gap:7px}.kp-points li{font-size:13px;padding:8px 11px;background:var(--soft);border-radius:8px;display:flex;gap:8px}.kp-points li::before{content:"▸";color:var(--brand)}
.kp-viz{background:var(--amber-soft);border-radius:11px;padding:13px 15px;font-size:13px;color:#7c5410;line-height:1.6}.kp-viz .vh{font-family:ui-monospace,monospace;font-size:11px;color:var(--amber);text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px}
.kp-example{background:#fbfbfe;border:1px dashed var(--line);border-radius:10px;padding:12px 14px;font-size:13px;color:#3a3f55;line-height:1.7}.kp-loading{text-align:center;color:var(--brand);font-family:ui-monospace,monospace;font-size:13px;padding:40px}.kp-empty{text-align:center;color:var(--faint);font-size:14px;padding:40px;line-height:1.8}.kp-src{font-size:11px;color:var(--faint);margin-top:4px}
`;

function useCSS() {
  React.useEffect(() => {
    if (document.getElementById("kp-style")) return;
    const style = document.createElement("style");
    style.id = "kp-style";
    style.textContent = CSS;
    document.head.appendChild(style);
  }, []);
}

export default function KnowledgePanel({ item, existingNotes = {} }) {
  useCSS();
  const points = item?.knowledge_points || [];
  const [active, setActive] = useState(points[0] || null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [usedNote, setUsedNote] = useState(false);

  useEffect(() => {
    setActive(points[0] || null);
  }, [item]);

  useEffect(() => {
    if (!active) {
      setData(null);
      return;
    }
    let alive = true;
    (async () => {
      setLoading(true);
      setData(null);
      const note = existingNotes[active] || "";
      setUsedNote(Boolean(note));
      try {
        const result = await explainKnowledge({ point: active, existingNote: note });
        if (alive) setData(result);
      } catch {
        if (alive) setData(null);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [active, existingNotes]);

  if (!item) {
    return <div className="kp"><div className="kp-empty">选一道错题<br />这里会展开它考的知识点</div></div>;
  }

  return (
    <div className="kp">
      {points.length > 0 && (
        <>
          <p className="kp-ey" style={{ marginBottom: 8 }}>这道题考的知识点 · 点击查看</p>
          <div className="kp-tabs">
            {points.map((point) => (
              <span key={point} className={"kp-tab" + (active === point ? " on" : "")} onClick={() => setActive(point)}>{point}</span>
            ))}
          </div>
        </>
      )}
      {loading && <div className="kp-loading">正在整理「{active}」的讲解...</div>}
      {data && !loading && (
        <>
          <div className="kp-sec">
            <div className="kp-summary"><MathText text={data.summary} /></div>
            {usedNote && <div className="kp-src">结合了已有知识点资料</div>}
          </div>
          <div className="kp-sec">
            <p className="kp-ey">详解</p>
            <div className="kp-detail"><MathText text={data.detail} /></div>
          </div>
          {(data.keyPoints || []).length > 0 && (
            <div className="kp-sec">
              <p className="kp-ey">要点</p>
              <ul className="kp-points">
                {data.keyPoints.map((point, index) => <li key={index}><MathText text={point} /></li>)}
              </ul>
            </div>
          )}
          {data.visualHint && (
            <div className="kp-sec">
              <div className="kp-viz">
                <div className="vh">可视化理解</div>
                <MathText text={data.visualHint} />
              </div>
            </div>
          )}
          {data.example && (
            <div className="kp-sec">
              <p className="kp-ey">例子</p>
              <div className="kp-example"><MathText text={data.example} /></div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
