import React from "react";
import katex from "katex";
import "katex/dist/katex.min.css";

const TOKEN_RE = /(\$\$[\s\S]+?\$\$|\$[^$]+?\$|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\])/g;

function renderTex(tex, displayMode = false) {
  try {
    return katex.renderToString(tex, { throwOnError: false, displayMode });
  } catch {
    return tex;
  }
}

function looksLikePureLatex(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  if (/[\u4e00-\u9fa5]/.test(text)) return false;
  return /\\begin\{|\\frac|\\left|\\right|\\sum|\\int|\\sqrt|_\{|\^\{/.test(text)
    && !/[a-z]{4,}\s+[a-z]{4,}/i.test(text);
}

function PlainText({ value }) {
  return (
    <>
      {String(value).split("\n").map((line, index, arr) => (
        <React.Fragment key={index}>
          {line}
          {index < arr.length - 1 && <br />}
        </React.Fragment>
      ))}
    </>
  );
}

export default function MathText({ children, text }) {
  const raw = String(text != null ? text : children || "")
    // 防御：清掉任何漏到正文的 reasoning 标签（<think> / </think_never_used_…>）
    .replace(/<\/?think[^>]*>/gi, "");

  if (!raw.includes("$") && !raw.includes("\\(") && !raw.includes("\\[") && looksLikePureLatex(raw)) {
    return <span dangerouslySetInnerHTML={{ __html: renderTex(raw) }} />;
  }

  const parts = raw.split(TOKEN_RE);
  return (
    <>
      {parts.map((part, index) => {
        if (!part) return null;
        let match = part.match(/^\$\$([\s\S]+)\$\$$/);
        if (match) return <span key={index} dangerouslySetInnerHTML={{ __html: renderTex(match[1], true) }} />;
        match = part.match(/^\$([^$]+)\$$/);
        if (match) return <span key={index} dangerouslySetInnerHTML={{ __html: renderTex(match[1]) }} />;
        match = part.match(/^\\\(([\s\S]+)\\\)$/);
        if (match) return <span key={index} dangerouslySetInnerHTML={{ __html: renderTex(match[1]) }} />;
        match = part.match(/^\\\[([\s\S]+)\\\]$/);
        if (match) return <span key={index} dangerouslySetInnerHTML={{ __html: renderTex(match[1], true) }} />;
        return <PlainText key={index} value={part} />;
      })}
    </>
  );
}
