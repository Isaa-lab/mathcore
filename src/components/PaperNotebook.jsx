import React, { useCallback, useEffect, useMemo, useState } from "react";
import MathText from "../lib/MathText";
import { makeWorkbenchApi } from "../lib/workbenchApi";
import { explainKnowledge, generateVariant, autoLatex } from "../lib/workbenchAI";

const CSS = `
.nb{--ink:#0f1220;--mut:#6b7184;--faint:#9aa0b4;--line:#e7e8ef;--soft:#f0f1f6;--card:#fff;--brand:#4338ca;--brand-soft:#eef0ff;--rose:#be123c;--rose-soft:#fdeaef;--emerald:#047857;--emerald-soft:#e7f6ef;--amber:#d97706;--amber-soft:#fef3e2;color:var(--ink)}
.nb-filt{display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap}
.nb-fb{font-size:12px;border:1px solid var(--line);background:#fff;color:#3a3f55;border-radius:8px;padding:5px 12px;cursor:pointer;font-family:ui-monospace,monospace}
.nb-fb.on{background:var(--brand);border-color:var(--brand);color:#fff}
.nb-empty{text-align:center;color:var(--faint);font-size:14px;padding:48px 14px;line-height:1.9}
.nb-loading{text-align:center;color:var(--brand);font-family:ui-monospace,monospace;font-size:13px;padding:40px}
.nb-card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 18px;margin-bottom:14px}
.nb-card.wrong{border-left:3px solid var(--rose)}.nb-card.star{border-left:3px solid var(--amber)}
.nb-ch{display:flex;align-items:center;gap:8px;margin-bottom:9px;flex-wrap:wrap}
.nb-num{font-family:ui-monospace,monospace;font-size:12px;color:var(--faint)}
.nb-badge{font-family:ui-monospace,monospace;font-size:11px;padding:2px 8px;border-radius:6px}
.nb-b-wrong{background:var(--rose-soft);color:var(--rose)}.nb-b-star{background:var(--amber-soft);color:var(--amber)}.nb-b-ch{background:var(--brand-soft);color:#3730a3}
.nb-star{margin-left:auto;background:none;border:none;cursor:pointer;font-size:18px;line-height:1;color:var(--amber)}
.nb-q{font-size:14px;line-height:1.65;margin-bottom:10px}
.nb-sec{margin-top:10px;padding-top:10px;border-top:1px dashed var(--line)}
.nb-lab{font-family:ui-monospace,monospace;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--faint);margin-bottom:5px}
.nb-mine{background:var(--soft);border-radius:9px;padding:9px 12px;font-size:13px;line-height:1.7;color:#3a3f55}
.nb-err{background:var(--rose-soft);border-radius:9px;padding:9px 12px;font-size:13px;line-height:1.7;color:#7c2030}
.nb-correct{background:var(--emerald-soft);border-radius:9px;padding:9px 12px;font-size:13px;line-height:1.75}
.nb-kps{display:flex;gap:6px;flex-wrap:wrap}
.nb-kp{font-size:12px;border:1px solid #dfe2ff;background:var(--brand-soft);color:#3730a3;border-radius:7px;padding:4px 10px;cursor:pointer;font-family:ui-monospace,monospace}
.nb-kp.on{background:var(--brand);border-color:var(--brand);color:#fff}
.nb-kpbody{background:#fbfbfe;border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin-top:8px;font-size:13px;line-height:1.75}
.nb-kpbody .s{font-weight:600;margin-bottom:6px}
.nb-acts{display:flex;gap:8px;margin-top:12px}
.nb-btn{font-size:12px;border:1px solid var(--line);background:#fff;color:#3a3f55;border-radius:8px;padding:6px 12px;cursor:pointer;font-family:inherit}
.nb-btn:hover{border-color:var(--brand);color:var(--brand)}
.nb-variant{margin-top:10px;background:var(--emerald-soft);border-radius:10px;padding:12px 14px}
.nb-variant .vh{font-family:ui-monospace,monospace;font-size:11px;color:var(--emerald);text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px}
.nb-muted{font-size:12px;color:var(--faint)}
`;

