import React, { useCallback, useEffect, useMemo, useState } from "react";
import { makeWorkbenchApi } from "../lib/workbenchApi";
import { generateMockExam, autoLatex } from "../lib/workbenchAI";
import MathText from "../lib/MathText";

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
.pa-mockbar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:10px;padding-top:10px;border-top:1px dashed var(--line)}
.pa-mockbar input{padding:4px 7px;border:1px solid var(--line);border-radius:6px;font-size:12px}
.pa-mbtn{border:1px solid var(--brand);background:var(--brand-soft);color:#3730a3;border-radius:7px;padding:4px 10px;cursor:pointer;font-size:12px}
.pa-mbtn:disabled{opacity:.55;cursor:wait}
.pa-modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:4vh 0}
.pa-modal{background:#fff;border-radius:12px;max-width:min(760px,92vw);width:92vw;padding:18px;color:var(--ink)}
.pa-modal-q{border-top:1px solid var(--line);padding:10px 0;line-height:1.7}
.pa-modal-ans{margin-top:6px;background:var(--soft);border-radius:8px;padding:8px 10px;line-height:1.7}
`;

function useCSS() {
  useEffect(() => {
    if (document.getElementById("pa-style")) return;
    const s = document.createElement("style");
    s.id = "pa-style"; s.textContent = CSS; document.head.appendChild(s);
  }, []);
}

const isImg = (name = "") => /\.(png|jpe?g|webp|gif|bmp|heic)$/i.test(name);

function PaperRow({ paper, wb, userId, profiles = [], onDelete, onMock }) {
  const [files, setFiles] = useState(null); // null=未加载, []=无文件
  const [loading, setLoading] = useState(false);
  const [subject, setSubject] = useState(paper.subject || "");
  const [teacher, setTeacher] = useState("");
  const [pick, setPick] = useState("");
  const [genBusy, setGenBusy] = useState(false);

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
      <div className="pa-mockbar">
        <span className="pa-meta">按命题老师风格出模拟题：</span>
        <select value={pick} onChange={(e) => {
          const v = e.target.value; setPick(v);
          if (v === "__new__" || v === "") { setSubject(paper.subject || ""); setTeacher(""); }
          else { const p = profiles.find((x) => x.id === v); if (p) { setSubject(p.subject); setTeacher(p.teacher_name); } }
        }}>
          <option value="">选老师档案…</option>
          {profiles.map((p) => <option key={p.id} value={p.id}>{p.subject} · {p.teacher_name}（{p.sample_count || 0} 份）</option>)}
          <option value="__new__">➕ 新建</option>
        </select>
        {(pick === "" || pick === "__new__") && (
          <>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="科目" style={{ width: 90 }} />
            <input value={teacher} onChange={(e) => setTeacher(e.target.value)} placeholder="命题老师" style={{ width: 80 }} />
          </>
        )}
        <button className="pa-mbtn" disabled={genBusy}
          onClick={async () => {
            if (!subject.trim() || !teacher.trim()) { alert("填一下科目和命题老师（用过改分单学过这位老师风格更准）"); return; }
            setGenBusy(true);
            try {
              const prof = await wb.getTeacherProfile(userId, subject.trim(), teacher.trim());
              const qs = await generateMockExam({ subject: subject.trim(), teacherName: teacher.trim(), questionStyle: prof?.question_style || "", count: 5 });
              if (qs.length) onMock({ questions: qs, teacher: teacher.trim() }); else alert("没生成出模拟题，重试一下");
            } catch (e) { alert("生成失败：" + (e?.message || e)); }
            finally { setGenBusy(false); }
          }}>
          {genBusy ? "生成中…" : "🎯 出这位老师风格的模拟题"}
        </button>
      </div>
    </div>
  );
}

// 模拟题弹窗（题目 + 可展开答案/解析）
function MockModal({ data, onClose }) {
  const [open, setOpen] = useState({});
  return (
    <div className="pa-modal-bg" onClick={onClose}>
      <div className="pa-modal" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <b>🎯 {data.teacher} 风格模拟题（{data.questions.length} 道）</b>
          <button className="pa-mbtn" onClick={onClose}>关闭</button>
        </div>
        {data.questions.map((q, i) => (
          <div key={i} className="pa-modal-q">
            <div style={{ fontWeight: 600, marginBottom: 4 }}>第 {i + 1} 题</div>
            <div><MathText text={autoLatex(q.question)} /></div>
            <button className="pa-mbtn" style={{ marginTop: 6 }} onClick={() => setOpen((o) => ({ ...o, [i]: !o[i] }))}>{open[i] ? "收起" : "看答案/解析"}</button>
            {open[i] && (
              <div className="pa-modal-ans">
                {q.answer && <div><b>答案：</b><MathText text={autoLatex(q.answer)} /></div>}
                {q.explanation && <div style={{ marginTop: 4 }}><b>解析：</b><MathText text={autoLatex(q.explanation)} /></div>}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function PaperArchive({ supabase, userId }) {
  useCSS();
  const wb = useMemo(() => makeWorkbenchApi(supabase), [supabase]);
  const [papers, setPapers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [mock, setMock] = useState(null); // { questions, teacher }
  const [profiles, setProfiles] = useState([]); // 已有老师档案

  const load = useCallback(async () => {
    if (!userId) { setPapers([]); setLoading(false); return; }
    setLoading(true);
    try { setPapers(await wb.listPapers(userId)); }
    catch { setPapers([]); }
    finally { setLoading(false); }
  }, [wb, userId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { (async () => { if (userId) { try { setProfiles(await wb.listTeacherProfiles(userId)); } catch { setProfiles([]); } } })(); }, [userId, wb]);

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
        shown.map((p) => <PaperRow key={p.id} paper={p} wb={wb} userId={userId} profiles={profiles} onDelete={onDelete} onMock={setMock} />)
      )}
      {mock && <MockModal data={mock} onClose={() => setMock(null)} />}
    </div>
  );
}
