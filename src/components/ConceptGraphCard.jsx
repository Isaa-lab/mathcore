// ─────────────────────────────────────────────────────────────────────────
// ConceptGraphCard — async knowledge-graph preview rendered from a
// [GRAPH_REF:slug|label] marker in chat.
//
// Responsibility boundary:
//  · Owns the fetch + client cache lifecycle for a single graph slug
//  · Emits an `intent`-shaped payload to the parent so the existing
//    DynamicVizCard / InteractiveLab pipeline renders it unchanged
//  · Has its own skeleton / error / warn states; does NOT render the graph
//    itself (that's InteractiveLab's job)
//
// Cache strategy (v1):
//  · localStorage key `mc:cg:v1:${slug}:${provider}` — scoped by provider
//    because quality varies significantly across models
//  · 7-day TTL, only successful graphs with score >= 70 are cached
//  · Graceful degradation: if storage is full / blocked, everything still
//    works, just no cache
// ─────────────────────────────────────────────────────────────────────────

import React, { useEffect, useRef, useState } from "react";
import { DynamicVizCard } from "../pages/MaterialChatPage";

const CACHE_PREFIX = "mc:cg:v1";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MIN_CACHEABLE_SCORE = 70;

function cacheKey(slug, provider) {
  const p = provider && provider !== "server" ? provider : "platform";
  return `${CACHE_PREFIX}:${slug}:${p}`;
}

function safeGetCache(slug, provider) {
  try {
    const raw = window.localStorage.getItem(cacheKey(slug, provider));
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (!entry || !entry.ts || !entry.graph) return null;
    if (Date.now() - entry.ts > CACHE_TTL_MS) {
      window.localStorage.removeItem(cacheKey(slug, provider));
      return null;
    }
    return entry;
  } catch {
    return null;
  }
}

function safeSetCache(slug, provider, payload) {
  try {
    window.localStorage.setItem(
      cacheKey(slug, provider),
      JSON.stringify({ ts: Date.now(), ...payload }),
    );
  } catch {
    // Quota exceeded / private mode / blocked — not fatal
  }
}

// Map backend graph → vizIntent shape for DynamicVizCard / ConceptStage
function graphToIntent(graph, fallbackLabel) {
  if (!graph) return null;
  return {
    structure: "concept",
    interactionLevel: "L1",
    title: graph.centralConcept || fallbackLabel || "知识图谱",
    description: graph.summary || "",
    data: {
      nodes: Array.isArray(graph.nodes) ? graph.nodes : [],
      edges: Array.isArray(graph.edges) ? graph.edges : [],
    },
  };
}

/**
 * Props:
 *  - slug: string  (e.g. "lagrange_interpolation")
 *  - label: string (display name, e.g. "Lagrange 插值多项式")
 *  - context?: string  (optional learning context, passed to backend)
 *  - onOpen?: (intent) => void   // click → InteractiveLab
 *  - aiBody?: { userProvider?: string, userKey?: string }  // from buildAIBody()
 */
