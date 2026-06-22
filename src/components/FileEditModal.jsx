import React, { useCallback, useEffect, useRef, useState } from "react";

// 点文件名打开的编辑器：旋转 + 裁剪，保存后用校正过的图片替换原文件。
// 图片 → 单页；PDF → 渲染成每页图片逐页编辑，保存后整体替换为图片文件。

let _pdfjs = null;
async function getPdfjs() {
  if (_pdfjs) return _pdfjs;
  const lib = await import("pdfjs-dist");
  lib.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).href;
  _pdfjs = lib;
  return lib;
}

function fileToDataURI(file) {
  return new Promise((res) => {
    const r = new FileReader();
    r.onerror = () => res(null);
    r.onload = (e) => res(e.target.result);
    r.readAsDataURL(file);
  });
}

async function pdfToImages(file) {
  const pdfjs = await getPdfjs();
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const out = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const raw = page.getViewport({ scale: 1 });
    const scale = Math.min(2, 1600 / raw.width);
    const vp = page.getViewport({ scale });
    const c = document.createElement("canvas");
    c.width = vp.width; c.height = vp.height;
    await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
    out.push(c.toDataURL("image/jpeg", 0.85));
  }
  return out;
}

// 顺时针旋转 deg 度
function rotateDataUri(uri, deg) {
  return new Promise((res) => {
    const img = new Image();
    img.onerror = () => res(uri);
    img.onload = () => {
      const d = ((deg % 360) + 360) % 360;
      const swap = d === 90 || d === 270;
      const c = document.createElement("canvas");
      c.width = swap ? img.height : img.width;
      c.height = swap ? img.width : img.height;
      const ctx = c.getContext("2d");
      ctx.translate(c.width / 2, c.height / 2);
      ctx.rotate((d * Math.PI) / 180);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);
      res(c.toDataURL("image/jpeg", 0.88));
    };
    img.src = uri;
  });
}

// 按比例裁剪（crop 为 0~1 的 {x,y,w,h}）
function cropDataUri(uri, crop) {
  return new Promise((res) => {
    const img = new Image();
    img.onerror = () => res(uri);
    img.onload = () => {
      const sx = Math.round(crop.x * img.width);
      const sy = Math.round(crop.y * img.height);
      const sw = Math.max(1, Math.round(crop.w * img.width));
      const sh = Math.max(1, Math.round(crop.h * img.height));
      const c = document.createElement("canvas");
      c.width = sw; c.height = sh;
      c.getContext("2d").drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      res(c.toDataURL("image/jpeg", 0.88));
    };
    img.src = uri;
  });
}

async function dataUriToFile(uri, name) {
  const blob = await (await fetch(uri)).blob();
  return new File([blob], name, { type: "image/jpeg" });
}

const CSS = `
.fe-mask{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:10000;display:flex;align-items:center;justify-content:center;padding:24px}
.fe-box{background:#fff;border-radius:14px;width:min(880px,96vw);max-height:92vh;display:flex;flex-direction:column;overflow:hidden}
.fe-hd{padding:12px 16px;border-bottom:1px solid #e7e8ef;display:flex;align-items:center;gap:10px;font-size:14px;font-weight:600}
.fe-hd .x{margin-left:auto;cursor:pointer;border:none;background:none;font-size:18px;color:#6b7184}
.fe-stage{flex:1;min-height:0;overflow:auto;background:#f3f3f7;display:flex;align-items:center;justify-content:center;padding:14px;position:relative}
.fe-imgwrap{position:relative;display:inline-block;line-height:0;cursor:crosshair;user-select:none}
.fe-imgwrap img{max-width:100%;max-height:64vh;display:block}
.fe-crop{position:absolute;border:2px solid #4338ca;background:rgba(67,56,202,.15);pointer-events:none}
.fe-tools{padding:10px 16px;border-top:1px solid #e7e8ef;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.fe-btn{font-size:13px;border:1px solid #e7e8ef;background:#fff;color:#3a3f55;border-radius:8px;padding:7px 12px;cursor:pointer;font-family:inherit}
.fe-btn:hover{border-color:#4338ca;color:#4338ca}
.fe-btn.primary{background:#4338ca;border-color:#4338ca;color:#fff}
.fe-btn:disabled{opacity:.5;cursor:not-allowed}
.fe-pg{font-size:12px;color:#6b7184;font-family:ui-monospace,monospace}
.fe-hint{font-size:11px;color:#9aa0b4}
`;

