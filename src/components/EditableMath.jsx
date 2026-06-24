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

// 通用符号（始终显示）
const SYM_COMMON = [
  { l: "a∕b", ins: "\\frac{\\placeholder{}}{\\placeholder{}}" },
  { l: "x²", ins: "^{\\placeholder{}}" },
  { l: "xᵢ", ins: "_{\\placeholder{}}" },
  { l: "√", ins: "\\sqrt{\\placeholder{}}" },
  { l: "≤", ins: "\\le" }, { l: "≥", ins: "\\ge" }, { l: "≠", ins: "\\ne" },
  { l: "×", ins: "\\times" }, { l: "·", ins: "\\cdot" }, { l: "±", ins: "\\pm" },
];
// 学科专属符号
const SYM_SUBJECT = {
  stats: { name: "概率统计", syms: [
    { l: "μ", ins: "\\mu" }, { l: "σ", ins: "\\sigma" }, { l: "σ²", ins: "\\sigma^2" },
    { l: "x̄", ins: "\\bar{x}" }, { l: "∑", ins: "\\sum_{\\placeholder{}}^{\\placeholder{}}" },
    { l: "∫", ins: "\\int_{\\placeholder{}}^{\\placeholder{}}" }, { l: "∼", ins: "\\sim" },
    { l: "N(,)", ins: "N(\\placeholder{},\\placeholder{})" }, { l: "E[]", ins: "E[\\placeholder{}]" },
    { l: "Var", ins: "\\mathrm{Var}(\\placeholder{})" }, { l: "P()", ins: "P(\\placeholder{})" }, { l: "∞", ins: "\\infty" },
  ]},
  linalg: { name: "线性代数", syms: [
    { l: "矩阵", ins: "\\begin{pmatrix}\\placeholder{}&\\placeholder{}\\\\\\placeholder{}&\\placeholder{}\\end{pmatrix}" },
    { l: "det", ins: "\\det(\\placeholder{})" }, { l: "λ", ins: "\\lambda" }, { l: "Aᵀ", ins: "^{T}" },
    { l: "⟨,⟩", ins: "\\langle\\placeholder{},\\placeholder{}\\rangle" }, { l: "‖‖", ins: "\\|\\placeholder{}\\|" },
    { l: "vec", ins: "\\vec{\\placeholder{}}" }, { l: "∑", ins: "\\sum_{\\placeholder{}}^{\\placeholder{}}" }, { l: "I", ins: "I" },
  ]},
  calc: { name: "微积分", syms: [
    { l: "∫", ins: "\\int_{\\placeholder{}}^{\\placeholder{}}" }, { l: "d∕dx", ins: "\\frac{d}{dx}" },
    { l: "∂", ins: "\\partial" }, { l: "lim", ins: "\\lim_{\\placeholder{}}" },
    { l: "∑", ins: "\\sum_{\\placeholder{}}^{\\placeholder{}}" }, { l: "∞", ins: "\\infty" }, { l: "→", ins: "\\to" },
  ]},
};
// 从题目线索（知识点+章节+题面）判断学科，返回 通用 + 对应学科一组
function symbolsFor(hints) {
  const h = String(hints || "").toLowerCase();
  let key = null;
  if (/概率|分布|期望|方差|正态|置信|似然|样本|统计|随机|probab|distribut|variance|normal|estimat|sample|stat/.test(h)) key = "stats";
  else if (/矩阵|特征|行列式|向量|线性|对角化|matrix|eigen|determin|vector|linear|diagonal/.test(h)) key = "linalg";
  else if (/积分|导数|极限|微分|级数|integral|deriv|limit|calculus|series/.test(h)) key = "calc";
  const subj = key ? SYM_SUBJECT[key] : null;
  return { common: SYM_COMMON, subject: subj };
}