export default function ConceptGraphCard({ slug, label, context, onOpen, aiBody }) {
  const provider = aiBody?.userProvider;
  const [state, setState] = useState("loading"); // "loading" | "ready" | "error"
  const [intent, setIntent] = useState(null);
  const [validation, setValidation] = useState(null);
  const [errorDetail, setErrorDetail] = useState("");
  const [fromCache, setFromCache] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const abortRef = useRef(null);

  useEffect(() => {
    if (!slug) { setState("error"); setErrorDetail("missing slug"); return; }

    // 1. Try cache first
    const cached = safeGetCache(slug, provider);
    if (cached && cached.graph) {
      setIntent(graphToIntent(cached.graph, label));
      setValidation(cached.validation || null);
      setFromCache(true);
      setState("ready");
      return;
    }

    // 2. Miss — fetch
    let cancelled = false;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setState("loading");

    fetch("/api/concept-graph", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug,
        concept: label,
        context: context || "",
        userProvider: aiBody?.userProvider,
        userKey: aiBody?.userKey,
      }),
      signal: ctrl.signal,
    })
      .then(async (res) => {
        const txt = await res.text();
        let data = {};
        try { data = JSON.parse(txt); } catch {}
        return { res, data, rawSnippet: txt.slice(0, 400) };
      })
      .then(({ res, data, rawSnippet }) => {
        if (cancelled) return;
        if (!res.ok) {
          setState("error");
          setErrorDetail(`HTTP ${res.status}: ${data.error || data.message || rawSnippet || "unknown"}`);
          return;
        }
        if (data.error && !data.graph) {
          setState("error");
          setErrorDetail(`${data.error}: ${data.hint || ""}`);
          return;
        }
        if (data.graph) {
          const nextIntent = graphToIntent(data.graph, label);
          setIntent(nextIntent);
          setValidation(data.validation || null);
          setFromCache(false);
          setState("ready");
          // Only cache high-score graphs; low-score results should be retried next time
          if (data.validation && data.validation.score >= MIN_CACHEABLE_SCORE) {
            safeSetCache(slug, provider, { graph: data.graph, validation: data.validation });
          }
          return;
        }
        // No error, no graph, something is off
        setState("error");
        setErrorDetail("Empty response from server");
      })
      .catch((e) => {
        if (cancelled || e?.name === "AbortError") return;
        setState("error");
        setErrorDetail(String(e?.message || e));
      });

    return () => {
      cancelled = true;
      try { ctrl.abort(); } catch {}
    };
  }, [slug, provider, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  const retry = () => {
    // Drop any cached bad entry and re-fetch
    try { window.localStorage.removeItem(cacheKey(slug, provider)); } catch {}
    setErrorDetail("");
    setState("loading");
    setAttempt((a) => a + 1);
  };

  // ── LOADING ──
  if (state === "loading") {
    return (
      <div style={cardShell(true)}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={shimmer()}>
            <span />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#0F766E", letterSpacing: "0.1em", textTransform: "uppercase" }}>
              正在构建知识图谱
            </div>
            <div style={{ fontSize: 14.5, fontWeight: 800, color: "#0F172A", marginTop: 4, letterSpacing: "-0.01em" }}>
              {label || slug}
            </div>
            <div style={{ fontSize: 11.5, color: "#64748B", marginTop: 4 }}>
              首次生成通常 2-5 秒；同一概念再次打开会瞬时命中。
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── ERROR ──
  if (state === "error" || !intent) {
    return (
      <div style={{ ...cardShell(false), background: "#FFFBEB", borderColor: "#FDE68A" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <span style={{ fontSize: 18, marginTop: 1 }}>⚠️</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: "#92400E", marginBottom: 4 }}>
              知识图谱生成失败
            </div>
            <div style={{ fontSize: 12, color: "#78350F", lineHeight: 1.55 }}>
              AI 没能在这个概念上画出合格的知识网络。可以换一个 AI 引擎再试（右上角头像）。
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button onClick={retry} style={btn("primary")}>🔄 重新生成</button>
            </div>
            {errorDetail && (
              <details style={{ marginTop: 8, fontSize: 10.5, color: "#A16207" }}>
                <summary style={{ cursor: "pointer", userSelect: "none" }}>诊断详情</summary>
                <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", marginTop: 4, padding: 6, background: "#FEF3C7", borderRadius: 4, maxHeight: 160, overflow: "auto", fontSize: 10 }}>{errorDetail}</pre>
              </details>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── READY ──
  // Render the existing DynamicVizCard preview; clicking opens InteractiveLab.
  const nodeCount = intent?.data?.nodes?.length || 0;
  const edgeCount = intent?.data?.edges?.length || 0;
  const score = validation?.score;
  const isWarn = typeof score === "number" && score < MIN_CACHEABLE_SCORE;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <DynamicVizCard intent={intent} onOpen={() => onOpen && onOpen(intent)} />
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, fontSize: 11, color: "#64748B" }}>
        <span style={{ fontWeight: 700, color: "#0F766E" }}>📊 {nodeCount} 节点 · {edgeCount} 连接</span>
        {fromCache && <span style={pill("#ECFEFF", "#164E63", "#A5F3FC")}>⚡️ 缓存命中</span>}
        {!fromCache && typeof score === "number" && score >= MIN_CACHEABLE_SCORE && (
          <span style={pill("#F0FDF4", "#166534", "#BBF7D0")}>✓ 已缓存</span>
        )}
        {isWarn && (
          <span style={pill("#FFFBEB", "#92400E", "#FDE68A")} title={(validation?.issues || []).join(" · ")}>
            ⚠️ 内容偏少，换个 AI 可能更好
          </span>
        )}
        <button onClick={retry} style={{ ...btn("ghost"), marginLeft: "auto" }}>🔁 重新生成</button>
      </div>
    </div>
  );
}

// ── styling helpers (kept inline to avoid new CSS files in the project) ──
function cardShell(isSkeleton) {
  return {
    padding: "14px 16px",
    borderRadius: 14,
    border: "1px solid #E2E8F0",
    background: isSkeleton ? "linear-gradient(90deg, #F0FDFA 0%, #ECFEFF 100%)" : "#FFFFFF",
    boxShadow: "0 2px 8px rgba(15, 118, 110, 0.06)",
    margin: "8px 0",
  };
}
function shimmer() {
  return {
    width: 44, height: 44, borderRadius: 12,
    background: "linear-gradient(90deg, #A7F3D0 0%, #BAE6FD 50%, #A7F3D0 100%)",
    backgroundSize: "200% 100%",
    animation: "mc-shimmer 1.6s infinite",
  };
}
function btn(variant) {
  const base = {
    fontSize: 11.5,
    padding: "4px 10px",
    borderRadius: 999,
    border: "1px solid transparent",
    cursor: "pointer",
    fontWeight: 700,
    fontFamily: "inherit",
    transition: "all 0.15s ease",
  };
  if (variant === "primary") {
    return { ...base, background: "#0F766E", color: "#FFFFFF", borderColor: "#0F766E" };
  }
  return { ...base, background: "#FFFFFF", color: "#475569", borderColor: "#CBD5E1" };
}
function pill(bg, fg, border) {
  return {
    fontSize: 10.5, fontWeight: 700,
    padding: "2px 8px", borderRadius: 999,
    background: bg, color: fg, border: `1px solid ${border}`,
  };
}