export default function FileEditModal({ file, onSave, onClose }) {
  const [pages, setPages] = useState(null); // [{src, crop}]
  const [cur, setCur] = useState(0);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(null); // {x0,y0,x1,y1} in fractions
  const wrapRef = useRef(null);

  useEffect(() => {
    if (document.getElementById("fe-style")) return;
    const s = document.createElement("style"); s.id = "fe-style"; s.textContent = CSS; document.head.appendChild(s);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      let srcs = [];
      if (file.type === "application/pdf") srcs = await pdfToImages(file);
      else { const u = await fileToDataURI(file); if (u) srcs = [u]; }
      if (alive) { setPages(srcs.map((src) => ({ src, crop: null }))); setCur(0); }
    })();
    return () => { alive = false; };
  }, [file]);

  const page = pages && pages[cur];

  const rotate = async (deg) => {
    setBusy(true);
    try {
      const rotated = await rotateDataUri(page.src, deg);
      setPages((prev) => prev.map((p, i) => (i === cur ? { src: rotated, crop: null } : p)));
      setDrag(null);
    } finally { setBusy(false); }
  };

  // 拖框裁剪：记录相对图片显示区域的比例
  const frac = (e) => {
    const r = wrapRef.current.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  };
  const onDown = (e) => { const p = frac(e); setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y }); };
  const onMove = (e) => { if (!drag) return; const p = frac(e); setDrag((d) => ({ ...d, x1: p.x, y1: p.y })); };
  const onUp = () => {
    if (!drag) return;
    const x = Math.min(drag.x0, drag.x1), y = Math.min(drag.y0, drag.y1);
    const w = Math.abs(drag.x1 - drag.x0), h = Math.abs(drag.y1 - drag.y0);
    if (w > 0.02 && h > 0.02) setPages((prev) => prev.map((p, i) => (i === cur ? { ...p, crop: { x, y, w, h } } : p)));
    setDrag(null);
  };

  const cropBoxStyle = () => {
    const c = drag
      ? { x: Math.min(drag.x0, drag.x1), y: Math.min(drag.y0, drag.y1), w: Math.abs(drag.x1 - drag.x0), h: Math.abs(drag.y1 - drag.y0) }
      : page?.crop;
    if (!c) return { display: "none" };
    return { left: `${c.x * 100}%`, top: `${c.y * 100}%`, width: `${c.w * 100}%`, height: `${c.h * 100}%` };
  };

  const save = async () => {
    setBusy(true);
    try {
      const base = (file.name || "image").replace(/\.[^.]+$/, "");
      const files = [];
      for (let i = 0; i < pages.length; i++) {
        const p = pages[i];
        const out = p.crop ? await cropDataUri(p.src, p.crop) : p.src;
        files.push(await dataUriToFile(out, pages.length > 1 ? `${base}_p${i + 1}.jpg` : `${base}.jpg`));
      }
      onSave(files);
    } finally { setBusy(false); }
  };

  return (
    <div className="fe-mask" onMouseUp={onUp}>
      <div className="fe-box" onClick={(e) => e.stopPropagation()}>
        <div className="fe-hd">
          编辑：{file.name}
          {pages && pages.length > 1 && <span className="fe-pg">第 {cur + 1}/{pages.length} 页</span>}
          <button className="x" onClick={onClose}>×</button>
        </div>
        <div className="fe-stage">
          {!pages ? (
            <span className="fe-hint">加载中…</span>
          ) : !page ? (
            <span className="fe-hint">无法读取此文件</span>
          ) : (
            <div
              ref={wrapRef}
              className="fe-imgwrap"
              onMouseDown={onDown}
              onMouseMove={onMove}
            >
              <img src={page.src} alt="编辑预览" draggable={false} />
              <div className="fe-crop" style={cropBoxStyle()} />
            </div>
          )}
        </div>
        <div className="fe-tools">
          <button className="fe-btn" disabled={busy || !page} onClick={() => rotate(-90)}>↺ 左转</button>
          <button className="fe-btn" disabled={busy || !page} onClick={() => rotate(90)}>↻ 右转</button>
          <button className="fe-btn" disabled={busy || !page?.crop} onClick={() => setPages((prev) => prev.map((p, i) => (i === cur ? { ...p, crop: null } : p)))}>清除裁剪</button>
          <span className="fe-hint">在图上拖动框选即可裁剪</span>
          {pages && pages.length > 1 && (
            <>
              <span style={{ flex: 1 }} />
              <button className="fe-btn" disabled={cur === 0} onClick={() => { setCur((c) => c - 1); setDrag(null); }}>‹ 上一页</button>
              <button className="fe-btn" disabled={cur === pages.length - 1} onClick={() => { setCur((c) => c + 1); setDrag(null); }}>下一页 ›</button>
            </>
          )}
          <span style={{ marginLeft: "auto" }} />
          <button className="fe-btn" onClick={onClose}>取消</button>
          <button className="fe-btn primary" disabled={busy || !pages} onClick={save}>{busy ? "处理中…" : "保存并替换"}</button>
        </div>
      </div>
    </div>
  );
}
