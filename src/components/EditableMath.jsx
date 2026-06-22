import React, { useEffect, useRef, useState } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";

// 点公式就地改：默认渲染公式，点某段公式 → 原地变成 MathLive 可视化编辑器，
// 失焦/回车写回并重新渲染；文字段保持纯文本。无需懂 LaTeX。
let _mlLoading = null;
function ensureMathLive() {
  if (!_mlLoading) {
    _mlLoading = import("mathlive").then((m) => {
      // npm 打包版默认找不到字体/音效(404)，会导致符号和虚拟键盘渲染异常 → 指到 CDN
      try {
        const E = m.MathfieldElement;
        if (E) {
          E.fontsDirectory = "https://cdn.jsdelivr.net/npm/mathlive/dist/fonts";
          E.soundsDirectory = null;
        }
      } catch {}
    }).catch(() => {});
  }
  return _mlLoading;
}

const TOKEN_RE = /(\$\$[\s\S]+?\$\$|\$[^$]+?\$)/g;
function renderTex(tex, display) {
  try { return katex.renderToString(tex, { throwOnError: false, displayMode: display }); }
  catch { return tex; }
}

function MathFieldInline({ latex, onCommit, onCancel }) {
  const ref = useRef(null);
  useEffect(() => {
    ensureMathLive();
    const el = ref.current;
    if (!el) return;
    let done = false;
    const finish = (commit) => {
      if (done) return; done = true;
      if (commit) onCommit(el.value); else onCancel();
    };
    const apply = () => { try { el.value = latex; el.focus(); } catch {} };
    if (window.customElements?.whenDefined) {
      customElements.whenDefined("math-field").then(() => { if (ref.current) apply(); });
    }
    try { el.value = latex; } catch {}
    const onKey = (e) => {
      if (e.key === "Enter") { e.preventDefault(); finish(true); }
      else if (e.key === "Escape") { e.preventDefault(); finish(false); }
    };
    const onBlur = () => finish(true);
    el.addEventListener("keydown", onKey);
    el.addEventListener("focusout", onBlur);
    setTimeout(apply, 100);
    return () => { el.removeEventListener("keydown", onKey); el.removeEventListener("focusout", onBlur); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <math-field
      ref={ref}
      class="em-mf"
      style={{ display: "inline-block", minWidth: "70px", fontSize: "17px", padding: "2px 6px", border: "1.5px solid var(--brand, #4338ca)", borderRadius: "6px", background: "#fff", verticalAlign: "middle" }}
    />
  );
}

export default function EditableMath({ value, onChange, placeholder }) {
  const [editIdx, setEditIdx] = useState(-1);
  useEffect(() => { ensureMathLive(); }, []);

  const raw = String(value || "");
  if (!raw.trim()) return <span className="em-empty">{placeholder || "（空白）"}</span>;
  const parts = raw.split(TOKEN_RE);

  const commit = (idx, newLatex, display) => {
    const clean = String(newLatex || "").trim();
    const next = parts.slice();
    next[idx] = clean ? (display ? `$$${clean}$$` : `$${clean}$`) : "";
    setEditIdx(-1);
    onChange(next.join(""));
  };

  return (
    <span className="em">
      {parts.map((part, i) => {
        if (!part) return null;
        const mDisplay = part.match(/^\$\$([\s\S]+)\$\$$/);
        const mInline = part.match(/^\$([^$]+)\$$/);
        if (mDisplay || mInline) {
          const display = !!mDisplay;
          const latex = display ? mDisplay[1] : mInline[1];
          if (editIdx === i) {
            return <MathFieldInline key={i} latex={latex} onCommit={(v) => commit(i, v, display)} onCancel={() => setEditIdx(-1)} />;
          }
          return (
            <span
              key={i}
              className="em-math"
              title="点击修改这个公式"
              onClick={(e) => { e.stopPropagation(); ensureMathLive(); setEditIdx(i); }}
              dangerouslySetInnerHTML={{ __html: renderTex(latex, display) }}
            />
          );
        }
        return (
          <span key={i}>
            {part.split("\n").map((ln, j, arr) => (
              <React.Fragment key={j}>{ln}{j < arr.length - 1 && <br />}</React.Fragment>
            ))}
          </span>
        );
      })}
    </span>
  );
}
