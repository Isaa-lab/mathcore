import React, { useEffect, useRef, useState } from "react";
import MathText from "../lib/MathText";
import { generateVariant, tutorReply } from "../lib/workbenchAI";

const CSS = `
.tc{--ink:#0f1220;--mut:#6b7184;--faint:#9aa0b4;--line:#e7e8ef;--soft:#f0f1f6;--brand:#4338ca;--emerald:#047857;--emerald-soft:#e7f6ef;color:var(--ink);height:100%;display:flex;flex-direction:column}
.tc-head{border-bottom:1px solid var(--line);padding-bottom:12px;margin-bottom:12px}.tc-head .t{font-size:15px;font-weight:600}.tc-head .s{font-size:12px;color:var(--mut);margin-top:3px}
.tc-msgs{flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:12px;padding-right:4px}.tc-msg{max-width:88%;padding:11px 14px;border-radius:13px;font-size:14px;line-height:1.65}
.tc-ai{background:var(--soft);align-self:flex-start;border-bottom-left-radius:4px}.tc-user{background:var(--brand);color:#fff;align-self:flex-end;border-bottom-right-radius:4px}.tc-typing{font-family:ui-monospace,monospace;font-size:12px;color:var(--brand);align-self:flex-start;padding:6px 4px}
.tc-input{display:flex;gap:8px;margin-top:12px;border-top:1px solid var(--line);padding-top:12px}.tc-ta{flex:1;border:1px solid var(--line);border-radius:10px;padding:10px 12px;font:inherit;font-size:14px;resize:none;outline:none;max-height:90px}.tc-ta:focus{border-color:var(--brand)}.tc-send{background:var(--brand);color:#fff;border:none;border-radius:10px;padding:0 18px;cursor:pointer;font-family:inherit;font-size:14px}.tc-send:disabled{opacity:.5;cursor:not-allowed}
.tc-empty{flex:1;display:flex;align-items:center;justify-content:center;text-align:center;color:var(--faint);font-size:14px;line-height:1.8}.tc-variant{margin-top:10px;background:var(--emerald-soft);border-radius:11px;padding:12px 14px}.tc-variant .vh{font-family:ui-monospace,monospace;font-size:11px;color:var(--emerald);text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px}
.tc-tools{display:flex;gap:8px;margin-top:10px}.tc-tool{font-size:12px;border:1px solid var(--line);background:#fff;color:#3a3f55;border-radius:8px;padding:6px 12px;cursor:pointer;font-family:inherit}
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
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [variant, setVariant] = useState(null);
  const endRef = useRef(null);

  useEffect(() => {
    setMsgs([]);
    setVariant(null);
    if (!item) return;
    let alive = true;
    (async () => {
      setBusy(true);
      try {
        const opener = await tutorReply({
          item,
          history: [],
          userMessage: "请用引导的方式，帮我看看这道题我哪里错了，先别直接告诉我答案。",
        });
        if (alive) setMsgs([{ role: "assistant", content: opener }]);
      } catch {
        if (alive) setMsgs([{ role: "assistant", content: "辅导加载失败，请重试。" }]);
      } finally {
        if (alive) setBusy(false);
      }
    })();
    return () => { alive = false; };
  }, [item]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, busy]);

  const send = async () => {
    if (!input.trim() || busy || !item) return;
    const userText = input.trim();
    setInput("");
    const next = [...msgs, { role: "user", content: userText }];
    setMsgs(next);
    setBusy(true);
    try {
      const reply = await tutorReply({ item, history: msgs, userMessage: userText });
      setMsgs([...next, { role: "assistant", content: reply }]);
    } catch {
      setMsgs([...next, { role: "assistant", content: "回复失败，请重试。" }]);
    } finally {
      setBusy(false);
    }
  };

  const makeVariant = async () => {
    if (!item) return;
    setBusy(true);
    try {
      setVariant(await generateVariant(item));
    } finally {
      setBusy(false);
    }
  };

  if (!item) {
    return <div className="tc"><div className="tc-empty">点击左边一道错题<br />我会一对一帮你讲懂它</div></div>;
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