let _emStyleAdded = false;
function ensureEmStyle() {
  if (_emStyleAdded || typeof document === "undefined") return;
  _emStyleAdded = true;
  const s = document.createElement("style");
  s.textContent = `
    math-field.em-mf::part(virtual-keyboard-toggle){display:none}
    math-field.em-mf::part(menu-toggle){display:none}
    .em-palette{display:inline-flex;flex-wrap:wrap;gap:4px;margin:4px 0;vertical-align:middle}
    .em-palette button{font-size:13px;border:1px solid #e7e8ef;background:#fff;border-radius:6px;padding:2px 7px;cursor:pointer;font-family:ui-monospace,monospace;color:#3a3f55;line-height:1.5}
    .em-palette button:hover{border-color:#4338ca;color:#4338ca}
    .em-palette .lab{font-size:10px;color:#9aa0b4;align-self:center;margin:0 2px}
    .em-grid{display:inline-flex;flex-direction:column;gap:6px;margin:6px 0;padding:8px;border:1px solid #e7e8ef;border-radius:8px;background:#fafaff;vertical-align:middle}
    .em-grid-bar{display:flex;align-items:center;gap:4px;flex-wrap:wrap}
    .em-grid-bar .lab{font-size:10px;color:#9aa0b4}
    .em-grid-bar button{border:1px solid #e7e8ef;background:#fff;border-radius:6px;padding:2px 8px;cursor:pointer;font-size:13px;color:#3a3f55;line-height:1.4}
    .em-grid-bar button:hover{border-color:#4338ca;color:#4338ca}
    .em-grid-bar button.ok{background:#4338ca;border-color:#4338ca;color:#fff;font-weight:600}
    .em-grid-bar b{font-variant-numeric:tabular-nums;min-width:14px;text-align:center}
    .em-grid-cells{display:grid;gap:4px}
    .em-grid-cells input{width:48px;padding:4px 5px;border:1px solid #d7ddff;border-radius:5px;font-size:14px;text-align:center;font-family:ui-monospace,monospace}
    .em-grid-cells input:focus{outline:none;border-color:#4338ca}
  `;
  document.head.appendChild(s);
}

