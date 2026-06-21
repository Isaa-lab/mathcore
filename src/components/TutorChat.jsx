import React, { useEffect, useRef, useState } from "react";
import MathText from "../lib/MathText";
import { generateVariant, tutorReply } from "../lib/workbenchAI";
import { callGenerate } from "../lib/aiClient";

const CSS = `
.tc{--ink:#0f1220;--mut:#6b7184;--faint:#9aa0b4;--line:#e7e8ef;--soft:#f0f1f6;--brand:#4338ca;--emerald:#047857;--emerald-soft:#e7f6ef;color:var(--ink);height:100%;flex:1;min-height:0;display:flex;flex-direction:column}
.tc-head{flex:0 0 auto;border-bottom:1px solid var(--line);padding-bottom:12px;margin-bottom:12px}.tc-head .t{font-size:15px;font-weight:600}.tc-head .s{font-size:12px;color:var(--mut);margin-top:3px}
.tc-msgs{flex:1 1 auto;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:12px;padding-right:4px}.tc-msg{max-width:88%;padding:11px 14px;border-radius:13px;font-size:14px;line-height:1.65}
.tc-ai{background:var(--soft);align-self:flex-start;border-bottom-left-radius:4px}.tc-user{background:var(--brand);color:#fff;align-self:flex-end;border-bottom-right-radius:4px}.tc-typing{font-family:ui-monospace,monospace;font-size:12px;color:var(--brand);align-self:flex-start;padding:6px 4px}
.tc-input{flex:0 0 auto;display:flex;gap:8px;margin-top:12px;border-top:1px solid var(--line);padding-top:12px}.tc-ta{flex:1;border:1px solid var(--line);border-radius:10px;padding:10px 12px;font:inherit;font-size:14px;resize:none;outline:none;max-height:90px}.tc-ta:focus{border-color:var(--brand)}.tc-send{background:var(--brand);color:#fff;border:none;border-radius:10px;padding:0 18px;cursor:pointer;font-family:inherit;font-size:14px}.tc-send:disabled{opacity:.5;cursor:not-allowed}
.tc-empty{flex:1;display:flex;align-items:center;justify-content:center;text-align:center;color:var(--faint);font-size:14px;line-height:1.8}.tc-variant{margin-top:10px;background:var(--emerald-soft);border-radius:11px;padding:12px 14px}.tc-variant .vh{font-family:ui-monospace,monospace;font-size:11px;color:var(--emerald);text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px}
.tc-tools{flex:0 0 auto;display:flex;gap:8px;margin-top:10px}.tc-tool{font-size:12px;border:1px solid var(--line);background:#fff;color:#3a3f55;border-radius:8px;padding:6px 12px;cursor:pointer;font-family:inherit}
`;

function useCSS() {
  React.useEffect(() => {
    if (document.getElementById("tc-style")) return;
    const style = document.createElement("style");
    style.id = "tc-style";
    style.textContent = CSS;
    document.head.appendChild(style);
  }, []);
}