function useCSS() {
  useEffect(() => {
    if (document.getElementById("nb-style")) return;
    const s = document.createElement("style");
    s.id = "nb-style";
    s.textContent = CSS;
    document.head.appendChild(s);
  }, []);
}

// 单条错题/收藏卡片
function NotebookCard({ item, existingNote, onUnstar }) {
  const [openKP, setOpenKP] = useState(null);     // 当前展开的知识点名
  const [kpData, setKpData] = useState({});       // point -> {loading, data}
  const [variant, setVariant] = useState(null);   // {loading, data}
  const isWrong = item.is_correct === false;
  const points = useMemo(
    () => [...new Set((item.knowledge_points || []).map((p) => String(p).trim()).filter(Boolean))],
    [item.knowledge_points]
  );

  const toggleKP = async (point) => {
    if (openKP === point) { setOpenKP(null); return; }
    setOpenKP(point);
    if (kpData[point]) return; // 已加载过，复用
    setKpData((m) => ({ ...m, [point]: { loading: true } }));
    try {
      const data = await explainKnowledge({ point, existingNote: existingNote?.(point) || "" });
      setKpData((m) => ({ ...m, [point]: { loading: false, data } }));
    } catch {
      setKpData((m) => ({ ...m, [point]: { loading: false, data: null } }));
    }
  };

  const makeVariant = async () => {
    setVariant({ loading: true });
    try {
      const v = await generateVariant({ question: item.question, knowledge_points: points });
      setVariant({ loading: false, data: v });
    } catch {
      setVariant({ loading: false, data: null });
    }
  };

  return (
    <div className={"nb-card" + (isWrong ? " wrong" : " star")}>
      <div className="nb-ch">
        <span className="nb-num">#{item.number || "—"}</span>
        {isWrong && <span className="nb-badge nb-b-wrong">错题{item.error_type ? ` · ${item.error_type}` : ""}</span>}
        {!isWrong && item.starred && <span className="nb-badge nb-b-star">收藏</span>}
        {item.chapter && <span className="nb-badge nb-b-ch">{item.chapter}</span>}
        <button className="nb-star" title={item.starred ? "取消收藏" : "收藏"} onClick={() => onUnstar(item)}>
          {item.starred ? "★" : "☆"}
        </button>
      </div>

      <div className="nb-q"><MathText text={item.question} /></div>

      {item.student_answer && (
        <div className="nb-sec">
          <div className="nb-lab">我的{isWrong ? "错误" : ""}解答过程</div>
          <div className="nb-mine"><MathText text={autoLatex(item.student_answer)} /></div>
        </div>
      )}

      {isWrong && (item.error_detail || item.error_type) && (
        <div className="nb-sec">
          <div className="nb-lab">错在哪里</div>
          <div className="nb-err"><MathText text={item.error_detail || `（${item.error_type || "未分类"}错误，未给出具体说明）`} /></div>
        </div>
      )}

      {item.correct_answer && (
        <div className="nb-sec">
          <div className="nb-lab">{isWrong ? "参考正确答案" : "参考答案"}</div>
          <div className="nb-correct"><MathText text={item.correct_answer} /></div>
        </div>
      )}

      {points.length > 0 && (
        <div className="nb-sec">
          <div className="nb-lab">关联知识点 · 点击展开详解</div>
          <div className="nb-kps">
            {points.map((p) => (
              <span key={p} className={"nb-kp" + (openKP === p ? " on" : "")} onClick={() => toggleKP(p)}>{p}</span>
            ))}
          </div>
          {openKP && (
            <div className="nb-kpbody">
              {kpData[openKP]?.loading && <span className="nb-muted">正在整理「{openKP}」的讲解…</span>}
              {kpData[openKP] && !kpData[openKP].loading && kpData[openKP].data && (
                <>
                  {kpData[openKP].data.summary && <div className="s"><MathText text={kpData[openKP].data.summary} /></div>}
                  {kpData[openKP].data.detail && <div><MathText text={kpData[openKP].data.detail} /></div>}
                  {(kpData[openKP].data.example) && (
                    <div style={{ marginTop: 8 }}><span className="nb-muted">例：</span><MathText text={kpData[openKP].data.example} /></div>
                  )}
                </>
              )}
              {kpData[openKP] && !kpData[openKP].loading && !kpData[openKP].data && <span className="nb-muted">讲解加载失败，请重试。</span>}
            </div>
          )}
        </div>
      )}

      <div className="nb-acts">
        <button className="nb-btn" onClick={makeVariant} disabled={variant?.loading}>
          {variant?.loading ? "出题中…" : "举一反三（出一道变式题）"}
        </button>
      </div>

      {variant && !variant.loading && variant.data && (
        <div className="nb-variant">
          <div className="vh">变式练习 · 做对说明你学会了</div>
          <div style={{ fontSize: 14, marginBottom: 8 }}><MathText text={variant.data.question} /></div>
          <details>
            <summary style={{ cursor: "pointer", fontSize: 13, color: "#047857" }}>查看答案</summary>
            <div style={{ fontSize: 13, marginTop: 6 }}><MathText text={variant.data.answer || variant.data.explanation} /></div>
          </details>
        </div>
      )}
      {variant && !variant.loading && !variant.data && <div className="nb-muted" style={{ marginTop: 8 }}>变式题生成失败，请重试。</div>}
    </div>
  );
}

