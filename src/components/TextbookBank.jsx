import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import katex from "katex";
import "katex/dist/katex.min.css";
import { makeQuestionsApi } from "../lib/questionsApi";

const CSS = `
.tb-wrap{--ink:#0f1220;--mut:#6b7184;--faint:#9aa0b4;--line:#e7e8ef;--soft:#f0f1f6;--card:#fff;--brand:#4338ca;--brand-soft:#eef0ff;--brand-ink:#3730a3;--amber:#d97706;--amber-soft:#fef3e2;--emerald:#047857;--emerald-soft:#e7f6ef;--rose:#be123c;--rose-soft:#fdeaef;--slate:#475569;--slate-soft:#eef1f5;--mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;color:var(--ink);font-family:inherit}
.tb-grid{display:grid;grid-template-columns:230px 1fr;gap:22px;align-items:start}@media(max-width:820px){.tb-grid{grid-template-columns:1fr}.tb-rail{position:static!important}}
.tb-rail{position:sticky;top:16px}.tb-panel{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px;margin-bottom:14px}
.tb-ey{font-family:var(--mono);font-size:10px;letter-spacing:.14em;color:var(--faint);text-transform:uppercase;margin:0 0 11px}
.tb-search{width:100%;border:1px solid var(--line);border-radius:9px;padding:9px 11px;font:inherit;font-size:13px;outline:none}.tb-search:focus{border-color:var(--brand)}
.tb-chips{display:flex;flex-wrap:wrap;gap:6px}.tb-chip{font-family:var(--mono);font-size:12px;border:1px solid var(--line);background:var(--card);color:#3a3f55;padding:5px 9px;border-radius:7px;cursor:pointer;transition:.12s;user-select:none}.tb-chip:hover{border-color:var(--brand)}.tb-chip.on{background:var(--brand);border-color:var(--brand);color:#fff}
.tb-startog{display:flex;align-items:center;gap:8px;font-size:13px;color:#3a3f55;cursor:pointer;user-select:none;margin-top:12px}.tb-startog input{accent-color:var(--brand);width:15px;height:15px}
.tb-meta{display:flex;gap:10px;align-items:baseline;margin:0 0 14px;font-family:var(--mono);font-size:12px;color:var(--mut)}.tb-meta b{color:var(--ink);font-size:13px}
.tb-card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 18px;margin-bottom:12px;transition:border-color .15s,box-shadow .15s}.tb-card:hover{border-color:#d7d9e6;box-shadow:0 6px 22px -16px rgba(20,22,40,.35)}.tb-card.sel{border-color:var(--brand);box-shadow:0 0 0 1px var(--brand)}
.tb-top{display:flex;align-items:center;gap:9px;margin-bottom:10px;flex-wrap:wrap}.tb-num{font-family:var(--mono);font-size:12px;color:var(--faint);min-width:30px}
.tb-tag{font-family:var(--mono);font-size:11px;padding:2px 8px;border-radius:6px;font-weight:500}.tb-ch{background:var(--slate-soft);color:var(--slate)}.tb-type{background:var(--brand-soft);color:var(--brand-ink)}
.tb-d-基础{background:var(--emerald-soft);color:var(--emerald)}.tb-d-进阶{background:var(--amber-soft);color:var(--amber)}.tb-d-挑战{background:var(--rose-soft);color:var(--rose)}.tb-s-未做{background:var(--slate-soft);color:var(--slate)}.tb-s-做对{background:var(--emerald-soft);color:var(--emerald)}.tb-s-做错{background:var(--rose-soft);color:var(--rose)}
.tb-star{margin-left:auto;cursor:pointer;color:var(--faint);font-size:17px;line-height:1;background:none;border:none;padding:4px;transition:.12s}.tb-star:hover,.tb-star.on{color:var(--amber)}
.tb-stem{font-size:15px;margin:2px 0 0}.tb-subs{margin:11px 0 0;display:grid;gap:7px}.tb-sub{display:flex;gap:9px;align-items:flex-start;font-size:14px;padding:7px 11px;background:var(--soft);border-radius:8px;overflow-x:auto}.tb-lab{font-family:var(--mono);font-size:12px;color:var(--brand);font-weight:600;flex-shrink:0;padding-top:2px}
.tb-acts{display:flex;gap:8px;margin-top:13px;align-items:center}.tb-btn{font-size:13px;border-radius:8px;padding:7px 13px;cursor:pointer;border:1px solid var(--line);background:var(--card);color:#3a3f55;transition:.12s;font-family:inherit}.tb-btn:hover{border-color:var(--brand);color:var(--brand)}.tb-btn.primary{background:var(--brand);border-color:var(--brand);color:#fff}.tb-btn.primary:hover{background:var(--brand-ink)}
.tb-ans{margin-top:11px;padding:13px 15px;background:#fbfbfe;border:1px dashed var(--line);border-radius:10px;font-size:14px;color:#3a3f55}.tb-ans-h{font-family:var(--mono);font-size:11px;letter-spacing:.1em;color:var(--faint);text-transform:uppercase;margin-bottom:7px}.tb-thm{margin-top:9px;display:flex;flex-wrap:wrap;gap:6px}.tb-thm .tg{font-family:var(--mono);font-size:11px;background:var(--brand-soft);color:var(--brand-ink);padding:2px 7px;border-radius:5px}.tb-pending{color:var(--faint);font-style:italic;font-size:13px}.tb-selck{width:16px;height:16px;accent-color:var(--brand);cursor:pointer;flex-shrink:0}.tb-empty{text-align:center;color:var(--mut);padding:60px 20px;font-size:14px}.tb-loading{text-align:center;color:var(--mut);padding:50px;font-family:var(--mono);font-size:13px}
.tb-bar{position:sticky;bottom:0;background:rgba(255,255,255,.94);backdrop-filter:blur(8px);border-top:1px solid var(--line);margin-top:8px;padding:13px 4px;display:flex;align-items:center;gap:12px}.tb-bar .cnt{font-family:var(--mono);font-size:13px;color:var(--mut)}.tb-bar .cnt b{color:var(--ink)}.tb-bar .sp{flex:1}
`;