export default function TutorChat({ item }) {
  useCSS();
  // 每道题独立保存对话：key = `q_${item.id}`；无题（自由问答）用 "__free"。
  // 切到 Q2 再切回 Q1 时，convos["q_<Q1>"] 仍在，直接恢复，不重新开场。
  const [convos, setConvos] = useState({});   // key -> messages[]
  const [variants, setVariants] = useState({}); // key -> variant
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const startedRef = useRef({}); // 记录哪些 key 已自动开场，避免重复触发
  const endRef = useRef(null);

  const key = item ? `q_${item.id}` : "__free";
  const msgs = convos[key] || [];
  const variant = variants[key] || null;

  const setMsgsFor = (k, updater) =>
    setConvos((prev) => ({ ...prev, [k]: typeof updater === "function" ? updater(prev[k] || []) : updater }));

  // 自动开场：仅当这道错题还没有任何对话、且未开场过时触发
  useEffect(() => {
    if (!item) return;
    if (startedRef.current[key]) return;
    if ((convos[key] || []).length > 0) { startedRef.current[key] = true; return; }
    startedRef.current[key] = true;
    let alive = true;
    (async () => {
      setBusy(true);
      try {
        const opener = await tutorReply({
          item,
          history: [],
          userMessage: "请用引导的方式，帮我看看这道题我哪里错了，先别直接告诉我答案。",
        });
        if (alive) setMsgsFor(key, [{ role: "assistant", content: opener }]);
      } catch {
        if (alive) setMsgsFor(key, [{ role: "assistant", content: "辅导加载失败，请重试。" }]);
      } finally {
        if (alive) setBusy(false);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item, key]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, busy]);

  const send = async () => {
    if (!input.trim() || busy || !item) return;
    const userText = input.trim();
    setInput("");
    const history = convos[key] || [];
    const next = [...history, { role: "user", content: userText }];
    setMsgsFor(key, next);
    setBusy(true);
    try {
      const reply = await tutorReply({ item, history, userMessage: userText });
      setMsgsFor(key, [...next, { role: "assistant", content: reply }]);
    } catch {
      setMsgsFor(key, [...next, { role: "assistant", content: "回复失败，请重试。" }]);
    } finally {
      setBusy(false);
    }
  };

  const makeVariant = async () => {
    if (!item) return;
    setBusy(true);
    try {
      const v = await generateVariant(item);
      setVariants((prev) => ({ ...prev, [key]: v }));
    } finally {
      setBusy(false);
    }
  };

  const sendFree = async () => {
    if (!input.trim() || busy) return;
    const userText = input.trim();
    setInput("");
    const history = convos[key] || [];
    const next = [...history, { role: "user", content: userText }];
    setMsgsFor(key, next);
    setBusy(true);
    try {
      const system = "你是耐心的线性代数私教，用简洁、引导式的方式回答学生关于线性代数的问题。公式用 $...$ 包裹。";
      const reply = await callGenerate(
        [{ role: "user", content: system }, ...history, { role: "user", content: userText }],
        { json: false, materialTitle: "通用线性代数辅导" }
      );
      setMsgsFor(key, [...next, { role: "assistant", content: reply }]);
    } catch {
      setMsgsFor(key, [...next, { role: "assistant", content: "回复失败，请重试。" }]);
    } finally {
      setBusy(false);
    }
  };

  if (!item) {
    return (
      <div className="tc">
        <div className="tc-head">
          <div className="t">AI 辅导</div>
          <div className="s">随便问我线性代数问题，或点左边错题做针对性讲解</div>
        </div>
        <div className="tc-msgs">
          {msgs.length === 0 && (
            <div className="tc-msg tc-ai">
              <MathText text={'你好！我是你的线性代数私教。可以直接问我，比如“行列式怎么算”，也可以点左边错题，我来一对一帮你讲懂。'} />
            </div>
          )}
          {msgs.map((msg, index) => (
            <div key={index} className={"tc-msg " + (msg.role === "user" ? "tc-user" : "tc-ai")}>
              <MathText text={msg.content} />
            </div>
          ))}
          {busy && <div className="tc-typing">AI 正在思考...</div>}
          <div ref={endRef} />
        </div>
        <div className="tc-input">
          <textarea
            className="tc-ta"
            rows={1}
            placeholder="问我任何线性代数问题..."
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                sendFree();
              }
            }}
          />
          <button className="tc-send" onClick={sendFree} disabled={busy || !input.trim()}>发送</button>
        </div>
      </div>
    );
  }

  return (
    <div className="tc">
      <div className="tc-head">
        <div className="t">一对一辅导 · 第 {item.number || "—"} 题</div>
        <div className="s">{(item.knowledge_points || []).join(" · ")} {item.error_type ? `· ${item.error_type}错误` : ""}</div>
      </div>
      <div className="tc-msgs">
        {msgs.map((msg, index) => (
          <div key={index} className={"tc-msg " + (msg.role === "user" ? "tc-user" : "tc-ai")}>
            <MathText text={msg.content} />
          </div>
        ))}
        {busy && <div className="tc-typing">AI 正在思考...</div>}
        {variant && (
          <div className="tc-variant">
            <div className="vh">变式练习 · 做对说明你学会了</div>
            <div style={{ fontSize: 14, marginBottom: 8 }}><MathText text={variant.question} /></div>
            <details>
              <summary style={{ cursor: "pointer", fontSize: 13, color: "#047857" }}>查看答案</summary>
              <div style={{ fontSize: 13, marginTop: 6 }}><MathText text={variant.answer || variant.explanation} /></div>
            </details>
          </div>
        )}
        <div ref={endRef} />
      </div>
      <div className="tc-tools">
        <button className="tc-tool" onClick={makeVariant} disabled={busy}>出一道变式题</button>
      </div>
      <div className="tc-input">
        <textarea
          className="tc-ta"
          rows={1}
          placeholder="问我任何不懂的地方..."
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
        />
        <button className="tc-send" onClick={send} disabled={busy || !input.trim()}>发送</button>
      </div>
    </div>
  );
}