function MathFieldInline({ latex, hints, onCommit, onCancel }) {
  const ref = useRef(null);
  const [grid, setGrid] = useState(null);   // 矩阵网格录入：{ rows, cols, cells:string[][] }
  const gridOpenRef = useRef(false);          // 网格打开时，点输入框失焦不要提交/卸载编辑器
  useEffect(() => {
    ensureMathLive();
    ensureEmStyle();
    const el = ref.current;
    if (!el) return;
    let done = false;
    const finish = (commit) => {
      if (done) return; done = true;
      const v = el.value;
      // 防误删：math-field 还没就绪/读到空值时，blur 不要用空值覆盖原公式
      if (commit && typeof v === "string" && v.trim()) onCommit(v);
      else onCancel();
    };
    const apply = () => { try { el.value = latex; el.focus(); } catch {} };
    if (window.customElements?.whenDefined) {
      customElements.whenDefined("math-field").then(() => { if (ref.current) apply(); });
    }
    try { el.value = latex; el.mathVirtualKeyboardPolicy = "manual"; } catch {}
    const onKey = (e) => {
      // Shift+Enter：在矩阵里加一行（不提交）。普通 Enter 才提交写回。
      if (e.key === "Enter" && (e.shiftKey || e.altKey)) {
        e.preventDefault();
        try { el.executeCommand("addRowAfter"); } catch {}
      } else if (e.key === "Enter") { e.preventDefault(); finish(true); }
      else if (e.key === "Escape") { e.preventDefault(); finish(false); }
    };
    // 点面板按钮会让 math-field 失焦 → 别立刻提交：palette 用 onMouseDown preventDefault 防失焦
    // 矩阵网格录入打开时，点网格输入框会失焦，但不能提交/卸载，否则网格消失
    const onBlur = () => { if (gridOpenRef.current) return; finish(true); };
    el.addEventListener("keydown", onKey);
    el.addEventListener("focusout", onBlur);
    setTimeout(apply, 100);
    return () => { el.removeEventListener("keydown", onKey); el.removeEventListener("focusout", onBlur); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const insert = (ins) => { try { ref.current?.insert(ins, { focus: true }); ref.current?.focus(); } catch {} };
  // 矩阵增删行列：MathLive 命令，只在光标位于矩阵内才生效（否则无操作）
  const exec = (cmd) => { try { ref.current?.executeCommand(cmd); ref.current?.focus(); } catch {} };
  const { common, subject } = symbolsFor(hints);

  // ── 矩阵网格录入：选行列、逐格填，生成 \begin{bmatrix}… ──
  const openGrid = () => { gridOpenRef.current = true; setGrid({ rows: 2, cols: 2, cells: [["", ""], ["", ""]] }); };
  const closeGrid = () => { gridOpenRef.current = false; setGrid(null); };
  const resizeGrid = (rows, cols) => setGrid((g) => ({
    rows, cols,
    cells: Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => g?.cells?.[i]?.[j] ?? "")),
  }));
  const setCell = (i, j, v) => setGrid((g) => {
    const cells = g.cells.map((r) => r.slice()); cells[i][j] = v; return { ...g, cells };
  });
  const insertMatrix = () => {
    if (!grid) return;
    const body = grid.cells.map((r) => r.map((c) => (String(c).trim() || "0")).join(" & ")).join(" \\\\ ");
    gridOpenRef.current = false;
    setGrid(null);
    insert(`\\begin{bmatrix}${body}\\end{bmatrix}`);
  };

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", verticalAlign: "middle", gap: 2 }}>
      <math-field
        ref={ref}
        class="em-mf"
        style={{ display: "inline-block", minWidth: "70px", fontSize: "17px", padding: "2px 6px", border: "1.5px solid var(--brand, #4338ca)", borderRadius: "6px", background: "#fff" }}
      />
      <span className="em-palette" onMouseDown={(e) => e.preventDefault()}>
        <span className="lab">矩阵</span>
        <button type="button" title="按行列填数字生成矩阵（识别不准时用这个，100%准）" onClick={openGrid}>▦ 矩阵录入</button>
        <button type="button" title="在光标所在矩阵下方加一行（也可按 Shift+Enter）" onClick={() => exec("addRowAfter")}>＋行</button>
        <button type="button" title="在光标所在矩阵右侧加一列" onClick={() => exec("addColumnAfter")}>＋列</button>
        <button type="button" title="删除光标所在的矩阵行" onClick={() => exec("removeRow")}>－行</button>
        <button type="button" title="删除光标所在的矩阵列" onClick={() => exec("removeColumn")}>－列</button>
        <span className="lab">·</span>
        {common.map((s) => <button key={s.l} type="button" onClick={() => insert(s.ins)}>{s.l}</button>)}
        {subject && <span className="lab">· {subject.name}</span>}
        {subject && subject.syms.map((s) => <button key={s.l} type="button" onClick={() => insert(s.ins)}>{s.l}</button>)}
      </span>
      {grid && (
        <span className="em-grid" onMouseDown={(e) => e.stopPropagation()}>
          <span className="em-grid-bar">
            <span className="lab">行</span>
            <button type="button" onClick={() => resizeGrid(Math.max(1, grid.rows - 1), grid.cols)}>－</button>
            <b>{grid.rows}</b>
            <button type="button" onClick={() => resizeGrid(Math.min(8, grid.rows + 1), grid.cols)}>＋</button>
            <span className="lab" style={{ marginLeft: 8 }}>列</span>
            <button type="button" onClick={() => resizeGrid(grid.rows, Math.max(1, grid.cols - 1))}>－</button>
            <b>{grid.cols}</b>
            <button type="button" onClick={() => resizeGrid(grid.rows, Math.min(8, grid.cols + 1))}>＋</button>
          </span>
          <span className="em-grid-cells" style={{ gridTemplateColumns: `repeat(${grid.cols}, 1fr)` }}>
            {grid.cells.map((row, i) => row.map((c, j) => (
              <input
                key={`${i}-${j}`}
                value={c}
                placeholder="0"
                onChange={(e) => setCell(i, j, e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); insertMatrix(); } }}
              />
            )))}
          </span>
          <span className="em-grid-bar">
            <button type="button" className="ok" onClick={insertMatrix}>插入矩阵</button>
            <button type="button" onClick={closeGrid}>取消</button>
            <span className="lab">支持分数等，如 1/2 或 \frac{`{1}{2}`}</span>
          </span>
        </span>
      )}
    </span>
  );
}

export default function EditableMath({ value, onChange, placeholder, hints }) {
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
            return <MathFieldInline key={i} latex={latex} hints={hints} onCommit={(v) => commit(i, v, display)} onCancel={() => setEditIdx(-1)} />;
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