const DIFFS = ["基础", "进阶", "挑战"];
const STATS = ["未做", "做对", "做错"];

function useInjectCSS() {
  useEffect(() => {
    if (document.getElementById("tb-style")) return;
    const style = document.createElement("style");
    style.id = "tb-style";
    style.textContent = CSS;
    document.head.appendChild(style);
  }, []);
}

function renderKatex(tex) {
  try { return katex.renderToString(String(tex || ""), { throwOnError: false, displayMode: false }); }
  catch { return String(tex || ""); }
}

function SubQuestion({ text }) {
  const match = String(text).match(/^\s*\(([a-z])\)\s*([\s\S]*)$/i);
  if (match) {
    return (
      <div className="tb-sub">
        <span className="tb-lab">({match[1]})</span>
        <span dangerouslySetInnerHTML={{ __html: renderKatex(match[2]) }} />
      </div>
    );
  }
  return <div className="tb-sub"><span dangerouslySetInnerHTML={{ __html: renderKatex(text) }} /></div>;
}

function Chip({ value, values, setValues }) {
  const active = values.has(value);
  return (
    <span
      className={`tb-chip${active ? " on" : ""}`}
      onClick={() => setValues((prev) => {
        const next = new Set(prev);
        next.has(value) ? next.delete(value) : next.add(value);
        return next;
      })}
    >
      {value}
    </span>
  );
}

