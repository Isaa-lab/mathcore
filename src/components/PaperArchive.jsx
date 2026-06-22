import React, { useCallback, useEffect, useMemo, useState } from "react";
import { makeWorkbenchApi } from "../lib/workbenchApi";

const CSS = `
.pa{--ink:#0f1220;--mut:#6b7184;--faint:#9aa0b4;--line:#e7e8ef;--soft:#f0f1f6;--card:#fff;--brand:#4338ca;--brand-soft:#eef0ff;color:var(--ink)}
.pa-loading{text-align:center;color:var(--brand);font-family:ui-monospace,monospace;font-size:13px;padding:40px}
.pa-empty{text-align:center;color:var(--faint);font-size:14px;padding:48px 14px;line-height:1.9}
.pa-card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px;margin-bottom:12px}
.pa-ch{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px}
.pa-title{font-size:14px;font-weight:600}
.pa-meta{font-family:ui-monospace,monospace;font-size:11px;color:var(--faint)}
.pa-tag{font-family:ui-monospace,monospace;font-size:11px;background:var(--brand-soft);color:#3730a3;border-radius:6px;padding:2px 8px}
.pa-del{margin-left:auto;background:none;border:none;color:#be123c;font-size:12px;cursor:pointer;font-family:inherit}
.pa-files{display:flex;gap:10px;flex-wrap:wrap}
.pa-file{display:inline-flex;flex-direction:column;align-items:center;gap:4px;cursor:pointer;text-decoration:none;color:var(--ink);width:96px}
.pa-thumb{width:96px;height:96px;border-radius:10px;border:1px solid var(--line);object-fit:cover;background:var(--soft)}
.pa-fdoc{width:96px;height:96px;border-radius:10px;border:1px solid var(--line);background:var(--soft);display:flex;align-items:center;justify-content:center;font-size:30px}
.pa-fname{font-size:11px;color:var(--mut);max-width:96px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pa-nofiles{font-size:12px;color:var(--faint)}
`;

function useCSS() {
  useEffect(() => {
    if (document.getElementById("pa-style")) return;
    const s = document.createElement("style");
    s.id = "pa-style"; s.textContent = CSS; document.head.appendChild(s);
  }, []);
}

const isImg = (name = "") => /\.(png|jpe?g|webp|gif|bmp|heic)$/i.test(name);

function PaperRow({ paper, wb, onDelete }) {
  const [files, setFiles] = useState(null); // null=未加载, []=无文件
  const [loading, setLoading] = useState(false);

  const loadFiles = useCallback(async () => {
    const paths = paper.image_urls || [];
    if (!paths.length) { setFiles([]); return; }
    setLoading(true);
    try { setFiles(await wb.signUrls(paths)); }
    catch { setFiles([]); }
    finally { setLoading(false); }
  }, [paper.image_urls, wb]);

  useEffect(() => { loadFiles(); }, [loadFiles]);

  const dt = paper.created_at ? new Date(paper.created_at).toLocaleString() : "";
  return (
    <div className="pa-card">
      <div className="pa-ch">
        <span className="pa-title">{paper.title || "未命名卷子"}</span>
        {paper.subject && <span className="pa-tag">{paper.subject}</span>}
        <span className="pa-meta">{dt}</span>
        <button className="pa-del" onClick={() => onDelete(paper)}>删除记录</button>
      </div>
      {loading ? (
        <div className="pa-nofiles">加载文件…</div>
      ) : (files && files.length) ? (
        <div className="pa-files">
          {files.map((f, i) => (
            <a key={i} className="pa-file" href={f.url} target="_blank" rel="noreferrer" download={f.name} title={f.name}>
              {isImg(f.name)
                ? <img className="pa-thumb" src={f.url} alt={f.name} />
                : <div className="pa-fdoc">{/\.pdf$/i.test(f.name) ? "📄" : "📎"}</div>}
              <span className="pa-fname">{f.name}</span>
            </a>
          ))}
        </div>
      ) : (
        <div className="pa-nofiles">（此记录未保存原始文件）</div>
      )}
    </div>
  );
}

export default function PaperArchive({ supabase, userId }) {
  useCSS();
  const wb = useMemo(() => makeWorkbenchApi(supabase), [supabase]);
  const [papers, setPapers] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!userId) { setPapers([]); setLoading(false); return; }
    setLoading(true);
    try { setPapers(await wb.listPapers(userId)); }
    catch { setPapers([]); }
    finally { setLoading(false); }
  }, [wb, userId]);

  useEffect(() => { load(); }, [load]);

  const onDelete = async (paper) => {
    if (!window.confirm("删除这条上传记录？（仅删记录，不影响已批改的错题）")) return;
    setPapers((prev) => prev.filter((p) => p.id !== paper.id));
    try { await wb.deletePaper(paper.id); } catch { load(); }
  };

  // 只展示存有原始文件的记录（空记录不展示，避免噪音）
  const shown = papers.filter((p) => (p.image_urls || []).length > 0);

  if (!userId) return <div className="pa"><div className="pa-empty">登录后查看上传记录。</div></div>;

  return (
    <div className="pa">
      {loading ? (
        <div className="pa-loading">正在加载以往记录…</div>
      ) : shown.length === 0 ? (
        <div className="pa-empty">还没有上传记录。<br />在「错题工作台」上传卷子或用 AI 解题后，原文件会保存在这里供随时下载。</div>
      ) : (
        shown.map((p) => <PaperRow key={p.id} paper={p} wb={wb} onDelete={onDelete} />)
      )}
    </div>
  );
}