export default function PaperNotebook({ supabase, userId, existingNotes = {} }) {
  useCSS();
  const wb = useMemo(() => makeWorkbenchApi(supabase), [supabase]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all"); // all | wrong | star

  const load = useCallback(async () => {
    if (!userId) { setItems([]); setLoading(false); return; }
    setLoading(true);
    try {
      setItems(await wb.listNotebook(userId));
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [wb, userId]);

  useEffect(() => { load(); }, [load]);

  const onUnstar = async (item) => {
    const next = !item.starred;
    // 乐观更新
    setItems((prev) => prev.map((x) => (x.id === item.id ? { ...x, starred: next } : x)));
    try { await wb.setStar(item.id, next); } catch { load(); }
    // 取消收藏且本身是对的题 → 不再属于错题本，移除
    if (!next && item.is_correct !== false) {
      setItems((prev) => prev.filter((x) => x.id !== item.id));
    }
  };

  const shown = items.filter((x) => {
    if (filter === "wrong") return x.is_correct === false;
    if (filter === "star") return !!x.starred;
    return true;
  });

  if (!userId) {
    return <div className="nb"><div className="nb-empty">登录后，这里会汇总你的卷子错题和收藏题。</div></div>;
  }

  return (
    <div className="nb">
      <div className="nb-filt">
        {[{ k: "all", t: "全部" }, { k: "wrong", t: "错题" }, { k: "star", t: "收藏" }].map((o) => (
          <span key={o.k} className={"nb-fb" + (filter === o.k ? " on" : "")} onClick={() => setFilter(o.k)}>{o.t}</span>
        ))}
        <span style={{ marginLeft: "auto", alignSelf: "center" }} className="nb-muted">{shown.length} 题</span>
      </div>

      {loading ? (
        <div className="nb-loading">正在加载错题本…</div>
      ) : shown.length === 0 ? (
        <div className="nb-empty">
          {filter === "star" ? "还没有收藏的题。" : "错题本还是空的。"}<br />
          批改卷子后错题会自动收录；对的题或 AI 解题点 ☆ 收藏也会进来。
        </div>
      ) : (
        shown.map((item) => (
          <NotebookCard
            key={item.id}
            item={item}
            existingNote={(p) => existingNotes[p]}
            onUnstar={onUnstar}
          />
        ))
      )}
    </div>
  );
}