export default function TextbookBank({ supabase, userId = null, onPractice }) {
  useInjectCSS();
  const api = useMemo(() => makeQuestionsApi(supabase), [supabase]);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [chapters, setChapters] = useState([]);
  const [open, setOpen] = useState(() => new Set());
  const [selected, setSelected] = useState(() => new Set());
  const [search, setSearch] = useState("");
  const [fCh, setFCh] = useState(new Set());
  const [fType, setFType] = useState(new Set());
  const [fDiff, setFDiff] = useState(new Set());
  const [fStat, setFStat] = useState(new Set());
  const [fStar, setFStar] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    const data = await api.listQuestions({ source: "textbook", owner: "public" }, userId);
    setRows(data);
    setChapters([...new Set(data.map((q) => q.chapter).filter(Boolean))].sort());
    setLoading(false);
  }, [api, userId]);

  useEffect(() => { reload(); }, [reload]);

  const shown = useMemo(() => rows.filter((q) => {
    if (fCh.size && !fCh.has(q.chapter)) return false;
    if (fType.size && !fType.has(q.type)) return false;
    if (fDiff.size && !fDiff.has(q.difficulty)) return false;
    if (fStat.size && !fStat.has(q.status)) return false;
    if (fStar && !q.starred) return false;
    if (search) {
      const hay = `${q.question} ${(q.subQuestions || []).join(" ")}`.toLowerCase();
      if (!hay.includes(search.toLowerCase())) return false;
    }
    return true;
  }), [rows, fCh, fType, fDiff, fStat, fStar, search]);
  const typeOptions = useMemo(() => {
    const set = new Set(["概念", "计算", "证明", "应用"]);
    rows.forEach((q) => { if (q.type) set.add(q.type); });
    return [...set];
  }, [rows]);

  const toggleOpen = (id) => setOpen((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const toggleSelected = (id) => setSelected((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const toggleStar = async (q) => {
    const nextStarred = !q.starred;
    setRows((prev) => prev.map((item) => item.id === q.id ? { ...item, starred: nextStarred } : item));
    await api.toggleStar(q.id, userId, nextStarred);
  };

  return (
    <div className="tb-wrap">
      <div className="tb-grid">
        <aside className="tb-rail">
          <div className="tb-panel"><p className="tb-ey">搜索</p><input className="tb-search" placeholder="搜索题目关键词..." value={search} onChange={(e) => setSearch(e.target.value)} /></div>
          <div className="tb-panel"><p className="tb-ey">章节</p><div className="tb-chips">{chapters.map((c) => <Chip key={c} value={c} values={fCh} setValues={setFCh} />)}</div></div>
          <div className="tb-panel"><p className="tb-ey">题型</p><div className="tb-chips">{typeOptions.map((t) => <Chip key={t} value={t} values={fType} setValues={setFType} />)}</div></div>
          <div className="tb-panel"><p className="tb-ey">难度</p><div className="tb-chips">{DIFFS.map((d) => <Chip key={d} value={d} values={fDiff} setValues={setFDiff} />)}</div></div>
          <div className="tb-panel">
            <p className="tb-ey">状态</p><div className="tb-chips">{STATS.map((s) => <Chip key={s} value={s} values={fStat} setValues={setFStat} />)}</div>
            <label className="tb-startog"><input type="checkbox" checked={fStar} onChange={(e) => setFStar(e.target.checked)} />只看收藏</label>
          </div>
        </aside>

        <main>
          {loading ? <div className="tb-loading">加载题库中...</div> : (
            <>
              <div className="tb-meta"><b>{shown.length}</b> 题 · 覆盖 {new Set(shown.map((r) => r.chapter)).size} 章 · 共 {rows.length} 题</div>
              {shown.length === 0 ? <div className="tb-empty">没有符合条件的题目，试试减少筛选条件</div> : shown.map((q) => {
                const isOpen = open.has(q.id);
                const isSelected = selected.has(q.id);
                return (
                  <motion.div key={q.id} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className={`tb-card${isSelected ? " sel" : ""}`}>
                    <div className="tb-top">
                      <input type="checkbox" className="tb-selck" checked={isSelected} onChange={() => toggleSelected(q.id)} />
                      <span className="tb-num">#{q.number || "-"}</span>
                      <span className="tb-tag tb-ch">{q.chapter}</span>
                      <span className="tb-tag tb-type">{q.type}</span>
                      <span className={`tb-tag tb-d-${q.difficulty}`}>{q.difficulty}</span>
                      <span className={`tb-tag tb-s-${q.status}`}>{q.status}</span>
                      <button className={`tb-star${q.starred ? " on" : ""}`} onClick={() => toggleStar(q)}>{q.starred ? "★" : "☆"}</button>
                    </div>
                    <div className="tb-stem">{q.question}</div>
                    {(q.subQuestions || []).length > 0 && <div className="tb-subs">{q.subQuestions.map((s, i) => <SubQuestion key={i} text={s} />)}</div>}
                    <div className="tb-acts">
                      <button className="tb-btn primary" onClick={() => onPractice?.([q.id])}>练这道</button>
                      <button className="tb-btn" onClick={() => toggleOpen(q.id)}>{isOpen ? "收起答案" : "查看答案"}</button>
                    </div>
                    <AnimatePresence>
                      {isOpen && (
                        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} style={{ overflow: "hidden" }}>
                          <div className="tb-ans">
                            {q.answerStatus === "generated" && q.answer ? (
                              <>
                                <div className="tb-ans-h">解析 {q.confidence === "low" ? "· 待核对" : ""}</div>
                                <div>{String(q.answer).split("\n").map((line, idx) => <React.Fragment key={idx}>{line}<br /></React.Fragment>)}</div>
                                {(q.theorems || []).length > 0 && <div className="tb-thm">{q.theorems.map((t, i) => <span key={i} className="tg">{t}</span>)}</div>}
                              </>
                            ) : <span className="tb-pending">答案尚未生成</span>}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                );
              })}
              <div className="tb-bar">
                <span className="cnt">已选 <b>{selected.size}</b> 题</span>
                <span className="sp" />
                <button className="tb-btn" onClick={() => setSelected(new Set())}>清空</button>
                <button className="tb-btn" onClick={() => setSelected(new Set(shown.map((q) => q.id)))}>全选当前</button>
                <button className="tb-btn primary" onClick={() => selected.size ? onPractice?.([...selected]) : alert("先选几道题")}>开始练习 -&gt;</button>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
