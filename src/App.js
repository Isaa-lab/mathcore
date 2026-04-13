import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createClient } from "@supabase/supabase-js";
import katex from "katex";
import "katex/dist/katex.min.css";

// Inject global CSS animations
(() => {
  if (document.getElementById("mc-global-styles")) return;
  const style = document.createElement("style");
  style.id = "mc-global-styles";
  style.textContent = `
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
    @keyframes popIn {
      0% { transform: scale(0.5); opacity: 0; }
      70% { transform: scale(1.08); opacity: 1; }
      100% { transform: scale(1); }
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes slideUp {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }
    button:focus-visible { outline: 2px solid #1D9E75; outline-offset: 2px; }
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: #ddd; border-radius: 3px; }
  `
  document.head.appendChild(style);
})();


// Update daily streak in localStorage
(() => {
  try {
    const today = new Date().toDateString();
    const data = JSON.parse(localStorage.getItem("mc_streak") || "{}");
    if (data.lastVisit !== today) {
      const yesterday = new Date(Date.now() - 86400000).toDateString();
      const days = data.lastVisit === yesterday ? (data.days || 0) + 1 : 1;
      localStorage.setItem("mc_streak", JSON.stringify({ days, lastVisit: today }));
    }
  } catch(e) {}
})();

const supabase = createClient(
  "https://kadjwgslbpklwbpvpsze.supabase.co",
  "sb_publishable_TvfRCNQCSs92EmZ02J5H1A_yM3FrFUp"
);

const G = {
  teal: "#1D9E75", tealLight: "#E1F5EE", tealDark: "#0F6E56",
  blue: "#185FA5", blueLight: "#E6F1FB",
  amber: "#BA7517", amberLight: "#FAEEDA",
  red: "#A32D2D", redLight: "#FCEBEB",
  purple: "#534AB7", purpleLight: "#EEEDFE",
};

// ── Badge System ─────────────────────────────────────────────────────────────
const BADGES = [
  { id: "first_answer",   emoji: "🌱", name: "初学者",    desc: "完成第一道题",          check: (st) => st.totalAnswered >= 1 },
  { id: "perfect_score",  emoji: "🎯", name: "神枪手",    desc: "单次练习全部答对",       check: (st) => st.hadPerfect },
  { id: "streak3",        emoji: "🔥", name: "坚持者",    desc: "连续学习 3 天",          check: (st) => st.streak >= 3 },
  { id: "streak7",        emoji: "⚡", name: "铁杆学霸",  desc: "连续学习 7 天",          check: (st) => st.streak >= 7 },
  { id: "wrong_killer",   emoji: "💪", name: "错题杀手",  desc: "攻克 5 道错题",          check: (st) => st.masteredWrong >= 5 },
  { id: "ace",            emoji: "🏆", name: "数学达人",  desc: "总正确率超过 80%",       check: (st) => st.overallAccuracy >= 80 },
  { id: "scholar",        emoji: "📚", name: "博学者",    desc: "累计学习时长超 60 分钟", check: (st) => st.totalMinutes >= 60 },
  { id: "all_chapters",   emoji: "🌈", name: "全能学霸",  desc: "练习 5 个及以上章节",    check: (st) => st.chaptersAttempted >= 5 },
  { id: "century",        emoji: "💯", name: "百题王",    desc: "累计答对 100 道题",      check: (st) => st.totalCorrect >= 100 },
  { id: "speed",          emoji: "⚡", name: "闪电答题",  desc: "30 秒内完成一题",        check: (st) => st.hadSpeedAnswer },
];

const getBadgeStats = () => {
  try {
    const answers = JSON.parse(localStorage.getItem("mc_answers") || "{}");
    const streak = JSON.parse(localStorage.getItem("mc_streak") || "{}").days || 0;
    const timeData = JSON.parse(localStorage.getItem("mc_study_time") || "{}");
    const wrongMastered = JSON.parse(localStorage.getItem("mc_wrong_mastered") || "0");
    const sessions = JSON.parse(localStorage.getItem("mc_sessions") || "[]");
    const totalMinutes = Math.round((timeData.totalSeconds || 0) / 60);
    const allAnswers = Object.values(answers);
    const totalAnswered = allAnswers.length;
    const totalCorrect = allAnswers.filter(Boolean).length;
    const overallAccuracy = totalAnswered > 0 ? Math.round(totalCorrect / totalAnswered * 100) : 0;
    const chaptersAttempted = new Set(Object.keys(JSON.parse(localStorage.getItem("mc_chapter_answers") || "{}"))).size;
    const hadPerfect = sessions.some(s => s.correct === s.total && s.total >= 5);
    const hadSpeedAnswer = JSON.parse(localStorage.getItem("mc_had_speed") || "false");
    return { totalAnswered, totalCorrect, overallAccuracy, streak, totalMinutes, masteredWrong: Number(wrongMastered), chaptersAttempted, hadPerfect, hadSpeedAnswer };
  } catch { return { totalAnswered: 0, totalCorrect: 0, overallAccuracy: 0, streak: 0, totalMinutes: 0, masteredWrong: 0, chaptersAttempted: 0, hadPerfect: false, hadSpeedAnswer: false }; }
};

const getUnlockedBadges = () => {
  const stats = getBadgeStats();
  return BADGES.filter(b => b.check(stats));
};

// Study time tracker helper (call on quiz start/end)
const recordStudyTime = (seconds) => {
  try {
    const data = JSON.parse(localStorage.getItem("mc_study_time") || "{}");
    data.totalSeconds = (data.totalSeconds || 0) + seconds;
    localStorage.setItem("mc_study_time", JSON.stringify(data));
  } catch {}
};


// ── SM-2 Spaced Repetition ───────────────────────────────────────────────────
const SM2 = {
  get(cardId) {
    try {
      const all = JSON.parse(localStorage.getItem("mc_sr") || "{}");
      return all[cardId] || { interval: 1, repetitions: 0, easeFactor: 2.5, dueDate: null };
    } catch { return { interval: 1, repetitions: 0, easeFactor: 2.5, dueDate: null }; }
  },
  update(cardId, quality) { // quality: 0=完全忘记, 3=模糊记得, 5=完全记得
    try {
      const all = JSON.parse(localStorage.getItem("mc_sr") || "{}");
      let { interval, repetitions, easeFactor } = this.get(cardId);
      if (quality < 3) {
        repetitions = 0;
        interval = 1;
      } else {
        if (repetitions === 0) interval = 1;
        else if (repetitions === 1) interval = 6;
        else interval = Math.round(interval * easeFactor);
        repetitions += 1;
      }
      easeFactor = Math.max(1.3, easeFactor + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
      const dueDate = new Date(Date.now() + interval * 86400000).toISOString();
      all[cardId] = { interval, repetitions, easeFactor, dueDate };
      localStorage.setItem("mc_sr", JSON.stringify(all));
    } catch {}
  },
  isDue(cardId) {
    const d = this.get(cardId);
    if (!d.dueDate) return true;
    return new Date(d.dueDate) <= new Date();
  },
  getDueCount(cards) {
    return cards.filter(c => this.isDue(c.front || c.id || c.question)).length;
  }
};


// Course → color mapping for consistent UI theming
const COURSE_COLOR = {
  "数值分析": "teal",
  "最优化": "purple",
  "线性代数": "blue",
  "概率论": "amber",
  "数理统计": "red",
  "ODE": "teal",
};
const getCourseColor = (course = "") => COURSE_COLOR[course] || "blue";
const COURSE_BORDER = {
  teal: G.teal, blue: G.blue, amber: G.amber, red: G.red, purple: G.purple,
};
const getCourseBorderColor = (course = "") => COURSE_BORDER[getCourseColor(course)] || G.blue;

const MATERIAL_ALLOWED_EXTS = [".pdf", ".ppt", ".pptx", ".doc", ".docx"];

/** materials 表尚未执行审核迁移（无 status 列）时，PostgREST 会报 PGRST204 */
const isMissingMaterialsStatusColumn = (err) => {
  const msg = String(err?.message || "");
  const code = String(err?.code || "");
  if (/Could not find the ['"]status['"] column of ['"]materials['"]/i.test(msg)) return true;
  if (/column\s+.*\bstatus\b.*does not exist/i.test(msg)) return true;
  if ((code === "PGRST204" || msg.includes("PGRST204")) && /\bstatus\b/i.test(msg) && /\bmaterials\b/i.test(msg)) {
    return true;
  }
  return false;
};

const isMissingQuestionsMaterialIdColumn = (err) => {
  const msg = String(err?.message || "");
  const code = String(err?.code || "");
  if (/Could not find the ['"]material_id['"] column of ['"]questions['"]/i.test(msg)) return true;
  if (/column\s+.*\bmaterial_id\b.*does not exist/i.test(msg)) return true;
  if ((code === "PGRST204" || msg.includes("PGRST204")) && /\bmaterial_id\b/i.test(msg) && /\bquestions\b/i.test(msg)) {
    return true;
  }
  return false;
};

const isMissingQuestionsQualityColumns = (err) => {
  const msg = String(err?.message || "");
  const code = String(err?.code || "");
  if (/Could not find the ['"](source_chunk_id|source_quote|quality_score)['"] column of ['"]questions['"]/i.test(msg)) return true;
  if (/column\s+.*\b(source_chunk_id|source_quote|quality_score)\b.*does not exist/i.test(msg)) return true;
  if ((code === "PGRST204" || msg.includes("PGRST204")) && /\bquestions\b/i.test(msg) && /\b(source_chunk_id|source_quote|quality_score)\b/i.test(msg)) {
    return true;
  }
  return false;
};

const getFileExt = (name = "") => {
  const idx = name.lastIndexOf(".");
  return idx >= 0 ? name.slice(idx).toLowerCase() : "";
};

// ── AI 配置工具（读/写 localStorage）────────────────────────────────────────
const getAIConfig = () => ({
  provider: localStorage.getItem("mc_ai_provider") || "groq",
  key: localStorage.getItem("mc_ai_key") || "",
  customUrl: localStorage.getItem("mc_ai_custom_url") || "",
});

// ── AI 设置弹窗 ───────────────────────────────────────────────────────────────
function AISettingsModal({ onClose }) {
  const AI_PROVIDERS = [
    { id: "groq",     name: "Groq",      flag: "⚡", desc: "完全免费·速度最快·推荐测试", placeholder: "gsk_...",      link: "https://console.groq.com/keys", free: true },
    { id: "gemini",   name: "Gemini",    flag: "🌐", desc: "Google（有免费 Key）",       placeholder: "AIzaSy...",    link: "https://aistudio.google.com/apikey" },
    { id: "deepseek", name: "DeepSeek",  flag: "🇨🇳", desc: "国内推荐，价格低廉",        placeholder: "sk-...",       link: "https://platform.deepseek.com/api_keys" },
    { id: "kimi",     name: "Kimi",      flag: "🇨🇳", desc: "月之暗面，国内可访问",      placeholder: "sk-...",       link: "https://platform.moonshot.cn/console/api-keys" },
    { id: "custom",   name: "自定义",    flag: "⚙️",  desc: "任意 OpenAI 兼容接口",     placeholder: "sk-...",       link: null },
  ];

  const [provider, setProvider] = useState(localStorage.getItem("mc_ai_provider") || "groq");
  const [key, setKey] = useState(localStorage.getItem("mc_ai_key") || "");
  const [customUrl, setCustomUrl] = useState(localStorage.getItem("mc_ai_custom_url") || "");
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);

  const curProvider = AI_PROVIDERS.find(p => p.id === provider) || AI_PROVIDERS[0];

  const handleSave = () => {
    if (key.trim()) {
      localStorage.setItem("mc_ai_provider", provider);
      localStorage.setItem("mc_ai_key", key.trim());
      if (provider === "custom") localStorage.setItem("mc_ai_custom_url", customUrl.trim());
      else localStorage.removeItem("mc_ai_custom_url");
    } else {
      localStorage.removeItem("mc_ai_provider");
      localStorage.removeItem("mc_ai_key");
      localStorage.removeItem("mc_ai_custom_url");
    }
    setSaved(true);
    setTimeout(() => { setSaved(false); onClose(); }, 800);
  };

  const handleClear = () => {
    localStorage.removeItem("mc_ai_provider");
    localStorage.removeItem("mc_ai_key");
    localStorage.removeItem("mc_ai_custom_url");
    setKey(""); setCustomUrl(""); setProvider("groq");
    setSaved(true);
    setTimeout(() => { setSaved(false); onClose(); }, 800);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: 20, width: "100%", maxWidth: 500, padding: "2rem", boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#111" }}>⚙️ AI 接口设置</div>
          <button onClick={onClose} style={{ fontSize: 20, background: "none", border: "none", cursor: "pointer", color: "#999", lineHeight: 1 }}>✕</button>
        </div>
        <div style={{ fontSize: 13, color: "#888", marginBottom: 22 }}>
          <div style={{ padding: "10px 12px", background: G.tealLight, borderRadius: 9, marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 18 }}>⚡</span>
            <div><strong style={{ color: G.tealDark }}>平台已内置 AI，无需配置即可使用！</strong><div style={{ fontSize: 11, color: G.teal, marginTop: 1 }}>若想切换模型或使用更高额度，可填入自己的 Key</div></div>
          </div>
          所有 Key 仅存在本地浏览器，不上传服务器。
        </div>

        {/* Provider 选择 */}
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#555", marginBottom: 10 }}>选择服务商</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {AI_PROVIDERS.map(p => (
              <button key={p.id} onClick={() => setProvider(p.id)} style={{ padding: "10px 12px", borderRadius: 12, border: provider === p.id ? `2px solid ${G.teal}` : "2px solid #e8e8e8", cursor: "pointer", background: provider === p.id ? G.tealLight : "#fafafa", textAlign: "left", fontFamily: "inherit", position: "relative" }}>
                {p.free && <span style={{ position: "absolute", top: 6, right: 8, fontSize: 10, fontWeight: 700, background: "#22c55e", color: "#fff", padding: "1px 6px", borderRadius: 6 }}>免费</span>}
                <div style={{ fontSize: 14, fontWeight: 600, color: provider === p.id ? G.tealDark : "#333" }}>{p.flag} {p.name}</div>
                <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>{p.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Custom URL（仅自定义时显示） */}
        {provider === "custom" && (
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: "#555", display: "block", marginBottom: 6 }}>接口 Base URL</label>
            <input value={customUrl} onChange={e => setCustomUrl(e.target.value)} placeholder="https://your-api.com/v1" style={{ width: "100%", padding: "10px 12px", border: "1.5px solid #e0e0e0", borderRadius: 10, fontSize: 14, fontFamily: "inherit", boxSizing: "border-box" }} />
            <div style={{ fontSize: 11, color: "#aaa", marginTop: 4 }}>需兼容 OpenAI /chat/completions 接口</div>
          </div>
        )}

        {/* API Key 输入 */}
        <div style={{ marginBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: "#555" }}>API Key</label>
            {curProvider.link && (
              <a href={curProvider.link} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: G.teal, textDecoration: "none" }}>免费获取 →</a>
            )}
          </div>
          <div style={{ position: "relative" }}>
            <input
              type={showKey ? "text" : "password"}
              value={key}
              onChange={e => setKey(e.target.value)}
              placeholder={curProvider.placeholder}
              style={{ width: "100%", padding: "10px 40px 10px 12px", border: "1.5px solid #e0e0e0", borderRadius: 10, fontSize: 14, fontFamily: "inherit", boxSizing: "border-box" }}
            />
            <button onClick={() => setShowKey(v => !v)} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#aaa", fontSize: 16 }}>{showKey ? "🙈" : "👁"}</button>
          </div>
          <div style={{ fontSize: 11, color: "#aaa", marginTop: 4 }}>Key 仅保存在你的浏览器本地，不会上传到服务器</div>
        </div>

        {/* 当前生效提示 */}
        {localStorage.getItem("mc_ai_key") && (
          <div style={{ padding: "8px 12px", background: G.tealLight, borderRadius: 8, fontSize: 12, color: G.tealDark, marginBottom: 16 }}>
            ✓ 当前已配置：{AI_PROVIDERS.find(p => p.id === (localStorage.getItem("mc_ai_provider") || "gemini"))?.name || "Gemini"} Key（已激活）
          </div>
        )}

        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={handleSave} style={{ flex: 1, padding: "12px 0", fontSize: 15, fontWeight: 700, fontFamily: "inherit", background: saved ? "#4caf50" : G.teal, color: "#fff", border: "none", borderRadius: 12, cursor: "pointer" }}>
            {saved ? "✓ 已保存" : "保存设置"}
          </button>
          {localStorage.getItem("mc_ai_key") && (
            <button onClick={handleClear} style={{ padding: "12px 18px", fontSize: 14, fontFamily: "inherit", background: G.redLight, color: G.red, border: "none", borderRadius: 12, cursor: "pointer", fontWeight: 600 }}>清除</button>
          )}
        </div>
      </div>
    </div>
  );
}

const withTimeout = async (promise, ms = 12000) => {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error("请求超时")), ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }
};

const normalizeMaterialText = (input) => {
  const raw = String(input || "");
  if (!raw) return "";
  // 保留换行便于英文 PDF 按段/按句切分；行内多空格压成单空格
  const cleaned = raw
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
  if (!cleaned) return "";
  // Only block obvious office-zip/binary artifacts; keep normal English textbook text.
  const junkLike = /PK\u0003\u0004|word\/|ppt\/|_rels|Content_Types\.xml|Image Manager/i.test(cleaned);
  if (junkLike) return "";
  return cleaned;
};

/** 未选章节时不要用「未知章节」：用具体章节 / 课程名 / 资料标题，避免题干与 API 上下文全是占位词 */
const resolveMaterialChapterLabel = (material) => {
  const ch = String(material?.chapter || "").trim();
  if (ch && ch !== "全部") return ch;
  const co = String(material?.course || "").trim();
  if (co) return co;
  const ti = String(material?.title || "").trim();
  if (ti) return ti.length > 42 ? `${ti.slice(0, 40)}…` : ti;
  return "本资料";
};

const splitTextIntoChunks = (text, maxLen = 700) => {
  const raw = String(text || "").trim();
  if (!raw) return [];
  const sents = raw
    .split(/\n+/)
    .flatMap((block) => block.split(/[。！？]|\.\s+|\?\s+|\!\s+/))
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const out = [];
  let cur = "";
  sents.forEach((s) => {
    if (!cur) {
      cur = s;
      return;
    }
    if ((cur.length + s.length + 1) <= maxLen) cur += " " + s;
    else {
      out.push(cur);
      cur = s;
    }
  });
  if (cur) out.push(cur);
  return out.slice(0, 30);
};

const buildSeedClaimsFromText = (text, chapter, course, count = 12) => {
  const src = String(text || "").trim();
  if (!src) return [];
  const sents = src
    .split(/\n+/)
    .flatMap((block) => block.split(/[。！？]|\.\s+|\?\s+|\!\s+/))
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length >= 10)
    .slice(0, count * 3);
  const out = [];
  for (let i = 0; i < sents.length && out.length < count; i++) {
    const claim = sents[i].slice(0, 110);
    // 种子 claim 来自 PDF 原句，不因「中文太少」丢弃英文教材
    if (/Image Manager|Neelakantan|_rels|Content_Types\.xml|PK\u0003\u0004/i.test(claim)) continue;
    out.push({
      chunk_index: 0,
      claim_text: claim,
      claim_type: "fact",
      difficulty: 2,
      source_quote: claim.slice(0, 80),
      chapter: chapter || null,
      course: course || "数学",
    });
  }
  return out;
};

const fetchChapterFallbackQuestions = async (chapter, count = 6) => {
  if (!count || count <= 0) return [];
  try {
    const aiCfg = getAIConfig();
    const res = await withTimeout(fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chapter: chapter || "资料专题", type: "单选题", count,
        userProvider: aiCfg.provider, userKey: aiCfg.key, userCustomUrl: aiCfg.customUrl,
      }),
    }), 9000);
    const data = await res.json();
    if (data?.error) return [];
    const arr = Array.isArray(data?.questions) ? data.questions : [];
    return arr.map((q) => ({
      ...q,
      type: q?.type || (q?.options ? "单选题" : "判断题"),
      quality_score: Math.max(72, Number(q?.quality_score || 72)),
      source_quote: q?.source_quote || `来自章节「${chapter || "资料专题"}」的兜底命题`,
      source_chunk_id: Number.isFinite(Number(q?.source_chunk_id)) ? Number(q.source_chunk_id) : null,
    }));
  } catch (e) {
    return buildMinimalChapterQuestions(chapter || "资料专题", Math.min(count, 4));
  }
};

const buildFallbackQuestions = (text, chapter, count = 6) => {
  const src = String(text || "").trim();
  if (!src) return [];
  const sents = src
    .split(/\n+/)
    .flatMap((block) => block.split(/[。！？]|\.\s+|\?\s+|\!\s+/))
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 12)
    .slice(0, count * 4);
  const qs = [];
  for (let i = 0; i < sents.length && qs.length < count; i++) {
    const sent = sents[i];
    if (i % 2 === 0) {
      qs.push({
        question: `以下说法是否正确：「${sent.slice(0, 58)}」`,
        options: null,
        answer: "正确",
        explanation: sent.slice(0, 120),
        type: "判断题",
        chapter: chapter || "资料专题",
      });
    } else {
      const words = sent.split(/[，,\s]/).filter(w => w.length > 1);
      const key = words[0] || "该知识点";
      qs.push({
        question: `关于「${key}」，下列描述最恰当的是：`,
        options: [
          `A.${sent.slice(0, 30)}`,
          `B.${key}与原文结论相反`,
          `C.${key}在资料中未出现`,
          "D.以上都不正确",
        ],
        answer: "A",
        explanation: sent.slice(0, 120),
        type: "单选题",
        chapter: chapter || "资料专题",
      });
    }
  }
  return qs.slice(0, count);
};

const buildFallbackTopics = (text, chapter, count = 4) => {
  const raw = String(text || "").trim();
  if (!raw) {
    return Array.from({ length: Math.max(2, Math.min(count, 4)) }).map((_, i) => ({
      name: `${chapter || "资料专题"} 知识点 ${i + 1}`,
      summary: "基于资料自动生成的核心要点，建议先阅读原文再练习。",
      chapter: chapter || null,
    }));
  }
  const sents = raw
    .split(/\n+/)
    .flatMap((block) => block.split(/[。！？]|\.\s+/))
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 12)
    .slice(0, count);
  return sents.map((s, i) => ({
    name: s.length > 32 ? s.slice(0, 30) + "…" : s,
    summary: s.slice(0, 80),
    chapter: chapter || null,
  }));
};

const buildMinimalChapterQuestions = (chapter = "资料专题", count = 4) => {
  let ch = String(chapter || "").trim();
  if (!ch || ch === "未知章节" || ch === "全部") ch = "本资料";
  const n = Math.max(2, Math.min(Number(count) || 4, 8));
  const templates = [
    {
      question: `关于「${ch}」，下列说法最合理的是：`,
      options: [
        "A.应从定义、条件和结论三层理解知识点",
        "B.只记结论，不必关注适用条件",
        "C.任何方法都可直接套用，无需判断前提",
        "D.学习时不需要和例题对应验证",
      ],
      answer: "A",
      explanation: "有效学习应同时掌握定义、前提与结论，并通过例题验证。",
      type: "单选题",
      chapter: ch,
      source_quote: `章节「${ch}」通用保底题`,
      quality_score: 72,
      source_chunk_id: null,
    },
    {
      question: `在学习「${ch}」时，先明确概念再做题通常更有效。`,
      options: null,
      answer: "正确",
      explanation: "先理解概念与适用条件，可以减少机械套题造成的错误。",
      type: "判断题",
      chapter: ch,
      source_quote: `章节「${ch}」通用保底题`,
      quality_score: 72,
      source_chunk_id: null,
    },
  ];
  const out = [];
  while (out.length < n) out.push(templates[out.length % templates.length]);
  return out;
};

const buildTopicsFromClaims = (claims = [], chapter = null) => {
  const rows = (Array.isArray(claims) ? claims : [])
    .map((c) => String(c?.claim_text || "").trim())
    .filter((t) => t.length >= 8)
    .slice(0, 6);
  if (!rows.length) return [];
  return rows.map((t, i) => ({
    name: `知识点 ${i + 1}`,
    summary: t.slice(0, 80),
    chapter: chapter || null,
  }));
};

const normalizeOutline = (outlineRaw = [], defaultSection = "资料大纲") => {
  const sections = (Array.isArray(outlineRaw) ? outlineRaw : [])
    .map((s) => ({
      title: String(s?.title || "").trim() || defaultSection,
      summary: String(s?.summary || "").trim(),
      topics: (Array.isArray(s?.topics) ? s.topics : [])
        .map((t) => String(t || "").trim())
        .filter((t) => t.length >= 2)
        .slice(0, 8),
    }))
    .filter((s) => s.topics.length > 0)
    .slice(0, 6);
  return sections;
};

const flattenOutlineTopics = (sections = []) => {
  const out = [];
  sections.forEach((s) => {
    (s.topics || []).forEach((t) => out.push({
      name: t,
      chapter: s.title,
      summary: s.summary || "",
    }));
  });
  return out.slice(0, 24);
};

const ensurePdfJs = async () => {
  if (window.pdfjsLib) return;
  await new Promise((res, rej) => {
    const sc = document.createElement("script");
    sc.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    sc.onload = res;
    sc.onerror = rej;
    document.head.appendChild(sc);
  });
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
};

/** @returns {{ text: string, pdfMeta: null | { likelyScanned: boolean, pageCount: number, sampledPages: number, textItemCount: number, meaningfulCharCount: number } }} */
const extractMaterialTextWithMeta = async (file) => {
  if (!file) return { text: "", pdfMeta: null };
  const ext = getFileExt(file.name);
  if (ext === ".pdf") {
    try {
      await ensurePdfJs();
      const buf = await file.arrayBuffer();
      const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
      let text = "";
      let totalItems = 0;
      const sampledPages = Math.min(pdf.numPages, 60);
      for (let i = 1; i <= sampledPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const items = content.items || [];
        totalItems += items.length;
        // 片段间加空格，避免英文粘成一词导致无法按句切分、AI 也读不懂
        let line = "";
        let lastY = null;
        for (const item of items) {
          const s = item.str || "";
          if (!s) continue;
          const y = item.transform ? item.transform[5] : 0;
          if (lastY !== null && Math.abs(y - lastY) > 4) {
            text += line.trim() + "\n";
            line = "";
          }
          if (line && !/\s$/.test(line) && !/^[\s.,;:!?)\]}]/.test(s)) line += " ";
          line += s;
          lastY = y;
        }
        if (line.trim()) text += line.trim() + "\n";
      }
      const normalized = normalizeMaterialText(text);
      const compact = normalized.replace(/\s/g, "");
      const meaningfulCharCount = compact.length;
      const pageCount = pdf.numPages;
      // 扫描版通常几乎无 text items / 无内嵌文字层（与「页数多但字少」一并判断）
      const fewItems = totalItems < 24 && pageCount >= 2;
      const likelyScanned =
        meaningfulCharCount === 0 ||
        (pageCount >= 2 && meaningfulCharCount < 120) ||
        (pageCount === 1 && meaningfulCharCount < 40) ||
        (fewItems && meaningfulCharCount < 200);
      return {
        text: normalized,
        pdfMeta: {
          likelyScanned,
          pageCount,
          sampledPages,
          textItemCount: totalItems,
          meaningfulCharCount,
        },
      };
    } catch (e) {
      return {
        text: "",
        pdfMeta: { likelyScanned: true, pageCount: 0, sampledPages: 0, textItemCount: 0, meaningfulCharCount: 0 },
      };
    }
  }
  // NOTE: .docx/.pptx are zip binaries; direct text() often becomes garbage.
  if (ext === ".docx" || ext === ".pptx" || ext === ".ppt" || ext === ".doc") {
    return { text: "", pdfMeta: null };
  }
  try {
    const t = await file.text();
    return { text: normalizeMaterialText((t || "").slice(0, 12000)), pdfMeta: null };
  } catch (e) {
    return { text: "", pdfMeta: null };
  }
};

const isLowQualityQuestion = (q) => {
  const text = String(q?.question || "");
  const exp = String(q?.explanation || "");
  const opts = q?.options;
  const sourceQuote = String(q?.source_quote || "");
  const qualityScore = Number(q?.quality_score || 0);
  const hasOptions = Array.isArray(opts) ? opts.length >= 2 : typeof opts === "string" && String(opts).trim().length > 8;

  if (!text || text.length < 10) return true;
  // API/保底模板把「未知章节」写进题干，无学科信息
  if (/[「『]未知章节[」』]/.test(text)) return true;
  // Obvious noisy/irrelevant artifacts
  if (/Image Manager|Neelakantan|_rels|Content_Types\.xml|PK\u0003\u0004/i.test(text)) return true;
  const chineseCount = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const alphaCount = (text.match(/[A-Za-z]/g) || []).length;
  // Keep English math materials available; only block obvious software/file artifacts.
  if (alphaCount > 120 && chineseCount < 2 && /_rels|Content_Types\.xml|Image Manager|PK\u0003\u0004/i.test(text)) return true;
  // 占位模板（全角/半角数字、多空格）
  if (/第[ \t\u3000]*[\d０-９]+[ \t\u3000]*个理解点/.test(text)) return true;
  if (/关于本资料内容/.test(text)) return true;
  if (/理解点/.test(text) && /以下判断是否正确|是否正确[？?]/.test(text)) return true;
  if (/请结合资料原文和课堂笔记/.test(exp)) return true;
  // extract 约定单选题却缺选项 → 常被误判成判断题
  if (!hasOptions && /下列|哪项|哪个|最恰当|选择的是/.test(text)) return true;
  // 判断题模板：只否定「以下判断是否正确」但无引号命题且含占位用语
  const hasQuotedClaim = /「[^」]{4,}」|『[^』]{4,}』/.test(text);
  if (/以下判断是否正确|如下判断是否正确/.test(text) && !hasQuotedClaim) {
    if (/理解点|本资料|知识点\s*\d|第\s*[\d０-９]+\s*个/.test(text)) return true;
  }
  if (sourceQuote && sourceQuote.length < 6) return true;
  if (qualityScore > 0 && qualityScore < 70) return true;

  // 过滤含明显占位/垃圾选项的题目
  if (Array.isArray(opts)) {
    const garbage = ['与原文相反', '教材未提及', '以上都不对', '与上述相反', '原文未提及',
      'Classification of Differential Eq', 'A.1 ', 'B.1 ', 'C.1 '];
    const hasGarbageOpt = opts.some(o => garbage.some(g => String(o).includes(g)));
    if (hasGarbageOpt) return true;
    const chapterTitleCount = opts.filter(o => /^[A-D]\.\s*\d+\.\d+\s+[A-Z]/.test(String(o))).length;
    if (chapterTitleCount >= 2) return true;
  }
  if (/^关于[「『][\d.]+ [A-Z]/.test(text) && text.length < 30) return true;

  return false;
};

const isLikelyRelevantClaim = (claimText = "") => {
  const t = String(claimText || "").trim();
  if (t.length < 8) return false;
  if (/Image Manager|Neelakantan|_rels|Content_Types\.xml|PK\u0003\u0004/i.test(t)) return false;
  const chineseCount = (t.match(/[\u4e00-\u9fff]/g) || []).length;
  const alphaCount = (t.match(/[A-Za-z]/g) || []).length;
  const mathHint = /(矩阵|范数|收敛|迭代|导数|积分|微分|误差|牛顿|最小二乘|优化|特征值|条件数|插值|方程|算法|线性|非线性|梯度|行列式|向量|子空间|基|秩|转置|可逆|正交|对角化|hessian|newton|gauss|qr|lu|svd|matrix|vector|eigen|determinant|linear|subspace|basis|rank|transpose|invertible|orthogonal|theorem|definition|lemma|proof)/i.test(t);
  if (chineseCount >= 3) return true;
  if (mathHint) return true;
  // 英文教材：足够长的字母句视为有效 claim（避免整段被清空）
  if (alphaCount >= 18 && t.length >= 24) return true;
  return false;
};

const fetchFileAsBrowserFile = async (url, fallbackName = "material.pdf") => {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const ext = getFileExt(fallbackName) || ".pdf";
    const mimeByExt = {
      ".pdf": "application/pdf",
      ".doc": "application/msword",
      ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ".ppt": "application/vnd.ms-powerpoint",
      ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    };
    const file = new File([blob], fallbackName, { type: mimeByExt[ext] || blob.type || "application/octet-stream" });
    return file;
  } catch (e) {
    return null;
  }
};

const processMaterialWithAI = async ({ material, file, genCount = 10 }) => {
  const materialId = material?.id;
  if (!materialId) return { topics: [], questions: [], insertedCount: 0, materialLinked: false };

  const chapter = (material?.chapter && material.chapter !== "全部")
    ? material.chapter : (material?.course || material?.title || "本资料");

  // Step 1: Extract text from PDF using pdf.js (client-side, free)
  let text = "";
  const pdfLikelyScanned = false;

  if (file) {
    try {
      await ensurePdfJs();
      const buf = await file.arrayBuffer();
      const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
      const totalPages = pdf.numPages;

      // Sample strategy: skip likely cover/TOC pages (first 3), sample up to 50 content pages
      const startPage = Math.min(4, totalPages);
      const endPage = Math.min(startPage + 49, totalPages);

      // First pass: collect all page texts to detect running headers/footers
      const rawPageTexts = [];
      for (let i = startPage; i <= endPage; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const items = (content.items || [])
          .filter(item => item.str && item.str.trim())
          .sort((a, b) => {
            const yDiff = (b.transform?.[5] || 0) - (a.transform?.[5] || 0);
            if (Math.abs(yDiff) > 5) return yDiff;
            return (a.transform?.[4] || 0) - (b.transform?.[4] || 0);
          });
        let pageText = "";
        let lastY = null;
        for (const item of items) {
          const y = item.transform?.[5] || 0;
          if (lastY !== null && Math.abs(y - lastY) > 8) pageText += "\n";
          else if (pageText && !pageText.endsWith(" ")) pageText += " ";
          pageText += item.str;
          lastY = y;
        }
        if (pageText.trim()) rawPageTexts.push(pageText.trim());
      }

      // Detect running headers/footers: short lines (< 80 chars) appearing in 30%+ of pages
      const lineFreq = {};
      const sampledCount = rawPageTexts.length;
      rawPageTexts.forEach(pt => {
        const firstLine = pt.split("\n")[0].trim();
        const lastLine = pt.split("\n").slice(-1)[0].trim();
        [firstLine, lastLine].forEach(l => {
          if (l.length > 0 && l.length < 80) {
            lineFreq[l] = (lineFreq[l] || 0) + 1;
          }
        });
      });
      const threshold = Math.max(2, Math.floor(sampledCount * 0.3));
      const headerFooterSet = new Set(
        Object.entries(lineFreq).filter(([, c]) => c >= threshold).map(([l]) => l)
      );

      const pageTexts = rawPageTexts.map(pt => {
        return pt
          .split("\n")
          .filter(l => !headerFooterSet.has(l.trim()))
          .join("\n");
      }).filter(pt => pt.trim().length > 0);

      let rawText = pageTexts.join("\n\n").trim();

      // Fix hyphenated line breaks common in English academic PDFs (e.g. "algo-\nrithm")
      rawText = rawText.replace(/([a-zA-Z])-\n([a-zA-Z])/g, "$1$2");
      // Collapse excessive blank lines
      rawText = rawText.replace(/\n{3,}/g, "\n\n");

      text = normalizeMaterialText(rawText);
    } catch (e) {
      console.error("PDF extraction error:", e.message);
    }
  }

  // Step 2: Try fetching from stored URL if no local file
  if (!text && material?.file_data && material.file_data.startsWith("http")) {
    try {
      const r = await fetch(material.file_data);
      if (r.ok) {
        const blob = await r.blob();
        const f2 = new File([blob], material.file_name || "m.pdf", { type: "application/pdf" });
        const sub = await processMaterialWithAI({ material, file: f2, genCount });
        return sub;
      }
    } catch (e) {}
  }

  const hasText = text.trim().length > 80;
  let topics = [], questions = [], usedApi = false;
  let apiQuotaExceeded = false;
  let apiErrorMsg = "";

  // Step 3: Call /api/extract with the extracted text
  if (hasText) {
    try {
      const aiCfg = getAIConfig();
      const resp = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: text.slice(0, 8000),
          course: material?.course || "数学",
          chapter,
          count: genCount,
          userProvider: aiCfg.provider, userKey: aiCfg.key, userCustomUrl: aiCfg.customUrl,
        }),
      });
      const data = await resp.json();
      if (resp.status === 429 || data.error === "QUOTA_EXCEEDED") {
        apiQuotaExceeded = true;
        apiErrorMsg = data.message || "Gemini API 配额已用完，请等待 1 分钟后重试。";
        console.warn("API quota exceeded:", apiErrorMsg);
      } else if (!data.error) {
        topics = Array.isArray(data.topics) ? data.topics : [];
        questions = Array.isArray(data.questions) ? data.questions : [];
        usedApi = true;
      } else {
        apiErrorMsg = data.error;
        console.error("API extract error:", data.error);
      }
    } catch (e) {
      console.error("API extract fetch error:", e.message);
    }
  }

  // Step 4: Fallback sentence-based questions — ONLY when API failed for non-quota reasons
  // Skip entirely on quota exceeded (would produce garbage questions)
  if (questions.length === 0 && hasText && !apiQuotaExceeded) {
    const isLikelySentence = (s) => {
      if (s.length < 30 || s.length > 180) return false;
      // Reject fragments starting with punctuation, math operators, or digits
      if (/^[\s,，.。;；:：\-+×÷=<>()\[\]{}|\/\\^_*\d]/.test(s)) return false;
      // Reject if math symbol density is too high (formula fragment)
      const mathCount = (s.match(/[=+\-×÷<>()\[\]{}|\/\\^_]/g) || []).length;
      if (mathCount > s.length * 0.15) return false;
      // Must contain at least 5 words / tokens
      if (s.trim().split(/\s+/).length < 5) return false;
      // Must have real alphabetic or CJK content
      if (!/[一-龥a-zA-Z]{3,}/.test(s)) return false;
      return true;
    };

    const sents = text
      .split(/[。\n]|\.\s+/)
      .map(s => s.replace(/\s+/g, " ").trim())
      .filter(isLikelySentence);

    for (let i = 0; i < sents.length && questions.length < genCount; i++) {
      const s = sents[i];
      questions.push({
        question: `判断：「${s.slice(0, 80)}」是否正确？`,
        options: null, answer: "正确",
        explanation: "请结合教材核对该陈述的准确性。",
        type: "判断题", chapter,
      });
    }
  }

  // Step 5: Save questions to DB — skip if quota exceeded (don't persist garbage)
  let insertedCount = 0;
  let materialLinked = false;
  if (!apiQuotaExceeded && questions.length > 0) {
    try {
      const rows = questions.map(q => ({
        chapter: q.chapter || chapter,
        course: material?.course || "数学",
        type: q.type || (q.options ? "单选题" : "判断题"),
        question: q.question,
        options: q.options || null,
        answer: q.answer,
        explanation: q.explanation || "",
        material_id: materialId,
      }));
      const { error: e1 } = await supabase.from("questions").insert(rows);
      if (!e1) { insertedCount = rows.length; materialLinked = true; }
      else {
        // Try without material_id if column missing
        const rows2 = rows.map(({ material_id, ...r }) => r);
        const { error: e2 } = await supabase.from("questions").insert(rows2);
        if (!e2) insertedCount = rows2.length;
      }
    } catch (e) {}
  }

  // Build diagnostic info for the UI
  const textLen = text.trim().length;
  const englishRatio = textLen > 0
    ? (text.match(/[a-zA-Z]/g) || []).length / textLen
    : 0;
  const textDiag = {
    charCount: textLen,
    language: englishRatio > 0.4 ? "English" : "Chinese",
    quality: !hasText ? "poor" : textLen < 500 ? "low" : textLen < 2000 ? "medium" : "good",
    hint: !hasText
      ? "未能提取文字（扫描版 PDF），题目质量很低，建议使用可选中文字的电子版 PDF"
      : textLen < 500
      ? `提取文字较少（${textLen} 字符），建议上传内容更多的 PDF 以提升出题质量`
      : `提取到 ${textLen} 字符（${englishRatio > 0.4 ? "英文" : "中文"}教材），题目基于真实教材内容生成`,
  };

  return {
    topics, questions, insertedCount, materialLinked,
    hasText, usedApi, pdfLikelyScanned: !hasText,
    textDiag,
    apiQuotaExceeded,
    apiErrorMsg,
    parseHint: !hasText ? "未能从 PDF 提取文字（可能是扫描版），建议使用可选中文字的电子版 PDF。" : null,
  };
};


// ── KaTeX ─────────────────────────────────────────────────────────────────────
const M = ({ tex, block = false }) => {
  const ref = useRef();
  useEffect(() => {
    if (ref.current) {
      try { katex.render(tex, ref.current, { throwOnError: false, displayMode: block }); } catch (e) {}
    }
  }, [tex, block]);
  return <span ref={ref} style={{ display: block ? "block" : "inline", margin: block ? "0.6rem 0" : "0 2px" }} />;
};

// ── Simple Visualizations (SVG) ───────────────────────────────────────────────
const VizBisection = () => (
  <svg viewBox="0 0 320 140" style={{ width: "100%", maxWidth: 320, display: "block", margin: "0 auto" }}>
    <rect x="0" y="0" width="320" height="140" fill={G.blueLight} rx="8"/>
    <line x1="20" y1="110" x2="300" y2="110" stroke="#aaa" strokeWidth="1"/>
    <path d="M30,30 Q120,140 200,50 Q250,10 300,80" stroke={G.teal} strokeWidth="2" fill="none"/>
    {/* intervals */}
    <line x1="30" y1="105" x2="300" y2="105" stroke={G.blue} strokeWidth="3"/>
    <line x1="30" y1="100" x2="30" y2="112" stroke={G.blue} strokeWidth="2"/>
    <line x1="300" y1="100" x2="300" y2="112" stroke={G.blue} strokeWidth="2"/>
    <text x="30" y="125" fontSize="10" fill={G.blue} textAnchor="middle">a</text>
    <text x="300" y="125" fontSize="10" fill={G.blue} textAnchor="middle">b</text>
    <line x1="165" y1="98" x2="165" y2="112" stroke={G.amber} strokeWidth="2" strokeDasharray="3"/>
    <text x="165" y="125" fontSize="10" fill={G.amber} textAnchor="middle">c=(a+b)/2</text>
    <circle cx="213" cy="72" r="5" fill={G.red}/>
    <text x="213" y="65" fontSize="10" fill={G.red} textAnchor="middle">root</text>
    <text x="160" y="15" fontSize="11" fill={G.blue} textAnchor="middle" fontWeight="500">二分法区间缩减示意</text>
  </svg>
);

const VizNewton = () => (
  <svg viewBox="0 0 320 150" style={{ width: "100%", maxWidth: 320, display: "block", margin: "0 auto" }}>
    <rect x="0" y="0" width="320" height="150" fill={G.tealLight} rx="8"/>
    <line x1="20" y1="120" x2="300" y2="120" stroke="#aaa" strokeWidth="1"/>
    <path d="M60,20 Q160,180 280,40" stroke={G.teal} strokeWidth="2.5" fill="none"/>
    {/* tangent line at x1 */}
    <line x1="80" y1="130" x2="200" y2="40" stroke={G.amber} strokeWidth="1.5" strokeDasharray="4"/>
    <circle cx="140" cy="85" r="5" fill={G.blue}/>
    <text x="140" y="78" fontSize="10" fill={G.blue} textAnchor="middle">x₁</text>
    <line x1="178" y1="118" x2="178" y2="122" stroke={G.amber} strokeWidth="2"/>
    <text x="178" y="134" fontSize="10" fill={G.amber} textAnchor="middle">x₂</text>
    <circle cx="218" cy="55" r="5" fill={G.blue}/>
    <text x="218" y="48" fontSize="10" fill={G.blue} textAnchor="middle">x₀</text>
    <circle cx="252" cy="108" r="5" fill={G.red}/>
    <text x="252" y="101" fontSize="10" fill={G.red} textAnchor="middle">x*</text>
    <text x="160" y="16" fontSize="11" fill={G.tealDark} textAnchor="middle" fontWeight="500">Newton 法切线迭代</text>
  </svg>
);

const VizLU = () => (
  <svg viewBox="0 0 320 130" style={{ width: "100%", maxWidth: 320, display: "block", margin: "0 auto" }}>
    <rect x="0" y="0" width="320" height="130" fill={G.purpleLight} rx="8"/>
    {/* A matrix */}
    <rect x="20" y="30" width="60" height="60" fill="white" rx="4" stroke={G.purple} strokeWidth="1.5"/>
    <text x="50" y="64" fontSize="20" fill={G.purple} textAnchor="middle" fontWeight="700">A</text>
    <text x="50" y="22" fontSize="11" fill={G.purple} textAnchor="middle">系数矩阵</text>
    {/* = */}
    <text x="98" y="66" fontSize="22" fill="#666" textAnchor="middle">=</text>
    {/* L matrix */}
    <rect x="112" y="30" width="60" height="60" fill="white" rx="4" stroke={G.teal} strokeWidth="1.5"/>
    <text x="142" y="64" fontSize="20" fill={G.teal} textAnchor="middle" fontWeight="700">L</text>
    <text x="142" y="22" fontSize="11" fill={G.teal} textAnchor="middle">下三角</text>
    {/* × */}
    <text x="188" y="66" fontSize="18" fill="#666" textAnchor="middle">×</text>
    {/* U matrix */}
    <rect x="202" y="30" width="60" height="60" fill="white" rx="4" stroke={G.blue} strokeWidth="1.5"/>
    <text x="232" y="64" fontSize="20" fill={G.blue} textAnchor="middle" fontWeight="700">U</text>
    <text x="232" y="22" fontSize="11" fill={G.blue} textAnchor="middle">上三角</text>
    {/* steps */}
    <text x="160" y="112" fontSize="10" fill="#555" textAnchor="middle">Ly=b → Ux=y，逐步求解</text>
  </svg>
);

const VizSimpson = () => (
  <svg viewBox="0 0 320 150" style={{ width: "100%", maxWidth: 320, display: "block", margin: "0 auto" }}>
    <rect x="0" y="0" width="320" height="150" fill={G.amberLight} rx="8"/>
    <defs>
      <linearGradient id="fillGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={G.amber} stopOpacity="0.3"/>
        <stop offset="100%" stopColor={G.amber} stopOpacity="0.05"/>
      </linearGradient>
    </defs>
    <line x1="30" y1="120" x2="290" y2="120" stroke="#aaa" strokeWidth="1"/>
    <path d="M50,110 Q120,20 160,35 Q200,50 270,100" stroke={G.amber} strokeWidth="2.5" fill="none"/>
    <path d="M50,110 Q120,20 160,35 Q200,50 270,100 L270,120 L50,120 Z" fill="url(#fillGrad)"/>
    {/* trapezoid lines */}
    <line x1="50" y1="110" x2="50" y2="120" stroke={G.blue} strokeWidth="1.5"/>
    <line x1="160" y1="35" x2="160" y2="120" stroke={G.blue} strokeWidth="1.5" strokeDasharray="3"/>
    <line x1="270" y1="100" x2="270" y2="120" stroke={G.blue} strokeWidth="1.5"/>
    <text x="50" y="133" fontSize="10" fill={G.blue} textAnchor="middle">a</text>
    <text x="160" y="133" fontSize="10" fill={G.blue} textAnchor="middle">(a+b)/2</text>
    <text x="270" y="133" fontSize="10" fill={G.blue} textAnchor="middle">b</text>
    <text x="160" y="15" fontSize="11" fill={G.amber} textAnchor="middle" fontWeight="500">Simpson 法则数值积分</text>
  </svg>
);

// ── New Visualizations ────────────────────────────────────────────────────────
const VizEigenvalue = () => (
  <svg viewBox="0 0 320 150" style={{ width: "100%", maxWidth: 320, display: "block", margin: "0 auto" }}>
    <rect x="0" y="0" width="320" height="150" fill={G.purpleLight} rx="8"/>
    <line x1="160" y1="140" x2="160" y2="10" stroke="#ccc" strokeWidth="1"/>
    <line x1="20" y1="75" x2="300" y2="75" stroke="#ccc" strokeWidth="1"/>
    {/* Original vector */}
    <line x1="160" y1="75" x2="220" y2="35" stroke={G.blue} strokeWidth="2.5" markerEnd="url(#arrowB)"/>
    <text x="228" y="30" fontSize="11" fill={G.blue}>v</text>
    {/* Scaled eigenvector */}
    <line x1="160" y1="75" x2="260" y2="75" stroke={G.purple} strokeWidth="2.5" strokeDasharray="5"/>
    <text x="265" y="78" fontSize="11" fill={G.purple}>λv</text>
    {/* Small vector */}
    <line x1="160" y1="75" x2="200" y2="55" stroke={G.teal} strokeWidth="2" opacity="0.7"/>
    <text x="202" y="50" fontSize="10" fill={G.teal}>Av=λv</text>
    <defs>
      <marker id="arrowB" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
        <path d="M0,0 L6,3 L0,6 Z" fill={G.blue}/>
      </marker>
    </defs>
    <text x="160" y="14" fontSize="11" fill={G.purple} textAnchor="middle" fontWeight="600">特征向量方向不变，长度缩放 λ 倍</text>
  </svg>
);

const VizNormal = () => (
  <svg viewBox="0 0 320 150" style={{ width: "100%", maxWidth: 320, display: "block", margin: "0 auto" }}>
    <rect x="0" y="0" width="320" height="150" fill="#f0f9ff" rx="8"/>
    <defs>
      <linearGradient id="normGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={G.blue} stopOpacity="0.4"/>
        <stop offset="100%" stopColor={G.blue} stopOpacity="0.05"/>
      </linearGradient>
    </defs>
    {/* Bell curve filled ±2σ */}
    <path d="M60,125 C80,125 90,30 160,25 C230,30 240,125 260,125 Z" fill="url(#normGrad)"/>
    {/* Bell curve outline */}
    <path d="M30,125 C60,125 80,15 160,12 C240,15 260,125 290,125" stroke={G.blue} strokeWidth="2.5" fill="none"/>
    <line x1="30" y1="125" x2="290" y2="125" stroke="#aaa" strokeWidth="1"/>
    {/* μ line */}
    <line x1="160" y1="12" x2="160" y2="125" stroke={G.red} strokeWidth="1.5" strokeDasharray="4"/>
    <text x="160" y="138" fontSize="10" fill={G.red} textAnchor="middle">μ</text>
    <text x="105" y="138" fontSize="10" fill={G.blue} textAnchor="middle">μ-2σ</text>
    <text x="215" y="138" fontSize="10" fill={G.blue} textAnchor="middle">μ+2σ</text>
    <text x="160" y="75" fontSize="10" fill={G.blue} textAnchor="middle">≈95%</text>
    <text x="160" y="14" fontSize="11" fill={G.blue} textAnchor="middle" fontWeight="600">正态分布 N(μ,σ²) 密度函数</text>
  </svg>
);

const VizBayes = () => (
  <svg viewBox="0 0 320 160" style={{ width: "100%", maxWidth: 320, display: "block", margin: "0 auto" }}>
    <rect x="0" y="0" width="320" height="160" fill="#fffbf0" rx="8"/>
    {/* Root */}
    <circle cx="60" cy="80" r="16" fill={G.amber} opacity="0.8"/>
    <text x="60" y="84" fontSize="10" fill="#fff" textAnchor="middle" fontWeight="700">Ω</text>
    {/* B1, B2 branches */}
    <line x1="76" y1="70" x2="150" y2="40" stroke={G.amber} strokeWidth="1.5"/>
    <line x1="76" y1="90" x2="150" y2="120" stroke={G.amber} strokeWidth="1.5"/>
    <circle cx="165" cy="40" r="14" fill={G.blue} opacity="0.8"/>
    <text x="165" y="44" fontSize="10" fill="#fff" textAnchor="middle">B₁</text>
    <circle cx="165" cy="120" r="14" fill={G.purple} opacity="0.8"/>
    <text x="165" y="124" fontSize="10" fill="#fff" textAnchor="middle">B₂</text>
    {/* A|B branches */}
    <line x1="179" y1="35" x2="245" y2="20" stroke={G.teal} strokeWidth="1.5"/>
    <line x1="179" y1="115" x2="245" y2="130" stroke={G.teal} strokeWidth="1.5"/>
    <rect x="245" y="10" width="52" height="20" rx="5" fill={G.tealLight}/>
    <text x="271" y="23" fontSize="9" fill={G.tealDark} textAnchor="middle">P(A|B₁)</text>
    <rect x="245" y="120" width="52" height="20" rx="5" fill={G.tealLight}/>
    <text x="271" y="133" fontSize="9" fill={G.tealDark} textAnchor="middle">P(A|B₂)</text>
    <text x="110" y="30" fontSize="9" fill={G.amber}>P(B₁)</text>
    <text x="110" y="125" fontSize="9" fill={G.amber}>P(B₂)</text>
    <text x="160" y="10" fontSize="11" fill={G.amber} textAnchor="middle" fontWeight="600">全概率公式与 Bayes 推断</text>
  </svg>
);

const VizCI = () => (
  <svg viewBox="0 0 320 130" style={{ width: "100%", maxWidth: 320, display: "block", margin: "0 auto" }}>
    <rect x="0" y="0" width="320" height="130" fill="#f0f9f5" rx="8"/>
    {/* Number line */}
    <line x1="30" y1="65" x2="290" y2="65" stroke="#ccc" strokeWidth="1.5"/>
    {/* True parameter */}
    <line x1="160" y1="50" x2="160" y2="80" stroke={G.red} strokeWidth="2.5"/>
    <text x="160" y="45" fontSize="10" fill={G.red} textAnchor="middle">θ (真值)</text>
    {/* CI 1 - covers */}
    <rect x="110" y="75" width="110" height="10" rx="3" fill={G.teal} opacity="0.6"/>
    <text x="165" y="83" fontSize="8" fill="#fff" textAnchor="middle">样本1区间 ✓</text>
    {/* CI 2 - covers */}
    <rect x="120" y="88" width="90" height="10" rx="3" fill={G.teal} opacity="0.6"/>
    <text x="165" y="96" fontSize="8" fill="#fff" textAnchor="middle">样本2区间 ✓</text>
    {/* CI 3 - misses */}
    <rect x="170" y="101" width="80" height="10" rx="3" fill={G.red} opacity="0.6"/>
    <text x="210" y="109" fontSize="8" fill="#fff" textAnchor="middle">样本3区间 ✗</text>
    <text x="160" y="125" fontSize="9" fill="#888" textAnchor="middle">95% 的区间覆盖真实 θ</text>
    <text x="160" y="14" fontSize="11" fill={G.tealDark} textAnchor="middle" fontWeight="600">置信区间的频率解释</text>
  </svg>
);

const VizODE = () => (
  <svg viewBox="0 0 320 150" style={{ width: "100%", maxWidth: 320, display: "block", margin: "0 auto" }}>
    <rect x="0" y="0" width="320" height="150" fill="#f5f0ff" rx="8"/>
    <line x1="30" y1="125" x2="290" y2="125" stroke="#aaa" strokeWidth="1"/>
    <line x1="30" y1="125" x2="30" y2="15" stroke="#aaa" strokeWidth="1"/>
    {/* True solution */}
    <path d="M40,115 C80,100 120,75 160,55 C200,38 240,28 280,22" stroke={G.teal} strokeWidth="2.5" fill="none"/>
    {/* Euler steps */}
    <polyline points="40,115 80,105 120,90 160,75 200,62 240,52 280,44" stroke={G.amber} strokeWidth="1.8" fill="none" strokeDasharray="5"/>
    <circle cx="40" cy="115" r="4" fill={G.red}/>
    <text x="40" y="140" fontSize="9" fill="#888" textAnchor="middle">t₀</text>
    <text x="200" y="140" fontSize="9" fill="#888" textAnchor="middle">t</text>
    <text x="100" y="55" fontSize="10" fill={G.teal}>精确解</text>
    <text x="210" y="38" fontSize="10" fill={G.amber}>Euler近似</text>
    <text x="160" y="14" fontSize="11" fill={G.purple} textAnchor="middle" fontWeight="600">Euler 法与精确解的误差积累</text>
  </svg>
);

const VizLaplace = () => (
  <svg viewBox="0 0 320 130" style={{ width: "100%", maxWidth: 320, display: "block", margin: "0 auto" }}>
    <rect x="0" y="0" width="320" height="130" fill="#fff8f0" rx="8"/>
    {/* Time domain box */}
    <rect x="15" y="35" width="90" height="55" rx="8" fill={G.amberLight} stroke={G.amber} strokeWidth="1.5"/>
    <text x="60" y="58" fontSize="11" fill={G.amber} textAnchor="middle" fontWeight="700">y(t)</text>
    <text x="60" y="72" fontSize="9" fill="#888" textAnchor="middle">时域 ODE</text>
    <text x="60" y="22" fontSize="10" fill={G.amber} textAnchor="middle">困难：微分方程</text>
    {/* Arrow right */}
    <path d="M108,62 L148,62" stroke={G.purple} strokeWidth="2" markerEnd="url(#arrowP)"/>
    <text x="128" y="55" fontSize="9" fill={G.purple} textAnchor="middle">L{}</text>
    {/* s domain box */}
    <rect x="152" y="35" width="90" height="55" rx="8" fill={G.purpleLight} stroke={G.purple} strokeWidth="1.5"/>
    <text x="197" y="58" fontSize="11" fill={G.purple} textAnchor="middle" fontWeight="700">Y(s)</text>
    <text x="197" y="72" fontSize="9" fill="#888" textAnchor="middle">s 域代数</text>
    <text x="197" y="22" fontSize="10" fill={G.purple} textAnchor="middle">容易：代数方程</text>
    {/* Arrow down left */}
    <path d="M197,93 L197,118 L60,118 L60,93" stroke={G.teal} strokeWidth="1.5" fill="none" strokeDasharray="4"/>
    <text x="130" y="115" fontSize="9" fill={G.teal} textAnchor="middle">L⁻¹{} 逆变换</text>
    <defs>
      <marker id="arrowP" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
        <path d="M0,0 L6,3 L0,6 Z" fill={G.purple}/>
      </marker>
    </defs>
    <text x="160" y="14" fontSize="11" fill={G.amber} textAnchor="middle" fontWeight="600">Laplace 变换：时域→s 域→时域</text>
  </svg>
);

const VIZ_MAP = {
  "二分法": <VizBisection />,
  "Newton 法": <VizNewton />,
  "LU 分解": <VizLU />,
  "梯形法 / Simpson 法": <VizSimpson />,
  "特征值与对角化": <VizEigenvalue />,
  "常见概率分布": <VizNormal />,
  "条件概率与 Bayes 定理": <VizBayes />,
  "置信区间": <VizCI />,
  "Euler 法": <VizODE />,
  "Runge-Kutta 法": <VizODE />,
  "Laplace 变换": <VizLaplace />,
};

// ── Knowledge Content ─────────────────────────────────────────────────────────
const KNOWLEDGE_CONTENT = {
  "二分法": {
    intro: "二分法（Bisection Method）是求方程 f(x)=0 的最稳健数值方法。每次将有根区间对半分，保证收敛。",
    formulas: [
      { label: "中点计算", tex: "c = \\frac{a+b}{2}" },
      { label: "误差上界（n 次迭代后）", tex: "|c_n - r| \\leq \\frac{b-a}{2^{n+1}}" },
    ],
    steps: ["验证 f(a)·f(b) < 0（有根）", "计算中点 c = (a+b)/2", "若 f(a)·f(c) < 0 则令 b=c，否则令 a=c", "重复直到 |b-a| < ε"],
    note: "一定收敛，但速度慢（线性）。每步误差缩小 1/2。",
    viz: "二分法",
    examples: [
      {
        problem: "用二分法求 $f(x)=x^3-x-2=0$ 在 $[1,2]$ 上的根，迭代3次，并估计误差。",
        steps: [
          "**验证有根：** $f(1)=1-1-2=-2<0$，$f(2)=8-2-2=4>0$，由零点定理，$[1,2]$ 内必有根 ✓",
          "**第1次迭代：** 中点 $c_1=\\frac{1+2}{2}=1.5$，$f(1.5)=3.375-1.5-2=-0.125<0$，故根在 $[1.5, 2]$",
          "**第2次迭代：** 中点 $c_2=\\frac{1.5+2}{2}=1.75$，$f(1.75)\\approx 1.359>0$，故根在 $[1.5, 1.75]$",
          "**第3次迭代：** 中点 $c_3=\\frac{1.5+1.75}{2}=1.625$，$f(1.625)\\approx 0.566>0$，故根在 $[1.5, 1.625]$",
          "**误差估计：** 经过 $n=3$ 次迭代后，误差上界 $|c_3-r|\\leq\\frac{b-a}{2^{n+1}}=\\frac{1}{2^4}=0.0625$"
        ],
        answer: "3次迭代后近似根 $x\\approx 1.5625$，误差 $\\leq 0.0625$。**规律：** 每次迭代区间缩半，$n$次后误差 $\\leq (b-a)/2^{n+1}$"
      },
      {
        problem: "若要使二分法的误差 $\\leq 10^{-4}$，对 $[0,1]$ 区间需要迭代多少次？",
        steps: [
          "**建立不等式：** 需满足 $\\frac{b-a}{2^{n+1}} \\leq 10^{-4}$",
          "**代入数据：** $\\frac{1-0}{2^{n+1}} \\leq 10^{-4}$，即 $2^{n+1} \\geq 10^4$",
          "**取对数求解：** $(n+1)\\ln 2 \\geq 4\\ln 10$，得 $n+1 \\geq \\frac{4\\times 2.303}{0.693} \\approx 13.29$",
          "**结论：** $n \\geq 12.29$，故至少需要 **13次** 迭代"
        ],
        answer: "至少需要 **13次** 迭代。通用公式：$n \\geq \\log_2\\frac{b-a}{\\varepsilon} - 1$"
      },
    ],
  },
  "Newton 法": {
    intro: "Newton 法（牛顿迭代法）用函数在当前点的切线交 x 轴的点作为下一步近似，二阶收敛，非常快速。",
    formulas: [
      { label: "迭代公式", tex: "x_{n+1} = x_n - \\frac{f(x_n)}{f'(x_n)}" },
      { label: "二阶收敛误差", tex: "e_{n+1} \\approx \\frac{f''(x^*)}{2f'(x^*)} e_n^2" },
    ],
    steps: ["取初始近似 x₀ 在根附近", "计算 x₁ = x₀ - f(x₀)/f'(x₀)", "重复直到 |xₙ₊₁ - xₙ| < ε"],
    note: "每步有效数字大约翻倍，但需要 f'(x)≠0 且初始值足够近。",
    viz: "Newton 法",
    examples: [
      {
        problem: "用Newton迭代法求 $\\sqrt{2}$（即求 $f(x)=x^2-2=0$ 的正根），取初值 $x_0=1$，迭代至6位有效数字。",
        steps: [
          "**建立迭代公式：** $f(x)=x^2-2$，$f'(x)=2x$，Newton迭代公式为 $x_{n+1}=x_n-\\frac{f(x_n)}{f'(x_n)}=x_n-\\frac{x_n^2-2}{2x_n}=\\frac{x_n+2/x_n}{2}$",
          "**第1次迭代：** $x_1=\\frac{1+2/1}{2}=\\frac{3}{2}=1.5$，误差 $|x_1-\\sqrt{2}|\\approx 0.0858$",
          "**第2次迭代：** $x_2=\\frac{1.5+2/1.5}{2}=\\frac{1.5+1.333}{2}\\approx 1.4167$，误差 $\\approx 0.0025$",
          "**第3次迭代：** $x_3=\\frac{1.4167+2/1.4167}{2}\\approx 1.41422$，误差 $\\approx 7\\times 10^{-7}$",
          "**二阶收敛验证：** 误差从 $0.0858\\to 0.0025\\to 7\\times 10^{-7}$，每步误差约为上步的平方（体现二阶收敛）"
        ],
        answer: "经过仅3次迭代，$x_3\\approx 1.41421$，达到6位有效数字。Newton法的二阶收敛远快于二分法的线性收敛。"
      },
    ],
  },
  "不动点迭代": {
    intro: "将 f(x)=0 改写为 x=g(x)，然后迭代 x_{n+1}=g(x_n) 求根。收敛性由 |g'(x*)| 决定。",
    formulas: [
      { label: "迭代格式", tex: "x_{n+1} = g(x_n)" },
      { label: "收敛条件（压缩映射）", tex: "|g'(x)| \\leq L < 1 \\quad \\forall x \\in [a,b]" },
      { label: "误差估计", tex: "|x^* - x_n| \\leq \\frac{L^n}{1-L}|x_1 - x_0|" },
    ],
    steps: ["将 f(x)=0 改写为 x=g(x)", "验证 |g'(x)| < 1 在根附近成立", "从 x₀ 出发迭代"],
    note: "|g'(x*)| 越小，收敛越快。当 g'(x*)=0 时达到超线性收敛。",
    examples: [
      { problem: "求 cos(x)=x 的根（x=g(x)=cos(x)），从 x₀=1 出发迭代。", steps: ["g'(x)=−sin(x)，在根附近 |g'|≈0.68<1，收敛 ✓", "x₁=cos(1)≈0.5403", "x₂=cos(0.5403)≈0.8576", "x₃=cos(0.8576)≈0.6543，…，收敛到 x*≈0.7391"], answer: "不动点 x*≈0.7391（即 Dottie number），约 50 步达到机器精度" },
    ],
  },
  "Gauss 消去法": {
    intro: "高斯消去法是解线性方程组 Ax=b 的标准算法，分前向消元（化为上三角）和回代两步。",
    formulas: [
      { label: "消元乘子", tex: "m_{ik} = \\frac{a_{ik}^{(k)}}{a_{kk}^{(k)}},\\; i > k" },
      { label: "计算复杂度", tex: "\\frac{n^3}{3} + O(n^2) \\text{ 次运算}" },
    ],
    steps: ["对每列 k，计算消元乘子 mₖₗ", "用第 k 行消去下面各行的第 k 列元素", "回代从最后一行求解各未知数"],
    note: "必须选主元（Pivoting）避免数值不稳定。部分主元法选每列最大元素。",
    examples: [
      { problem: "用 Gauss 消去法解：2x+y=5，4x+3y=11。", steps: ["m₂₁=4/2=2，R₂←R₂−2R₁：0x+y=1", "回代：y=1，2x=5−1=4，x=2"], answer: "x=2，y=1" },
    ],
  },
  "LU 分解": {
    intro: "LU 分解把矩阵 A 写成 A=LU，L 是下三角、U 是上三角，一次分解可高效求解多个右端项。",
    formulas: [
      { label: "分解形式", tex: "A = LU \\quad (\\text{或带行交换 } PA = LU)" },
      { label: "两步求解", tex: "Ly = b \\;\\Rightarrow\\; Ux = y" },
    ],
    steps: ["对 A 做 LU 分解（O(n³)，只做一次）", "前代求解 Ly=b（O(n²)）", "回代求解 Ux=y（O(n²)）"],
    note: "对每个新的 b 只需 O(n²)，适合多右端项。带行交换的 PA=LU 更稳定。",
    viz: "LU 分解",
    examples: [
      { problem: "对 A=[[2,1],[6,4]] 做 LU 分解，再解 Ax=[5,18]ᵀ。", steps: ["m₂₁=6/2=3，L=[[1,0],[3,1]]，U=[[2,1],[0,1]]", "前代 Ly=b：y₁=5，3×5+y₂=18→y₂=3", "回代 Ux=y：x₂=3，2x₁+3=5→x₁=1"], answer: "x₁=1，x₂=3" },
    ],
  },
  "Lagrange 插值": {
    intro: "给定 n+1 个节点，Lagrange 插值构造唯一的次数 ≤n 的多项式经过所有节点。",
    formulas: [
      { label: "插值多项式", tex: "P_n(x) = \\sum_{k=0}^{n} y_k L_k(x)" },
      { label: "基函数", tex: "L_k(x) = \\prod_{j \\neq k} \\frac{x-x_j}{x_k-x_j}" },
      { label: "误差上界", tex: "|f(x)-P_n(x)| \\leq \\frac{M_{n+1}}{(n+1)!}|\\omega_{n+1}(x)|" },
    ],
    steps: ["选取 n+1 个节点", "计算每个基函数 Lₖ(x)", "加权求和得到 Pₙ(x)"],
    note: "等距节点高次插值会在端点附近振荡（Runge 现象）。建议使用 Chebyshev 节点。",
    examples: [
      { problem: "已知 f(0)=1，f(1)=3，f(2)=7，用 Lagrange 插值求 f(1.5)。", steps: ["L₀(x)=(x−1)(x−2)/[(0−1)(0−2)]=(x−1)(x−2)/2", "L₁(x)=(x−0)(x−2)/[(1−0)(1−2)]=−x(x−2)", "L₂(x)=x(x−1)/2", "P(1.5)=1×(0.5)(−0.5)/2+3×(−1.5)(−0.5)+7×1.5×0.5/2", "=−0.125+2.25+2.625=4.75"], answer: "f(1.5)≈4.75（实际函数若为 2x²+1，真值=4.5，误差来自多项式次数限制）" },
    ],
  },
  "法方程": {
    intro: "线性最小二乘求 x 使 ‖b-Ax‖₂ 最小，对目标函数求导置零得到法方程（正规方程）。",
    formulas: [
      { label: "最小化目标", tex: "\\min_x \\|Ax - b\\|_2^2" },
      { label: "法方程", tex: "A^\\top A\\, x = A^\\top b" },
    ],
    steps: ["建立超定方程组 Ax≈b（方程数 > 未知数）", "构造法方程 AᵀAx=Aᵀb", "求解得到最优参数"],
    note: "AᵀA 的条件数是 A 的平方，数值稳定性差。实践中用 QR 分解更好。",
    examples: [
      { problem: "已知数据点 (0,1),(1,2),(2,3.5)，用最小二乘拟合直线 y=a+bx。", steps: ["A=[[1,0],[1,1],[1,2]]，b=[1,2,3.5]ᵀ", "AᵀA=[[3,3],[3,5]]，Aᵀb=[6.5,9]", "解法方程：a=0.833，b=1.25（不是精确过点）"], answer: "拟合直线 y≈0.833+1.25x，最小化所有点到直线的残差平方和" },
    ],
  },
  "梯形法 / Simpson 法": {
    intro: "数值积分方法用多项式近似被积函数，再精确积分该多项式，从而近似原来的定积分。",
    formulas: [
      { label: "梯形法", tex: "\\int_a^b f\\,dx \\approx \\tfrac{b-a}{2}[f(a)+f(b)],\\; E=O(h^2)" },
      { label: "Simpson 法", tex: "\\int_a^b f\\,dx \\approx \\tfrac{b-a}{6}[f(a)+4f(m)+f(b)],\\; E=O(h^4)" },
    ],
    steps: ["将 [a,b] 分成 n 个子区间", "在每个子区间用梯形或 Simpson 公式", "累加各子区间结果"],
    note: "Simpson 法对次数 ≤3 的多项式精确，误差比梯形法高两阶。",
    viz: "梯形法 / Simpson 法",
    examples: [
      { problem: "用梯形法和 Simpson 法计算 ∫₀¹ x² dx（精确值=1/3≈0.3333）。", steps: ["梯形法：(1−0)/2×[f(0)+f(1)]=(1/2)×(0+1)=0.5，误差=0.167", "Simpson 法：(1−0)/6×[f(0)+4f(0.5)+f(1)]=(1/6)×(0+1+1)=0.3333"], answer: "Simpson 法精确（x² 是 2 次多项式，≤3 次，Simpson 精确积分）；梯形法误差较大" },
    ],
  },
  "Euler 法": {
    intro: "Euler 法是求解 ODE 初值问题 y'=f(t,y) 最简单的方法：用当前斜率直接预测下一步。",
    formulas: [
      { label: "Euler 迭代", tex: "w_{i+1} = w_i + h\\,f(t_i,\\,w_i)" },
      { label: "局部截断误差", tex: "\\tau = \\tfrac{h}{2}y''(\\xi)=O(h^2),\\quad \\text{全局} O(h)" },
    ],
    steps: ["从初始值 w₀=y₀ 出发", "依次计算 wᵢ₊₁=wᵢ+h·f(tᵢ,wᵢ)", "推进到目标时间"],
    note: "一阶方法，精度低，步长需很小。仅用于理论分析和教学示例，实践用 RK4。",
    viz: "Euler 法",
    examples: [
      { problem: "用 Euler 法解 y'=y，y(0)=1，步长 h=0.5，求 y(1) 的近似值（精确值 e≈2.718）。", steps: ["w₀=1，t₀=0", "w₁=w₀+0.5×f(0,1)=1+0.5×1=1.5，t₁=0.5", "w₂=1.5+0.5×f(0.5,1.5)=1.5+0.5×1.5=2.25，t₂=1.0"], answer: "Euler 近似 y(1)≈2.25，误差≈0.47（约 17%），减小步长可改善精度" },
    ],
  },
  "Runge-Kutta 法": {
    intro: "RK4 在一个步长内取四个斜率采样点加权平均，得到四阶精度，是最常用的 ODE 求解器。",
    formulas: [
      { label: "经典 RK4 格式", tex: "w_{i+1} = w_i + \\tfrac{h}{6}(k_1+2k_2+2k_3+k_4)" },
      { label: "局部截断误差", tex: "O(h^5),\\quad \\text{全局误差 } O(h^4)" },
    ],
    steps: ["计算 k₁=f(tᵢ,wᵢ)", "计算 k₂=f(tᵢ+h/2, wᵢ+hk₁/2)", "计算 k₃=f(tᵢ+h/2, wᵢ+hk₂/2)", "计算 k₄=f(tᵢ+h, wᵢ+hk₃)", "更新 wᵢ₊₁"],
    note: "每步 4 次函数求值，精度与计算量均衡。自适应步长版本（RK45）更实用。",
    viz: "Runge-Kutta 法",
    examples: [
      { problem: "用 RK4 解 y'=y，y(0)=1，步长 h=0.5，求 y(0.5)（精确值 e^0.5≈1.6487）。", steps: ["k₁=f(0,1)=1", "k₂=f(0.25, 1+0.5×0.5)=f(0.25,1.25)=1.25", "k₃=f(0.25, 1+0.5×1.25/2)=f(0.25,1.3125)=1.3125", "k₄=f(0.5, 1+0.5×1.3125)=f(0.5,1.6563)=1.6563", "w₁=1+(0.5/6)×(1+2.5+2.625+1.6563)≈1.6484"], answer: "RK4 近似 1.6484，误差仅 0.0003，远优于 Euler 法（误差 0.15）" },
    ],
  },
  "最小二乘数据拟合": {
    intro: "给定 m 个数据点，寻找参数 x 使模型与观测值的残差平方和最小，是数据科学的核心方法。",
    formulas: [
      { label: "残差向量", tex: "r = b - Ax,\\quad r_i = b_i - \\sum_j a_{ij}x_j" },
      { label: "最小二乘目标", tex: "\\min_x \\|r\\|_2^2 = \\min_x \\sum_{i=1}^m r_i^2" },
    ],
    steps: ["收集数据点 (tᵢ,bᵢ)", "建立矩阵方程 Ax≈b", "用法方程或 QR 分解求 x*"],
    note: "线性最小二乘：参数线性出现，有解析解。非线性：需要 Gauss-Newton 迭代。",
    examples: [
      { problem: "3 个实验数据：(1,2.1),(2,3.9),(3,6.2)，用 y=ax 拟合（过原点直线）。", steps: ["A=[1;2;3]（列向量），b=[2.1,3.9,6.2]ᵀ", "AᵀA=1+4+9=14，Aᵀb=2.1+7.8+18.6=28.5", "a=28.5/14≈2.036"], answer: "最优拟合 y≈2.036x，残差 ‖r‖≈0.18（比任何其他斜率都小）" },
    ],
  },
  "投资组合选择 (Markowitz)": {
    intro: "Markowitz 1959 年提出均值-方差框架，在期望收益和风险之间寻求最优平衡，获 1990 年诺贝尔经济学奖。",
    formulas: [
      { label: "期望收益", tex: "\\bar{r}_P = \\mu^\\top x" },
      { label: "投资组合风险", tex: "\\sigma_P^2 = x^\\top V x" },
      { label: "优化模型", tex: "\\min_x x^\\top Vx \\quad\\text{s.t.}\\; \\mu^\\top x \\geq p,\\; a^\\top x \\leq B" },
    ],
    steps: ["估计各证券期望收益 μ 和协方差矩阵 V", "设定收益下界 p 和预算 B", "求解二次规划得最优配置 x*"],
    note: "三种等价建模：最大化收益-α风险 / 最小化风险约束收益 / 最大化收益约束风险。",
    examples: [
      { problem: "两只股票 μ=[0.10,0.15]，V=[[0.04,0.01],[0.01,0.09]]，预算=1。求最小方差组合。", steps: ["min xᵀVx s.t. x₁+x₂=1，KKT：2Vx=λ1", "解得 x₁≈0.62，x₂≈0.38", "σ²_P=0.62²×0.04+2×0.62×0.38×0.01+0.38²×0.09≈0.029"], answer: "最优配置：62% 配低风险股，38% 配高收益股；组合收益 11.9%，方差 0.029" },
    ],
  },
  "SVM 分类": {
    intro: "支持向量机通过最大化两类数据之间的间隔超平面来分类，是数据挖掘的核心算法。",
    formulas: [
      { label: "最大间隔问题", tex: "\\min_w \\|w\\|^2 \\quad\\text{s.t.}\\; y_i[(w,x^i)+b]\\geq 1" },
      { label: "间隔宽度", tex: "\\text{margin} = \\frac{2}{\\|w\\|}" },
      { label: "软间隔（允许误分）", tex: "\\min_w \\|w\\|^2 + C\\sum_i\\xi_i" },
    ],
    steps: ["整理训练数据 {(xⁱ,yᵢ)}，yᵢ∈{±1}", "求解二次规划得到最优 ŵ 和 b̂", "新样本 y=sign((ŵ,x)+b̂)"],
    note: "C 控制惩罚力度：C 大→不允许误分；C 小→允许误分但间隔宽。",
    examples: [
      { problem: "两类点：正类 (1,1),(2,2)，负类 (0,0),(1,0)。求最大间隔超平面。", steps: ["支持向量（最近点）约为 (1,0) 和 (1,1)", "分界面为 x₁+x₂=1.5（中间面），w=(1,1)/‖(1,1)‖", "间隔 margin=2/‖w‖=√2≈1.414"], answer: "超平面：x₁+x₂=1.5（即 w·x+b=0），间隔宽度 √2" },
    ],
  },

  // ════════════════════════════════════════════════════════════════
  // 线性代数 (Leon 9th)
  // ════════════════════════════════════════════════════════════════
  "行列式定义与性质": {
    intro: "n 阶行列式是 n×n 方阵的一个标量函数，几何上表示列向量张成的超平行体的有向体积。",
    formulas: [
      { label: "余子式展开（按第 i 行）", tex: "\\det(A) = \\sum_{j=1}^n (-1)^{i+j} a_{ij} M_{ij}" },
      { label: "乘积法则", tex: "\\det(AB) = \\det(A)\\det(B)" },
      { label: "可逆条件", tex: "A \\text{ 可逆} \\iff \\det(A) \\neq 0" },
    ],
    steps: ["对 2×2 矩阵：ad-bc", "对 n×n：沿任意行/列按余子式展开（递归）", "利用初等行变换化为三角形，连乘对角元"],
    note: "行交换改变符号；行倍乘乘以常数 k；行加法不变。三角矩阵的行列式等于对角线之积。",
    examples: [
      { problem: "计算 3×3 矩阵 A=[[1,2,3],[0,4,5],[1,0,6]] 的行列式。", steps: ["沿第 1 列展开：det=1×M₁₁−0×M₂₁+1×M₃₁", "M₁₁=det[[4,5],[0,6]]=24−0=24", "M₃₁=det[[2,3],[4,5]]=10−12=−2", "det(A)=1×24+1×(−1)³⁺¹×(−2)=24−2=22"], answer: "det(A)=22，A 可逆（行列式非零）" },
    ],
  },
  "特征值与对角化": {
    intro: "方阵 A 的特征值 λ 使得存在非零向量 v 满足 Av=λv。对角化将 A 变换为对角矩阵，大大简化矩阵幂的计算。",
    formulas: [
      { label: "特征方程", tex: "\\det(A - \\lambda I) = 0" },
      { label: "对角化分解", tex: "A = P\\Lambda P^{-1},\\quad \\Lambda = \\operatorname{diag}(\\lambda_1,\\ldots,\\lambda_n)" },
      { label: "矩阵幂", tex: "A^k = P\\Lambda^k P^{-1}" },
    ],
    steps: ["计算特征多项式 det(A-λI)=0，求出 λ₁,…,λₙ", "对每个 λᵢ 求解 (A-λᵢI)v=0 得特征向量 vᵢ", "若 n 个特征向量线性无关，令 P=[v₁…vₙ]，则 A=PΛP⁻¹"],
    note: "实对称矩阵一定可对角化，且特征向量两两正交（谱定理）。n 个不同特征值保证可对角化。",
    viz: "特征值与对角化",
    examples: [
      { problem: "求 A=[[3,1],[0,2]] 的特征值和特征向量，并对角化。", steps: ["特征多项式：(3−λ)(2−λ)=0，λ₁=3，λ₂=2", "λ₁=3：(A−3I)v=[[0,1],[0,−1]]v=0 → v₁=[1,0]ᵀ", "λ₂=2：(A−2I)v=[[1,1],[0,0]]v=0 → v₂=[−1,1]ᵀ", "P=[[1,−1],[0,1]]，Λ=[[3,0],[0,2]]"], answer: "A=PΛP⁻¹，A¹⁰=PΛ¹⁰P⁻¹=diag(3¹⁰,2¹⁰) 变换后再变换回" },
    ],
  },
  "SVD 奇异值分解": {
    intro: "SVD 将任意矩阵分解为 A=UΣVᵀ，U、V 为正交矩阵，Σ 为非负对角矩阵，是数据降维、伪逆和图像压缩的核心工具。",
    formulas: [
      { label: "SVD 分解", tex: "A = U\\Sigma V^\\top,\\quad A \\in \\mathbb{R}^{m\\times n}" },
      { label: "奇异值定义", tex: "\\sigma_i = \\sqrt{\\lambda_i(A^\\top A)},\\quad \\sigma_1 \\geq \\sigma_2 \\geq \\cdots \\geq 0" },
      { label: "伪逆（Moore-Penrose）", tex: "A^+ = V\\Sigma^+ U^\\top" },
    ],
    steps: ["计算 AᵀA 的特征值（即 σᵢ²）和特征向量（V 的列）", "计算 AAᵀ 的特征向量（U 的列）", "奇异值 σᵢ=√λᵢ 组成 Σ"],
    note: "奇异值的大小反映各方向的拉伸强度；截断 SVD（保留前 k 个奇异值）是最优低秩近似（Eckart-Young 定理）。",
    examples: [
      { problem: "求 A=[[1,0],[0,2],[0,0]] 的 SVD（3×2 矩阵）。", steps: ["AᵀA=[[1,0],[0,4]]，特征值 σ₁²=4，σ₂²=1，故 σ₁=2，σ₂=1", "V=I₂（已是标准正交），Σ=[[2,0],[0,1],[0,0]]", "U 的前两列：u₁=Av₁/σ₁=[0,1,0]ᵀ，u₂=Av₂/σ₂=[1,0,0]ᵀ"], answer: "A=UΣVᵀ，U 的列是数据空间方向，σ₁=2 表示 y 方向拉伸更大" },
    ],
  },
  "Gram-Schmidt 正交化": {
    intro: "Gram-Schmidt 过程将一组线性无关向量转化为标准正交基，是 QR 分解的理论基础。",
    formulas: [
      { label: "正交投影", tex: "\\text{proj}_u v = \\frac{v \\cdot u}{u \\cdot u}\\, u" },
      { label: "Gram-Schmidt 迭代", tex: "u_k = v_k - \\sum_{j=1}^{k-1}\\frac{v_k \\cdot u_j}{u_j \\cdot u_j}u_j" },
      { label: "QR 分解结果", tex: "A = QR,\\quad Q^\\top Q = I,\\; R \\text{ 上三角}" },
    ],
    steps: ["令 u₁=v₁", "令 u₂=v₂ - proj_{u₁}(v₂)", "一般步：减去前面所有方向的投影", "归一化：qₖ=uₖ/‖uₖ‖"],
    note: "数值实现用修正 Gram-Schmidt（Modified GS）或 Householder 变换，稳定性更好。",
    examples: [
      { problem: "对 v₁=[1,1,0]ᵀ，v₂=[1,0,1]ᵀ 做 Gram-Schmidt 正交化。", steps: ["u₁=v₁=[1,1,0]ᵀ，q₁=u₁/‖u₁‖=[1,1,0]/√2", "proj_{u₁}(v₂)=(v₂·u₁)/(u₁·u₁)×u₁=(1/2)[1,1,0]ᵀ=[0.5,0.5,0]ᵀ", "u₂=v₂−proj=[1,0,1]−[0.5,0.5,0]=[0.5,−0.5,1]ᵀ", "q₂=u₂/‖u₂‖=[0.5,−0.5,1]/√1.5"], answer: "正交基 {q₁,q₂}，两者点积 q₁·q₂=0.5/√2−0.5/√2+0=0 ✓" },
    ],
  },
  "列空间与零空间": {
    intro: "矩阵的四个基本子空间（列空间、行空间、零空间、左零空间）刻画了线性方程组的解结构。",
    formulas: [
      { label: "秩-零化度定理", tex: "\\text{rank}(A) + \\text{nullity}(A) = n \\quad (A \\in \\mathbb{R}^{m\\times n})" },
      { label: "列空间（值域）", tex: "\\mathcal{C}(A) = \\{Ax : x \\in \\mathbb{R}^n\\}" },
      { label: "零空间（核）", tex: "\\mathcal{N}(A) = \\{x : Ax = 0\\}" },
    ],
    steps: ["对 A 进行行化简得到 RREF", "主列对应列空间的基", "自由变量对应零空间的基向量"],
    note: "Ax=b 有解 ⟺ b∈C(A)。若解存在，通解=特解+零空间中任意向量。",
    examples: [
      { problem: "求 A=[[1,2,3],[2,4,6]] 的零空间和列空间维数。", steps: ["行化简：R₂−2R₁→[[1,2,3],[0,0,0]]，rank(A)=1", "零空间维数=3−1=2（2个自由变量 x₂,x₃）", "零空间基：v₁=[−2,1,0]ᵀ，v₂=[−3,0,1]ᵀ（令 x₂=1,x₃=0 或 x₂=0,x₃=1）"], answer: "列空间=span{[1,2]ᵀ}，维数 1；零空间维数 2；验证：1+2=3=n ✓" },
    ],
  },

  // ════════════════════════════════════════════════════════════════
  // 概率论
  // ════════════════════════════════════════════════════════════════
  "条件概率与 Bayes 定理": {
    intro: "条件概率 P(A|B) 衡量在 B 已发生的前提下 A 发生的概率，Bayes 定理实现「从结果推原因」的反向推断。",
    viz: "条件概率与 Bayes 定理",
    formulas: [
      { label: "条件概率定义", tex: "P(A|B) = \\frac{P(A \\cap B)}{P(B)},\\quad P(B)>0" },
      { label: "全概率公式", tex: "P(A) = \\sum_{i=1}^n P(A|B_i)P(B_i)" },
      { label: "Bayes 定理", tex: "P(B_i|A) = \\frac{P(A|B_i)P(B_i)}{\\sum_j P(A|B_j)P(B_j)}" },
    ],
    steps: ["确定划分 {B₁,…,Bₙ}（互斥且穷举）", "用全概率公式计算 P(A)", "代入 Bayes 公式得后验概率 P(Bᵢ|A)"],
    note: "P(B) 称先验概率，P(B|A) 称后验概率。独立性条件：P(A∩B)=P(A)P(B)。",
    examples: [
      { problem: "某疾病患病率 1%，检测阳性率：患病者 99%，健康者 5%。已知检测阳性，求真正患病概率。", steps: ["设 B₁=患病，B₂=健康，A=阳性", "P(A)=P(A|B₁)P(B₁)+P(A|B₂)P(B₂)=0.99×0.01+0.05×0.99=0.0099+0.0495=0.0594", "P(B₁|A)=0.99×0.01/0.0594≈0.167"], answer: "即使检测阳性，真正患病概率只有约 16.7%（低患病率的影响），这说明稀有疾病的检测需多次确认" },
    ],
  },
  "常见概率分布": {
    intro: "数学中几种基础分布（Bernoulli、Poisson、正态、指数）描述了自然界中最常见的随机现象。",
    formulas: [
      { label: "正态分布密度", tex: "f(x)=\\frac{1}{\\sigma\\sqrt{2\\pi}}e^{-\\frac{(x-\\mu)^2}{2\\sigma^2}}" },
      { label: "Poisson 分布", tex: "P(X=k)=\\frac{\\lambda^k e^{-\\lambda}}{k!},\\quad k=0,1,2,\\ldots" },
      { label: "指数分布 CDF", tex: "F(x)=1-e^{-\\lambda x},\\quad x\\geq 0" },
    ],
    steps: ["根据实际场景选择合适分布", "确定参数（μ/σ 或 λ 等）", "计算概率或分位数"],
    note: "正态分布：68-95-99.7 法则。Poisson 是二项分布当 n→∞,np=λ 时的极限。指数分布具有无记忆性。",
    viz: "常见概率分布",
    examples: [
      { problem: "某网站每分钟平均收到 3 个请求（Poisson(3)），求 1 分钟内收到 0 个请求的概率，以及收到至少 1 个的概率。", steps: ["P(X=0)=e⁻³×3⁰/0!=e⁻³≈0.0498", "P(X≥1)=1−P(X=0)=1−0.0498≈0.9502"], answer: "0 请求的概率≈5%，至少 1 个请求的概率≈95%。实际中常用此计算 SLA（服务水平协议）" },
    ],
  },
  "期望与方差": {
    intro: "期望 E[X] 是随机变量的加权平均，方差 Var(X) 衡量其散布程度，两者是描述分布最核心的数字特征。",
    formulas: [
      { label: "离散期望", tex: "E[X] = \\sum_k x_k P(X=x_k)" },
      { label: "方差分解", tex: "\\text{Var}(X) = E[X^2] - (E[X])^2" },
      { label: "协方差", tex: "\\text{Cov}(X,Y) = E[XY] - E[X]E[Y]" },
    ],
    steps: ["计算 E[X]（加权和或积分）", "计算 E[X²]", "方差 = E[X²] - (E[X])²"],
    note: "线性性：E[aX+b]=aE[X]+b；Var(aX+b)=a²Var(X)。独立时 Var(X+Y)=Var(X)+Var(Y)。",
    examples: [
      { problem: "X 取 1,2,3 各以概率 0.2,0.5,0.3，求 E[X]，Var(X)，以及 Y=2X+1 的方差。", steps: ["E[X]=1×0.2+2×0.5+3×0.3=0.2+1.0+0.9=2.1", "E[X²]=1×0.2+4×0.5+9×0.3=0.2+2.0+2.7=4.9", "Var(X)=4.9−2.1²=4.9−4.41=0.49", "Var(Y)=Var(2X+1)=4Var(X)=4×0.49=1.96"], answer: "E[X]=2.1，Var(X)=0.49，σ=0.7；Y=2X+1 的 Var=1.96" },
    ],
  },
  "中心极限定理": {
    intro: "中心极限定理（CLT）是概率论最重要的结果：无论总体分布如何，足够多 i.i.d. 样本的均值趋向正态分布。",
    formulas: [
      { label: "CLT（Lindeberg-Lévy）", tex: "\\frac{\\bar{X}_n - \\mu}{\\sigma/\\sqrt{n}} \\xrightarrow{d} N(0,1)" },
      { label: "样本均值分布", tex: "\\bar{X}_n \\approx N\\!\\left(\\mu,\\frac{\\sigma^2}{n}\\right) \\text{ 当 } n \\text{ 大}" },
    ],
    steps: ["确认样本 i.i.d.，有有限均值 μ 和方差 σ²", "标准化：减均值除以标准误 σ/√n", "当 n≥30（经验），用标准正态计算概率"],
    note: "CLT 是统计推断的基石：解释了为何正态分布无处不在，也是大样本置信区间和假设检验的理论依据。",
    examples: [
      { problem: "掷均匀骰子（μ=3.5，σ²=35/12），掷 36 次，求样本均值超过 3.8 的概率。", steps: ["样本均值 X̄ ≈ N(3.5, 35/(12×36))=N(3.5, 0.0810)", "标准误 σ/√n=√(35/12)/6≈0.285", "P(X̄>3.8)=P(Z>(3.8−3.5)/0.285)=P(Z>1.053)≈1−0.854=0.146"], answer: "约 14.6% 的概率样本均值超过 3.8，CLT 使我们可以用正态分布近似这一非正态总体的问题" },
    ],
  },

  // 数理统计
  "最大似然估计 MLE": {
    intro: "MLE 选取使观测数据出现概率最大的参数值作为估计，是最常用的参数估计方法，具有渐近正态性和有效性。",
    formulas: [
      { label: "似然函数", tex: "L(\\theta) = \\prod_{i=1}^n f(x_i;\\theta)" },
      { label: "对数似然", tex: "\\ell(\\theta) = \\sum_{i=1}^n \\ln f(x_i;\\theta)" },
      { label: "MLE 方程", tex: "\\frac{\\partial \\ell}{\\partial \\theta} = 0" },
    ],
    steps: ["写出似然函数 L(θ)", "取对数得 ℓ(θ)（便于求导）", "对 θ 求偏导置零，解方程组", "验证是最大值（Hessian 负定）"],
    note: "MLE 的渐近性质：n→∞ 时，θ̂_MLE 是无偏且有效的，且 √n(θ̂-θ₀)→N(0, I(θ₀)⁻¹)，I 为 Fisher 信息量。",
    examples: [
      { problem: "X～Exp(λ)，观测到样本 x₁=1.2, x₂=0.8, x₃=2.0，求 λ 的 MLE。", steps: ["似然 L(λ)=λ³e^{−λ(1.2+0.8+2.0)}=λ³e^{−4λ}", "对数似然 ℓ=3ln(λ)−4λ", "ℓ'=3/λ−4=0 → λ̂=3/4=0.75"], answer: "λ̂_MLE=n/Σxᵢ=3/4=0.75（样本均值的倒数），这是指数分布 MLE 的通用结论" },
    ],
  },
  "置信区间": {
    intro: "置信区间 [L, U] 以 1-α 的概率包含真实参数 θ，是区间估计的标准方法，比点估计提供更多不确定性信息。",
    formulas: [
      { label: "正态均值（σ 已知）", tex: "\\bar{X} \\pm z_{\\alpha/2}\\frac{\\sigma}{\\sqrt{n}}" },
      { label: "正态均值（σ 未知）", tex: "\\bar{X} \\pm t_{\\alpha/2,n-1}\\frac{S}{\\sqrt{n}}" },
      { label: "比例的置信区间", tex: "\\hat{p} \\pm z_{\\alpha/2}\\sqrt{\\frac{\\hat{p}(1-\\hat{p})}{n}}" },
    ],
    steps: ["选择枢轴量（含 θ 的已知分布的统计量）", "根据分布确定临界值（z 或 t）", "反解出 θ 的区间 [L, U]"],
    note: "置信度 1-α 不是「θ 落在区间内的概率」，而是「该方法构造的区间有 1-α 的概率包含 θ」（频率解释）。",
    viz: "置信区间",
    examples: [
      { problem: "n=25 名学生考试均值 X̄=75，样本标准差 S=10，σ 未知，构造 μ 的 95% 置信区间。", steps: ["σ 未知用 t 分布，自由度 n−1=24", "t₀.₀₂₅,₂₄≈2.064（查表）", "误差边界：2.064×10/√25=2.064×2=4.13"], answer: "95% CI: [75−4.13, 75+4.13]=[70.87, 79.13]，即有 95% 置信度真实均值在此区间" },
    ],
  },
  "假设检验框架": {
    intro: "假设检验用样本数据对总体参数做出统计决策：在 H₀ 为真的前提下，判断观测结果是否足够极端以拒绝 H₀。",
    formulas: [
      { label: "t 检验统计量", tex: "T = \\frac{\\bar{X} - \\mu_0}{S/\\sqrt{n}} \\sim t_{n-1} \\text{ under } H_0" },
      { label: "I 类错误（弃真）", tex: "\\alpha = P(\\text{拒绝 }H_0 \\mid H_0\\text{ 真})" },
      { label: "p 值", tex: "p = P(\\text{检验统计量} \\geq t_{obs} \\mid H_0)" },
    ],
    steps: ["建立 H₀ 和 H₁（单/双侧）", "选择检验统计量及其分布", "计算 p 值或查临界值", "p<α 则拒绝 H₀"],
    note: "p 值越小，拒绝 H₀ 的证据越强，但不代表效应量大。增大样本量 n 可减少两类错误。",
    examples: [
      { problem: "声称新药平均降压 10mmHg，实验 n=16 人，X̄=8，S=4，α=0.05，检验 H₀:μ=10 vs H₁:μ<10。", steps: ["T=(8−10)/(4/√16)=(−2)/(1)=−2，自由度 15", "单侧临界值 t₀.₀₅,₁₅=−1.753（查表左尾）", "t_obs=−2 < −1.753，落入拒绝域"], answer: "p≈0.032<0.05，拒绝 H₀，统计显著地认为新药效果低于声称的 10mmHg" },
    ],
  },

  // ODE
  "分离变量法": {
    intro: "将 ODE dy/dx=f(x)g(y) 的两个变量分别移到等式两边后积分，是求解可分离一阶方程最直接的方法。",
    formulas: [
      { label: "可分离形式", tex: "\\frac{dy}{dx} = f(x)g(y)" },
      { label: "分离后积分", tex: "\\int \\frac{dy}{g(y)} = \\int f(x)\\,dx + C" },
    ],
    steps: ["验证方程可写成 dy/g(y)=f(x)dx 的形式", "两边分别积分", "解出 y（若可能）代入初始条件确定 C"],
    note: "注意 g(y)=0 时的奇解（常数解）。解的存在区间取决于 g(y) 的零点和 f(x) 的奇点。",
    examples: [
      { problem: "求解 IVP：dy/dx = 2xy，y(0)=3。", steps: ["分离变量：dy/y=2x dx", "两边积分：ln|y|=x²+C", "y=Ae^{x²}（A=e^C）", "代入 y(0)=3：A=3"], answer: "y=3e^{x²}，定义在 (−∞,+∞) 上，随 |x| 增大迅速增长" },
    ],
  },
  "特征方程法（常系数线性 ODE）": {
    intro: "常系数线性齐次 ODE aₙy⁽ⁿ⁾+…+a₀y=0 通过代入 y=eʳˣ 化为代数方程（特征方程），其根决定通解形式。",
    formulas: [
      { label: "特征方程（二阶）", tex: "ar^2 + br + c = 0" },
      { label: "实不等根", tex: "y = C_1 e^{r_1 x} + C_2 e^{r_2 x}" },
      { label: "复根 r=α±βi", tex: "y = e^{\\alpha x}(C_1\\cos\\beta x + C_2\\sin\\beta x)" },
      { label: "重根 r（k重）", tex: "y = (C_1+C_2 x+\\cdots+C_k x^{k-1})e^{rx}" },
    ],
    steps: ["写出特征方程，求所有根", "根据根的类型写出基本解组", "线性组合得通解，用初始条件定系数"],
    note: "非齐次方程 ay''+by'+cy=g(x) 的通解=齐次通解+特解。特解用待定系数法或常数变易法求。",
    examples: [
      { problem: "求解 IVP：y''−3y'+2y=0，y(0)=1，y'(0)=0。", steps: ["特征方程：r²−3r+2=0，(r−1)(r−2)=0，r₁=1，r₂=2", "通解：y=C₁eˣ+C₂e²ˣ", "y(0)=C₁+C₂=1，y'(0)=C₁+2C₂=0", "解得 C₁=2，C₂=−1"], answer: "y=2eˣ−e²ˣ，当 x→+∞ 时 y→−∞（e²ˣ 增长主导）" },
    ],
  },
  "Laplace 变换": {
    intro: "Laplace 变换把时域 ODE 化为 s 域的代数方程，特别适合求解含初始条件的线性常系数 ODE（IVP）。",
    formulas: [
      { label: "定义", tex: "\\mathcal{L}\\{f(t)\\} = F(s) = \\int_0^\\infty e^{-st}f(t)\\,dt" },
      { label: "导数法则", tex: "\\mathcal{L}\\{f'\\} = sF(s) - f(0)" },
      { label: "卷积定理", tex: "\\mathcal{L}\\{f*g\\} = F(s)G(s)" },
    ],
    steps: ["对 ODE 两边取 Laplace 变换，代入初始条件", "解出 Y(s)（代数方程）", "对 Y(s) 做部分分式分解", "查变换表或用卷积定理求逆变换 y(t)"],
    note: "Laplace 变换只适用于 t≥0，且要求函数为指数阶。阶跃函数 u(t-a) 和 δ 函数在 Laplace 域有简洁形式。",
    viz: "Laplace 变换",
    examples: [
      { problem: "用 Laplace 变换解 y''+4y=0，y(0)=1，y'(0)=0。", steps: ["对两边取 Laplace 变换，利用导数法则 L{y''}=s²Y−sy(0)−y'(0)：", "s²Y − s·1 − 0 + 4Y = 0，即 (s²+4)Y = s", "解出 Y(s) = s/(s²+4)", "查 Laplace 变换表：L⁻¹{s/(s²+ω²)} = cos(ωt)，此处 ω=2", "∴ y(t) = cos(2t)，满足初始条件验证：y(0)=1 ✓，y'(0)=−2sin(0)=0 ✓"], answer: "y(t) = cos(2t)，描述无阻尼自由振荡，周期 T=π" },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════
  // 线性代数补充内容
  // ═══════════════════════════════════════════════════════════════════
  "矩阵运算与初等变换": {
    intro: "矩阵加法、数乘、乘法是线性代数的基础运算；初等行变换（行交换、行倍乘、行加法）是化简矩阵的核心工具，不改变方程组的解集。",
    formulas: [
      { label: "矩阵乘法 (C=AB)", tex: "c_{ij} = \\sum_{k=1}^n a_{ik}b_{kj}" },
      { label: "转置性质", tex: "(AB)^\\top = B^\\top A^\\top" },
      { label: "逆矩阵公式（2×2）", tex: "A^{-1} = \\frac{1}{ad-bc}\\begin{pmatrix}d & -b \\\\ -c & a\\end{pmatrix}" },
    ],
    steps: ["矩阵乘法：A 的列数必须等于 B 的行数", "初等行变换：行交换 Rᵢ↔Rⱼ；行倍乘 Rᵢ→kRᵢ；行加法 Rᵢ→Rᵢ+kRⱼ", "用初等行变换化简增广矩阵 [A|b] 以解方程组", "初等变换不改变矩阵的秩和方程组的解"],
    note: "矩阵乘法不满足交换律（一般 AB≠BA），但满足结合律和分配律。",
    examples: [
      { problem: "设 A=[[1,2],[3,4]]，B=[[0,1],[1,0]]，计算 AB 和 BA，验证 AB≠BA。", steps: ["AB：第(1,1)位=1×0+2×1=2；第(1,2)位=1×1+2×0=1；第(2,1)位=3×0+4×1=4；第(2,2)位=3×1+4×0=3", "∴ AB = [[2,1],[4,3]]", "BA：第(1,1)位=0×1+1×3=3；第(1,2)位=0×2+1×4=4；第(2,1)位=1；第(2,2)位=2", "∴ BA = [[3,4],[1,2]]", "显然 AB = [[2,1],[4,3]] ≠ [[3,4],[1,2]] = BA"], answer: "AB ≠ BA，体现矩阵乘法的不交换性。这是矩阵运算与实数运算的关键区别。" },
    ],
  },
  "Gauss-Jordan 消去": {
    intro: "Gauss-Jordan 消去法将增广矩阵化为行最简阶梯形（RREF），可同时读出所有变量的值，也用于求逆矩阵。",
    formulas: [
      { label: "行最简阶梯形（RREF）条件", tex: "\\text{每个主元为 1，所在列其余元素为 0}" },
      { label: "求逆矩阵格式", tex: "[A \\mid I] \\xrightarrow{\\text{行变换}} [I \\mid A^{-1}]" },
    ],
    steps: ["写出增广矩阵 [A|b]（或 [A|I] 求逆）", "从左到右，逐列化主元为 1（÷该列主元）", "用主元行消去同列所有其他行的元素（不仅是下方）", "继续下一列，直到得到 RREF", "从 RREF 直接读出解或 A⁻¹"],
    note: "与普通 Gauss 消去相比，Gauss-Jordan 还消去主元上方的元素，得到 RREF，代价是运算量略大。",
    examples: [
      { problem: "用 Gauss-Jordan 消去法解：x+2y=5，3x+4y=11。", steps: ["增广矩阵：[[1,2|5],[3,4|11]]", "R₂ ← R₂ − 3R₁：[[1,2|5],[0,-2|-4]]", "R₂ ← R₂÷(−2)：[[1,2|5],[0,1|2]]", "R₁ ← R₁ − 2R₂：[[1,0|1],[0,1|2]]", "直接读出 x=1，y=2"], answer: "x=1，y=2。RREF 左侧恰好变成单位矩阵，说明解唯一。" },
    ],
  },
  "向量的线性组合": {
    intro: "若向量 b 可以写成 v₁,…,vₙ 的加权和，则称 b 是这些向量的线性组合。这个概念贯穿线性代数全书，是张成空间和列空间的基础。",
    formulas: [
      { label: "线性组合定义", tex: "b = c_1 v_1 + c_2 v_2 + \\cdots + c_n v_n" },
      { label: "等价矩阵形式", tex: "Ac = b,\\quad A = [v_1 \\mid v_2 \\mid \\cdots \\mid v_n]" },
    ],
    steps: ["判断 b 是否是 {v₁,…,vₙ} 的线性组合 ⟺ 方程 Ax=b 是否有解", "将向量组拼为矩阵 A，构造增广矩阵 [A|b]", "行化简：若增广矩阵无矛盾行（0=非零），则有解", "回代（或 RREF）求系数 c₁,…,cₙ"],
    note: "b 在列空间 C(A) 中 ⟺ b 是 A 各列的线性组合 ⟺ Ax=b 有解。",
    examples: [
      { problem: "判断 b=[3,5]ᵀ 是否是 v₁=[1,1]ᵀ 和 v₂=[1,3]ᵀ 的线性组合。", steps: ["构造方程 c₁[1,1]+c₂[1,3]=[3,5]", "即：c₁+c₂=3，c₁+3c₂=5", "第二式减第一式：2c₂=2 → c₂=1", "代回：c₁=3−1=2", "验证：2[1,1]+1[1,3]=[2+1,2+3]=[3,5] ✓"], answer: "b = 2v₁ + v₂，是线性组合。系数 c₁=2，c₂=1。" },
    ],
  },
  "矩阵的秩": {
    intro: "矩阵的秩（rank）是行空间（或列空间）的维数，等于行化简后主元的个数，反映方程组的独立约束数。",
    formulas: [
      { label: "秩的定义", tex: "\\text{rank}(A) = \\text{主元数} = \\dim(\\mathcal{C}(A))" },
      { label: "秩-零化度定理", tex: "\\text{rank}(A) + \\text{nullity}(A) = n\\quad (A\\in\\mathbb{R}^{m\\times n})" },
      { label: "方程组相容性", tex: "Ax=b\\text{ 有解} \\iff \\text{rank}([A|b]) = \\text{rank}(A)" },
    ],
    steps: ["对 A 做行化简，得到阶梯形矩阵", "数主元个数即为 rank(A)", "若 rank(A)=n（满列秩），方程组 Ax=0 只有零解", "若 rank(A)=m（满行秩），Ax=b 对任意 b 有解"],
    note: "行变换不改变秩；rank(A)=rank(Aᵀ)，即行秩等于列秩。",
    examples: [
      { problem: "求 A=[[1,2,3],[2,4,6],[1,0,1]] 的秩。", steps: ["R₂←R₂−2R₁：[[1,2,3],[0,0,0],[1,0,1]]", "R₃←R₃−R₁：[[1,2,3],[0,0,0],[0,-2,-2]]", "交换 R₂ 和 R₃：[[1,2,3],[0,-2,-2],[0,0,0]]", "有 2 个主元：列 1（主元 1）和列 2（主元 -2）"], answer: "rank(A)=2，nullity=3−2=1（一个自由变量）。第 3 行全零，说明三个方程只有两个独立约束。" },
    ],
  },
  "余子式与代数余子式": {
    intro: "余子式 Mᵢⱼ 是删去第 i 行第 j 列后的 (n-1)×(n-1) 子矩阵的行列式；代数余子式 Cᵢⱼ=(-1)^(i+j)Mᵢⱼ。行列式按任意行/列展开都用代数余子式。",
    formulas: [
      { label: "按第 i 行的余子式展开", tex: "\\det(A) = \\sum_{j=1}^n a_{ij}C_{ij}" },
      { label: "代数余子式", tex: "C_{ij} = (-1)^{i+j} M_{ij}" },
      { label: "逆矩阵伴随阵公式", tex: "A^{-1} = \\frac{1}{\\det A}\\,\\text{adj}(A),\\quad (\\text{adj}A)_{ij}=C_{ji}" },
    ],
    steps: ["划去第 i 行第 j 列，计算剩余 (n-1)×(n-1) 矩阵的行列式得 Mᵢⱼ", "乘以符号 (-1)^(i+j) 得代数余子式 Cᵢⱼ", "选含零最多的行/列展开，减少计算量"],
    note: "符号规律：按国际象棋棋盘黑白格分布，(1,1) 位置为 +。展开选含零最多的行/列可减少运算量。",
    examples: [
      { problem: "用第 1 行展开计算 A=[[2,1,0],[1,3,2],[0,1,1]] 的行列式。", steps: ["按第 1 行展开：det=2·C₁₁+1·C₁₂+0·C₁₃", "C₁₁=(+1)·det[[3,2],[1,1]]=(+1)·(3−2)=1", "C₁₂=(−1)·det[[1,2],[0,1]]=(−1)·(1−0)=−1", "C₁₃=(+1)·det[[1,3],[0,1]]=(+1)·(1−0)=1（但系数为 0，不影响结果）", "det(A)=2×1+1×(−1)+0×1=2−1=1"], answer: "det(A)=1，A 可逆（行列式非零）。" },
    ],
  },
  "Cramer 法则": {
    intro: "Cramer 法则用行列式直接表达线性方程组 Ax=b 的唯一解（当 det(A)≠0 时），理论价值高，实用性较弱（n 大时计算量远高于消去法）。",
    formulas: [
      { label: "Cramer 公式", tex: "x_i = \\frac{\\det(A_i)}{\\det(A)},\\quad i=1,\\ldots,n" },
      { label: "Aᵢ 的定义", tex: "A_i = [a_1,\\ldots,a_{i-1},\\mathbf{b},a_{i+1},\\ldots,a_n]" },
    ],
    steps: ["计算 det(A)（若为 0 则无唯一解）", "对每个变量 xᵢ，将 A 的第 i 列替换为 b，得到 Aᵢ", "计算 det(Aᵢ)", "xᵢ = det(Aᵢ)/det(A)"],
    note: "Cramer 法则时间复杂度 O(n!)，仅适合 2×2 和 3×3 系统手算，或理论分析（如解的连续性）。",
    examples: [
      { problem: "用 Cramer 法则解：3x+y=7，x+2y=4。", steps: ["A=[[3,1],[1,2]]，det(A)=6−1=5", "A₁（x）：将 b=[7,4]ᵀ 替换第 1 列 → A₁=[[7,1],[4,2]]，det(A₁)=14−4=10", "A₂（y）：将 b 替换第 2 列 → A₂=[[3,7],[1,4]]，det(A₂)=12−7=5", "x=10/5=2，y=5/5=1"], answer: "x=2，y=1。验证：3×2+1=7 ✓，2+2×1=4 ✓" },
    ],
  },
  "行列式的几何意义": {
    intro: "行列式的绝对值等于矩阵各列向量（或行向量）所围成的平行多面体的有向体积：2D 中是平行四边形面积，3D 中是平行六面体体积。",
    formulas: [
      { label: "2D 面积（2×2 矩阵）", tex: "\\text{Area} = |\\det(A)| = |ad - bc|" },
      { label: "3D 体积（3×3 矩阵）", tex: "\\text{Vol} = |\\det([u,v,w])|" },
      { label: "线性变换缩放比", tex: "\\text{变换后体积} = |\\det(T)| \\times \\text{原体积}" },
    ],
    steps: ["将向量写成矩阵的列", "计算行列式的绝对值得到有向体积", "符号（正/负）表示向量组的取向（右手/左手）"],
    note: "当 det(A)=0 时，向量组共面（或共线），平行多面体退化为面积/体积为零的扁平图形。",
    examples: [
      { problem: "向量 v₁=[3,0]ᵀ，v₂=[1,2]ᵀ，求它们围成的平行四边形面积。", steps: ["构造矩阵 A=[v₁|v₂]=[[3,1],[0,2]]", "det(A)=3×2−1×0=6", "面积=|det(A)|=6"], answer: "平行四边形面积=6。也可理解为：变换 A 将单位正方形（面积=1）拉伸为面积 6 的平行四边形。" },
    ],
  },
  "子空间": {
    intro: "向量空间 V 的子空间 W 是 V 的非空子集，且对加法和数乘封闭。典型子空间包括零子空间 {0}、全空间 V 本身、以及矩阵的列空间/零空间。",
    formulas: [
      { label: "子空间判定（三条件）", tex: "\\textbf{0}\\in W;\\quad u,v\\in W\\Rightarrow u+v\\in W;\\quad c\\in\\mathbb{R},u\\in W\\Rightarrow cu\\in W" },
      { label: "零空间（核）", tex: "\\text{Null}(A) = \\{x : Ax = 0\\}" },
      { label: "列空间（像）", tex: "\\text{Col}(A) = \\text{span}\\{a_1,a_2,\\ldots,a_n\\}" },
    ],
    steps: ["验证 0∈W（否则直接不是子空间）", "验证加法封闭：u,v∈W → u+v∈W", "验证数乘封闭：c∈ℝ，u∈W → cu∈W"],
    note: "平面内过原点的直线是 ℝ² 的子空间；不过原点的直线不是（不含零向量）。",
    examples: [
      { problem: "判断 W={[x,y]ᵀ : x+y=0} 是否是 ℝ² 的子空间。", steps: ["验证零向量：x=0,y=0 时 0+0=0 ✓，故 0∈W", "验证加法：设 u=[a,−a]ᵀ，v=[b,−b]ᵀ∈W，u+v=[a+b,−a−b]ᵀ，(a+b)+(−a−b)=0 ✓", "验证数乘：cu=[ca,−ca]ᵀ，ca+(−ca)=0 ✓", "三条件全满足"], answer: "W 是 ℝ² 的子空间，实际上是一条过原点的直线（方向向量 [1,−1]ᵀ），dim=1。" },
    ],
  },
  "基与维数": {
    intro: "向量空间的基是一组线性无关且能张成整个空间的向量；基的向量个数称为维数，是空间固有属性，不因基的选择而改变。",
    formulas: [
      { label: "基的定义", tex: "B=\\{v_1,\\ldots,v_k\\}:\\; \\text{线性无关且} \\text{span}(B)=V" },
      { label: "坐标唯一性", tex: "\\forall\\,v\\in V,\\; v = c_1v_1+\\cdots+c_kv_k\\text{ 唯一}" },
      { label: "维数定理", tex: "\\dim(U+W) = \\dim(U)+\\dim(W)-\\dim(U\\cap W)" },
    ],
    steps: ["写出候选向量组，检验线性无关性", "检验张成性：任意向量可由基表示", "基的个数 = 维数（基不唯一，维数唯一）"],
    note: "扩展基：将线性无关组扩展到整个空间的基；收缩基：从张成组中去掉冗余向量得到基。",
    examples: [
      { problem: "证明 {[1,0,1]ᵀ, [0,1,1]ᵀ, [1,1,0]ᵀ} 是 ℝ³ 的一组基。", steps: ["将三向量排为矩阵列：A=[[1,0,1],[0,1,1],[1,1,0]]", "计算 det(A)=1(0−1)−0+1(0−1)=−1−1=−2≠0", "det≠0 说明三向量线性无关，且维数=3=dim(ℝ³)", "线性无关的 n 个向量就是 ℝⁿ 的一组基（无需另验证张成性）"], answer: "det(A)=−2≠0，三向量线性无关，构成 ℝ³ 的基，dim(ℝ³)=3。" },
    ],
  },
  "坐标变换": {
    intro: "同一向量在不同基下有不同的坐标表示；过渡矩阵 P 将旧坐标转换为新坐标，是基变换的核心工具。",
    formulas: [
      { label: "旧坐标→新坐标", tex: "[v]_{\\mathcal{B}'} = P^{-1}[v]_{\\mathcal{B}}" },
      { label: "过渡矩阵", tex: "P = [[b_1]_{\\mathcal{B}'}\\;|\\;\\cdots\\;|\\;[b_n]_{\\mathcal{B}'}]" },
      { label: "矩阵在新基下的表示", tex: "[T]_{\\mathcal{B}'} = P^{-1}[T]_{\\mathcal{B}}\\,P" },
    ],
    steps: ["确定旧基 B 和新基 B'", "将旧基向量 bᵢ 用新基表示，得到 P 的各列", "新坐标 = P⁻¹ × 旧坐标"],
    note: "坐标变换本质是「同一向量，换个参照系」；过渡矩阵 P 的列是旧基向量在新基下的坐标。",
    examples: [
      { problem: "旧基 B={[1,0]ᵀ,[0,1]ᵀ}（标准基），新基 B'={[1,1]ᵀ,[1,−1]ᵀ}。求 v=[3,1]ᵀ 在新基下的坐标。", steps: ["P=[[1,1],[1,−1]]（新基向量排为列）", "求 P⁻¹：det(P)=−1−1=−2，P⁻¹=(1/−2)[[−1,−1],[−1,1]]=[[1/2,1/2],[1/2,−1/2]]", "[v]_{B'}=P⁻¹[v]_B=[[1/2,1/2],[1/2,−1/2]]×[3,1]ᵀ=[2,1]ᵀ"], answer: "v 在新基下坐标为 [2,1]ᵀ，即 v=2·[1,1]+1·[1,−1]=[3,1] ✓" },
    ],
  },
  "内积与正交": {
    intro: "内积（点积）赋予向量空间几何结构——长度和角度；两向量内积为零时称为正交，正交性是最小二乘、主成分分析的基础。",
    formulas: [
      { label: "欧氏内积", tex: "\\langle u,v \\rangle = u^\\top v = \\sum_{i=1}^n u_i v_i" },
      { label: "向量长度（模）", tex: "\\|u\\| = \\sqrt{\\langle u,u \\rangle}" },
      { label: "Cauchy-Schwarz 不等式", tex: "|\\langle u,v \\rangle| \\leq \\|u\\|\\,\\|v\\|" },
    ],
    steps: ["计算内积：逐分量相乘后求和", "计算模：内积的平方根", "判断正交：u·v=0 即正交"],
    note: "标准正交基 {q₁,…,qₙ} 满足 qᵢ·qⱼ=δᵢⱼ（Kronecker delta）：同向量内积=1，不同向量内积=0。",
    examples: [
      { problem: "已知 u=[1,2,−1]ᵀ，v=[3,0,3]ᵀ，计算 u·v，‖u‖，‖v‖，以及两向量夹角。", steps: ["u·v = 1×3+2×0+(−1)×3 = 3+0−3 = 0", "‖u‖ = √(1+4+1) = √6", "‖v‖ = √(9+0+9) = √18 = 3√2", "cos θ = u·v/(‖u‖‖v‖) = 0/(√6·3√2) = 0 → θ = 90°"], answer: "u·v=0，两向量正交，夹角 θ=90°。正交向量在最小二乘和 QR 分解中有重要应用。" },
    ],
  },
  "QR 分解": {
    intro: "QR 分解将矩阵 A 分解为正交矩阵 Q 和上三角矩阵 R，是求解最小二乘和特征值的数值稳定算法，优于法方程（避免条件数平方）。",
    formulas: [
      { label: "QR 分解", tex: "A = QR,\\quad Q^\\top Q = I,\\quad R \\text{ 上三角}" },
      { label: "最小二乘解（通过 QR）", tex: "A^\\top Ax = A^\\top b \\;\\Leftrightarrow\\; Rx = Q^\\top b" },
    ],
    steps: ["对 A 的列用 Gram-Schmidt 正交化得到 Q 的列", "R = QᵀA（上三角矩阵）", "求解 Rx=Qᵀb（回代，比法方程更稳定）"],
    note: "Householder 变换和 Givens 旋转是 QR 分解的数值实现方法，比修正 Gram-Schmidt 更稳定。",
    examples: [
      { problem: "对 A=[[1,1],[0,1],[1,0]] 进行 QR 分解（A 的列 a₁=[1,0,1]ᵀ，a₂=[1,1,0]ᵀ）。", steps: ["q₁ = a₁/‖a₁‖ = [1,0,1]ᵀ/√2 = [1/√2, 0, 1/√2]ᵀ", "r₁₂ = q₁·a₂ = 1/√2+0+0 = 1/√2；u₂=a₂−r₁₂q₁=[1−1/2,1,0−1/2]=[1/2,1,−1/2]ᵀ", "q₂=u₂/‖u₂‖，‖u₂‖=√(1/4+1+1/4)=√(3/2)，q₂=[1/√6,2/√6,−1/√6]ᵀ", "R=[[‖a₁‖, r₁₂],[0, ‖u₂‖]]=[[√2,1/√2],[0,√(3/2)]]"], answer: "A=QR，Q 的两列为 q₁,q₂（正交单位向量），R 为上三角。用 Rx=Qᵀb 求最小二乘比法方程数值稳定。" },
    ],
  },
  "正交投影与最小二乘": {
    intro: "b 在子空间 W 上的正交投影 p̂ 是 W 中距 b 最近的点，使 ‖b−p̂‖ 最小。这直接给出线性最小二乘的几何解释。",
    formulas: [
      { label: "向量 b 在 a 上的投影", tex: "\\hat{p} = \\frac{a^\\top b}{a^\\top a}\\,a" },
      { label: "投影矩阵（投到 C(A)）", tex: "P = A(A^\\top A)^{-1}A^\\top" },
      { label: "最小二乘解", tex: "\\hat{x} = (A^\\top A)^{-1}A^\\top b = A^+ b" },
    ],
    steps: ["残差 r=b−Ax̂ 必须与 A 的所有列正交（AᵀAx̂=Aᵀb）", "投影矩阵 P=A(AᵀA)⁻¹Aᵀ 满足 P²=P（幂等）且 Pᵀ=P（对称）", "最小二乘解 x̂ 使 ‖Ax−b‖² 最小"],
    note: "若 A 列满秩（各列线性无关），AᵀA 可逆，最小二乘解唯一；若不是，用伪逆 A⁺ 给出最小范数解。",
    examples: [
      { problem: "将 b=[1,2,2]ᵀ 投影到 a=[1,1,1]ᵀ 所张成的直线上。", steps: ["投影公式：p̂ = (aᵀb/aᵀa)·a", "aᵀb = 1+2+2 = 5", "aᵀa = 1+1+1 = 3", "p̂ = (5/3)·[1,1,1]ᵀ = [5/3,5/3,5/3]ᵀ", "残差：e=b−p̂=[1−5/3,2−5/3,2−5/3]=[−2/3,1/3,1/3]ᵀ，验证 aᵀe=−2/3+1/3+1/3=0 ✓（正交）"], answer: "p̂=[5/3,5/3,5/3]ᵀ，残差 e⊥a，‖e‖²=2/3 是 b 到直线的最短距离的平方。" },
    ],
  },
  "特征方程": {
    intro: "特征方程 det(A−λI)=0 是求矩阵特征值的核心方程，是一个关于 λ 的 n 次多项式（特征多项式），其根就是特征值。",
    formulas: [
      { label: "特征多项式", tex: "p(\\lambda) = \\det(A - \\lambda I)" },
      { label: "特征方程（n=2）", tex: "\\lambda^2 - \\text{tr}(A)\\lambda + \\det(A) = 0" },
      { label: "Cayley-Hamilton 定理", tex: "p(A) = 0\\text{（矩阵满足自身特征方程）}" },
    ],
    steps: ["计算 det(A−λI) 展开为 λ 的多项式", "求解 p(λ)=0 得特征值 λ₁,…,λₙ（可能有重根或复根）", "代数重数：λ 作为多项式根的重数；几何重数：特征子空间的维数"],
    note: "代数重数 ≥ 几何重数；矩阵可对角化 ⟺ 每个特征值的代数重数=几何重数。",
    examples: [
      { problem: "求 A=[[4,1],[2,3]] 的特征值。", steps: ["det(A−λI)=det([[4−λ,1],[2,3−λ]])=(4−λ)(3−λ)−2", "展开：12−7λ+λ²−2=λ²−7λ+10", "分解：(λ−5)(λ−2)=0", "特征值 λ₁=5，λ₂=2"], answer: "特征值为 5 和 2。tr(A)=7=5+2 ✓；det(A)=10=5×2 ✓（特征值之积=行列式，之和=迹）" },
    ],
  },
  "对角化": {
    intro: "若矩阵 A 有 n 个线性无关的特征向量，则可对角化为 A=PΛP⁻¹，其中 Λ 是特征值对角矩阵。对角化使矩阵幂、指数等计算极为简便。",
    formulas: [
      { label: "对角化分解", tex: "A = P\\Lambda P^{-1},\\quad \\Lambda=\\mathrm{diag}(\\lambda_1,\\ldots,\\lambda_n)" },
      { label: "矩阵幂", tex: "A^k = P\\Lambda^k P^{-1} = P\\,\\mathrm{diag}(\\lambda_1^k,\\ldots,\\lambda_n^k)\\,P^{-1}" },
      { label: "矩阵指数", tex: "e^A = P\\,\\mathrm{diag}(e^{\\lambda_1},\\ldots,e^{\\lambda_n})\\,P^{-1}" },
    ],
    steps: ["求所有特征值（特征方程）", "对每个特征值求特征向量", "将特征向量排为列构成 P", "验证 P 可逆（特征向量线性无关）→ 得到 A=PΛP⁻¹"],
    note: "对角化不唯一（P 的列序可调整）；实对称矩阵一定可用正交矩阵对角化（谱定理）。",
    examples: [
      { problem: "对角化 A=[[3,1],[0,2]]。", steps: ["特征值：(3−λ)(2−λ)=0 → λ₁=3，λ₂=2", "λ₁=3：(A−3I)v=[[0,1],[0,−1]]v=0 → v₁=[1,0]ᵀ", "λ₂=2：(A−2I)v=[[1,1],[0,0]]v=0 → v₂=[−1,1]ᵀ", "P=[[1,−1],[0,1]]，Λ=[[3,0],[0,2]]", "验证：A=PΛP⁻¹（P⁻¹=[[1,1],[0,1]]）"], answer: "A=[[1,−1],[0,1]]·[[3,0],[0,2]]·[[1,1],[0,1]]。用对角化算 A¹⁰：对角矩阵的幂直接提 3¹⁰ 和 2¹⁰。" },
    ],
  },
  "对称矩阵的谱定理": {
    intro: "谱定理（Spectral Theorem）：实对称矩阵 A=Aᵀ 一定可用正交矩阵对角化，即 A=QΛQᵀ，Q 为正交矩阵，λᵢ 均为实数。",
    formulas: [
      { label: "谱分解", tex: "A = Q\\Lambda Q^\\top = \\sum_{i=1}^n \\lambda_i q_i q_i^\\top" },
      { label: "正交性", tex: "q_i^\\top q_j = \\delta_{ij};\\quad Q^\\top Q = QQ^\\top = I" },
      { label: "正定条件", tex: "A\\text{ 正定} \\iff \\text{所有 }\\lambda_i > 0 \\iff x^\\top Ax > 0\\;(\\forall x\\neq 0)" },
    ],
    steps: ["验证 A 对称（A=Aᵀ）", "计算特征值（必为实数）", "对每个特征值求特征向量；不同特征值的特征向量自动正交", "Gram-Schmidt 处理重特征值的特征空间，得到标准正交基"],
    note: "谱定理是 PCA（主成分分析）、二次型化标准形、以及正定矩阵理论的基础。",
    examples: [
      { problem: "对 A=[[4,2],[2,1]] 做谱分解。", steps: ["特征方程：(4−λ)(1−λ)−4=λ²−5λ=λ(λ−5)=0 → λ₁=0，λ₂=5", "λ₁=0：(A−0)v=0 → v₁=[1,−2]ᵀ；单位化 q₁=[1,−2]ᵀ/√5", "λ₂=5：(A−5I)v=0 → v₂=[2,1]ᵀ；单位化 q₂=[2,1]ᵀ/√5", "验证正交：q₁·q₂=(2−2)/5=0 ✓", "谱分解：A=0·q₁q₁ᵀ+5·q₂q₂ᵀ=5·q₂q₂ᵀ"], answer: "A=5·[4/5,2/5;2/5,1/5]，det=0（奇异矩阵），rank=1，λ₁=0 对应零空间，λ₂=5 对应主方向。" },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════
  // 概率论补充内容
  // ═══════════════════════════════════════════════════════════════════
  "样本空间与事件": {
    intro: "样本空间 Ω 是随机试验所有可能结果的集合；事件是 Ω 的子集，基本事件运算（并、交、补）对应集合运算。",
    formulas: [
      { label: "De Morgan 律", tex: "\\overline{A\\cup B}=\\bar{A}\\cap\\bar{B};\\quad \\overline{A\\cap B}=\\bar{A}\\cup\\bar{B}" },
      { label: "加法公式", tex: "P(A\\cup B)=P(A)+P(B)-P(A\\cap B)" },
      { label: "互斥事件加法", tex: "A\\cap B=\\varnothing\\Rightarrow P(A\\cup B)=P(A)+P(B)" },
    ],
    steps: ["列出样本空间 Ω（所有可能结果）", "定义感兴趣的事件（Ω 的子集）", "用集合运算计算复合事件的概率"],
    note: "必然事件 Ω 和不可能事件 ∅ 是两个极端；P(Ω)=1，P(∅)=0。",
    examples: [
      { problem: "掷两枚骰子，定义 A=「两数之和为 7」，B=「第一枚为 4」，求 P(A)，P(B)，P(A∩B)，P(A∪B)。", steps: ["Ω 共 6×6=36 个等可能结果", "A={(1,6),(2,5),(3,4),(4,3),(5,2),(6,1)}，|A|=6，P(A)=6/36=1/6", "B={(4,1),(4,2),(4,3),(4,4),(4,5),(4,6)}，|B|=6，P(B)=1/6", "A∩B={(4,3)}，P(A∩B)=1/36", "P(A∪B)=1/6+1/6−1/36=12/36−1/36=11/36"], answer: "P(A)=1/6，P(B)=1/6，P(A∩B)=1/36，P(A∪B)=11/36" },
    ],
  },
  "概率公理": {
    intro: "Kolmogorov 公理体系用三条公理（非负性、规范性、可列可加性）建立了现代概率论的严格基础，所有概率性质均可由此推导。",
    formulas: [
      { label: "公理一（非负性）", tex: "P(A) \\geq 0 \\quad \\forall A" },
      { label: "公理二（规范性）", tex: "P(\\Omega) = 1" },
      { label: "公理三（可列可加）", tex: "A_i\\cap A_j=\\varnothing\\Rightarrow P\\!\\left(\\bigcup_{i=1}^\\infty A_i\\right)=\\sum_{i=1}^\\infty P(A_i)" },
    ],
    steps: ["验证样本空间有概率测度（满足三公理）", "由公理推导：P(∅)=0，P(Aᶜ)=1−P(A)，P(A∪B) 加法公式等", "利用这些性质计算复杂事件的概率"],
    note: "三条公理极为简洁，但足以推导所有概率性质。古典概型（等可能性）和频率解释都是满足公理的特例。",
    examples: [
      { problem: "已知 P(A)=0.3，P(B)=0.4，P(A∩B)=0.1，求 P(Aᶜ)，P(A∪B)，P(AᶜBᶜ)。", steps: ["P(Aᶜ)=1−P(A)=1−0.3=0.7（由公理推导的补事件公式）", "P(A∪B)=P(A)+P(B)−P(A∩B)=0.3+0.4−0.1=0.6", "P(AᶜBᶜ)=P((A∪B)ᶜ)=1−P(A∪B)=1−0.6=0.4（De Morgan 律）"], answer: "P(Aᶜ)=0.7，P(A∪B)=0.6，P(AᶜBᶜ)=0.4" },
    ],
  },
  "条件概率": {
    intro: "条件概率 P(A|B) 在已知 B 发生的前提下重新分配概率，将样本空间缩小为 B；它是 Bayes 推断、链式法则的基础。",
    formulas: [
      { label: "条件概率定义", tex: "P(A|B) = \\frac{P(A\\cap B)}{P(B)},\\quad P(B)>0" },
      { label: "乘法公式", tex: "P(A\\cap B) = P(A|B)P(B) = P(B|A)P(A)" },
      { label: "独立性判定", tex: "A,B\\text{ 独立} \\iff P(A|B)=P(A) \\iff P(A\\cap B)=P(A)P(B)" },
    ],
    steps: ["确定条件事件 B（P(B)>0）", "计算 P(A∩B)（两事件同时发生的概率）", "P(A|B) = P(A∩B)/P(B)"],
    note: "独立≠互斥！两个非零概率事件若互斥，则一定不独立（知道 B 发生，A 不可能发生，改变了 A 的概率）。",
    examples: [
      { problem: "一副牌中随机抽一张，P(K)=4/52，P(红色)=26/52，P(红K)=2/52。求 P(红色|K) 和 P(K|红色)，判断两事件是否独立。", steps: ["P(红色|K)=P(红色∩K)/P(K)=(2/52)/(4/52)=2/4=1/2", "P(K|红色)=P(红色∩K)/P(红色)=(2/52)/(26/52)=2/26=1/13", "检验独立性：P(红色∩K)=2/52；P(红色)·P(K)=(1/2)·(1/13)=1/26=2/52 ✓"], answer: "P(红色|K)=1/2，P(K|红色)=1/13，P(A∩B)=P(A)P(B) 成立，故两事件独立。" },
    ],
  },
  "全概率公式与 Bayes 定理": {
    intro: "全概率公式将复杂事件 A 分解为在各互斥划分 Bᵢ 下的加权平均；Bayes 定理反转条件，从「结果推原因」实现统计推断。",
    formulas: [
      { label: "全概率公式", tex: "P(A) = \\sum_i P(A|B_i)P(B_i)" },
      { label: "Bayes 定理", tex: "P(B_i|A) = \\frac{P(A|B_i)P(B_i)}{\\sum_j P(A|B_j)P(B_j)}" },
    ],
    steps: ["确定互斥穷举划分 {B₁,…,Bₙ}（P(Bᵢ)已知=先验）", "计算各条件概率 P(A|Bᵢ)（似然）", "用全概率公式计算 P(A)", "代入 Bayes 定理得后验 P(Bᵢ|A)"],
    note: "先验 P(Bᵢ) + 似然 P(A|Bᵢ) → 后验 P(Bᵢ|A)。Bayes 统计的核心思想：用数据不断更新信念。",
    viz: "条件概率与 Bayes 定理",
    examples: [
      { problem: "三台机器生产零件各占 20%、30%、50%，次品率分别为 5%、4%、2%。随机取一件发现是次品，求来自机器 1 的概率。", steps: ["设 B₁,B₂,B₃=来自机器1,2,3；A=次品", "P(B₁)=0.2, P(B₂)=0.3, P(B₃)=0.5", "P(A|B₁)=0.05, P(A|B₂)=0.04, P(A|B₃)=0.02", "全概率：P(A)=0.2×0.05+0.3×0.04+0.5×0.02=0.01+0.012+0.01=0.032", "Bayes：P(B₁|A)=0.01/0.032≈0.3125"], answer: "来自机器 1 的概率约 31.25%，虽然机器 1 占比最小，但次品率最高，贡献最大。" },
    ],
  },
  "离散型随机变量": {
    intro: "离散型随机变量 X 取有限或可列个值，其概率分布由概率质量函数（PMF）P(X=xₖ)=pₖ 完全描述，所有概率之和为 1。",
    formulas: [
      { label: "PMF 归一化", tex: "\\sum_k p_k = 1,\\quad p_k \\geq 0" },
      { label: "期望", tex: "E[X] = \\sum_k x_k p_k" },
      { label: "二项分布", tex: "X\\sim B(n,p):\\; P(X=k)=\\binom{n}{k}p^k(1-p)^{n-k}" },
    ],
    steps: ["列出所有可能取值 x₁,x₂,…", "确定每个值的概率 pₖ=P(X=xₖ)", "验证 Σpₖ=1", "用 PMF 计算期望、方差等数字特征"],
    note: "重要离散分布：Bernoulli（0-1分布）、二项分布 B(n,p)、Poisson(λ)、几何分布、负二项分布。",
    examples: [
      { problem: "X 是一次掷骰子的点数，写出 PMF，计算 P(X≥5) 和 E[X]。", steps: ["PMF：P(X=k)=1/6，k=1,2,3,4,5,6（均匀分布）", "P(X≥5)=P(X=5)+P(X=6)=1/6+1/6=2/6=1/3", "E[X]=1×(1/6)+2×(1/6)+…+6×(1/6)=(1+2+3+4+5+6)/6=21/6=3.5"], answer: "P(X≥5)=1/3，E[X]=3.5（均匀分布的均值=（最大值+最小值）/2）" },
    ],
  },
  "连续型随机变量": {
    intro: "连续型随机变量 X 的概率用密度函数（PDF）f(x) 描述，f(x)≥0 且积分为1；单点概率为零，只有区间上的概率才有意义。",
    formulas: [
      { label: "PDF 归一化", tex: "\\int_{-\\infty}^{+\\infty} f(x)\\,dx = 1" },
      { label: "区间概率", tex: "P(a\\leq X\\leq b) = \\int_a^b f(x)\\,dx" },
      { label: "连续均匀分布", tex: "X\\sim U(a,b):\\; f(x)=\\frac{1}{b-a},\\; x\\in[a,b]" },
    ],
    steps: ["写出 PDF f(x)（只在支撑集上非零）", "验证归一化：∫f(x)dx=1", "用积分计算区间概率 P(a≤X≤b)"],
    note: "P(X=c)=0 对连续变量始终成立；连续随机变量由 CDF F(x)=P(X≤x)=∫f(t)dt 等价描述。",
    examples: [
      { problem: "X~U(0,4)（均匀分布），求 P(1<X<3) 和 E[X]。", steps: ["PDF：f(x)=1/4，x∈[0,4]；其余为 0", "P(1<X<3)=∫₁³(1/4)dx=(1/4)×(3−1)=1/2", "E[X]=∫₀⁴x·(1/4)dx=(1/4)·[x²/2]₀⁴=(1/4)·8=2", "也可直接用公式 E[X]=(a+b)/2=(0+4)/2=2"], answer: "P(1<X<3)=1/2，E[X]=2。均匀分布的期望在区间中点，方差=(b−a)²/12=4/3。" },
    ],
  },
  "分布函数": {
    intro: "累积分布函数（CDF）F(x)=P(X≤x) 对所有随机变量（离散和连续）均有定义，单调不减，右连续，F(−∞)=0，F(+∞)=1。",
    formulas: [
      { label: "CDF 定义", tex: "F(x) = P(X \\leq x) = \\int_{-\\infty}^x f(t)\\,dt" },
      { label: "区间概率", tex: "P(a < X \\leq b) = F(b) - F(a)" },
      { label: "PDF 与 CDF 互相转化", tex: "f(x) = F'(x)\\text{（在连续点处）}" },
    ],
    steps: ["对离散变量：F(x)=ΣP(X=xₖ)（x ≥ xₖ 的所有项）", "对连续变量：F(x)=∫₋∞ˣ f(t)dt", "用 F(b)−F(a) 计算区间概率"],
    note: "CDF 是右连续的左极限函数；离散变量的 CDF 是阶梯函数；连续变量的 CDF 是连续函数。",
    examples: [
      { problem: "X~Exp(1)，即 f(x)=e⁻ˣ（x≥0），求 CDF F(x) 和 P(1<X<2)。", steps: ["F(x)=∫₀ˣ e⁻ᵗdt=[-e⁻ᵗ]₀ˣ=1−e⁻ˣ（x≥0），F(x)=0（x<0）", "P(1<X<2)=F(2)−F(1)=(1−e⁻²)−(1−e⁻¹)=e⁻¹−e⁻²", "≈0.3679−0.1353=0.2326"], answer: "F(x)=1−e⁻ˣ（x≥0），P(1<X<2)≈0.233。指数分布的 CDF 形式简洁，常用于排队论和可靠性分析。" },
    ],
  },
  "常见分布（Bernoulli/Poisson/正态/指数）": {
    intro: "四种最基础的概率分布各有其物理背景：Bernoulli 描述成败，Poisson 描述稀有事件，正态描述自然测量误差，指数描述等待时间。",
    formulas: [
      { label: "正态分布 N(μ,σ²)", tex: "f(x)=\\frac{1}{\\sigma\\sqrt{2\\pi}}e^{-\\frac{(x-\\mu)^2}{2\\sigma^2}}" },
      { label: "Poisson 分布", tex: "P(X=k)=\\frac{\\lambda^k e^{-\\lambda}}{k!},\\;E[X]=\\lambda" },
      { label: "指数分布 Exp(λ)", tex: "f(x)=\\lambda e^{-\\lambda x},\\;x\\geq 0,\\;E[X]=1/\\lambda" },
    ],
    steps: ["识别场景对应哪种分布（二元结果→Bernoulli，计数→Poisson，测量→正态，等待→指数）", "确定参数（μ,σ² 或 λ 等）", "用对应的 PMF/PDF 计算所需概率"],
    note: "正态分布：68−95−99.7 法则；Poisson 是 Binomial 的极限（n→∞,np=λ）；指数具有无记忆性。",
    viz: "常见概率分布",
    examples: [
      { problem: "某邮局每小时收到投诉电话平均 2 个（Poisson），求一小时内收到 0 个、恰好 3 个的概率。", steps: ["λ=2，X~Poisson(2)", "P(X=0)=e⁻²·2⁰/0!=e⁻²≈0.1353", "P(X=3)=e⁻²·2³/3!=e⁻²·8/6≈0.1353×1.333≈0.1804"], answer: "P(X=0)≈13.5%，P(X=3)≈18%。Poisson 分布的众数约在 λ 附近，这里 λ=2 时 P(X=2) 和 P(X=3) 最大。" },
    ],
  },
  "数学期望": {
    intro: "数学期望 E[X] 是随机变量按概率加权的平均值，是分布的「重心」，描述随机试验的长期平均结果。",
    formulas: [
      { label: "离散期望", tex: "E[X] = \\sum_k x_k P(X=x_k)" },
      { label: "连续期望", tex: "E[X] = \\int_{-\\infty}^{+\\infty} x\\,f(x)\\,dx" },
      { label: "线性性（最重要！）", tex: "E[aX+bY] = aE[X]+bE[Y]" },
    ],
    steps: ["离散：E[X]=Σxₖpₖ（加权平均）", "连续：E[X]=∫x·f(x)dx", "函数的期望：E[g(X)]=Σg(xₖ)pₖ 或 ∫g(x)f(x)dx"],
    note: "期望的线性性对任意随机变量成立，无需独立性；E[XY]=E[X]E[Y] 只在 X,Y 独立时成立。",
    examples: [
      { problem: "X 表示掷一枚骰子的奖金（正面 1,2,3,4 分别得 1,2,3,4 元，5 点亏 2 元，6 点亏 5 元），计算期望奖金，判断是否值得参与。", steps: ["E[X]=1×(1/6)+2×(1/6)+3×(1/6)+4×(1/6)+(−2)×(1/6)+(−5)×(1/6)", "=(1+2+3+4−2−5)/6=3/6=0.5（元）", "每次参与的期望收益为 0.5 元"], answer: "E[X]=0.5 元>0，从期望角度值得参与。但注意：期望正值不等于每次都赢，需考虑方差（风险）。" },
    ],
  },
  "方差与标准差": {
    intro: "方差 Var(X) 衡量随机变量偏离期望的平均程度，标准差 σ=√Var(X) 与 X 同量纲，是描述分布散布程度的最常用指标。",
    formulas: [
      { label: "方差定义", tex: "\\mathrm{Var}(X) = E[(X-\\mu)^2] = E[X^2] - (E[X])^2" },
      { label: "常用性质", tex: "\\mathrm{Var}(aX+b) = a^2\\mathrm{Var}(X)" },
      { label: "独立变量之和", tex: "\\mathrm{Var}(X+Y) = \\mathrm{Var}(X)+\\mathrm{Var}(Y)\\;\\text{（独立时）}" },
    ],
    steps: ["先算 E[X]（均值 μ）", "算 E[X²]=Σxₖ²pₖ 或 ∫x²f(x)dx", "Var(X)=E[X²]−μ²", "σ=√Var(X)"],
    note: "Var(X)≥0；Var(X)=0 ⟺ X 是常数（以概率 1）；Chebyshev 不等式：P(|X−μ|≥kσ)≤1/k²。",
    examples: [
      { problem: "X~B(n=4, p=0.5)（掷 4 枚硬币正面数），计算 E[X]，Var(X)，P(X=2)。", steps: ["二项分布公式：E[X]=np=4×0.5=2", "Var(X)=np(1−p)=4×0.5×0.5=1，σ=1", "P(X=2)=C(4,2)×0.5²×0.5²=6×0.25×0.25=6/16=0.375"], answer: "E[X]=2，Var(X)=1，σ=1；P(X=2)=37.5%（最可能出现 2 个正面）。" },
    ],
  },
  "协方差与相关系数": {
    intro: "协方差 Cov(X,Y) 衡量两随机变量的线性相关程度；相关系数 ρ 是标准化后的协方差，取值在 [−1,1]，与量纲无关。",
    formulas: [
      { label: "协方差", tex: "\\mathrm{Cov}(X,Y) = E[XY] - E[X]E[Y]" },
      { label: "Pearson 相关系数", tex: "\\rho_{XY} = \\frac{\\mathrm{Cov}(X,Y)}{\\sqrt{\\mathrm{Var}(X)\\cdot\\mathrm{Var}(Y)}}" },
      { label: "方差展开", tex: "\\mathrm{Var}(X+Y) = \\mathrm{Var}(X)+2\\mathrm{Cov}(X,Y)+\\mathrm{Var}(Y)" },
    ],
    steps: ["计算 E[XY]（联合分布下的加权平均）", "Cov(X,Y)=E[XY]−E[X]E[Y]", "ρ=Cov/√(Var(X)Var(Y))"],
    note: "ρ=1 完全正相关；ρ=−1 完全负相关；ρ=0 线性不相关（但不意味着独立！）。",
    examples: [
      { problem: "X 均匀分布在 {1,2,3}，Y=X²，计算 Cov(X,Y) 和 ρ(X,Y)。", steps: ["P(X=k)=1/3，E[X]=(1+2+3)/3=2", "E[X²]=(1+4+9)/3=14/3，E[X³]=(1+8+27)/3=36/3=12", "E[Y]=E[X²]=14/3，E[XY]=E[X³]=12", "Cov(X,Y)=12−2×(14/3)=12−28/3=8/3≈2.67", "Var(X)=14/3−4=2/3；Var(Y)=E[X⁴]−(E[X²])²=(1+16+81)/3−(14/3)²=98/3−196/9≈10.22", "ρ=（8/3）/√(2/3×10.22)≈2.67/√6.81≈1.02... (ρ接近1，强正相关)"], answer: "Cov(X,Y)≈2.67，ρ≈0.98，强正相关——当 X 增大时 Y=X² 也明显增大，尽管关系是非线性的。" },
    ],
  },
  "大数定律（弱/强）": {
    intro: "大数定律保证：大量独立重复试验的样本均值以某种意义收敛到总体期望，是概率论的基石，也是频率解释概率的理论依据。",
    formulas: [
      { label: "弱大数定律（依概率收敛）", tex: "\\bar{X}_n \\xrightarrow{P} \\mu:\\; P(|\\bar{X}_n-\\mu|>\\varepsilon)\\to 0" },
      { label: "强大数定律（几乎处处收敛）", tex: "P\\!\\left(\\lim_{n\\to\\infty}\\bar{X}_n = \\mu\\right) = 1" },
      { label: "Chebyshev 弱大数定律条件", tex: "\\text{i.i.d.，有限方差 }\\sigma^2\\Rightarrow P(|\\bar{X}_n-\\mu|>\\varepsilon)\\leq \\frac{\\sigma^2}{n\\varepsilon^2}" },
    ],
    steps: ["确认样本 i.i.d.（独立同分布），有有限期望 μ", "弱大数定律：用 Chebyshev 不等式证明", "强大数定律：要求更强（如有限 4 阶矩），结论更强（几乎处处）"],
    note: "弱 LLN 是频率→概率的理论基础；强 LLN 保证模拟（Monte Carlo）方法的有效性。",
    examples: [
      { problem: "掷公平硬币，X̄ₙ 表示前 n 次正面频率，由 Chebyshev 不等式估计：要保证 P(|X̄ₙ−0.5|>0.01)≤0.05，n 至少需要多少？", steps: ["X~Bernoulli(0.5)，μ=0.5，Var(X)=0.25", "Chebyshev：P(|X̄ₙ−μ|>ε)≤Var(X)/(nε²)", "要求 0.25/(n×0.01²)≤0.05", "0.25/(0.0001n)≤0.05 → n≥0.25/(0.0001×0.05)=50000"], answer: "n≥50000。这是 Chebyshev 给出的保守上界；实际用正态近似只需 n≈约1万。大数定律为频率趋近概率提供了数学保证。" },
    ],
  },
  "正态近似应用": {
    intro: "由中心极限定理，当 n 足够大时（通常 n≥30），任意分布的样本均值近似服从正态分布，可用标准正态表求概率。",
    formulas: [
      { label: "正态近似（CLT）", tex: "\\bar{X}_n \\approx N\\!\\left(\\mu, \\frac{\\sigma^2}{n}\\right)" },
      { label: "标准化", tex: "Z = \\frac{\\bar{X}_n - \\mu}{\\sigma/\\sqrt{n}} \\approx N(0,1)" },
      { label: "二项→正态近似（n≥30）", tex: "B(n,p) \\approx N(np,\\,np(1-p))" },
    ],
    steps: ["识别 X̄ₙ 的分布参数 μ 和 σ/√n", "标准化：Z=(X̄ₙ−μ)/(σ/√n)", "查标准正态表 Φ(z) 计算概率"],
    note: "连续性修正：对离散分布（如二项），计算 P(X≤k) 时用 P(Z≤(k+0.5−np)/√(np(1-p))) 更精确。",
    examples: [
      { problem: "某工厂生产零件，μ=10cm，σ=0.5cm。随机抽 100 个，求样本均值超过 10.1cm 的概率。", steps: ["X̄~N(10, 0.5²/100)=N(10, 0.0025)，标准误=0.5/10=0.05", "P(X̄>10.1)=P(Z>(10.1−10)/0.05)=P(Z>2)", "查正态表：P(Z>2)=1−Φ(2)=1−0.9772=0.0228"], answer: "P(X̄>10.1)≈2.28%。样本量越大，样本均值越集中在真实均值附近，这正是大样本统计推断的优势。" },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════
  // 数理统计补充内容
  // ═══════════════════════════════════════════════════════════════════
  "总体与样本": {
    intro: "统计推断的基础：总体是研究对象的全体（通常是一个分布），样本是从总体中随机抽取的有限个观测值，目的是用样本推断总体参数。",
    formulas: [
      { label: "简单随机样本", tex: "X_1,X_2,\\ldots,X_n \\overset{\\text{i.i.d.}}{\\sim} F(\\cdot;\\theta)" },
      { label: "样本均值", tex: "\\bar{X} = \\frac{1}{n}\\sum_{i=1}^n X_i" },
      { label: "样本方差（无偏）", tex: "S^2 = \\frac{1}{n-1}\\sum_{i=1}^n(X_i-\\bar{X})^2" },
    ],
    steps: ["明确总体分布族 F(·;θ) 和待估参数 θ", "设计简单随机抽样方案（等概率、独立抽取）", "计算样本统计量（X̄, S² 等）", "用统计量对总体参数做推断（估计/检验）"],
    note: "样本方差除以 n−1 而非 n，是为了使 E[S²]=σ²（无偏性）。这 1 个自由度「损失」在估计均值上。",
    examples: [
      { problem: "观测到样本：3, 7, 5, 4, 6。计算样本均值 X̄ 和样本方差 S²。", steps: ["X̄=(3+7+5+4+6)/5=25/5=5", "各偏差：3−5=−2，7−5=2，5−5=0，4−5=−1，6−5=1", "偏差平方和：4+4+0+1+1=10", "S²=10/(5−1)=10/4=2.5"], answer: "X̄=5，S²=2.5，样本标准差 S=√2.5≈1.58。样本均值用来估计总体均值，S² 用来估计总体方差 σ²。" },
    ],
  },
  "统计量": {
    intro: "统计量是样本的函数，且不含任何未知参数。样本均值、样本方差、样本分位数都是统计量；它们本身是随机变量，有自己的抽样分布。",
    formulas: [
      { label: "样本 k 阶矩", tex: "A_k = \\frac{1}{n}\\sum_{i=1}^n X_i^k" },
      { label: "样本中心 k 阶矩", tex: "B_k = \\frac{1}{n}\\sum_{i=1}^n(X_i-\\bar{X})^k" },
      { label: "顺序统计量", tex: "X_{(1)}\\leq X_{(2)}\\leq\\cdots\\leq X_{(n)}" },
    ],
    steps: ["确认表达式只含样本 X₁,…,Xₙ（无未知参数）", "统计量也是随机变量，可求其期望、方差（抽样分布）", "常用统计量：X̄（估均值）、S²（估方差）、样本极差（估量程）"],
    note: "X̄ 是总体均值 μ 的充分统计量（正态分布下）；T=X̄/（S/√n）是检验 μ 的枢轴量。",
    examples: [
      { problem: "样本 2, 4, 6, 8, 10，计算样本二阶矩 A₂、样本方差 S²，并验证 A₂−X̄²=n·S²/(n+1) 不成立（说明 S² 不是 B₂）。", steps: ["X̄=(2+4+6+8+10)/5=6", "A₂=(4+16+36+64+100)/5=220/5=44", "B₂（除以 n）=(4+4+0+4+4)/5+（以偏差平方）=32/5=6.4", "S²（除以 n−1）=32/4=8", "B₂≠S²：B₂ 是有偏的（E[B₂]=(n−1)σ²/n≠σ²），S² 是无偏的"], answer: "X̄=6，A₂=44，B₂=6.4，S²=8。统计中用 S²（除以 n−1）而非 B₂（除以 n），因为 S² 是 σ² 的无偏估计。" },
    ],
  },
  "χ² 分布 / t 分布 / F 分布": {
    intro: "三大抽样分布是正态总体参数推断（置信区间和假设检验）的基础工具，由标准正态变量的变换得到。",
    formulas: [
      { label: "χ²(n) 分布", tex: "\\chi^2 = Z_1^2+\\cdots+Z_n^2,\\; Z_i\\overset{\\text{i.i.d.}}{\\sim}N(0,1)" },
      { label: "t(n) 分布", tex: "T = \\frac{Z}{\\sqrt{\\chi^2(n)/n}},\\; Z\\perp\\chi^2(n)" },
      { label: "F(m,n) 分布", tex: "F = \\frac{\\chi^2(m)/m}{\\chi^2(n)/n}" },
    ],
    steps: ["χ²(n)：n 个独立标准正态的平方和；E[χ²]=n，Var=2n", "t(n)：标准正态÷独立χ²的根号；n→∞ 趋向正态", "F(m,n)：两个独立χ²之比；检验方差相等时使用"],
    note: "自由度越大，t 分布越接近标准正态（n>30 时差异小）；F 分布非对称，F(1,n)=t²(n)。",
    examples: [
      { problem: "X₁,…,X₁₆ i.i.d.~N(μ,4)（σ²=4），S² 是样本方差。求 (n−1)S²/σ² 的分布，并求 P((n−1)S²/σ²≤26.3)。", steps: ["(n−1)S²/σ²=(16−1)S²/4=15S²/4~χ²(15)", "P(15S²/4≤26.3)=P(χ²(15)≤26.3)", "查 χ²(15) 分布表：χ²₀.₀₅(15)=24.996，χ²₀.₀₂₅(15)=27.488", "26.3 在这两个值之间，故概率约在 0.95~0.975 之间"], answer: "15S²/4~χ²(15)，P(χ²(15)≤26.3)≈0.965（精确查表）。这是构造 σ² 置信区间的基础。" },
    ],
  },
  "正态总体抽样定理": {
    intro: "正态总体的样本均值和样本方差相互独立，且有精确分布——这一性质使正态模型的统计推断（置信区间、t检验）有严格理论依据。",
    formulas: [
      { label: "X̄ 的精确分布", tex: "\\bar{X}\\sim N\\!\\left(\\mu,\\frac{\\sigma^2}{n}\\right)" },
      { label: "S² 的精确分布", tex: "\\frac{(n-1)S^2}{\\sigma^2}\\sim\\chi^2(n-1)" },
      { label: "X̄ 与 S² 独立", tex: "\\bar{X}\\perp S^2\\;\\text{（正态总体专有性质）}" },
      { label: "t 统计量", tex: "\\frac{\\bar{X}-\\mu}{S/\\sqrt{n}}\\sim t(n-1)" },
    ],
    steps: ["X~N(μ,σ²)，X₁,…,Xₙ i.i.d. 抽样", "X̄ 和 S² 统计上独立（仅正态总体有此性质）", "σ 未知时，用 S 代替 σ，t=（X̄−μ）/（S/√n）~t(n−1)"],
    note: "独立性是关键：若总体不正态，X̄ 和 S² 一般不独立；大样本下 CLT 给近似正态，但有限样本需严格条件。",
    examples: [
      { problem: "X~N(μ,σ²)，n=10，X̄=5.2，S=1.5，检验 μ 是否为 5，α=0.05。", steps: ["H₀:μ=5，H₁:μ≠5（双侧）", "t 统计量=(5.2−5)/(1.5/√10)=0.2/0.474=0.422", "自由度 9，双侧临界值 t₀.₀₂₅(9)=2.262", "|t|=0.422<2.262，不落入拒绝域"], answer: "不拒绝 H₀，样本不支持 μ≠5 的结论（p≈0.68）。关键用 t 分布是因为 σ 未知，用 S 估计。" },
    ],
  },
  "矩估计法": {
    intro: "矩估计法用样本矩替代总体矩（令 Aₖ=μₖ），从而建立估计方程求解参数，是最古老、最直观的参数估计方法。",
    formulas: [
      { label: "总体 k 阶矩", tex: "\\mu_k = E[X^k] = g_k(\\theta)" },
      { label: "矩估计方程", tex: "A_k = \\frac{1}{n}\\sum_{i=1}^n X_i^k = \\mu_k(\\theta)" },
      { label: "常用：均值-方差估计", tex: "\\hat{\\mu}=\\bar{X},\\quad \\hat{\\sigma}^2=B_2=\\frac{1}{n}\\sum(X_i-\\bar{X})^2" },
    ],
    steps: ["写出总体 k 阶矩 μₖ=g(θ)（用参数表示）", "令样本 k 阶矩 Aₖ=μₖ，建立方程组", "解方程组求出参数的矩估计量"],
    note: "矩估计简单直观，但通常不及 MLE 有效（方差较大）。当分布族简单（如均匀、指数），矩估计与 MLE 一致。",
    examples: [
      { problem: "X~U(a,b)（均匀分布），已知 E[X]=(a+b)/2，E[X²]=(a²+ab+b²)/3，由样本 X̄=3，A₂=11 求 a,b 的矩估计。", steps: ["方程①：(a+b)/2=X̄=3 → a+b=6", "方程②：(a²+ab+b²)/3=A₂=11 → a²+ab+b²=33", "由①：b=6−a；代入②：a²+a(6−a)+(6−a)²=33", "a²+6a−a²+36−12a+a²=a²−6a+36=33 → a²−6a+3=0", "a=(6±√(36−12))/2=(6±√24)/2=3±√6"], answer: "â=3−√6≈0.55，b̂=3+√6≈5.45。矩估计只需样本矩，计算简单但可能不如 MLE 精确。" },
    ],
  },
  "估计量优良性（无偏/有效/相合）": {
    intro: "评价估计量优劣的三大标准：无偏性（平均不偏）、有效性（方差最小）、相合性（样本量大时趋于真值）。",
    formulas: [
      { label: "无偏性", tex: "E[\\hat{\\theta}] = \\theta\\quad (\\text{对所有 }\\theta)" },
      { label: "均方误差分解", tex: "\\text{MSE}(\\hat\\theta) = \\mathrm{Var}(\\hat\\theta) + [\\text{Bias}(\\hat\\theta)]^2" },
      { label: "Cramér-Rao 下界（CRLB）", tex: "\\mathrm{Var}(\\hat\\theta) \\geq \\frac{1}{nI(\\theta)}" },
    ],
    steps: ["无偏：验证 E[θ̂]=θ（或计算偏差 Bias=E[θ̂]−θ）", "有效：比较方差大小；最优无偏估计量（UMVUE）达到 CRLB", "相合：θ̂ 依概率收敛到 θ（n→∞ 时 MSE→0）"],
    note: "MLE 在正则条件下渐近有效（方差趋近 CRLB）；X̄ 是均值的 UMVUE；S²（除以 n−1）是方差的无偏估计。",
    examples: [
      { problem: "比较 S₁²=Σ(Xᵢ−X̄)²/n 和 S²=Σ(Xᵢ−X̄)²/(n−1)，哪个是 σ² 的无偏估计？", steps: ["计算 E[Σ(Xᵢ−X̄)²]=E[(n−1)S²]", "可以证明：Σ(Xᵢ−X̄)²=(n−1)S²（用代数展开）", "E[S₁²]=E[Σ(Xᵢ−X̄)²/n]=(n−1)σ²/n≠σ²（有偏，低估了方差）", "E[S²]=E[Σ(Xᵢ−X̄)²/(n−1)]=(n−1)σ²/(n−1)=σ²（无偏）"], answer: "S²（除以 n−1）是 σ² 的无偏估计；S₁²（除以 n）有偏，低估 σ²。当 n 大时差异小，但统计中规范用 S²。" },
    ],
  },
  "检验框架（H₀/H₁/α/β）": {
    intro: "假设检验框架的核心：设定原假设 H₀ 和备择假设 H₁，控制第一类错误率 α（显著性水平），在此约束下最小化第二类错误率 β。",
    formulas: [
      { label: "第一类错误（弃真）", tex: "\\alpha = P(\\text{拒绝}H_0 \\mid H_0\\text{为真})" },
      { label: "第二类错误（存伪）", tex: "\\beta = P(\\text{不拒绝}H_0 \\mid H_1\\text{为真})" },
      { label: "检验功效（Power）", tex: "1-\\beta = P(\\text{拒绝}H_0 \\mid H_1\\text{为真})" },
    ],
    steps: ["建立 H₀（原假设，一般包含等号）和 H₁（备择假设）", "选显著性水平 α（常用 0.05 或 0.01）", "计算检验统计量及其在 H₀ 下的分布", "确定拒绝域（或计算 p 值），下结论"],
    note: "α 和 β 此消彼长（α↑则 β↓）；增大样本量 n 可同时降低 α 和 β；奈曼-皮尔逊引理给出最优拒绝域。",
    examples: [
      { problem: "某药厂声称药效 μ₀=100mg，实际 μ=105mg，σ=10mg，n=25，α=0.05，单侧检验 H₀:μ=100 vs H₁:μ>100，求 β。", steps: ["拒绝域：Z=(X̄−100)/(10/5)>z₀.₀₅=1.645，即 X̄>100+1.645×2=103.29", "β=P(不拒绝 H₀|μ=105)=P(X̄≤103.29|μ=105)", "Z=(103.29−105)/2=−0.855，β=Φ(−0.855)≈0.196"], answer: "β≈19.6%，检验功效=80.4%。增大 n 可降低 β：n=100 时功效提升到约 98%。" },
    ],
  },
  "t 检验": {
    intro: "t 检验是检验正态总体均值最常用的方法（σ 未知时），分单样本、双样本独立和配对 t 检验三种类型。",
    formulas: [
      { label: "单样本 t 统计量", tex: "T = \\frac{\\bar{X}-\\mu_0}{S/\\sqrt{n}} \\sim t(n-1)\\text{ under }H_0" },
      { label: "双样本独立 t（等方差）", tex: "T = \\frac{\\bar{X}_1-\\bar{X}_2}{S_p\\sqrt{1/n_1+1/n_2}},\\;S_p^2=\\frac{(n_1-1)S_1^2+(n_2-1)S_2^2}{n_1+n_2-2}" },
    ],
    steps: ["确认总体近似正态，σ 未知", "计算 t 统计量", "查 t(n−1) 分布表得临界值 tα(n−1) 或计算 p 值", "双侧：|t|>tα/2 则拒绝；单侧：t>tα（或 t<−tα）则拒绝"],
    note: "若样本量 n≥30，t 检验与 z 检验结果接近；t 检验对正态假设有一定稳健性（分布轻微偏态仍可用）。",
    examples: [
      { problem: "某班级 9 名学生数学成绩：78,82,85,79,90,88,76,84,83。检验该班均值是否显著不同于全国平均 80 分（α=0.05，双侧）。", steps: ["X̄=(78+82+85+79+90+88+76+84+83)/9=745/9≈82.78", "S²=Σ(Xᵢ−82.78)²/8≈22.94，S≈4.79", "t=(82.78−80)/(4.79/√9)=2.78/1.597≈1.74", "t₀.₀₂₅(8)=2.306（查表），|t|=1.74<2.306，不落入拒绝域"], answer: "不拒绝 H₀（p≈0.12>0.05），该班均值与全国均值无统计显著差异。注意「不显著」≠「相等」。" },
    ],
  },
  "χ² 拟合优度检验": {
    intro: "χ² 拟合优度检验检验样本是否来自某特定分布，通过比较观测频数与理论频数的差异，统计量近似服从 χ² 分布。",
    formulas: [
      { label: "χ² 统计量", tex: "\\chi^2 = \\sum_{i=1}^k \\frac{(O_i - E_i)^2}{E_i} \\approx \\chi^2(k-1-p)" },
      { label: "自由度", tex: "df = k - 1 - p\\text{（k 个类别，p 个估计参数）}" },
    ],
    steps: ["将数据分为 k 个类别，计算观测频数 Oᵢ", "由假设分布计算理论频数 Eᵢ=nPᵢ", "计算 χ²=Σ(Oᵢ−Eᵢ)²/Eᵢ", "查 χ²(k−1−p) 表，若超过临界值则拒绝 H₀"],
    note: "要求每个类别理论频数 Eᵢ≥5，必要时合并类别；检验的是分布族，不是具体参数值。",
    examples: [
      { problem: "掷骰子 120 次，各点出现频数：22,18,25,20,21,14。检验骰子是否均匀（α=0.05）。", steps: ["H₀：各面概率均为 1/6；理论频数 Eᵢ=120/6=20", "χ²=(22−20)²/20+(18−20)²/20+(25−20)²/20+(20−20)²/20+(21−20)²/20+(14−20)²/20", "=4/20+4/20+25/20+0+1/20+36/20=70/20=3.5", "df=6−1=5，χ²₀.₀₅(5)=11.07，3.5<11.07，不拒绝 H₀"], answer: "p≈0.62，不拒绝 H₀，没有足够证据认为骰子不均匀。" },
    ],
  },
  "p 值与检验功效": {
    intro: "p 值是在 H₀ 为真时观测到至少如此极端结果的概率——它衡量数据与 H₀ 的相容程度；检验功效 1−β 衡量检验发现真实效应的能力。",
    formulas: [
      { label: "p 值（双侧 t 检验）", tex: "p = 2\\,P(t(n-1) \\geq |t_{\\text{obs}}|)" },
      { label: "拒绝准则", tex: "p < \\alpha \\Rightarrow \\text{拒绝} H_0" },
      { label: "功效（Power）", tex: "1-\\beta = P(|T|>t_{\\alpha/2} \\mid H_1\\text{为真})" },
    ],
    steps: ["计算检验统计量 t_obs", "p 值 = P(T≥|t_obs| 或 T≤−|t_obs| | H₀)", "p<α 拒绝 H₀；p≥α 不拒绝（不等于接受）", "用功效分析决定样本量"],
    note: "p 值不是 H₀ 为真的概率，而是在 H₀ 下数据如此极端的概率；小 p 值是拒绝 H₀ 的证据，但不表示效应量大。",
    examples: [
      { problem: "单样本 t 检验，n=25，t_obs=2.5（双侧），求 p 值并判断 α=0.05 下的结论。", steps: ["自由度 df=24，查 t 分布表：t₀.₀₂₅(24)=2.064，t₀.₀₁(24)=2.492", "2.492<2.5，故 p/2<0.01，即 p<0.02", "精确查表或软件：p≈0.0196<0.05"], answer: "p≈0.020<0.05，在 α=0.05 显著性水平下拒绝 H₀。但注意：样本量 n=25 时，p 值受样本量影响，实际效应大小（effect size）也需报告。" },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════
  // ODE 补充内容
  // ═══════════════════════════════════════════════════════════════════
  "线性方程与积分因子": {
    intro: "一阶线性 ODE y'+P(x)y=Q(x) 有公式解：先求积分因子 μ(x)=e^∫P(x)dx，再对 μy 求导后积分。",
    formulas: [
      { label: "积分因子", tex: "\\mu(x) = e^{\\int P(x)\\,dx}" },
      { label: "通解公式", tex: "y = \\frac{1}{\\mu(x)}\\left[\\int \\mu(x)Q(x)\\,dx + C\\right]" },
    ],
    steps: ["整理为标准形式 y'+P(x)y=Q(x)", "计算积分因子 μ(x)=e^∫P(x)dx", "方程变为 (μy)'=μQ(x)", "两边积分：μy=∫μQ dx+C，解出 y"],
    note: "积分因子将左端变为 (μy)' 的完全导数，是一阶线性方程的通用解法，不要求 P,Q 连续性以外的特殊结构。",
    examples: [
      { problem: "解 IVP：y'+(1/x)y=x，y(1)=2（x>0）。", steps: ["P(x)=1/x，μ=e^∫(1/x)dx=e^ln(x)=x", "方程变为 (xy)'=x·x=x²", "积分：xy=x³/3+C", "y=x²/3+C/x，代入 y(1)=2：1/3+C=2，C=5/3"], answer: "y=x²/3+5/(3x)。验证：y'=2x/3−5/(3x²)，y'+y/x=2x/3−5/(3x²)+x/3+5/(3x²)=x ✓" },
    ],
  },
  "待定系数法": {
    intro: "待定系数法（Undetermined Coefficients）是求非齐次线性 ODE 特解的算法：根据右端函数 g(x) 的形式猜测特解形式，再代入方程确定系数。",
    formulas: [
      { label: "通解结构", tex: "y = y_h + y_p \\quad (\\text{齐次通解} + \\text{特解})" },
      { label: "g(x)=eᵅˣ时", tex: "y_p = Ae^{\\alpha x}\\text{（若 α 不是特征根）}" },
      { label: "g(x)=sin/cos 时", tex: "y_p = A\\cos\\beta x + B\\sin\\beta x" },
    ],
    steps: ["求对应齐次方程的通解 y_h", "根据 g(x) 类型猜测 y_p 的形式", "若猜测形式与 y_h 重叠，乘以 x（或 x²）修正", "代入 ODE 解出待定系数"],
    note: "修正规则：若 g(x) 含 eʳˣ 而 r 是特征根（k 重），则 y_p 乘以 xᵏ（避免被 y_h 吸收）。",
    examples: [
      { problem: "求 y''−3y'+2y=4eˣ 的通解（注意 r=1 是特征根）。", steps: ["齐次特征方程：r²−3r+2=0→(r−1)(r−2)=0，r₁=1，r₂=2", "y_h=C₁eˣ+C₂e²ˣ", "g(x)=4eˣ，r=1 是单特征根，修正：y_p=Axeˣ", "代入：y_p'=Aeˣ+Axeˣ，y_p''=2Aeˣ+Axeˣ", "代入 ODE：2Aeˣ+Axeˣ−3Aeˣ−3Axeˣ+2Axeˣ=(2−3)Aeˣ+(1−3+2)Axeˣ=−Aeˣ=4eˣ→A=−4"], answer: "y=C₁eˣ+C₂e²ˣ−4xeˣ。注意因为 eˣ 是齐次解，需要用 xeˣ 作特解形式。" },
    ],
  },
  "叠加原理与 Wronskian": {
    intro: "叠加原理：线性 ODE 的解的线性组合仍是解；Wronskian 行列式判断解组的线性无关性，从而判断是否构成基本解组。",
    formulas: [
      { label: "Wronskian（2 个解）", tex: "W(y_1,y_2)(x) = \\begin{vmatrix}y_1 & y_2 \\\\ y_1' & y_2'\\end{vmatrix} = y_1y_2'-y_2y_1'" },
      { label: "基本解组条件", tex: "W(x) \\neq 0 \\text{ 在 }I\\text{ 上} \\iff y_1,y_2\\text{ 线性无关}" },
      { label: "Abel 公式", tex: "W(x) = W(x_0)\\,e^{-\\int_{x_0}^x P(t)\\,dt}" },
    ],
    steps: ["找两个独立解 y₁,y₂", "计算 W(y₁,y₂)=y₁y₂'−y₂y₁'", "W≠0 → 是基本解组 → 通解 y=C₁y₁+C₂y₂"],
    note: "Abel 公式说明 Wronskian 在整个区间要么恒为零（线性相关），要么恒不为零（线性无关），只需验证一个点。",
    examples: [
      { problem: "验证 y₁=eˣ，y₂=e²ˣ 是 y''−3y'+2y=0 的基本解组。", steps: ["验证 y₁ 是解：eˣ−3eˣ+2eˣ=0 ✓；验证 y₂：4e²ˣ−6e²ˣ+2e²ˣ=0 ✓", "计算 W：W=eˣ·2e²ˣ−e²ˣ·eˣ=2e³ˣ−e³ˣ=e³ˣ", "W=e³ˣ>0 对所有 x，故线性无关，构成基本解组"], answer: "W=e³ˣ≠0，y₁,y₂ 是基本解组，通解为 y=C₁eˣ+C₂e²ˣ（与特征方程法一致）。" },
    ],
  },
  "常数变易法": {
    intro: "常数变易法（Variation of Parameters）：将齐次通解 y_h=C₁y₁+C₂y₂ 中的常数「变为函数」u₁(x),u₂(x)，代入非齐次 ODE 求特解，适用范围比待定系数法更广。",
    formulas: [
      { label: "特解公式", tex: "y_p = -y_1\\int\\frac{y_2 g}{W}\\,dx + y_2\\int\\frac{y_1 g}{W}\\,dx" },
      { label: "系数方程组", tex: "\\begin{cases}u_1'y_1+u_2'y_2=0\\\\u_1'y_1'+u_2'y_2'=g(x)\\end{cases}" },
    ],
    steps: ["求齐次通解的基本解组 {y₁,y₂}，计算 Wronskian W", "解方程组求 u₁'(x),u₂'(x)", "积分得 u₁(x),u₂(x)", "特解 y_p=u₁y₁+u₂y₂"],
    note: "常数变易法对任何连续的 g(x) 都有效；待定系数法只适用于特定形式（多项式、指数、三角函数及其乘积）。",
    examples: [
      { problem: "用常数变易法求 y''−y=eˣ/x 的特解（x>0）。", steps: ["齐次解：r²=1→r=±1，y₁=eˣ，y₂=e⁻ˣ，W=e⁻ˣ(−eˣ)−eˣ(e⁻ˣ)=−1−1=−2（负号）…wait let me redo：W=y₁y₂'−y₂y₁'=eˣ(−e⁻ˣ)−e⁻ˣ(eˣ)=−1−1=−2", "u₁'=−y₂g/W=(e⁻ˣ·eˣ/x)/(−2)... 化简：u₁'=−(1/x)/(−2)=1/(2x)，u₁=ln(x)/2", "u₂'=y₁g/W=(eˣ·eˣ/x)/(−2)=−e²ˣ/(2x)（此积分无初等形式，保留积分形式）"], answer: "y_p=(ln x/2)eˣ+u₂e⁻ˣ。常数变易法通用性强，但 u₂ 的积分不一定是初等函数，这正体现了它的局限。" },
    ],
  },
  "逆变换与部分分式": {
    intro: "Laplace 逆变换将 s 域函数 F(s) 还原为时域 f(t)，核心技巧是将 F(s) 分解为标准分式的线性组合，再逐项查表。",
    formulas: [
      { label: "常用逆变换（查表）", tex: "\\mathcal{L}^{-1}\\!\\left\\{\\frac{1}{s-a}\\right\\}=e^{at},\\; \\mathcal{L}^{-1}\\!\\left\\{\\frac{\\omega}{s^2+\\omega^2}\\right\\}=\\sin\\omega t" },
      { label: "部分分式（不同实根）", tex: "\\frac{N(s)}{(s-a)(s-b)} = \\frac{A}{s-a}+\\frac{B}{s-b}" },
      { label: "留数计算系数", tex: "A = \\lim_{s\\to a}(s-a)F(s),\\quad B = \\lim_{s\\to b}(s-b)F(s)" },
    ],
    steps: ["对 F(s) 做部分分式分解（分母因式分解）", "用「盖住法」或留数公式求各系数", "对每项查 Laplace 变换表得 f(t)"],
    note: "复数根对应正弦/余弦；重根对应 tⁿeᵃᵗ；分子次数≥分母时先做多项式除法。",
    examples: [
      { problem: "求 F(s)=(2s+3)/[(s+1)(s+3)] 的逆变换 f(t)。", steps: ["部分分式：(2s+3)/[(s+1)(s+3)]=A/(s+1)+B/(s+3)", "A=(2×(−1)+3)/((−1+3))=(−2+3)/2=1/2", "B=(2×(−3)+3)/((−3+1))=(−6+3)/(−2)=3/2", "F(s)=(1/2)·1/(s+1)+(3/2)·1/(s+3)"], answer: "f(t)=(1/2)e⁻ᵗ+(3/2)e⁻³ᵗ，t≥0。验证：f(0)=1/2+3/2=2，用初值定理：sF(s)|_{s→∞}=2s²/s²=2 ✓" },
    ],
  },
  "用 Laplace 变换求解 IVP": {
    intro: "Laplace 变换将 IVP（初值问题）中的微分运算转化为代数运算，自动纳入初始条件，通过求逆变换得到时域解。",
    formulas: [
      { label: "导数变换（含初值）", tex: "\\mathcal{L}\\{y''\\} = s^2Y(s)-sy(0)-y'(0)" },
      { label: "求解流程", tex: "\\text{ODE（含初值）}\\xrightarrow{\\mathcal{L}}Y(s)\\xrightarrow{\\mathcal{L}^{-1}}y(t)" },
    ],
    steps: ["对 ODE 两边取 Laplace 变换，利用导数法则并代入初始条件", "整理为 Y(s) 的代数方程，解出 Y(s)", "对 Y(s) 做部分分式分解", "逐项取逆变换得 y(t)"],
    note: "Laplace 法特别适合阶跃函数（u(t−a)）和脉冲函数（δ(t)）作为驱动项的情形，这在电路和控制系统中极为常见。",
    viz: "Laplace 变换",
    examples: [
      { problem: "用 Laplace 变换解 IVP：y''−y'−2y=0，y(0)=1，y'(0)=0。", steps: ["取 Laplace 变换：s²Y−s·1−0−(sY−1)−2Y=0", "化简：(s²−s−2)Y=s−1，Y=(s−1)/[(s−1)(s+2)·/(s²−s−2的因式)... 因式分解：s²−s−2=(s−2)(s+1)", "Y=(s−1)/[(s−2)(s+1)]，部分分式：A/(s−2)+B/(s+1)", "A=(2−1)/(2+1)=1/3，B=(−1−1)/(−1−2)=−2/(−3)=2/3", "y(t)=(1/3)e²ᵗ+(2/3)e⁻ᵗ"], answer: "y(t)=(1/3)e²ᵗ+(2/3)e⁻ᵗ。验证：y(0)=1/3+2/3=1 ✓，y'(0)=(2/3)e²ᵗ−(2/3)e⁻ᵗ|_{t=0}=0 ✓" },
    ],
  },
  "浮点数系统": {
    intro: "计算机用有限位二进制表示实数，浮点数系统由基数β、尾数位数t、指数范围决定，不能精确表示大多数实数。IEEE 754 双精度有效位约15-16 位十进制。",
    formulas: [
      { label: "IEEE 754 双精度", tex: "x = \pm m \times 2^e,\quad m\in[1,2),\; e\in[-1022,1023]" },
      { label: "机器精度", tex: "\varepsilon_{\text{mach}} = 2^{-52} \approx 2.22\times 10^{-16}" },
      { label: "相对舎入误差", tex: "\left|\frac{fl(x)-x}{x}\right| \leq \frac{1}{2}\varepsilon_{\text{mach}}" },
    ],
    steps: ["判断数是否溢出或下溢", "标准化为 ±m×2^e，m∈[1,2)", "截断/舎入到 52 位尾数（双精度）", "计算相对误差：|fl(x)-x|/|x|"],
    note: "浮点数不满足结合律：(a+b)+c 可能 ≠ a+(b+c)。大数加小数会吃掉小数（信息丢失），应从小到大累加。",
    examples: [
      { problem: "用 4 位十进制浮点数（β=10, t=4）表示 1/3，计算舎入误差。", steps: ["1/3 = 0.33333…，标准化为 0.3333×10⁰（截断4位）", "fl(1/3) = 0.3333", "绝对误差：|0.3333 - 0.33333…| ≈ 3.3×10⁻⁵", "相对误差：3.3×10⁻⁵ / 0.3333 ≈ 9.9×10⁻⁵"], answer: "fl(1/3)=0.3333，相对误差≈10⁻⁴，符合 4 位有效数字精度（误差界 5×10⁻⁴）" },
    ],
  },
  "割线法": {
    intro: "割线法用前两次迭代点的割线斜率代替 Newton 法的导数，无需计算 f'(x)，收敛阶约为黄金比 φ≈1.618。",
    formulas: [
      { label: "割线法迭代", tex: "x_{n+1} = x_n - f(x_n)\,\frac{x_n - x_{n-1}}{f(x_n)-f(x_{n-1})}" },
      { label: "收敛阶", tex: "\alpha = \frac{1+\sqrt{5}}{2} \approx 1.618" },
    ],
    steps: ["选初始两点 x₀, x₁（不需满足变号）", "计算 f(x₀), f(x₁)", "用割线公式计算 x₂", "重复直到 |xₙ₊₁ - xₙ| < ε"],
    note: "割线法每步只需一次函数求值（Newton 法需要一次函数+一次导数）；比二分法快，比 Newton 法稍慢。",
    examples: [
      { problem: "用割线法求 f(x) = x³ - 2 = 0 的根，x₀=1, x₁=2。", steps: ["f(1) = -1, f(2) = 6", "x₂ = 2 - 6·(2-1)/(6-(-1)) = 2 - 6/7 ≈ 1.1429", "f(1.1429) ≈ 1.494 - 2 = -0.506", "x₃ = 1.1429 - (-0.506)·(1.1429-2)/(-0.506-6) ≈ 1.2809"], answer: "经几次迭代后收敛到 ∛2 ≈ 1.2599，割线法比二分法快，不需要导数" },
    ],
  },
  "Jacobi / Gauss-Seidel 法": {
    intro: "迭代法用于求解大型稀疏线性方程组 Ax=b，Jacobi 法用上次值全部更新，Gauss-Seidel 法立即使用新值，通常收敛快 2 倍。",
    formulas: [
      { label: "Jacobi 迭代", tex: "x_i^{(k+1)} = \frac{1}{a_{ii}}\!\left(b_i - \sum_{j\neq i}a_{ij}x_j^{(k)}\right)" },
      { label: "Gauss-Seidel 迭代", tex: "x_i^{(k+1)} = \frac{1}{a_{ii}}\!\left(b_i - \sum_{j<i}a_{ij}x_j^{(k+1)} - \sum_{j>i}a_{ij}x_j^{(k)}\right)" },
      { label: "收敛充分条件", tex: "\rho(D^{-1}(L+U)) < 1\; \text{或 A 严格对角占优}" },
    ],
    steps: ["分解 A = D + L + U（对角、下三角、上三角）", "初始化 x⁽⁰⁾（通常取零向量）", "Jacobi：用 x⁽ᵏ⁾ 整批更新 x⁽ᵏ⁺¹⁾", "Gauss-Seidel：顺序更新，立即使用新值"],
    note: "严格对角占优（|aᵢᵢ| > Σⱼ≠ᵢ|aᵢⱼ|）保证两法均收敛；Gauss-Seidel 通常比 Jacobi 快约2 倍。",
    examples: [
      { problem: "用 Gauss-Seidel 法求 4x+y=9, x+3y=7，从 x⁽⁰⁾=(0,0) 开始两轮迭代。", steps: ["第1轮：x⁽¹⁾ = (9 - 1×0)/4 = 2.25", "y⁽¹⁾ = (7 - 1×2.25)/3 = 1.583", "第2轮：x⁽²⁾ = (9 - 1×1.583)/4 = 1.854", "y⁽²⁾ = (7 - 1×1.854)/3 = 1.715，继续迭代…"], answer: "真解为 x=20/11≈1.818, y=19/11≈1.727；Gauss-Seidel 通常在几十轮迭代内收敛" },
    ],
  },
  "Newton 插值": {
    intro: "Newton 差商插值多项式利用差商表递推构造，可方便地增加新节点而无需重建全部多项式，与 Lagrange 插值等价但计算更高效。",
    formulas: [
      { label: "一阶差商", tex: "f[x_0,x_1] = \frac{f(x_1)-f(x_0)}{x_1-x_0}" },
      { label: "Newton 差商公式", tex: "P_n(x) = \sum_{k=0}^n f[x_0,\ldots,x_k]\prod_{i=0}^{k-1}(x-x_i)" },
      { label: "误差项", tex: "R_n(x) = f[x_0,\ldots,x_n,x]\prod_{i=0}^n(x-x_i)" },
    ],
    steps: ["建立差商表：f[xᵢ]=f(xᵢ)；f[xᵢ,xⱼ]=(f[xⱼ]-f[xᵢ])/(xⱼ-xᵢ)", "主对角线（首行）元素即为各阶差商系数", "写出 Newton 多项式 P_n(x)", "估算误差 |R_n(x)|"],
    note: "Newton 插值与 Lagrange 插值给出同一多项式；新增节点 xₙ₊₁ 只需计算一列新差商，效率高。",
    examples: [
      { problem: "已知 f(0)=1, f(1)=3, f(2)=7，构造 Newton 差商插值多项式并求 f(1.5)。", steps: ["零阶差商：f[0]=1, f[1]=3, f[2]=7", "一阶差商：f[0,1]=(3-1)/(1-0)=2, f[1,2]=(7-3)/(2-1)=4", "二阶差商：f[0,1,2]=(4-2)/(2-0)=1", "P₂(x) = 1 + 2(x-0) + 1(x-0)(x-1) = x²+x+1"], answer: "P₂(1.5) = 1.5²+1.5+1 = 4.75；f(x)=x²+x+1 完全吴合，插值误差为零" },
    ],
  },
  "数値微分": {
    intro: "数値微分用函数値差商近似导数，中心差分精度最高（O(h²)），但步长 h 太小会引入浮点舎入误差，需权衡取舎。",
    formulas: [
      { label: "前向差分 O(h)", tex: "f'(x) \approx \frac{f(x+h)-f(x)}{h}" },
      { label: "中心差分 O(h²)", tex: "f'(x) \approx \frac{f(x+h)-f(x-h)}{2h}" },
      { label: "二阶导数 O(h²)", tex: "f''(x) \approx \frac{f(x+h)-2f(x)+f(x-h)}{h^2}" },
    ],
    steps: ["选择差分格式（优先中心差分）", "选步长 h（通常 10⁻⁵~10⁻³）", "计算差商得近似导数", "用 Richardson 外推提高精度（可选）"],
    note: "最优步长约 h* ≈ √ε_mach（前向差分）或 ε_mach^(1/3)（中心差分），约10⁻⁸ 量级。",
    examples: [
      { problem: "用中心差分计算 f(x)=sin(x) 在 x=π/4 处的一阶导数，h=0.1。", steps: ["f(π/4+0.1) = sin(0.8854) ≈ 0.7745", "f(π/4-0.1) = sin(0.6854) ≈ 0.6332", "f'(π/4) ≈ (0.7745-0.6332)/(2×0.1) = 0.1413/0.2 ≈ 0.7065", "精确値 cos(π/4) = √2/2 ≈ 0.7071，误差 ≈ 6×10⁻⁴"], answer: "数値导数 ≈ 0.7065，与精确値 0.7071 误差约0.08%，符合 O(h²)=O(0.01) 精度" },
    ],
  },
  "Romberg 法": {
    intro: "Romberg 积分用 Richardson 外推提高梯形法精度，构造三角形外推表，主对角线收敛最快，最终可达任意阶精度。",
    formulas: [
      { label: "梯形法（2ʲ等分）", tex: "T_j = \frac{b-a}{2^j}\!\left[\frac{f(a)+f(b)}{2}+\sum_{k=1}^{2^j-1}f\!\left(a+k\frac{b-a}{2^j}\right)\right]" },
      { label: "Richardson 外推", tex: "R(j,k) = \frac{4^k R(j,k-1)-R(j-1,k-1)}{4^k - 1}" },
    ],
    steps: ["计算 R(0,0)=T₁，R(1,0)=T₂，R(2,0)=T₄ …（步长逐步减半）", "外推：R(j,1)=(4R(j,0)-R(j-1,0))/3 消去 O(h²) 误差", "继续外推：R(j,k) 消去更高阶误差项", "取对角线 R(n,n) 作为最终结果"],
    note: "Romberg 法对光滑函数高效；每次对分步长，复用已有函数値，相当于自适应精度控制。",
    examples: [
      { problem: "用 Romberg 法前两层计算 ∫₀¹ eˣ dx（精确値 e-1≈1.71828）。", steps: ["R(0,0): h=1，T₁=(f(0)+f(1))/2=(1+e)/2≈1.8591", "R(1,0): h=0.5，T₂=(f(0)+2f(0.5)+f(1))/4≈1.7539", "R(1,1): (4×1.7539-1.8591)/3 = (7.0156-1.8591)/3 ≈ 1.71828", "误差从 0.141（R(0,0)）降到 0.0001（R(1,1)）"], answer: "R(1,1)≈1.71828，一次外推后误差从 O(h²)≈0.14 降到 O(h⁴)≈0.0001，精度提升约100倍" },
    ],
  },
  "Bernoulli 方程": {
    intro: "Bernoulli 方程 y' + P(x)y = Q(x)yⁿ 通过换元 v = y^(1-n) 线性化，是可精确求解的非线性 ODE 典型形式之一。",
    formulas: [
      { label: "Bernoulli 方程", tex: "y' + P(x)y = Q(x)y^n,\quad n\neq 0,1" },
      { label: "换元 v = y^(1-n)", tex: "v' + (1-n)P(x)v = (1-n)Q(x)\quad (\text{线性ODE})" },
    ],
    steps: ["识别 n（yⁿ 的指数），确认 n≠0,1", "令 v = y^(1-n)，则 v' = (1-n)y^(-n)y'", "方程两边除以 yⁿ 后化为线性 ODE", "用积分因子法求 v(x)，还原 y = v^(1/(1-n))"],
    note: "n=0 退化为线性 ODE；n=1 为分离变量方程；n=2 特别常见（Logistic 增长模型的变形）。",
    examples: [
      { problem: "求解 y' - y = xy³（n=3）。", steps: ["令 v = y^(1-3) = y⁻²，则 v' = -2y⁻³y'", "方程两边乘 (-2)y⁻³：v' + 2v = -2x", "积分因子 μ = e^(2x)：(ve^(2x))' = -2xe^(2x)", "积分得 ve^(2x) = -xe^(2x) + e^(2x)/2 + C，即 v = -x + 1/2 + Ce^(-2x)"], answer: "y = v^(-1/2) = [1/2 - x + Ce^(-2x)]^(-1/2)；验证：当 y(0)=1 时，C=1/2" },
    ],
  },
  "线性规划概述": {
    intro: "线性规划（LP）在线性约束下最优化线性目标函数，是运筹学核心工具，广泛用于资源分配、运输问题、生产计划等。",
    formulas: [
      { label: "标准形", tex: "\min c^\top x \;\text{s.t.}\; Ax = b,\; x \geq 0" },
      { label: "最优解位于顶点", tex: "\text{若有界，最优解在可行域顶点（基可行解）处取得}" },
      { label: "强对偶定理", tex: "\min c^\top x = \max b^\top y \;\text{（对偶问题最优値相等）}" },
    ],
    steps: ["定义决策变量 x₁, x₂, …", "建立目标函数（最大化或最小化）", "写出约束条件（≤, ≥, = 形式）", "引入松弛变量化为标准形，用单纯形法求解"],
    note: "LP 可在多项式时间内求解（内点法）；最优解若存在必在顶点处。整数规划（ILP）是 NP-hard。",
    examples: [
      { problem: "最大化 z = 5x₁ + 4x₂，约束 6x₁+4x₂≤24，x₁+2x₂≤6，x₁,x₂≥0。", steps: ["可行域顶点：(0,0),(4,0),(3,1.5),(0,3)", "各顶点目标値：z(4,0)=20, z(3,1.5)=21, z(0,3)=12, z(0,0)=0", "最大値在 (3,1.5) 处：z=5×3+4×1.5=21"], answer: "最优解 x₁=3, x₂=1.5，最大利润 z=21；几何上最优解总在可行域顶点" },
    ],
  },
  "相平面分析": {
    intro: "相平面法通过平衡点稳定性分析研究非线性ODE系统的定性行为，无需求解析解，用 Jacobian 特征値判断平衡点类型。",
    formulas: [
      { label: "自治系统", tex: "\dot{x}=f(x,y),\;\dot{y}=g(x,y)" },
      { label: "平衡点", tex: "f(x^*,y^*)=0,\;g(x^*,y^*)=0" },
      { label: "线性化 Jacobian", tex: "J = \begin{pmatrix}f_x & f_y\\ g_x & g_y\end{pmatrix}_{(x^*,y^*)}" },
    ],
    steps: ["令 ẋ=0, ẏ=0 求平衡点 (x*,y*)", "计算平衡点处的 Jacobian 矩阵 J", "求 J 的特征値 λ₁, λ₂", "按特征値分类：均负→稳定结点，异号→马鞍点，纯虚→中心，复数→焦点"],
    note: "特征値均负→稳定；均正→不稳定；异号→马鞍点（不稳定）；实部负复数→稳定焦点（贚旋收敛）。",
    examples: [
      { problem: "分析 ẋ=y, ẏ=-x-y（鸿尼振荡）在 (0,0) 的稳定性。", steps: ["平衡点：y=0, -x-y=0 → (0,0)", "Jacobian J = [[0,1],[-1,-1]]", "特征方程：λ²+λ+1=0，λ = (-1±i√3)/2", "实部 = -1/2 < 0 → 稳定焦点（贚旋收敛）"], answer: "原点是稳定焦点；解为 x(t)=e^(-t/2)[A cos(√3t/2)+B sin(√3t/2)]，随时间贚旋衰减" },
    ],
  },

};

// ── Topic Modal ───────────────────────────────────────────────────────────────
function TopicModal({ topic, onClose, setPage, setChapterFilter, chapterNum, course }) {
  const content = KNOWLEDGE_CONTENT[topic];
  const vizKey = content?.viz;
  const chapterStr = (course && course !== "数值分析") ? `${course} ${chapterNum}` : chapterNum;

  const relatedQs = useMemo(() => {
    if (!chapterStr) return [];
    const matched = ALL_QUESTIONS.filter(q => q.chapter && q.chapter === chapterStr);
    if (matched.length > 0) return matched.slice(0, 3);
    return ALL_QUESTIONS.filter(q => q.chapter && chapterNum && q.chapter.includes(chapterNum)).slice(0, 3);
  }, [chapterStr, chapterNum]);

  const courseColor = {
    "数值分析": G.teal, "最优化": G.purple, "线性代数": G.blue,
    "概率论": G.amber, "数理统计": G.red, "ODE": "#8B5CF6",
  }[course] || G.teal;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,20,40,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 300, padding: "1rem" }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 20, maxWidth: 740, width: "100%", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 32px 80px rgba(0,0,0,0.3)" }}>

        {/* ══ Header ══ */}
        <div style={{ position: "sticky", top: 0, zIndex: 20, background: "#fff", borderBottom: "1px solid #f0f0f0" }}>
          <div style={{ height: 4, background: courseColor, borderRadius: "20px 20px 0 0" }} />
          <div style={{ padding: "1.2rem 1.6rem", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: courseColor, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 5 }}>{course} · {chapterNum}</div>
              <div style={{ fontSize: 21, fontWeight: 800, color: "#0f172a", lineHeight: 1.3 }}>{topic}</div>
            </div>
            <button onClick={onClose} style={{ flexShrink: 0, width: 32, height: 32, borderRadius: "50%", border: "none", background: "#f3f4f6", cursor: "pointer", fontSize: 14, color: "#6b7280", display: "flex", alignItems: "center", justifyContent: "center", marginTop: 2 }}>✕</button>
          </div>
        </div>

        {/* ══ Body ══ */}
        <div style={{ padding: "1.6rem" }}>
          {!content ? (
            <div style={{ padding: "3rem 2rem", textAlign: "center" }}>
              <div style={{ fontSize: 40, marginBottom: 14 }}>📝</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: "#374151", marginBottom: 8 }}>内容正在完善中</div>
              <div style={{ fontSize: 14, color: "#9ca3af" }}>该知识点的详细讲解内容即将上线</div>
              {relatedQs.length > 0 && <div style={{ fontSize: 13, color: G.blue, marginTop: 16 }}>可以先做下方相关题目练习 ↓</div>}
            </div>
          ) : (
            <>
              {/* §1 核心概念 */}
              <section style={{ marginBottom: 28 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <div style={{ width: 28, height: 28, borderRadius: 8, background: courseColor, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>📖</div>
                  <span style={{ fontSize: 15, fontWeight: 700, color: "#0f172a" }}>核心概念</span>
                </div>
                <div style={{ fontSize: 15, color: "#374151", lineHeight: 1.9, padding: "16px 20px", background: "#f8fafc", borderRadius: 12, borderLeft: `4px solid ${courseColor}` }}>
                  {content.intro}
                </div>
              </section>

              {/* §2 关键公式 */}
              <section style={{ marginBottom: 28 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <div style={{ width: 28, height: 28, borderRadius: 8, background: G.purple, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>📐</div>
                  <span style={{ fontSize: 15, fontWeight: 700, color: "#0f172a" }}>关键公式</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {content.formulas.map((f, i) => (
                    <div key={i} style={{ padding: "14px 20px", background: "#faf5ff", borderRadius: 12, border: "1px solid #e9d5ff" }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: G.purple, letterSpacing: "0.08em", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ background: G.purple, color: "#fff", width: 18, height: 18, borderRadius: 4, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10 }}>{i+1}</span>
                        {f.label.toUpperCase()}
                      </div>
                      <M tex={f.tex} block />
                    </div>
                  ))}
                </div>
              </section>

              {/* §3 解题步骤 */}
              {content.steps && (
                <section style={{ marginBottom: 28 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                    <div style={{ width: 28, height: 28, borderRadius: 8, background: G.blue, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>🔢</div>
                    <span style={{ fontSize: 15, fontWeight: 700, color: "#0f172a" }}>解题步骤</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {content.steps.map((s, i) => (
                      <div key={i} style={{ display: "flex", gap: 14, alignItems: "flex-start", padding: "10px 16px", background: "#f0f9ff", borderRadius: 10 }}>
                        <div style={{ width: 24, height: 24, borderRadius: "50%", background: G.blue, color: "#fff", fontSize: 12, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>{i+1}</div>
                        <div style={{ fontSize: 14, color: "#1e3a5f", lineHeight: 1.75, paddingTop: 2 }}>{s}</div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* §4 可视化 */}
              {vizKey && VIZ_MAP[vizKey] && (
                <section style={{ marginBottom: 28 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                    <div style={{ width: 28, height: 28, borderRadius: 8, background: G.amber, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>🎨</div>
                    <span style={{ fontSize: 15, fontWeight: 700, color: "#0f172a" }}>可视化理解</span>
                  </div>
                  <div style={{ background: "#fffbf0", borderRadius: 14, border: "1px solid #fde68a", padding: "1.2rem", overflow: "hidden" }}>
                    {VIZ_MAP[vizKey]}
                  </div>
                </section>
              )}

              {/* §5 重要提示 */}
              {content.note && (
                <div style={{ marginBottom: 28, display: "flex", gap: 12, padding: "14px 18px", background: "#fffbeb", borderRadius: 12, border: "1px solid #fcd34d", alignItems: "flex-start" }}>
                  <span style={{ fontSize: 18, flexShrink: 0, marginTop: 1 }}>⚡</span>
                  <div style={{ fontSize: 14, color: "#78350f", lineHeight: 1.8 }}><strong>重点提示：</strong>{content.note}</div>
                </div>
              )}

              {/* §6 例题讲解 */}
              {content.examples?.length > 0 && (
                <section style={{ marginBottom: 28 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                    <div style={{ width: 28, height: 28, borderRadius: 8, background: "#10b981", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>✏️</div>
                    <span style={{ fontSize: 15, fontWeight: 700, color: "#0f172a" }}>典型例题</span>
                  </div>
                  {content.examples.map((ex, idx) => (
                    <div key={idx} style={{ marginBottom: 20, borderRadius: 16, border: "1px solid #d1fae5", overflow: "hidden", boxShadow: "0 2px 8px rgba(16,185,129,0.08)" }}>
                      {/* Problem */}
                      <div style={{ padding: "16px 20px", background: "linear-gradient(135deg,#ecfdf5,#d1fae5)", borderLeft: "5px solid #10b981" }}>
                        <div style={{ fontSize: 11, fontWeight: 800, color: "#065f46", letterSpacing: "0.12em", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ background: G.teal, color: "#fff", padding: "4px 12px", borderRadius: 20, fontSize: 12 }}>例题 {idx+1}</span>
                        </div>
                        <div style={{ fontSize: 15, color: "#064e3b", lineHeight: 1.8, fontWeight: 500 }}><MathText text={ex.problem} /></div>
                      </div>
                      {/* Solution steps */}
                      <div style={{ padding: "16px 20px", background: "#fff" }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", letterSpacing: "0.08em", marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ width: 4, height: 14, background: G.blue, borderRadius: 2, display: "inline-block" }} />
                          解题过程
                        </div>
                        {ex.steps.map((s, si) => (
                          <div key={si} style={{ display: "flex", gap: 12, marginBottom: 12, alignItems: "flex-start" }}>
                            <div style={{ flexShrink: 0, width: 26, height: 26, borderRadius: "50%", background: G.blue, color: "#fff", fontSize: 12, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", marginTop: 2 }}>{si+1}</div>
                            <div style={{ fontSize: 14.5, color: "#1f2937", lineHeight: 1.95, flex: 1 }}><MathText text={s} /></div>
                          </div>
                        ))}
                      </div>
                      {/* Answer */}
                      <div style={{ padding: "14px 20px", background: "#f0fdf4", borderTop: "1px solid #a7f3d0", display: "flex", gap: 10, alignItems: "flex-start" }}>
                        <span style={{ fontSize: 16, flexShrink: 0 }}>✅</span>
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 800, color: "#065f46", letterSpacing: "0.08em", marginBottom: 4 }}>最终答案</div>
                          <div style={{ fontSize: 14, color: "#064e3b", lineHeight: 1.75 }}><MathText text={ex.answer} /></div>
                        </div>
                      </div>
                    </div>
                  ))}
                </section>
              )}
            </>
          )}

          {/* ══ 相关练习题 ══ */}
          {relatedQs.length > 0 && (
            <section>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                <div style={{ width: 28, height: 28, borderRadius: 8, background: G.blue, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>📝</div>
                <span style={{ fontSize: 15, fontWeight: 700, color: "#0f172a" }}>随堂练习</span>
                <span style={{ fontSize: 12, color: "#9ca3af" }}>· {chapterStr}</span>
              </div>
              {relatedQs.map((q, qi) => {
                const opts = q.options ? (typeof q.options === "string" ? JSON.parse(q.options) : q.options) : null;
                const letters = ["A","B","C","D"];
                return (
                  <div key={q.id} style={{ marginBottom: 14, borderRadius: 14, border: "1px solid #e5e7eb", overflow: "hidden" }}>
                    <div style={{ padding: "14px 18px", background: "#f8fafc" }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: G.blue, marginBottom: 7, display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ background: G.blueLight, color: G.blue, padding: "2px 8px", borderRadius: 20 }}>Q{qi+1}</span>
                        <span style={{ color: "#9ca3af" }}>{q.type}</span>
                      </div>
                      <div style={{ fontSize: 14, color: "#111827", lineHeight: 1.75, fontWeight: 500 }}>{q.question}</div>
                    </div>
                    {opts && (
                      <div style={{ padding: "10px 18px 14px", background: "#fff", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 24px" }}>
                        {opts.map((opt, oi) => {
                          const isCorrect = letters[oi] === q.answer;
                          return (
                            <div key={oi} style={{ fontSize: 13.5, display: "flex", gap: 6, alignItems: "flex-start", color: isCorrect ? G.tealDark : "#4b5563", fontWeight: isCorrect ? 700 : 400, background: isCorrect ? G.tealLight : "transparent", padding: isCorrect ? "4px 8px" : "4px 0", borderRadius: isCorrect ? 8 : 0 }}>
                              <span style={{ flexShrink: 0, fontWeight: 800 }}>{letters[oi]}.</span>
                              <span>{opt}{isCorrect ? " ✓" : ""}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {!opts && (
                      <div style={{ padding: "8px 18px", background: "#fff", fontSize: 13.5 }}>
                        <span style={{ color: "#9ca3af", marginRight: 8 }}>答案：</span><span style={{ color: G.teal, fontWeight: 700 }}>{q.answer}</span>
                      </div>
                    )}
                    {q.explanation && (
                      <div style={{ padding: "10px 18px", background: "#f9fafb", borderTop: "1px solid #f3f4f6", fontSize: 13, color: "#6b7280", lineHeight: 1.7, display: "flex", gap: 8, alignItems: "flex-start" }}>
                        <span style={{ color: G.amber, flexShrink: 0 }}>💡</span>
                        <span>{q.explanation}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </section>
          )}
        </div>

        {/* ══ Footer ══ */}
        <div style={{ padding: "1rem 1.6rem", borderTop: "1px solid #f3f4f6", display: "flex", gap: 10, justifyContent: "space-between", alignItems: "center", background: "#fafafa", borderRadius: "0 0 20px 20px" }}>
          {setPage && setChapterFilter && chapterStr && (
            <button onClick={() => { setChapterFilter(chapterStr); onClose(); setPage("题库练习"); }}
              style={{ padding: "9px 18px", background: G.blueLight, color: G.blue, border: `1.5px solid ${G.blue}44`, borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
              ✏️ 进入题库练习 →
            </button>
          )}
          <button onClick={onClose} style={{ padding: "9px 22px", background: courseColor, color: "#fff", border: "none", borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
            完成学习 ✓
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Expanded Question Bank ────────────────────────────────────────────────────
const ALL_QUESTIONS = [
  { id: "1", chapter: "Ch.1", type: "单选题", question: "二分法每迭代一次，有根区间的长度变为原来的：", options: ["1/3", "1/2", "1/4", "不确定"], answer: "B", explanation: "二分法每次取中点，区间精确缩小为 1/2，线性收敛。" },
  { id: "2", chapter: "Ch.1", type: "单选题", question: "Newton 法的收敛阶为：", options: ["线性 p=1", "超线性", "二阶 p=2", "不收敛"], answer: "C", explanation: "Newton 法在单根附近二阶收敛，每步有效数字大约翻倍。" },
  { id: "3", chapter: "Ch.1", type: "单选题", question: "不动点迭代 x_{n+1}=g(x_n) 收敛的充分条件是：", options: ["|g'(x*)| > 1", "|g'(x*)| = 1", "|g'(x*)| < 1", "g'(x*)=0"], answer: "C", explanation: "压缩映射定理：|g'(x*)| < 1 保证局部收敛。" },
  { id: "4", chapter: "Ch.1", type: "判断题", question: "Newton 法对任意初始值都能收敛到方程的根。", options: null, answer: "错误", explanation: "Newton 法只在根附近才能保证收敛，初始值选取不当可能发散。" },
  { id: "5", chapter: "Ch.1", type: "单选题", question: "割线法（Secant Method）与 Newton 法相比：", options: ["不需要计算导数，但收敛慢", "需要计算导数，收敛更快", "不需要计算导数，收敛阶约 1.618", "完全等价"], answer: "C", explanation: "割线法用差商代替导数，收敛阶为黄金比例 (1+√5)/2 ≈ 1.618，属超线性收敛。" },
  { id: "6", chapter: "Ch.2", type: "单选题", question: "高斯消去法的计算复杂度为：", options: ["O(n)", "O(n²)", "O(n³)", "O(2ⁿ)"], answer: "C", explanation: "消元步骤共约 n³/3 次乘除运算，复杂度 O(n³)。" },
  { id: "7", chapter: "Ch.2", type: "判断题", question: "对任意可逆矩阵 A，不用行交换的 LU 分解一定存在。", options: null, answer: "错误", explanation: "即使 A 可逆，主元也可能为零，此时无行交换的 LU 分解不存在。需要 PA=LU。" },
  { id: "8", chapter: "Ch.2", type: "单选题", question: "矩阵条件数 κ(A) 衡量的是：", options: ["矩阵的行列式大小", "线性系统对扰动的敏感程度", "矩阵是否对称", "迭代法的收敛速度"], answer: "B", explanation: "κ(A)=‖A‖·‖A⁻¹‖，刻画右端项 b 的小扰动对解 x 的放大倍数。" },
  { id: "9", chapter: "Ch.2", type: "单选题", question: "Jacobi 迭代法与 Gauss-Seidel 迭代法的主要区别是：", options: ["Jacobi 更快", "Gauss-Seidel 使用每步最新计算值", "Jacobi 需要更多内存", "两者完全等价"], answer: "B", explanation: "Gauss-Seidel 在一次迭代内就使用最新更新的分量，通常比 Jacobi 收敛快。" },
  { id: "10", chapter: "Ch.3", type: "单选题", question: "n+1 个节点的 Lagrange 插值多项式次数最高为：", options: ["n-1", "n", "n+1", "2n"], answer: "B", explanation: "n+1 个节点确定唯一次数 ≤n 的插值多项式。" },
  { id: "11", chapter: "Ch.3", type: "单选题", question: "Runge 现象指的是：", options: ["节点过少导致误差大", "高次等距插值在端点振荡", "插值多项式不唯一", "Chebyshev 的缺陷"], answer: "B", explanation: "高次等距节点多项式插值在区间端点附近出现剧烈振荡，即 Runge 现象。" },
  { id: "12", chapter: "Ch.3", type: "单选题", question: "Chebyshev 插值节点的优点是：", options: ["计算量最小", "最小化插值误差的最大值（minimax）", "使插值多项式次数最低", "适用于周期函数"], answer: "B", explanation: "Chebyshev 节点使插值误差的最大值达到最小，可避免 Runge 现象。" },
  { id: "13", chapter: "Ch.3", type: "判断题", question: "三次样条插值比高次多项式插值具有更好的数值稳定性。", options: null, answer: "正确", explanation: "三次样条用分段低次多项式，避免高次插值的振荡问题，且保证一阶和二阶导数连续。" },
  { id: "14", chapter: "Ch.4", type: "单选题", question: "线性最小二乘问题的法方程为：", options: ["Ax=b", "AᵀAx=Aᵀb", "AAᵀx=b", "A²x=b²"], answer: "B", explanation: "对 ‖Ax-b‖² 关于 x 求导置零，得法方程 AᵀAx=Aᵀb。" },
  { id: "15", chapter: "Ch.4", type: "判断题", question: "QR 分解比法方程方法数值上更稳定。", options: null, answer: "正确", explanation: "法方程的条件数为 A 的条件数的平方；QR 分解直接作用于 A，稳定性更好。" },
  { id: "16", chapter: "Ch.4", type: "单选题", question: "非线性最小二乘问题与线性最小二乘问题的主要区别是：", options: ["目标函数不同", "非线性问题没有解析解，需要迭代", "非线性问题只有唯一解", "两者求解方法完全相同"], answer: "B", explanation: "非线性最小二乘（如 Gauss-Newton 法）需要迭代求解，可能有多个局部极小。" },
  { id: "17", chapter: "Ch.5", type: "单选题", question: "Simpson 法则的截断误差阶为：", options: ["O(h²)", "O(h³)", "O(h⁴)", "O(h⁵)"], answer: "C", explanation: "Simpson 法截断误差 O(h⁴)，比梯形法（O(h²)）高两阶。" },
  { id: "18", chapter: "Ch.5", type: "单选题", question: "Romberg 积分的核心思想是：", options: ["高斯积分节点选取", "用梯形法结果进行Richardson外推", "Gauss-Legendre 节点", "Monte Carlo 估计"], answer: "B", explanation: "Romberg 对不同步长的梯形法结果进行 Richardson 外推，大幅提高精度。" },
  { id: "19", chapter: "Ch.5", type: "判断题", question: "高斯积分（Gaussian Quadrature）对次数 ≤ 2n-1 的多项式精确。", options: null, answer: "正确", explanation: "n 点 Gauss 积分（Gauss-Legendre）对次数 ≤ 2n-1 的多项式给出精确积分。" },
  { id: "20", chapter: "Ch.6", type: "单选题", question: "Euler 法求解 ODE 的局部截断误差为：", options: ["O(h)", "O(h²)", "O(h³)", "O(h⁴)"], answer: "B", explanation: "Euler 法一阶方法，局部截断误差 O(h²)，全局误差 O(h)。" },
  { id: "21", chapter: "Ch.6", type: "单选题", question: "经典四阶 Runge-Kutta 法每步需要计算几次 f 的值：", options: ["1次", "2次", "3次", "4次"], answer: "D", explanation: "RK4 每步计算 k₁,k₂,k₃,k₄ 共 4 次函数求值。" },
  { id: "22", chapter: "Ch.6", type: "单选题", question: "刚性方程（Stiff ODE）的特点是：", options: ["方程右端函数变化极慢", "解中包含变化速率差异极大的分量，显式方法需极小步长", "方程没有解析解", "Euler 法效率最高"], answer: "B", explanation: "刚性方程的特征值实部差异极大，显式方法（如 Euler）需极小步长，隐式方法更合适。" },
  { id: "23", chapter: "最优化 Ch.1", type: "单选题", question: "线性最小二乘模型的特征是：", options: ["目标函数线性", "所有参数线性出现在模型中", "约束条件线性", "残差为零"], answer: "B", explanation: "线性最小二乘指所有待求参数在模型函数中线性出现，即使 t 的函数是非线性的。" },
  { id: "24", chapter: "最优化 Ch.1", type: "单选题", question: "Markowitz 投资组合模型中 σ²_P=xᵀVx 表示：", options: ["期望收益", "投资预算", "投资组合方差（风险）", "证券数量"], answer: "C", explanation: "σ²_P=xᵀVx 是投资组合收益率的方差，V 为协方差矩阵，x 为持仓向量。" },
  { id: "25", chapter: "最优化 Ch.1", type: "单选题", question: "SVM 最大间隔分类问题的目标函数是：", options: ["min ‖w‖", "min ‖w‖²", "max ‖w‖", "max 2/‖w‖"], answer: "B", explanation: "最大化间隔 2/‖w‖ 等价于最小化 ‖w‖²，后者为凸二次规划。" },
  { id: "26", chapter: "最优化 Ch.1", type: "判断题", question: "非线性规划问题一定有全局最优解。", options: null, answer: "错误", explanation: "非线性规划可能有多个局部极小（甚至无界），全局最优解不一定存在或可达。" },
  { id: "27", chapter: "最优化 Ch.1", type: "单选题", question: "Markowitz 投资组合中，将 α 设为 0 时，意味着：", options: ["完全规避风险", "完全忽略风险，只最大化收益", "等权重配置", "只投单一证券"], answer: "B", explanation: "目标 max μᵀx - αxᵀVx 中 α=0 时风险项消失，只追求最大期望收益。" },
  { id: "28", chapter: "Ch.2", type: "单选题", question: "求解线性方程组时，使用部分主元法（Partial Pivoting）的目的是：", options: ["减少计算量", "避免除以很小的主元导致数值不稳定", "使方程组有唯一解", "减少内存占用"], answer: "B", explanation: "部分主元法在每列中选绝对值最大的元素为主元，防止小主元引起的数值放大误差。" },
  { id: "29", chapter: "Ch.5", type: "单选题", question: "复合梯形法（Composite Trapezoid）在 n 个子区间上的截断误差阶为：", options: ["O(h)", "O(h²)", "O(h³)", "O(h⁴)"], answer: "B", explanation: "复合梯形法每个子区间误差 O(h³)，共 n 段后全局误差 O(h²)，其中 h=(b-a)/n。" },
  { id: "30", chapter: "Ch.6", type: "判断题", question: "Runge-Kutta 4 阶方法每步的全局误差为 O(h⁴)。", options: null, answer: "正确", explanation: "RK4 是四阶方法：局部截断误差 O(h⁵)，全局误差 O(h⁴)。" },

  // ── 线性代数 (Leon 9th) ──────────────────────────────────────────
  { id: "LA1", chapter: "线性代数 Ch.1", course: "线性代数", type: "单选题", question: "若矩阵 A 的秩为 r，则 n 元齐次方程组 Ax=0 的解空间维数为：", options: ["r", "n-r", "m-r（m为行数）", "n"], answer: "B", explanation: "由秩-零化度定理，nullity(A)=n-rank(A)=n-r，即自由变量数为 n-r。" },
  { id: "LA2", chapter: "线性代数 Ch.1", course: "线性代数", type: "判断题", question: "若线性方程组 Ax=b 有两个不同的解，则它一定有无穷多个解。", options: null, answer: "正确", explanation: "两个解之差是 Ax=0 的非零解，零空间非平凡，从而 Ax=b 有无穷多解（特解+任意零空间向量）。" },
  { id: "LA3", chapter: "线性代数 Ch.2", course: "线性代数", type: "单选题", question: "n 阶矩阵 A 可逆的充要条件是：", options: ["A 的所有元素非零", "det(A) ≠ 0", "A 的所有特征值为正", "A 是对称矩阵"], answer: "B", explanation: "A 可逆 ⟺ det(A)≠0 ⟺ rank(A)=n ⟺ Ax=0 只有零解，这是等价的四个充要条件之一。" },
  { id: "LA4", chapter: "线性代数 Ch.2", course: "线性代数", type: "单选题", question: "行列式 det(kA) 与 det(A) 的关系（A 为 n×n 矩阵）：", options: ["k·det(A)", "k²·det(A)", "kⁿ·det(A)", "det(A)/k"], answer: "C", explanation: "每行都提出公因子 k，共 n 行，所以 det(kA)=kⁿdet(A)。" },
  { id: "LA5", chapter: "线性代数 Ch.3", course: "线性代数", type: "单选题", question: "向量组 {v₁,v₂,v₃} 构成 ℝ³ 的一组基，则以下说法正确的是：", options: ["它们可以线性相关", "任意 ℝ³ 中的向量可唯一表示为它们的线性组合", "它们的长度必须为 1", "它们必须互相垂直"], answer: "B", explanation: "基的定义：线性无关且张成整个空间。任意向量可用基唯一表示（坐标唯一）。" },
  { id: "LA6", chapter: "线性代数 Ch.4", course: "线性代数", type: "单选题", question: "Gram-Schmidt 正交化的目的是：", options: ["求矩阵的特征值", "将任意基变换为标准正交基", "对矩阵进行 LU 分解", "计算行列式"], answer: "B", explanation: "Gram-Schmidt 将线性无关向量组逐步转化为正交向量组，再单位化得到标准正交基。" },
  { id: "LA7", chapter: "线性代数 Ch.5", course: "线性代数", type: "单选题", question: "实对称矩阵的特征值：", options: ["必须为正数", "必须为实数", "必须互不相同", "必须为整数"], answer: "B", explanation: "谱定理：实对称矩阵的特征值一定是实数，且对应不同特征值的特征向量相互正交。" },
  { id: "LA8", chapter: "线性代数 Ch.5", course: "线性代数", type: "单选题", question: "矩阵 A 的奇异值（SVD 中的 σᵢ）等于：", options: ["A 的特征值", "AᵀA 特征值的平方根", "A 的行列式", "A 的迹"], answer: "B", explanation: "SVD：σᵢ=√λᵢ(AᵀA)，其中 λᵢ 为 AᵀA 的特征值（非负实数）。" },
  { id: "LA9", chapter: "线性代数 Ch.4", course: "线性代数", type: "判断题", question: "若 A 为 m×n 矩阵且 m>n，则 AᵀA 一定是可逆矩阵。", options: null, answer: "错误", explanation: "AᵀA 可逆当且仅当 A 的列向量线性无关（rank(A)=n）。若 A 的列线性相关，AᵀA 不可逆。" },
  { id: "LA10", chapter: "线性代数 Ch.5", course: "线性代数", type: "判断题", question: "n 阶矩阵有 n 个不同特征值，则一定可以对角化。", options: null, answer: "正确", explanation: "不同特征值对应的特征向量线性无关，n 个不同特征值保证 n 个线性无关特征向量，从而可对角化。" },

  // ── 概率论 ────────────────────────────────────────────────────────
  { id: "PT1", chapter: "概率论 Ch.1", course: "概率论", type: "单选题", question: "若事件 A 与 B 独立，则以下必然成立的是：", options: ["A 与 B 互斥", "P(A∩B)=P(A)P(B)", "P(A|B)=P(B|A)", "P(A∪B)=1"], answer: "B", explanation: "独立性定义：P(A∩B)=P(A)P(B)。独立与互斥是两个不同概念，非零概率事件不能同时独立且互斥。" },
  { id: "PT2", chapter: "概率论 Ch.1", course: "概率论", type: "单选题", question: "全概率公式 P(A)=ΣP(A|Bᵢ)P(Bᵢ) 要求 {Bᵢ} 满足：", options: ["互斥", "互斥且穷举（构成样本空间划分）", "独立", "等概率"], answer: "B", explanation: "{Bᵢ} 必须构成样本空间的完备划分：两两互斥且并集为 Ω，确保每种情况恰好被计算一次。" },
  { id: "PT3", chapter: "概率论 Ch.2", course: "概率论", type: "单选题", question: "若 X~N(μ,σ²)，则 P(μ-2σ < X < μ+2σ) 约等于：", options: ["68%", "95%", "99.7%", "50%"], answer: "B", explanation: "正态分布的 68-95-99.7 法则：μ±σ 内约 68%，μ±2σ 内约 95%，μ±3σ 内约 99.7%。" },
  { id: "PT4", chapter: "概率论 Ch.2", course: "概率论", type: "单选题", question: "泊松分布 X~Poisson(λ) 中，E[X] 和 Var(X) 分别等于：", options: ["λ 和 λ²", "λ 和 λ", "λ² 和 λ", "1/λ 和 1/λ²"], answer: "B", explanation: "Poisson 分布的期望和方差相等，均等于参数 λ。" },
  { id: "PT5", chapter: "概率论 Ch.3", course: "概率论", type: "单选题", question: "若 X,Y 独立，则 Var(X+Y) 等于：", options: ["Var(X)+Var(Y)+2Cov(X,Y)", "Var(X)+Var(Y)", "Var(X)·Var(Y)", "Var(X)-Var(Y)"], answer: "B", explanation: "独立时 Cov(X,Y)=0，所以 Var(X+Y)=Var(X)+Var(Y)+2Cov(X,Y)=Var(X)+Var(Y)。" },
  { id: "PT6", chapter: "概率论 Ch.4", course: "概率论", type: "单选题", question: "中心极限定理（CLT）的标准化形式中，样本均值 X̄ᵥ 近似服从：", options: ["t 分布", "χ² 分布", "标准正态 N(0,1)", "均匀分布"], answer: "C", explanation: "CLT：(X̄-μ)/(σ/√n) 依分布收敛到 N(0,1)，这是大样本统计推断的基础。" },
  { id: "PT7", chapter: "概率论 Ch.2", course: "概率论", type: "判断题", question: "指数分布具有无记忆性：已知等待时间超过 s 分钟，未来额外等待超过 t 分钟的概率等于从零开始等待超过 t 分钟的概率。", options: null, answer: "正确", explanation: "指数分布的无记忆性：P(X>s+t|X>s)=P(X>t)。这是指数分布在连续分布中唯一具有的性质。" },
  { id: "PT8", chapter: "概率论 Ch.4", course: "概率论", type: "判断题", question: "大数定律说明：样本量 n→∞ 时，样本均值依概率收敛到总体均值。", options: null, answer: "正确", explanation: "弱大数定律（Khinchin）：i.i.d. 且 E[X]=μ，则 X̄ₙ →ᴾ μ；强大数定律则是几乎处处收敛。" },

  // ── 数理统计 (Bijma 2016) ────────────────────────────────────────
  { id: "MS1", chapter: "数理统计 Ch.1", course: "数理统计", type: "单选题", question: "设 X₁,…,Xₙ 是来自 N(μ,σ²) 的随机样本，则样本方差 S² 的分布为：", options: ["正态分布", "t 分布", "χ²(n-1)/（n-1）乘以 σ²", "F 分布"], answer: "C", explanation: "(n-1)S²/σ² ~ χ²(n-1)，即 S²=(σ²/(n-1))·χ²(n-1)，这是正态总体的基本抽样定理之一。" },
  { id: "MS2", chapter: "数理统计 Ch.1", course: "数理统计", type: "单选题", question: "t 分布与标准正态分布相比，t 分布的尾部：", options: ["比正态分布细", "与正态分布相同", "比正态分布厚（重尾）", "没有尾部"], answer: "C", explanation: "t(n) 分布比 N(0,1) 有更厚的尾部（heavy tails），自由度 n→∞ 时趋向标准正态。" },
  { id: "MS3", chapter: "数理统计 Ch.2", course: "数理统计", type: "单选题", question: "若 θ̂ 是 θ 的无偏估计量，则意味着：", options: ["θ̂=θ 总成立", "E[θ̂]=θ", "θ̂ 的方差最小", "θ̂ 是 θ 的函数"], answer: "B", explanation: "无偏性定义：E[θ̂]=θ，即估计量的期望等于真实参数值，没有系统性偏差。" },
  { id: "MS4", chapter: "数理统计 Ch.2", course: "数理统计", type: "单选题", question: "正态总体 N(μ,σ²) 中，μ 的最大似然估计量是：", options: ["样本中位数", "样本众数", "样本均值 X̄", "样本方差 S²"], answer: "C", explanation: "对正态分布求似然函数对 μ 的导数并置零，得 μ̂_MLE=X̄（样本均值）。" },
  { id: "MS5", chapter: "数理统计 Ch.2", course: "数理统计", type: "单选题", question: "95% 置信区间的正确解释是：", options: ["θ 有 95% 概率落在区间内", "该方法重复使用时约 95% 的区间包含真实 θ", "区间内有 95% 的样本", "拒绝 H₀ 的概率为 95%"], answer: "B", explanation: "频率解释：区间 [L,U] 是随机的，真实参数固定。重复抽样构造的区间中有 95% 会包含 θ。" },
  { id: "MS6", chapter: "数理统计 Ch.3", course: "数理统计", type: "单选题", question: "在假设检验中，p 值的含义是：", options: ["H₀ 为真的概率", "犯第一类错误的概率 α", "在 H₀ 为真时，观测到至少如此极端结果的概率", "H₁ 为真的概率"], answer: "C", explanation: "p 值=P(观测统计量≥t_obs | H₀)，衡量数据与 H₀ 的相容程度；p 越小，越不支持 H₀。" },
  { id: "MS7", chapter: "数理统计 Ch.3", course: "数理统计", type: "判断题", question: "假设检验中，不拒绝 H₀ 意味着 H₀ 一定为真。", options: null, answer: "错误", explanation: "不拒绝 H₀ 只表示样本证据不足以拒绝，并非证明 H₀ 为真。这可能是因为样本量不够大（功效不足）。" },
  { id: "MS8", chapter: "数理统计 Ch.3", course: "数理统计", type: "判断题", question: "增大显著性水平 α 会降低第二类错误（漏判）的概率 β。", options: null, answer: "正确", explanation: "α 与 β 此消彼长：α 增大则拒绝域扩大，更容易拒绝 H₀，从而 β 减小；但同时犯第一类错误的风险增大。" },

  // ── ODE ────────────────────────────────────────────────────────
  { id: "ODE1", chapter: "ODE Ch.1", course: "ODE", type: "单选题", question: "一阶线性 ODE y'+P(x)y=Q(x) 的积分因子为：", options: ["e^{∫P dx}", "e^{-∫P dx}", "∫P dx", "P(x)"], answer: "A", explanation: "积分因子 μ=e^{∫P(x)dx}，乘以方程两边后左侧变为 (μy)' = μQ(x)，可直接积分。" },
  { id: "ODE2", chapter: "ODE Ch.1", course: "ODE", type: "单选题", question: "初值问题 dy/dx=y²，y(0)=1 的解在哪个区间上存在？", options: ["(-∞,+∞)", "(-∞,1)", "(0,1)", "(-∞,∞) 上分段"], answer: "B", explanation: "解为 y=1/(1-x)，在 x=1 处有垂直渐近线（爆破）。解仅在 x<1 时存在，即 (-∞,1)。" },
  { id: "ODE3", chapter: "ODE Ch.2", course: "ODE", type: "单选题", question: "常系数齐次 ODE y''-4y'+4y=0 的特征根为重根 r=2，其通解为：", options: ["C₁e^{2x}+C₂e^{-2x}", "(C₁+C₂x)e^{2x}", "C₁cos2x+C₂sin2x", "C₁e^{2x}"], answer: "B", explanation: "特征根 r=2（二重），重根情形通解为 (C₁+C₂x)eʳˣ，提供两个线性无关解。" },
  { id: "ODE4", chapter: "ODE Ch.2", course: "ODE", type: "单选题", question: "二阶齐次 ODE 的特征根为 α±βi（复数），则通解包含：", options: ["e^{αx} 和 e^{βx}", "e^{αx}cosβx 和 e^{αx}sinβx", "cosαx 和 sinβx", "e^{iβx}"], answer: "B", explanation: "复特征根 α±βi 对应两个实值线性无关解：e^{αx}cosβx 和 e^{αx}sinβx（Euler 公式）。" },
  { id: "ODE5", chapter: "ODE Ch.3", course: "ODE", type: "单选题", question: "L{eᵃᵗ} = F(s) 的值为（Laplace 变换）：", options: ["1/(s+a)", "1/(s-a)", "a/(s²+a²)", "s/(s²+a²)"], answer: "B", explanation: "由定义 ∫₀^∞ e^{-st}e^{at}dt=∫₀^∞ e^{-(s-a)t}dt=1/(s-a)，要求 s>a。" },
  { id: "ODE6", chapter: "ODE Ch.3", course: "ODE", type: "单选题", question: "用 Laplace 变换求解 IVP 时，y'(0) 的初始条件在变换中体现为：", options: ["直接乘以 s", "F(s)-y(0)", "sF(s)-y(0)", "s²F(s)-sy(0)-y'(0)（二阶时）"], answer: "D", explanation: "L{y''}=s²F(s)-sy(0)-y'(0)，初始条件自动代入，这是 Laplace 变换处理 IVP 的优势。" },
  { id: "ODE7", chapter: "ODE Ch.4", course: "ODE", type: "判断题", question: "若线性方程组 x'=Ax 的矩阵 A 的所有特征值实部均为负数，则原点是渐近稳定的平衡点。", options: null, answer: "正确", explanation: "所有特征值实部 Re(λᵢ)<0 时，基本解 e^{λᵢt}→0，所有解趋向原点，原点是渐近稳定的。" },
  { id: "ODE8", chapter: "ODE Ch.1", course: "ODE", type: "判断题", question: "可分离变量的 ODE dy/dx=f(x)g(y) 在 g(y₀)=0 处，y≡y₀ 是一个奇解（常数解）。", options: null, answer: "正确", explanation: "将 y≡y₀ 代入方程：dy/dx=0=f(x)·0 恒成立，所以 y=y₀ 是满足 g(y₀)=0 的奇解（常数解）。" },
];

const FLASHCARDS = [
  { front: "二分法收敛阶", back: "线性收敛 p=1，每步误差缩小 1/2", chapter: "Ch.1" },
  { front: "Newton 法收敛阶", back: "二阶收敛 p=2，每步有效数字翻倍", chapter: "Ch.1" },
  { front: "不动点迭代收敛条件", back: "|g'(x*)| < 1（压缩映射）", chapter: "Ch.1" },
  { front: "割线法收敛阶", back: "超线性，约 1.618（黄金比例）", chapter: "Ch.1" },
  { front: "高斯消去法复杂度", back: "O(n³)，约 n³/3 次乘除运算", chapter: "Ch.2" },
  { front: "LU 分解的核心优势", back: "一次分解（O(n³)），后续每次求解只需 O(n²)", chapter: "Ch.2" },
  { front: "条件数 κ(A) 含义", back: "‖A‖·‖A⁻¹‖，衡量扰动放大倍数，越大越病态", chapter: "Ch.2" },
  { front: "Lagrange 插值误差", back: "f^(n+1)(ξ)/(n+1)! · ∏(x-xᵢ)，与高阶导数有关", chapter: "Ch.3" },
  { front: "Runge 现象", back: "高次等距插值在端点振荡，用 Chebyshev 节点可避免", chapter: "Ch.3" },
  { front: "三次样条的优点", back: "分段低次、一阶二阶导数连续、无振荡", chapter: "Ch.3" },
  { front: "法方程（Normal Equations）", back: "AᵀAx = Aᵀb，最小二乘问题的最优性条件", chapter: "Ch.4" },
  { front: "QR 分解 vs 法方程", back: "QR 更稳定：条件数不被平方，精度更高", chapter: "Ch.4" },
  { front: "Simpson 法则精度", back: "O(h⁴)，对次数 ≤3 的多项式精确", chapter: "Ch.5" },
  { front: "Romberg 积分思想", back: "对梯形法结果做 Richardson 外推，大幅提高精度", chapter: "Ch.5" },
  { front: "Euler 法全局误差", back: "O(h)，一阶方法，步长需小，精度低", chapter: "Ch.6" },
  { front: "RK4 全局误差", back: "O(h⁴)，四阶方法，精度与计算量均衡", chapter: "Ch.6" },
  { front: "刚性方程特点", back: "特征值实部差异大，显式方法步长受限，需隐式方法", chapter: "Ch.6" },
  { front: "Markowitz 投资组合风险", back: "σ²_P = xᵀVx，V 协方差矩阵，x 持仓向量", chapter: "最优化 Ch.1" },
  { front: "SVM 间隔宽度", back: "margin = 2/‖w‖，最大化间隔 ⟺ 最小化 ‖w‖²", chapter: "最优化 Ch.1" },
  { front: "SVM 软间隔参数 C", back: "C 大→惩罚误分重；C 小→允许更多误分但间隔宽", chapter: "最优化 Ch.1" },
  // 线性代数
  { front: "秩-零化度定理", back: "rank(A) + nullity(A) = n（列数），即主元数+自由变量数=列数", chapter: "线性代数 Ch.1" },
  { front: "行列式乘积法则", back: "det(AB) = det(A)·det(B)，det(kA) = kⁿdet(A)", chapter: "线性代数 Ch.2" },
  { front: "A 可逆的充要条件", back: "det(A)≠0 ⟺ rank(A)=n ⟺ Ax=0 只有零解 ⟺ 列向量线性无关", chapter: "线性代数 Ch.2" },
  { front: "谱定理（实对称矩阵）", back: "实对称矩阵特征值全为实数，不同特征值的特征向量正交，且一定可对角化", chapter: "线性代数 Ch.5" },
  { front: "SVD 分解形式", back: "A = UΣVᵀ，σᵢ=√λᵢ(AᵀA)，截断 SVD 是最优低秩近似", chapter: "线性代数 Ch.5" },
  { front: "Gram-Schmidt 正交化核心步", back: "uₖ = vₖ - Σproj_{uⱼ}(vₖ)，去掉前面方向的投影成分", chapter: "线性代数 Ch.4" },
  // 概率论
  { front: "Bayes 定理", back: "P(Bᵢ|A) = P(A|Bᵢ)P(Bᵢ) / ΣP(A|Bⱼ)P(Bⱼ)，从结果推原因", chapter: "概率论 Ch.1" },
  { front: "正态分布 68-95-99.7 法则", back: "μ±1σ ≈68%，μ±2σ ≈95%，μ±3σ ≈99.7%", chapter: "概率论 Ch.2" },
  { front: "Poisson 分布 E 和 Var", back: "E[X]=λ，Var(X)=λ（均等于参数 λ）", chapter: "概率论 Ch.2" },
  { front: "方差的计算公式", back: "Var(X) = E[X²] - (E[X])²", chapter: "概率论 Ch.3" },
  { front: "中心极限定理", back: "(X̄-μ)/(σ/√n) → N(0,1)，n 足够大（≥30）时成立", chapter: "概率论 Ch.4" },
  { front: "指数分布无记忆性", back: "P(X>s+t | X>s) = P(X>t)，等待时间不受历史影响", chapter: "概率论 Ch.2" },
  // 数理统计
  { front: "MLE 核心思想", back: "最大化 ℓ(θ)=Σln f(xᵢ;θ)，用对数似然方程求解", chapter: "数理统计 Ch.2" },
  { front: "无偏估计量定义", back: "E[θ̂]=θ，期望等于真实参数，无系统偏差", chapter: "数理统计 Ch.2" },
  { front: "正态总体抽样分布", back: "(n-1)S²/σ² ~ χ²(n-1)；(X̄-μ)/(S/√n) ~ t(n-1)", chapter: "数理统计 Ch.1" },
  { front: "置信区间覆盖含义", back: "1-α 是该方法覆盖真值的频率，不是「θ 落在区间内的概率」", chapter: "数理统计 Ch.2" },
  { front: "p 值含义", back: "P(|T|≥t_obs | H₀)，p 越小越拒绝 H₀；p<α 则显著", chapter: "数理统计 Ch.3" },
  // ODE
  { front: "一阶线性 ODE 积分因子", back: "y'+P(x)y=Q(x) → μ=e^{∫P dx}，乘后化为 (μy)'=μQ", chapter: "ODE Ch.1" },
  { front: "重特征根的通解", back: "r 为 k 重根 → (C₁+C₂x+…+Cₖxᵏ⁻¹)eʳˣ", chapter: "ODE Ch.2" },
  { front: "复特征根的通解", back: "α±βi → e^{αx}(C₁cosβx + C₂sinβx)", chapter: "ODE Ch.2" },
  { front: "Laplace 变换的导数公式", back: "L{y'}=sY-y(0)；L{y''}=s²Y-sy(0)-y'(0)", chapter: "ODE Ch.3" },
  { front: "渐近稳定平衡点条件", back: "线性系统 x'=Ax 的所有特征值实部 Re(λᵢ)<0", chapter: "ODE Ch.4" },
];


// ── Topic → Chapter mapping ───────────────────────────────────────────────────
const TOPIC_CHAPTER = {
  "多项式求值": "Ch.0", "二进制与浮点数": "Ch.0", "有效数字与舍入误差": "Ch.0", "微积分基础回顾": "Ch.0",
  "二分法": "Ch.1", "不动点迭代": "Ch.1", "误差分析": "Ch.1", "Newton 法": "Ch.1", "割线法": "Ch.1",
  "Gauss 消去法": "Ch.2", "LU 分解": "Ch.2", "条件数与误差": "Ch.2", "Jacobi / Gauss-Seidel 迭代": "Ch.2",
  "Lagrange 插值": "Ch.3", "Newton 差商": "Ch.3", "Chebyshev 插值": "Ch.3", "三次样条": "Ch.3", "Bézier 曲线": "Ch.3",
  "法方程": "Ch.4", "数据拟合模型": "Ch.4", "QR 分解": "Ch.4", "GMRES": "Ch.4", "非线性最小二乘": "Ch.4",
  "有限差分公式": "Ch.5", "梯形法 / Simpson 法": "Ch.5", "Romberg 积分": "Ch.5", "Gauss 积分": "Ch.5",
  "Euler 法": "Ch.6", "Runge-Kutta 法": "Ch.6", "方程组": "Ch.6", "刚性方程与隐式法": "Ch.6",
  "打靶法": "Ch.7", "有限差分法": "Ch.7", "有限元 / Galerkin 法": "Ch.7",
  "抛物型方程": "Ch.8", "双曲型方程": "Ch.8", "椭圆型方程": "Ch.8", "Crank-Nicolson 法": "Ch.8",
  "伪随机数生成": "Ch.9", "Monte Carlo 模拟": "Ch.9", "方差缩减": "Ch.9",
  "最小二乘数据拟合": "最优化 Ch.1", "线性 vs 非线性模型": "最优化 Ch.1",
  "残差向量与范数": "最优化 Ch.1", "非线性规划定义": "最优化 Ch.1",
  "设施选址问题": "最优化 Ch.1", "球缺体积最优化": "最优化 Ch.1",
  "投资组合选择 (Markowitz)": "最优化 Ch.1", "交通流最小化": "最优化 Ch.1",
  "最大似然估计": "最优化 Ch.1", "SVM 分类": "最优化 Ch.1",
  // 线性代数
  "矩阵运算与初等变换": "线性代数 Ch.1", "Gauss-Jordan 消去": "线性代数 Ch.1",
  "向量的线性组合": "线性代数 Ch.1", "矩阵的秩": "线性代数 Ch.1",
  "行列式定义与性质": "线性代数 Ch.2", "余子式与代数余子式": "线性代数 Ch.2",
  "Cramer 法则": "线性代数 Ch.2", "行列式的几何意义": "线性代数 Ch.2",
  "子空间": "线性代数 Ch.3", "基与维数": "线性代数 Ch.3",
  "列空间与零空间": "线性代数 Ch.3", "坐标变换": "线性代数 Ch.3",
  "内积与正交": "线性代数 Ch.4", "Gram-Schmidt 正交化": "线性代数 Ch.4",
  "QR 分解": "线性代数 Ch.4", "正交投影与最小二乘": "线性代数 Ch.4",
  "特征方程": "线性代数 Ch.5", "对角化": "线性代数 Ch.5",
  "对称矩阵的谱定理": "线性代数 Ch.5", "SVD 奇异值分解": "线性代数 Ch.5",
  "特征值与对角化": "线性代数 Ch.5",
  // 概率论
  "样本空间与事件": "概率论 Ch.1", "概率公理": "概率论 Ch.1",
  "条件概率": "概率论 Ch.1", "全概率公式与 Bayes 定理": "概率论 Ch.1",
  "条件概率与 Bayes 定理": "概率论 Ch.1",
  "离散型随机变量": "概率论 Ch.2", "连续型随机变量": "概率论 Ch.2",
  "分布函数": "概率论 Ch.2", "常见分布（Bernoulli/Poisson/正态/指数）": "概率论 Ch.2",
  "常见概率分布": "概率论 Ch.2",
  "数学期望": "概率论 Ch.3", "方差与标准差": "概率论 Ch.3",
  "协方差与相关系数": "概率论 Ch.3", "矩母函数": "概率论 Ch.3",
  "期望与方差": "概率论 Ch.3",
  "大数定律（弱/强）": "概率论 Ch.4", "中心极限定理": "概率论 Ch.4",
  "收敛性概念": "概率论 Ch.4", "正态近似应用": "概率论 Ch.4",
  // 数理统计
  "总体与样本": "数理统计 Ch.1", "统计量": "数理统计 Ch.1",
  "χ² 分布 / t 分布 / F 分布": "数理统计 Ch.1", "正态总体抽样定理": "数理统计 Ch.1",
  "矩估计法": "数理统计 Ch.2", "最大似然估计 MLE": "数理统计 Ch.2",
  "估计量优良性（无偏/有效/相合）": "数理统计 Ch.2", "置信区间": "数理统计 Ch.2",
  "检验框架（H₀/H₁/α/β）": "数理统计 Ch.3", "t 检验": "数理统计 Ch.3",
  "χ² 拟合优度检验": "数理统计 Ch.3", "p 值与检验功效": "数理统计 Ch.3",
  "假设检验框架": "数理统计 Ch.3",
  // ODE
  "分离变量法": "ODE Ch.1", "线性方程与积分因子": "ODE Ch.1",
  "Bernoulli 方程": "ODE Ch.1", "存在唯一性定理": "ODE Ch.1",
  "特征方程法": "ODE Ch.2", "叠加原理与 Wronskian": "ODE Ch.2",
  "待定系数法": "ODE Ch.2", "常数变易法": "ODE Ch.2",
  "特征方程法（常系数线性 ODE）": "ODE Ch.2",
  "Laplace 变换定义与性质": "ODE Ch.3", "逆变换与部分分式": "ODE Ch.3",
  "卷积定理": "ODE Ch.3", "用 Laplace 变换求解 IVP": "ODE Ch.3",
  "Laplace 变换": "ODE Ch.3",
  "线性方程组的矩阵解法": "ODE Ch.4", "相平面与轨迹": "ODE Ch.4",
  "平衡点类型与稳定性": "ODE Ch.4", "Lyapunov 稳定性": "ODE Ch.4",
};

// Get chapter stats from sessionAnswers {questionId: {correct, chapter}}
const getChapterStats = (sessionAnswers) => {
  const stats = {};
  try {
    Object.values(sessionAnswers || {}).forEach((val) => {
      if (!val || typeof val !== "object") return;
      const { correct, chapter } = val;
      if (!chapter) return;
      if (!stats[chapter]) stats[chapter] = { correct: 0, total: 0 };
      stats[chapter].total++;
      if (correct) stats[chapter].correct++;
    });
  } catch (e) {}
  return stats;
};

const getTopicStatus = (topic, chapterStats) => {
  const ch = TOPIC_CHAPTER[topic];
  if (!ch || !chapterStats[ch]) return "todo";
  const { correct, total } = chapterStats[ch];
  if (total >= 3) return "done";
  if (total >= 1) return "doing";
  return "todo";
};

const getTopicAccuracy = (topic, chapterStats) => {
  const ch = TOPIC_CHAPTER[topic];
  if (!ch || !chapterStats[ch]) return null;
  const { correct, total } = chapterStats[ch];
  return { correct, total, pct: Math.round(correct / total * 100) };
};

const CHAPTERS = [
  { id: 0, course: "数值分析", num: "Ch.0", name: "基础知识", topics: ["多项式求值", "二进制与浮点数", "有效数字与舍入误差", "微积分基础回顾"] },
  { id: 1, course: "数值分析", num: "Ch.1", name: "方程求解", topics: ["二分法", "不动点迭代", "误差分析", "Newton 法", "割线法"] },
  { id: 2, course: "数值分析", num: "Ch.2", name: "线性方程组", topics: ["Gauss 消去法", "LU 分解", "条件数与误差", "Jacobi / Gauss-Seidel 迭代"] },
  { id: 3, course: "数值分析", num: "Ch.3", name: "插值", topics: ["Lagrange 插值", "Newton 差商", "Chebyshev 插值", "三次样条", "Bézier 曲线"] },
  { id: 4, course: "数值分析", num: "Ch.4", name: "最小二乘", topics: ["法方程", "数据拟合模型", "QR 分解", "GMRES", "非线性最小二乘"] },
  { id: 5, course: "数值分析", num: "Ch.5", name: "数值微积分", topics: ["有限差分公式", "梯形法 / Simpson 法", "Romberg 积分", "Gauss 积分"] },
  { id: 6, course: "数值分析", num: "Ch.6", name: "常微分方程", topics: ["Euler 法", "Runge-Kutta 法", "方程组", "刚性方程与隐式法"] },
  { id: 7, course: "数值分析", num: "Ch.7", name: "边值问题", topics: ["打靶法", "有限差分法", "有限元 / Galerkin 法"] },
  { id: 8, course: "数值分析", num: "Ch.8", name: "偏微分方程", topics: ["抛物型方程", "双曲型方程", "椭圆型方程", "Crank-Nicolson 法"] },
  { id: 9, course: "数值分析", num: "Ch.9", name: "随机数与 Monte Carlo", topics: ["伪随机数生成", "Monte Carlo 模拟", "方差缩减"] },
  { id: 10, course: "最优化", num: "Ch.1", name: "优化模型概论", topics: ["最小二乘数据拟合", "线性 vs 非线性模型", "残差向量与范数", "非线性规划定义"] },
  { id: 11, course: "最优化", num: "Ch.1b", name: "非线性规划应用", topics: ["设施选址问题", "球缺体积最优化", "投资组合选择 (Markowitz)", "交通流最小化", "最大似然估计", "SVM 分类"] },
  // ── 线性代数 (Leon 9th) ──────────────────────────────────────────────────
  { id: 12, course: "线性代数", num: "Ch.1", name: "矩阵与线性方程组", topics: ["矩阵运算与初等变换", "Gauss-Jordan 消去", "向量的线性组合", "矩阵的秩"] },
  { id: 13, course: "线性代数", num: "Ch.2", name: "行列式", topics: ["行列式定义与性质", "余子式与代数余子式", "Cramer 法则", "行列式的几何意义"] },
  { id: 14, course: "线性代数", num: "Ch.3", name: "向量空间", topics: ["子空间", "基与维数", "列空间与零空间", "坐标变换"] },
  { id: 15, course: "线性代数", num: "Ch.4", name: "正交性与最小二乘", topics: ["内积与正交", "Gram-Schmidt 正交化", "QR 分解", "正交投影与最小二乘"] },
  { id: 16, course: "线性代数", num: "Ch.5", name: "特征值与 SVD", topics: ["特征方程", "对角化", "对称矩阵的谱定理", "SVD 奇异值分解"] },
  // ── 概率论 ───────────────────────────────────────────────────────────────
  { id: 17, course: "概率论", num: "Ch.1", name: "概率基础", topics: ["样本空间与事件", "概率公理", "条件概率", "全概率公式与 Bayes 定理"] },
  { id: 18, course: "概率论", num: "Ch.2", name: "随机变量与分布", topics: ["离散型随机变量", "连续型随机变量", "分布函数", "常见分布（Bernoulli/Poisson/正态/指数）"] },
  { id: 19, course: "概率论", num: "Ch.3", name: "期望与矩", topics: ["数学期望", "方差与标准差", "协方差与相关系数", "矩母函数"] },
  { id: 20, course: "概率论", num: "Ch.4", name: "极限定理", topics: ["大数定律（弱/强）", "中心极限定理", "收敛性概念", "正态近似应用"] },
  // ── 数理统计 (Bijma 2016) ─────────────────────────────────────────────────
  { id: 21, course: "数理统计", num: "Ch.1", name: "统计基础与抽样分布", topics: ["总体与样本", "统计量", "χ² 分布 / t 分布 / F 分布", "正态总体抽样定理"] },
  { id: 22, course: "数理统计", num: "Ch.2", name: "参数估计", topics: ["矩估计法", "最大似然估计 MLE", "估计量优良性（无偏/有效/相合）", "置信区间"] },
  { id: 23, course: "数理统计", num: "Ch.3", name: "假设检验", topics: ["检验框架（H₀/H₁/α/β）", "t 检验", "χ² 拟合优度检验", "p 值与检验功效"] },
  // ── ODE ──────────────────────────────────────────────────────────────────
  { id: 24, course: "ODE", num: "Ch.1", name: "一阶方程", topics: ["分离变量法", "线性方程与积分因子", "Bernoulli 方程", "存在唯一性定理"] },
  { id: 25, course: "ODE", num: "Ch.2", name: "高阶线性方程", topics: ["特征方程法", "叠加原理与 Wronskian", "待定系数法", "常数变易法"] },
  { id: 26, course: "ODE", num: "Ch.3", name: "Laplace 变换", topics: ["Laplace 变换定义与性质", "逆变换与部分分式", "卷积定理", "用 Laplace 变换求解 IVP"] },
  { id: 27, course: "ODE", num: "Ch.4", name: "线性方程组与稳定性", topics: ["线性方程组的矩阵解法", "相平面与轨迹", "平衡点类型与稳定性", "Lyapunov 稳定性"] },
];

// ── Shared UI ─────────────────────────────────────────────────────────────────
const s = {
  card: { background: "#fff", border: "1px solid #f0f0f0", borderRadius: 20, padding: "1.6rem", boxShadow: "0 2px 16px rgba(0,0,0,0.05)" },
  input: { width: "100%", fontSize: 15, padding: "13px 16px", border: "1.5px solid #e5e5e7", borderRadius: 12, fontFamily: "inherit", boxSizing: "border-box", outline: "none", color: "#111", background: "#fafafa" },
  label: { fontSize: 13, color: "#555", marginBottom: 8, display: "block", fontWeight: 600, letterSpacing: "0.01em" },
};

const Btn = ({ children, onClick, variant = "outline", size = "md", disabled = false, style = {} }) => {
  const base = variant === "primary"
    ? { background: disabled ? "#9FE1CB" : G.teal, color: "#fff", border: "none" }
    : variant === "danger"
    ? { background: G.redLight, color: G.red, border: `1px solid ${G.red}` }
    : { background: "#fff", color: "#333", border: "1.5px solid #ddd" };
  const pad = size === "sm" ? "7px 14px" : size === "lg" ? "14px 32px" : "10px 22px";
  const fz = size === "sm" ? 13 : size === "lg" ? 16 : 14;
  return (
    <button disabled={disabled} onClick={onClick} style={{ padding: pad, fontSize: fz, fontFamily: "inherit", borderRadius: 10, cursor: disabled ? "not-allowed" : "pointer", fontWeight: 500, transition: "all .15s", ...base, ...style }}>{children}</button>
  );
};

const Badge = ({ children, color = "teal" }) => {
  const m = { teal: [G.tealLight, G.tealDark], blue: [G.blueLight, G.blue], amber: [G.amberLight, G.amber], red: [G.redLight, G.red], purple: [G.purpleLight, G.purple] };
  const [bg, fg] = m[color] || m.teal;
  return <span style={{ background: bg, color: fg, fontSize: 11, padding: "3px 10px", borderRadius: 20, fontWeight: 600, whiteSpace: "nowrap" }}>{children}</span>;
};
const StatCard = ({ label, value, sub, color = G.teal, icon }) => (
  <div style={{ background: color + "10", borderRadius: 20, padding: "1.2rem 1.1rem", border: "1px solid " + color + "22", boxShadow: "0 2px 12px rgba(0,0,0,0.03)" }}>
    <div style={{ fontSize: 22, marginBottom: 8 }}>{icon}</div>
    <div style={{ fontSize: 28, fontWeight: 800, color, lineHeight: 1, marginBottom: 4 }}>{value}</div>
    <div style={{ fontSize: 13, fontWeight: 700, color: "#222", marginBottom: 2 }}>{label}</div>
    {sub && <div style={{ fontSize: 11, color: "#999" }}>{sub}</div>}
  </div>
)

const ProgressBar = ({ value, max = 100, color = G.teal, height = 8 }) => (
  <div style={{ height, background: "#f0f0f0", borderRadius: height, overflow: "hidden" }}>
    <div style={{ height, width: `${Math.min(100, (value / max) * 100)}%`, background: color, borderRadius: height, transition: "width .5s ease" }} />
  </div>
);

// ── Email Confirmed Page ───────────────────────────────────────────────────────
function EmailConfirmedPage({ onContinue }) {
  useEffect(() => {
    // 清除 Supabase 自动建立的 session，要求用户手动登录
    supabase.auth.signOut();
  }, []);

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #f0fdf8 0%, #e8f4ff 100%)", display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
      <div style={{ textAlign: "center", maxWidth: 440 }}>
        {/* 图标 */}
        <div style={{ width: 88, height: 88, borderRadius: 28, background: G.teal, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 44, margin: "0 auto 28px", boxShadow: "0 8px 32px rgba(29,158,117,0.25)" }}>✅</div>

        <div style={{ fontSize: 28, fontWeight: 700, color: "#111", marginBottom: 12, letterSpacing: "-0.5px" }}>邮箱验证成功！</div>
        <div style={{ fontSize: 16, color: "#555", lineHeight: 1.8, marginBottom: 32 }}>
          你的账号已完成邮箱确认，可以关闭此页面，<br />回到 MathCore 网站进行登录。
        </div>

        <div style={{ background: "#fff", border: `1.5px solid ${G.teal}33`, borderRadius: 16, padding: "1.2rem 1.5rem", marginBottom: 28, textAlign: "left" }}>
          <div style={{ fontSize: 13, color: "#666", lineHeight: 1.9 }}>
            <div>1. 打开 <a href="https://mathcore-theta.vercel.app" style={{ color: G.teal, fontWeight: 600 }}>mathcore-theta.vercel.app</a></div>
            <div>2. 用你注册时的邮箱和密码登录</div>
            <div>3. 开始你的数学学习之旅 🎓</div>
          </div>
        </div>

        <button
          onClick={onContinue}
          style={{ padding: "14px 40px", fontSize: 16, fontWeight: 700, fontFamily: "inherit", background: G.teal, color: "#fff", border: "none", borderRadius: 14, cursor: "pointer", boxShadow: "0 4px 16px rgba(29,158,117,0.3)" }}
        >
          前往登录 →
        </button>
        <div style={{ marginTop: 14, fontSize: 13, color: "#aaa" }}>点击按钮或直接访问网站登录</div>
      </div>
    </div>
  );
}

// ── Auth Page ─────────────────────────────────────────────────────────────────
function AuthPage() {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("student");
  const [classCode, setClassCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown(c => c <= 1 ? 0 : c - 1), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  const handleLogin = async () => {
    setLoading(true); setError("");
    // 手动登录时清除邮箱确认标记，避免误触发确认页
    localStorage.removeItem("mc_confirm_pending");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError("邮箱或密码错误，请重试");
    setLoading(false);
  };

  const handleRegister = async () => {
    if (!name.trim()) { setError("请输入姓名"); return; }
    if (password.length < 6) { setError("密码至少 6 位"); return; }
    setLoading(true); setError("");
    const { error } = await supabase.auth.signUp({
      email, password,
      options: {
        data: { name, role },
        emailRedirectTo: "https://mathcore-theta.vercel.app",
      },
    });
    if (error) {
      if (/rate.limit|over.*email|too many|email.*rate/i.test(error.message)) {
        // 服务器端频率限制：不锁前端按钮，告知用户稍等即可重试
        setError("Supabase 邮件冷却中（每个邮箱 60 秒限一封），请稍等片刻后再点注册，或换一个邮箱测试。");
      } else if (/already registered|user already/i.test(error.message)) {
        setError("该邮箱已注册，请直接登录，或在 Supabase 后台删除账号后稍等 60 秒再试。");
      } else {
        setError(error.message);
      }
    } else {
      setSuccess("注册成功！验证邮件已发送，请查收。");
      setCooldown(60);
      localStorage.setItem("mc_confirm_pending", String(Date.now()));
    }
    setLoading(false);
  };

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #f0fdf8 0%, #e8f4ff 100%)", display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
      <div style={{ width: "100%", maxWidth: 460 }}>
        {/* Brand */}
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{ width: 56, height: 56, borderRadius: 16, background: G.teal, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, margin: "0 auto 14px" }}>📐</div>
          <div style={{ fontSize: 26, fontWeight: 700, color: "#111", letterSpacing: "-0.5px" }}>MathCore</div>
          <div style={{ fontSize: 15, color: "#666", marginTop: 4 }}>数学与应用数学学习平台</div>
        </div>

        <div style={{ ...s.card, padding: "2rem" }}>
          {/* Tabs */}
          <div style={{ display: "flex", background: "#f5f5f5", borderRadius: 12, padding: 4, marginBottom: 24 }}>
            {[["login", "登录"], ["register", "注册"]].map(([m, l]) => (
              <button key={m} onClick={() => { setMode(m); setError(""); setSuccess(""); }} style={{ flex: 1, padding: "10px 0", fontSize: 14, fontFamily: "inherit", border: "none", cursor: "pointer", borderRadius: 10, fontWeight: mode === m ? 600 : 400, background: mode === m ? "#fff" : "transparent", color: mode === m ? "#111" : "#888", boxShadow: mode === m ? "0 2px 8px rgba(0,0,0,0.08)" : "none" }}>{l}</button>
            ))}
          </div>

          {error && <div style={{ padding: "12px 16px", background: G.redLight, color: G.red, borderRadius: 10, fontSize: 14, marginBottom: 16 }}>{error}</div>}
          {success && (
            <div style={{ padding: "14px 16px", background: G.tealLight, color: G.tealDark, borderRadius: 10, fontSize: 14, marginBottom: 16, lineHeight: 1.7 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>✉️ 验证邮件已发送！</div>
              <div>请打开你注册时填写的邮箱，点击邮件中的链接完成验证后即可登录。</div>
              <div style={{ marginTop: 6, color: "#2d7a5f", fontSize: 13 }}>
                没收到？请检查<strong>垃圾邮件</strong>文件夹。
                {cooldown > 0
                  ? <span style={{ marginLeft: 6, color: "#888" }}>重新发送需等待 <strong style={{ color: G.tealDark }}>{cooldown}s</strong></span>
                  : <span style={{ marginLeft: 6 }}>如仍未收到，可重新注册触发再次发送（每封邮件有 60 秒冷却）。</span>
                }
              </div>
            </div>
          )}

          {mode === "register" && (
            <>
              <div style={{ marginBottom: 14 }}>
                <label style={s.label}>姓名</label>
                <input style={s.input} value={name} onChange={e => setName(e.target.value)} placeholder="你的名字" />
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={s.label}>身份</label>
                <div style={{ display: "flex", gap: 10 }}>
                  {[["student", "🎓 学生"], ["teacher", "👨‍🏫 教师"]].map(([r, l]) => (
                    <button key={r} onClick={() => setRole(r)} style={{ flex: 1, padding: "12px 0", fontSize: 14, fontFamily: "inherit", border: role === r ? `2px solid ${G.teal}` : "2px solid #e0e0e0", borderRadius: 10, cursor: "pointer", fontWeight: role === r ? 600 : 400, background: role === r ? G.tealLight : "#fff", color: role === r ? G.tealDark : "#666" }}>{l}</button>
                  ))}
                </div>
              </div>
            </>
          )}

          <div style={{ marginBottom: 14 }}>
            <label style={s.label}>邮箱</label>
            <input style={s.input} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="your@email.com" />
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={s.label}>密码</label>
            <input style={s.input} type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder={mode === "register" ? "至少 6 位" : "输入密码"} onKeyDown={e => { if (e.key === "Enter") { if (mode === "login") handleLogin(); else handleRegister(); }}} />
          </div>

          <button
            disabled={loading || (mode === "register" && cooldown > 0)}
            onClick={mode === "login" ? handleLogin : handleRegister}
            style={{ width: "100%", padding: "14px 0", fontSize: 16, fontWeight: 600, fontFamily: "inherit", background: loading || (mode === "register" && cooldown > 0) ? "#9FE1CB" : G.teal, color: "#fff", border: "none", borderRadius: 12, cursor: loading || (mode === "register" && cooldown > 0) ? "not-allowed" : "pointer" }}
          >
            {loading ? "处理中…" : mode === "register" && cooldown > 0 ? `重新发送（${cooldown}s）` : mode === "login" ? "登录" : "注册账号"}
          </button>
          <div style={{ textAlign: "center", marginTop: 16, fontSize: 14, color: "#888" }}>
            {mode === "login" ? <>还没有账号？<span onClick={() => setMode("register")} style={{ color: G.teal, cursor: "pointer", fontWeight: 500 }}>立即注册</span></> : <>已有账号？<span onClick={() => setMode("login")} style={{ color: G.teal, cursor: "pointer", fontWeight: 500 }}>直接登录</span></>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Nav ───────────────────────────────────────────────────────────────────────
// ── Change Password Modal ────────────────────────────────────────────────────────────
function ChangePasswordModal({ onClose }) {
  const [oldPwd, setOldPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [ok, setOk] = useState(false);

  const handleSubmit = async () => {
    if (!newPwd || newPwd.length < 6) { setMsg("新密码至少6个字符"); return; }
    if (newPwd !== confirm) { setMsg("两次输入的新密码不一致"); return; }
    setLoading(true); setMsg("");
    try {
      const { error } = await supabase.auth.updateUser({ password: newPwd });
      if (error) { setMsg("修改失败：" + error.message); }
      else { setOk(true); setMsg("密码修改成功！请用新密码重新登录。"); }
    } catch(e) { setMsg("修改失败，请稍后重试"); }
    setLoading(false);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: 20, padding: "2rem", width: "100%", maxWidth: 380, boxShadow: "0 20px 60px rgba(0,0,0,0.15)", animation: "slideUp .25s ease" }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 20, display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 22 }}>🔒</span> 修改密码
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, color: "#666", marginBottom: 6, fontWeight: 600 }}>新密码</div>
            <input type="password" value={newPwd} onChange={e => setNewPwd(e.target.value)} placeholder="至少6个字符" style={{ width: "100%", padding: "10px 14px", border: "1.5px solid #e0e0e0", borderRadius: 10, fontSize: 14, fontFamily: "inherit", outline: "none", boxSizing: "border-box" }} />
          </div>
          <div>
            <div style={{ fontSize: 12, color: "#666", marginBottom: 6, fontWeight: 600 }}>确认新密码</div>
            <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="再次输入新密码" style={{ width: "100%", padding: "10px 14px", border: "1.5px solid #e0e0e0", borderRadius: 10, fontSize: 14, fontFamily: "inherit", outline: "none", boxSizing: "border-box" }} onKeyDown={e => e.key === "Enter" && !loading && handleSubmit()} />
          </div>
          {msg && (
            <div style={{ padding: "10px 14px", borderRadius: 10, background: ok ? "#f0fdf4" : "#fff5f5", color: ok ? G.teal : G.red, fontSize: 13, fontWeight: 500 }}>{msg}</div>
          )}
          <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
            <button onClick={onClose} style={{ flex: 1, padding: "10px", border: "1.5px solid #e0e0e0", borderRadius: 10, cursor: "pointer", background: "#fff", color: "#666", fontSize: 14, fontFamily: "inherit" }}>取消</button>
            {!ok && <button onClick={handleSubmit} disabled={loading} style={{ flex: 2, padding: "10px", border: "none", borderRadius: 10, cursor: loading ? "not-allowed" : "pointer", background: loading ? "#aaa" : G.teal, color: "#fff", fontSize: 14, fontWeight: 600, fontFamily: "inherit" }}>{loading ? "修改中..." : "确认修改"}</button>}
            {ok && <button onClick={onClose} style={{ flex: 2, padding: "10px", border: "none", borderRadius: 10, cursor: "pointer", background: G.teal, color: "#fff", fontSize: 14, fontWeight: 600, fontFamily: "inherit" }}>完成</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

function TopNav({ page, setPage, profile, onLogout }) {
  const [showMore, setShowMore] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showPwdModal, setShowPwdModal] = useState(false);
  const primaryLinks = ["首页", "资料库", "知识点", "资料对话", "题库练习", "学习报告"];
  const moreLinks = profile?.role === "teacher"
    ? ["上传资料", "技能树", "记忆卡片", "错题本", "教师管理"]
    : ["上传资料", "技能树", "记忆卡片", "错题本"];
  const isActive = (l) => page === l;
  return (
    <div style={{ background: "rgba(255,255,255,0.92)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", borderBottom: "1px solid rgba(0,0,0,0.06)", padding: "0 2rem", display: "flex", alignItems: "center", justifyContent: "space-between", height: 60, position: "sticky", top: 0, zIndex: 100, boxShadow: "0 2px 16px rgba(0,0,0,0.04)" }}>
      <div onClick={() => setPage("首页")} style={{ display: "flex", alignItems: "center", gap: 9, cursor: "pointer", flexShrink: 0 }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: G.teal, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
            <path d="M17 4H6L11.5 11L6 18H17" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <span style={{ fontSize: 18, fontWeight: 800, color: "#111", letterSpacing: "-0.5px" }}>MathCore</span>
      </div>
      <div style={{ display: "flex", gap: 1, alignItems: "center" }}>
        {primaryLinks.map(l => (
          <button key={l} onClick={() => setPage(l)} style={{ padding: "8px 14px", borderRadius: 9, fontSize: 14, fontFamily: "inherit", border: "none", cursor: "pointer", fontWeight: isActive(l) ? 700 : 400, background: isActive(l) ? G.tealLight : "transparent", color: isActive(l) ? G.tealDark : "#444", whiteSpace: "nowrap" }}>
            {l === "资料对话" ? "🤖 AI助教" : l}
          </button>
        ))}
        <div style={{ position: "relative" }}>
          <button onClick={() => setShowMore(v => !v)} style={{ padding: "7px 13px", borderRadius: 8, fontSize: 13, fontFamily: "inherit", border: "none", cursor: "pointer", background: moreLinks.includes(page) ? G.tealLight : "transparent", color: moreLinks.includes(page) ? G.tealDark : "#555" }}>
            更多 ▾
          </button>
          {showMore && (
            <div onMouseLeave={() => setShowMore(false)} style={{ position: "absolute", top: "100%", right: 0, background: "#fff", borderRadius: 12, boxShadow: "0 8px 32px rgba(0,0,0,0.12)", border: "1px solid #eee", padding: "8px 6px", minWidth: 140, zIndex: 200 }}>
              {moreLinks.map(l => (
                <button key={l} onClick={() => { setPage(l); setShowMore(false); }} style={{ display: "block", width: "100%", textAlign: "left", padding: "9px 14px", borderRadius: 8, fontSize: 13, fontFamily: "inherit", border: "none", cursor: "pointer", background: page === l ? G.tealLight : "transparent", color: page === l ? G.tealDark : "#555", fontWeight: page === l ? 600 : 400 }}>{l}</button>
              ))}
            </div>
          )}
        </div>
      </div>
      {showPwdModal && <ChangePasswordModal onClose={() => setShowPwdModal(false)} />}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, position: "relative" }}>
        <div onClick={() => setShowUserMenu(v => !v)} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", padding: "4px 8px", borderRadius: 10, transition: "background .15s" }}
          onMouseEnter={e => e.currentTarget.style.background = "#f5f5f5"}
          onMouseLeave={e => e.currentTarget.style.background = "transparent"}
        >
          <div style={{ width: 32, height: 32, borderRadius: "50%", background: G.teal, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, color: "#fff" }}>{(profile?.name || "U")[0].toUpperCase()}</div>
          <div style={{ lineHeight: 1.2 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#111" }}>{profile?.name}</div>
            <div style={{ fontSize: 11, color: "#aaa" }}>{profile?.role === "teacher" ? "教师" : "学生"} ▾</div>
          </div>
        </div>
        {showUserMenu && (
          <div onMouseLeave={() => setShowUserMenu(false)} style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, background: "#fff", borderRadius: 14, boxShadow: "0 8px 32px rgba(0,0,0,0.12)", border: "1px solid #eee", padding: "8px 6px", minWidth: 160, zIndex: 300 }}>
            <div style={{ padding: "8px 14px", fontSize: 12, color: "#aaa", fontWeight: 600, borderBottom: "1px solid #f0f0f0", marginBottom: 6 }}>{profile?.email || profile?.name}</div>
            <button onClick={() => { setShowPwdModal(true); setShowUserMenu(false); }} style={{ display: "block", width: "100%", textAlign: "left", padding: "9px 14px", borderRadius: 8, fontSize: 13, fontFamily: "inherit", border: "none", cursor: "pointer", background: "transparent", color: "#333" }}
              onMouseEnter={e => e.currentTarget.style.background = "#f5f5f5"}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}
            >🔒 修改密码</button>
            <div style={{ height: 1, background: "#f0f0f0", margin: "6px 8px" }} />
            <button onClick={() => { onLogout(); setShowUserMenu(false); }} style={{ display: "block", width: "100%", textAlign: "left", padding: "9px 14px", borderRadius: 8, fontSize: 13, fontFamily: "inherit", border: "none", cursor: "pointer", background: "transparent", color: G.red }}
              onMouseEnter={e => e.currentTarget.style.background = "#fff5f5"}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}
            >🚪 退出登录</button>
          </div>
        )}
      </div>
    </div>
  );
}
function JoinClassCard({ profile }) {
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");
  const [msgType, setMsgType] = useState(""); // "ok" | "err"
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const currentCode = profile?.class_code || localStorage.getItem("mc_class_code") || "";

  const handleJoin = async () => {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) { setMsg("请输入邀请码"); setMsgType("err"); return; }
    setLoading(true); setMsg(""); 
    try {
      const { error } = await supabase.from("profiles").update({ class_code: trimmed }).eq("id", profile.id);
      if (error) {
        // class_code 列可能尚未建立，退回到 localStorage
        localStorage.setItem("mc_class_code", trimmed);
        setMsg(`已加入班级 ${trimmed}（本地保存）`); setMsgType("ok");
      } else {
        localStorage.setItem("mc_class_code", trimmed);
        setMsg(`成功加入班级 ${trimmed}！`); setMsgType("ok");
      }
      setCode(""); setExpanded(false);
    } catch (e) {
      setMsg("加入失败，请稍后重试"); setMsgType("err");
    }
    setLoading(false);
  };

  if (profile?.role === "teacher") return null;

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: "#888", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 14 }}>我的班级</div>
      <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #f0f0f0", padding: "1.25rem 1.5rem", boxShadow: "0 2px 12px rgba(0,0,0,0.04)" }}>
        {currentCode ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: 14, color: "#555", marginBottom: 2 }}>当前班级</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: G.teal, letterSpacing: "0.06em" }}>{currentCode}</div>
            </div>
            <button onClick={() => setExpanded(v => !v)} style={{ padding: "8px 16px", fontSize: 13, fontFamily: "inherit", background: G.tealLight, color: G.tealDark, border: "none", borderRadius: 10, cursor: "pointer", fontWeight: 600 }}>
              {expanded ? "取消" : "更换班级"}
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: G.blueLight, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>🏫</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: "#111", marginBottom: 2 }}>还未加入班级</div>
              <div style={{ fontSize: 13, color: "#888" }}>输入老师提供的邀请码即可加入</div>
            </div>
            <button onClick={() => setExpanded(v => !v)} style={{ padding: "10px 18px", fontSize: 14, fontFamily: "inherit", background: G.blue, color: "#fff", border: "none", borderRadius: 10, cursor: "pointer", fontWeight: 600 }}>
              {expanded ? "取消" : "加入班级"}
            </button>
          </div>
        )}

        {expanded && (
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid #f0f0f0" }}>
            <div style={{ display: "flex", gap: 10 }}>
              <input
                value={code}
                onChange={e => setCode(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === "Enter" && handleJoin()}
                placeholder="输入班级邀请码（如 MATH2024）"
                style={{ flex: 1, padding: "10px 14px", fontSize: 14, border: "1.5px solid #e0e0e0", borderRadius: 10, fontFamily: "inherit", letterSpacing: "0.06em" }}
              />
              <button onClick={handleJoin} disabled={loading} style={{ padding: "10px 20px", fontSize: 14, fontWeight: 700, fontFamily: "inherit", background: loading ? "#aaa" : G.blue, color: "#fff", border: "none", borderRadius: 10, cursor: loading ? "not-allowed" : "pointer" }}>
                {loading ? "…" : "确认"}
              </button>
            </div>
            {msg && <div style={{ marginTop: 10, fontSize: 13, color: msgType === "ok" ? G.tealDark : G.red }}>{msgType === "ok" ? "✓ " : "✕ "}{msg}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

function HomePage({ setPage, profile }) {
  const [showAISettings, setShowAISettings] = useState(false);
  const aiCfg = getAIConfig();
  const hasUserKey = aiCfg.key.length > 4;
  const providerLabel = { groq: "Groq", gemini: "Gemini", deepseek: "DeepSeek", kimi: "Kimi", custom: "自定义" }[aiCfg.provider] || "Groq";

  const streak = (() => { try { const d = JSON.parse(localStorage.getItem("mc_streak") || "{}"); return d.days || 1; } catch { return 1; } })();
  const badgeStats = getBadgeStats();
  const unlockedIds = new Set(BADGES.filter(b => b.check(badgeStats)).map(b => b.id));

  return (
    <div style={{ maxWidth: 1020, margin: "0 auto", padding: "0 0 60px" }}>
      {showAISettings && <AISettingsModal onClose={() => setShowAISettings(false)} />}

      {/* ───────── HERO ───────── */}
      <div style={{
        background: "linear-gradient(135deg, #0d7a58 0%, #1D9E75 45%, #1565c0 100%)",
        padding: "3.5rem 3rem 3rem",
        position: "relative", overflow: "hidden",
        borderRadius: 28,
      }}>
        {/* decorative */}
        <div style={{ position:"absolute", right:-60, top:-60, width:320, height:320, borderRadius:"50%", background:"rgba(255,255,255,0.04)" }} />
        <div style={{ position:"absolute", right:100, bottom:-80, width:200, height:200, borderRadius:"50%", background:"rgba(255,255,255,0.03)" }} />

        <div style={{ position:"relative", zIndex:1 }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:16 }}>
            <div>
              <div style={{ color:"rgba(255,255,255,0.7)", fontSize:13, fontWeight:600, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:10 }}>
                数学智能学习平台
              </div>
              <div style={{ fontSize:40, fontWeight:900, color:"#fff", letterSpacing:"-1px", lineHeight:1.1, marginBottom:14 }}>
                你好，{profile?.name || "同学"} 👋
              </div>
              <div style={{ fontSize:15, color:"rgba(255,255,255,0.8)", lineHeight:1.7, maxWidth:500 }}>
                两大核心功能：<strong style={{color:"#fff"}}>上传资料 → AI 知识分析</strong>，以及 <strong style={{color:"#fff"}}>制定备考计划 → AI 助教带领复习</strong>
              </div>
            </div>
            <div style={{ display:"flex", gap:10, flexShrink:0 }}>
              <button onClick={() => setShowAISettings(true)} style={{ padding:"10px 18px", fontSize:13, fontWeight:600, fontFamily:"inherit", background: hasUserKey ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.12)", color:"#fff", border:"1.5px solid rgba(255,255,255,0.35)", borderRadius:12, cursor:"pointer", display:"flex", alignItems:"center", gap:7 }}>
                ⚙️ AI 设置
                {hasUserKey && <span style={{ fontSize:11, background:"rgba(255,255,255,0.2)", padding:"2px 8px", borderRadius:8 }}>{providerLabel} ✓</span>}
              </button>
            </div>
          </div>

          {/* Stats pills */}
          <div style={{ display:"flex", gap:10, marginTop:28, flexWrap:"wrap" }}>
            {[
              { icon:"🔥", val: streak + "天", label:"连续学习" },
              { icon:"✏️", val: ALL_QUESTIONS.length + "+", label:"题目总量" },
              { icon:"🏃", val: FLASHCARDS.length, label:"记忆卡片" },
              { icon:"🏅", val: unlockedIds.size + "/" + BADGES.length, label:"徽章解锁" },
            ].map(p => (
              <div key={p.label} style={{ background:"rgba(255,255,255,0.14)", backdropFilter:"blur(8px)", borderRadius:14, padding:"10px 18px", display:"flex", alignItems:"center", gap:8, border:"1px solid rgba(255,255,255,0.2)" }}>
                <span style={{ fontSize:18 }}>{p.icon}</span>
                <div>
                  <div style={{ fontSize:18, fontWeight:800, color:"#fff", lineHeight:1 }}>{p.val}</div>
                  <div style={{ fontSize:11, color:"rgba(255,255,255,0.7)" }}>{p.label}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ───────── TWO CORE WORKFLOW CARDS ───────── */}
      <div style={{ padding:"0 2rem", marginTop:-1 }}>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, marginTop:24, marginBottom:24 }}>

          {/* Card 1: 资料学习 */}
          <div style={{ background:"#fff", borderRadius:24, overflow:"hidden", boxShadow:"0 4px 24px rgba(29,158,117,0.12)", border:"1px solid rgba(29,158,117,0.15)" }}>
            <div style={{ background:"linear-gradient(135deg, #ecfdf5, #d1fae5)", padding:"1.6rem 1.8rem 1.2rem", borderBottom:"1px solid #a7f3d0" }}>
              <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:10 }}>
                <div style={{ width:44, height:44, borderRadius:14, background:G.teal, display:"flex", alignItems:"center", justifyContent:"center", fontSize:22 }}>📚</div>
                <div>
                  <div style={{ fontSize:20, fontWeight:800, color:"#064e3b" }}>资料学习</div>
                  <div style={{ fontSize:12, color:"#065f46", fontWeight:500 }}>Upload → Analyze → Practice</div>
                </div>
              </div>
              <div style={{ fontSize:14, color:"#065f46", lineHeight:1.7 }}>
                上传课件、作业、真题，AI 自动提取知识点结构、生成题库、配套记忆卡片
              </div>
            </div>
            <div style={{ padding:"1rem 1.8rem 1.5rem" }}>
              <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:16 }}>
                {[
                  { icon:"⬆️", text:"上传资料", sub:"支持 PDF、图片、文字", page:"资料库" },
                  { icon:"🧠", text:"AI 知识分析", sub:"自动展开知识点卡片", page:"知识点" },
                  { icon:"✏️", text:"掰对应题库", sub:"AI 为每个知识点出题", page:"题库练习" },
                ].map(item => (
                  <div key={item.text} onClick={() => setPage(item.page)} style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 12px", borderRadius:12, cursor:"pointer", background:"#f8fffe", border:"1px solid #e0faf4", transition:"background .15s" }}
                    onMouseEnter={e => e.currentTarget.style.background="#ecfdf5"}
                    onMouseLeave={e => e.currentTarget.style.background="#f8fffe"}
                  >
                    <span style={{ fontSize:18, width:28, textAlign:"center" }}>{item.icon}</span>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:14, fontWeight:700, color:"#111" }}>{item.text}</div>
                      <div style={{ fontSize:12, color:"#888" }}>{item.sub}</div>
                    </div>
                    <span style={{ color:"#aaa", fontSize:14 }}>›</span>
                  </div>
                ))}
              </div>
              <button onClick={() => setPage("资料库")} style={{ width:"100%", padding:"12px", background:G.teal, color:"#fff", border:"none", borderRadius:14, fontSize:15, fontWeight:700, fontFamily:"inherit", cursor:"pointer" }}>
                开始学习 →
              </button>
            </div>
          </div>

          {/* Card 2: 备考复习 */}
          <div style={{ background:"#fff", borderRadius:24, overflow:"hidden", boxShadow:"0 4px 24px rgba(24,95,165,0.12)", border:"1px solid rgba(24,95,165,0.15)" }}>
            <div style={{ background:"linear-gradient(135deg, #eff6ff, #dbeafe)", padding:"1.6rem 1.8rem 1.2rem", borderBottom:"1px solid #bfdbfe" }}>
              <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:10 }}>
                <div style={{ width:44, height:44, borderRadius:14, background:G.blue, display:"flex", alignItems:"center", justifyContent:"center", fontSize:22 }}>🎯</div>
                <div>
                  <div style={{ fontSize:20, fontWeight:800, color:"#1e3a5f" }}>期末备考</div>
                  <div style={{ fontSize:12, color:"#1e40af", fontWeight:500 }}>Plan → AI Review → Track</div>
                </div>
              </div>
              <div style={{ fontSize:14, color:"#1e3a5f", lineHeight:1.7 }}>
                设定考试日期和范围，生成倍计划，AI 小核逐章引导复习、即时检验、分析薄弱点
              </div>
            </div>
            <div style={{ padding:"1rem 1.8rem 1.5rem" }}>
              <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:16 }}>
                {[
                  { icon:"📅", text:"制定备考计划", sub:"设考试日期指定范围和章节", page:"学习报告" },
                  { icon:"🤖", text:"AI 助教带领复习", sub:"必考/高频项目分级教学", page:"资料对话" },
                  { icon:"❌", text:"错题本强化", sub:"将错题转化为巳掌握的知识点", page:"错题本" },
                ].map(item => (
                  <div key={item.text} onClick={() => setPage(item.page)} style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 12px", borderRadius:12, cursor:"pointer", background:"#f8faff", border:"1px solid #e0eaff", transition:"background .15s" }}
                    onMouseEnter={e => e.currentTarget.style.background="#eff6ff"}
                    onMouseLeave={e => e.currentTarget.style.background="#f8faff"}
                  >
                    <span style={{ fontSize:18, width:28, textAlign:"center" }}>{item.icon}</span>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:14, fontWeight:700, color:"#111" }}>{item.text}</div>
                      <div style={{ fontSize:12, color:"#888" }}>{item.sub}</div>
                    </div>
                    <span style={{ color:"#aaa", fontSize:14 }}>›</span>
                  </div>
                ))}
              </div>
              <button onClick={() => setPage("资料对话")} style={{ width:"100%", padding:"12px", background:G.blue, color:"#fff", border:"none", borderRadius:14, fontSize:15, fontWeight:700, fontFamily:"inherit", cursor:"pointer" }}>
                开始备考 →
              </button>
            </div>
          </div>
        </div>

        {/* ───────── QUICK TOOLS ───────── */}
        <div style={{ marginBottom:24 }}>
          <div style={{ fontSize:12, fontWeight:700, color:"#aaa", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:12 }}>快捷工具</div>
          <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
            {[
              { icon:"🏃", label:"记忆卡片", page:"记忆卡片", color:G.purple, bg:G.purpleLight },
              { icon:"📊", label:"学习报告", page:"学习报告", color:G.amber, bg:G.amberLight },
              { icon:"🌳", label:"技能树", page:"技能树", color:G.teal, bg:G.tealLight },
              { icon:"📚", label:"知识点", page:"知识点", color:G.blue, bg:G.blueLight },
              { icon:"⬆️", label:"上传资料", page:"上传资料", color:"#666", bg:"#f5f5f5" },
            ].map(t => (
              <button key={t.label} onClick={() => setPage(t.page)} style={{ padding:"9px 18px", background:t.bg, color:t.color, border:"1px solid " + t.color + "30", borderRadius:20, fontSize:13, fontWeight:600, fontFamily:"inherit", cursor:"pointer", display:"flex", alignItems:"center", gap:7 }}>
                <span>{t.icon}</span>{t.label}
              </button>
            ))}
          </div>
        </div>

        <JoinClassCard profile={profile} />

        {/* ───────── BADGE GALLERY ───────── */}
        <div style={{ marginTop:28 }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
            <div style={{ fontSize:16, fontWeight:800, color:"#111" }}>🏅 成就墙</div>
            <div style={{ fontSize:12, color:"#bbb" }}>{unlockedIds.size}/{BADGES.length} 已解锁</div>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:10 }}>
            {BADGES.map(b => {
              const unlocked = unlockedIds.has(b.id);
              return (
                <div key={b.id} title={b.desc} style={{
                  background: unlocked ? "linear-gradient(135deg,#fef9c3,#fef08a)" : "#fafafa",
                  border: unlocked ? "2px solid #facc15" : "1.5px solid #eee",
                  borderRadius:18, padding:"16px 8px",
                  display:"flex", flexDirection:"column", alignItems:"center", gap:8,
                  opacity: unlocked ? 1 : 0.45,
                  boxShadow: unlocked ? "0 4px 16px rgba(250,204,21,0.3)" : "none",
                  transition:"all .2s",
                }}>
                  <span style={{ fontSize:26, filter: unlocked ? "none" : "grayscale(1)" }}>{b.emoji}</span>
                  <div style={{ fontSize:12, fontWeight:700, color: unlocked ? "#78350f" : "#999", textAlign:"center", lineHeight:1.3 }}>{b.name}</div>
                  <div style={{ fontSize:10, color: unlocked ? "#92400e" : "#ccc", textAlign:"center", lineHeight:1.4 }}>{b.desc}</div>
                  {unlocked && <div style={{ fontSize:9, background:"#22c55e", color:"#fff", padding:"2px 8px", borderRadius:20, fontWeight:700 }}>已解锁 ✓</div>}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function KnowledgePage({ setPage, setChapterFilter }) {
  const [materials, setMaterials] = useState([]);
  const [selectedMaterialId, setSelectedMaterialId] = useState(null);
  const [aiTopics, setAiTopics] = useState([]);
  const [topicMastery, setTopicMastery] = useState({});

  const reloadKnowledge = useCallback(async () => {
    const mRes = await supabase.from("materials").select("id,title,course,chapter,created_at").order("created_at", { ascending: false }).limit(80);
    const list = mRes.data || [];
    setMaterials(list);
    setSelectedMaterialId((prev) => {
      if (prev && list.some((m) => m.id === prev)) return prev;
      return list.length > 0 ? list[0].id : null;
    });

    const tRes = await supabase.from("questions") /* material_topics stub */.select("*").order("created_at", { ascending: false }).limit(500);
    setAiTopics(tRes.data || []);

    const uid = (await supabase.auth.getUser())?.data?.user?.id;
    if (!uid) return;
    const { data: mdata } = await supabase
      .from("questions" /* topic_mastery removed */)
      .select("topic_id,status,correct_count,wrong_count")
      .eq("user_id", uid);
    const map = {};
    (mdata || []).forEach((r) => { map[r.topic_id] = r; });
    setTopicMastery(map);
  }, []);

  useEffect(() => {
    reloadKnowledge();
    const onVis = () => {
      if (document.visibilityState === "visible") reloadKnowledge();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [reloadKnowledge]);

  const markTopicMastery = async (topic, status) => {
    const uid = (await supabase.auth.getUser())?.data?.user?.id;
    if (!uid || !topic?.id) return;
    await supabase.from("questions") /* topic_mastery stub */.upsert({
      user_id: uid,
      topic_id: topic.id,
      status,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,topic_id" });
    setTopicMastery((prev) => {
      const next = { ...prev, [topic.id]: { ...(prev[topic.id] || {}), status } };
      const toast = document.createElement('div');
      if (status === 'done') {
        toast.style.cssText = 'position:fixed;top:20px;right:20px;z-index:9999;background:linear-gradient(135deg,#1D9E75,#0a7a5a);color:#fff;padding:14px 24px;border-radius:16px;font-size:14px;font-weight:700;box-shadow:0 8px 32px rgba(29,158,117,0.4);animation:popIn 0.3s ease;font-family:system-ui,sans-serif;display:flex;align-items:center;gap:10px';
        toast.innerHTML = '<span style="font-size:22px">🎉</span><div><div>知识点已掌握！</div><div style="font-size:11px;opacity:0.85;margin-top:2px">太棒了，继续前进💪</div></div>';
      } else {
        toast.style.cssText = 'position:fixed;top:20px;right:20px;z-index:9999;background:#555;color:#fff;padding:12px 20px;border-radius:14px;font-size:13px;font-family:system-ui,sans-serif';
        toast.textContent = '已重置，加油！';
      }
      document.body.appendChild(toast);
      setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.4s'; setTimeout(() => toast.remove(), 400); }, 2200);
      return next;
    });
  };

  const [selectedTopic, setSelectedTopic] = useState(null);
  const [selectedTopicMeta, setSelectedTopicMeta] = useState(null);

  const openTopic = (t, mat) => {
    setSelectedTopic(t.name);
    setSelectedTopicMeta({ chapterNum: t.chapterNum, course: mat?.course });
  };

  const selectedMaterial = materials.find((m) => m.id === selectedMaterialId) || null;

  // Build course knowledge points from hardcoded CHAPTERS + KNOWLEDGE_CONTENT
  const courseTopics = selectedMaterial
    ? CHAPTERS.filter(ch => ch.course === selectedMaterial.course)
        .flatMap(ch =>
          ch.topics.map(topicName => ({
            id: `${ch.num}__${topicName}`,
            name: topicName,
            chapterNum: ch.num,
            chapterName: ch.name,
            hasDetail: !!KNOWLEDGE_CONTENT[topicName],
            intro: KNOWLEDGE_CONTENT[topicName]?.intro || null,
          }))
        )
    : [];

  // AI-extracted topics from DB (for future use when AI extraction works)
  const aiTopicsForMaterial = aiTopics.filter((t) => t.material_id === selectedMaterialId);

  const totalTopicCount = courseTopics.length + aiTopicsForMaterial.length;

  return (
    <>
      {selectedTopic && (
        <TopicModal
          topic={selectedTopic}
          onClose={() => { setSelectedTopic(null); setSelectedTopicMeta(null); }}
          setPage={setPage}
          setChapterFilter={setChapterFilter}
          chapterNum={selectedTopicMeta?.chapterNum}
          course={selectedTopicMeta?.course}
        />
      )}
      <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 16, padding: "2rem", maxWidth: 1200, margin: "0 auto" }}>
        <div style={{ ...s.card, padding: "1rem 0", height: "fit-content" }}>
          <div style={{ padding: "8px 14px 12px", borderBottom: "1px solid #f0f0f0", marginBottom: 8 }}>
            <div style={{ fontSize: 13, color: "#666", fontWeight: 700 }}>资料知识库</div>
            <div style={{ fontSize: 12, color: "#999", marginTop: 4 }}>点击资料查看对应课程知识点</div>
          </div>
          {materials.map((m) => {
            const active = selectedMaterialId === m.id;
            const cnt = CHAPTERS.filter(ch => ch.course === m.course).flatMap(ch => ch.topics).length;
            return (
              <div
                key={m.id}
                onClick={() => setSelectedMaterialId(m.id)}
                style={{
                  padding: "10px 14px",
                  cursor: "pointer",
                  borderLeft: `3px solid ${active ? getCourseBorderColor(m.course) : "transparent"}`,
                  background: active ? G.tealLight : "transparent",
                }}
              >
                <div style={{ fontSize: 14, fontWeight: active ? 700 : 500, color: active ? G.tealDark : "#222" }}>{m.title}</div>
                <div style={{ fontSize: 11, color: "#888", marginTop: 3 }}>
                  {m.course || "未分类"} · {cnt > 0 ? `${cnt} 个知识点` : "暂无"}
                </div>
              </div>
            );
          })}
          {materials.length === 0 && <div style={{ padding: "12px 14px", color: "#999", fontSize: 13 }}>暂无资料，请先上传 PDF</div>}
        </div>

        <div style={{ ...s.card }}>
          {/* Header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, paddingBottom: 16, borderBottom: "1px solid #f3f4f6" }}>
            <div>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#0f172a", lineHeight: 1.3 }}>{selectedMaterial?.title || "请选择资料"}</div>
              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
                {selectedMaterial?.course && (
                  <span style={{ background: ({"数值分析":G.tealLight,"最优化":G.purpleLight,"线性代数":G.blueLight,"概率论":G.amberLight,"数理统计":G.redLight,"ODE":"#f3e8ff"})[selectedMaterial.course]||G.tealLight, color: ({"数值分析":G.tealDark,"最优化":G.purple,"线性代数":G.blue,"概率论":G.amber,"数理统计":G.red,"ODE":"#7c3aed"})[selectedMaterial.course]||G.tealDark, fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 20 }}>{selectedMaterial.course}</span>
                )}
                <span style={{ fontSize: 12, color: "#6b7280", fontWeight: 600 }}>{totalTopicCount} 个知识点</span>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
              <Btn size="sm" onClick={() => reloadKnowledge()}>刷新</Btn>
              <Btn size="sm" onClick={() => setPage("上传资料")}>上传新资料</Btn>
              <Btn size="sm" variant="primary" onClick={() => { if (!selectedMaterial) return; setPage("quiz_material_" + selectedMaterial.id + "_" + encodeURIComponent(selectedMaterial.title || "")); }} disabled={!selectedMaterial}>
                进入该资料练习 →
              </Btn>
            </div>
          </div>

          {/* Knowledge topic cards grouped by chapter */}
          {courseTopics.length > 0 ? (
            CHAPTERS.filter(ch => ch.course === selectedMaterial?.course).map(ch => {
              const chTopics = courseTopics.filter(t => t.chapterNum === ch.num);
              if (chTopics.length === 0) return null;
              const chColor = ({"数值分析":G.teal,"最优化":G.purple,"线性代数":G.blue,"概率论":G.amber,"数理统计":G.red,"ODE":"#7c3aed"})[selectedMaterial?.course] || G.teal;
              return (
                <div key={ch.num} style={{ marginBottom: 28 }}>
                  {/* Chapter header */}
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
                      <span style={{ background: chColor, color: "#fff", borderRadius: 8, padding: "4px 10px", fontSize: 11, fontWeight: 800, letterSpacing: "0.06em" }}>{ch.num}</span>
                      <span style={{ fontSize: 14, fontWeight: 700, color: "#374151" }}>{ch.name}</span>
                      <span style={{ fontSize: 12, color: "#9ca3af" }}>{chTopics.length} 个知识点</span>
                    </div>
                    <div style={{ flex: 1, height: 1, background: "#f3f4f6" }} />
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(258px, 1fr))", gap: 12 }}>
                    {chTopics.map(t => {
                      const mastery = topicMastery[t.id]?.status || "todo";
                      const chapterStr = (selectedMaterial?.course && selectedMaterial.course !== "数值分析")
                        ? `${selectedMaterial.course} ${t.chapterNum}` : t.chapterNum;
                      const hasContent = !!t.intro;
                      return (
                        <div
                          key={t.id}
                          onClick={() => openTopic(t, selectedMaterial)}
                          style={{ border: `1.5px solid ${mastery === "done" ? G.teal + "55" : "#e5e7eb"}`, borderRadius: 14, padding: "16px", background: mastery === "done" ? "#f0fdf4" : "#fff", display: "flex", flexDirection: "column", gap: 10, cursor: "pointer", transition: "all 0.15s ease", position: "relative" }}
                          onMouseEnter={e => { e.currentTarget.style.boxShadow = `0 6px 20px ${chColor}22`; e.currentTarget.style.borderColor = chColor + "66"; e.currentTarget.style.transform = "translateY(-2px)"; }}
                          onMouseLeave={e => { e.currentTarget.style.boxShadow = "none"; e.currentTarget.style.borderColor = mastery === "done" ? G.teal + "55" : "#e5e7eb"; e.currentTarget.style.transform = "none"; }}
                        >
                          {/* Top: title + mastery badge */}
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                            <div style={{ fontSize: 14, fontWeight: 700, color: "#111827", lineHeight: 1.45, flex: 1 }}>{t.name}</div>
                            {mastery === "done" && (
                              <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, color: G.tealDark, background: G.tealLight, padding: "2px 7px", borderRadius: 20, whiteSpace: "nowrap", marginTop: 2 }}>已掌握 ✓</span>
                            )}
                          </div>

                          {/* Intro preview */}
                          <div style={{ fontSize: 12.5, color: hasContent ? "#4b5563" : "#9ca3af", lineHeight: 1.65, fontStyle: hasContent ? "normal" : "italic", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", minHeight: 40 }}>
                            {hasContent ? t.intro : "点击查看知识点详细内容 →"}
                          </div>

                          {/* Indicators */}
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            {hasContent && <span style={{ fontSize: 10, color: G.tealDark, background: G.tealLight, padding: "2px 7px", borderRadius: 20, fontWeight: 600 }}>📖 含讲解</span>}
                            {t.intro && KNOWLEDGE_CONTENT[t.name]?.examples?.length > 0 && <span style={{ fontSize: 10, color: "#065f46", background: "#d1fae5", padding: "2px 7px", borderRadius: 20, fontWeight: 600 }}>✏️ {KNOWLEDGE_CONTENT[t.name].examples.length} 道例题</span>}
                            {t.intro && KNOWLEDGE_CONTENT[t.name]?.viz && <span style={{ fontSize: 10, color: G.amber, background: G.amberLight, padding: "2px 7px", borderRadius: 20, fontWeight: 600 }}>🎨 可视化</span>}
                          </div>

                          {/* Action row */}
                          <div style={{ display: "flex", gap: 7, marginTop: 2 }} onClick={e => e.stopPropagation()}>
                            <button onClick={() => openTopic(t, selectedMaterial)}
                              style={{ flex: 1, padding: "7px 0", fontSize: 12, fontWeight: 700, background: chColor, color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", whiteSpace: "nowrap" }}>
                              📖 查看内容
                            </button>
                            <button onClick={() => { setChapterFilter(chapterStr); setPage("题库练习"); }}
                              style={{ flex: 1, padding: "7px 0", fontSize: 12, fontWeight: 600, background: "#f0f9ff", color: G.blue, border: `1.5px solid ${G.blue}33`, borderRadius: 8, cursor: "pointer", whiteSpace: "nowrap" }}>
                              ✏️ 练习题目
                            </button>
                            <button onClick={() => markTopicMastery(t, mastery === "done" ? "todo" : "done")}
                              title={mastery === "done" ? "取消掌握" : "标记已掌握"}
                              style={{ padding: "7px 10px", fontSize: 15, background: mastery === "done" ? G.tealLight : "#f9fafb", border: `1.5px solid ${mastery === "done" ? G.teal : "#e5e7eb"}`, borderRadius: 8, cursor: "pointer", lineHeight: 1 }}>
                              {mastery === "done" ? "✅" : "☆"}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          ) : (
            <div style={{ padding: "3rem 2rem", textAlign: "center", border: "2px dashed #e5e7eb", borderRadius: 16 }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>📚</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
                {selectedMaterial ? `「${selectedMaterial.course}」课程暂无配置知识点` : "请在左侧选择资料"}
              </div>
              <div style={{ fontSize: 13, color: "#9ca3af" }}>选择左侧资料开始学习</div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ── Quiz Page ─────────────────────────────────────────────────────────────────
function QuizPage({ setPage, initialQuestion = null, chapterFilter = null, setChapterFilter, onAnswer, materialId = null, materialTitle = null }) {
  const [allQuestions, setAllQuestions] = useState([]);
  const [loading, setLoading] = useState(true);
  // Setup state (moved to top - never in conditional)
  const [selectedChapters, setSelectedChapters] = useState(chapterFilter ? [chapterFilter] : []);
  const [selectedTypes, setSelectedTypes] = useState([]);
  const [quizCount, setQuizCount] = useState(10);
  const [timerOn, setTimerOn] = useState(false);
  // Quiz state
  const [quizMode, setQuizMode] = useState(null);
  const [displayQ, setDisplayQ] = useState([]);
  const [current, setCurrent] = useState(0);
  const [selected, setSelected] = useState(null);
  const [answered, setAnswered] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [score, setScore] = useState(0);
  const [wrongList, setWrongList] = useState([]);
  const [finished, setFinished] = useState(false);
  const [timer, setTimer] = useState(0);
  const [correctStreak, setCorrectStreak] = useState(0);
  const [showWin, setShowWin] = useState(false);
  const sessionStartRef = useRef(Date.now());
  const [materialFilterFallback, setMaterialFilterFallback] = useState(false);
  const [materialGenerating, setMaterialGenerating] = useState(false);
  const [materialGenerateMsg, setMaterialGenerateMsg] = useState("");
  const autoGenTriedRef = useRef(false);
  const timerRef = useRef(null);

  const tryGenerateQuestionsForMaterial = async (mid) => {
    if (!mid) return { ok: false, inserted: 0 };
    setMaterialGenerating(true);
    setMaterialGenerateMsg("正在为该资料生成题目（约 10-20 秒）…");
    try {
      const { data: material, error: matErr } = await supabase
        .from("materials")
        .select("id,title,course,chapter,description,file_name,file_data")
        .eq("id", mid)
        .single();
      if (matErr || !material) throw new Error(matErr?.message || "未找到资料");
      const fetchedFile = material?.file_data ? await fetchFileAsBrowserFile(material.file_data, material.file_name || "material.pdf") : null;
      const result = await processMaterialWithAI({
        material,
        file: fetchedFile,
        fallbackText: `${material.title || ""} ${material.description || ""}`,
        genCount: 8,
        actorName: "系统自动补题",
      });
      const inserted = result?.insertedCount ?? result?.questions?.length ?? 0;
      const hint = (!fetchedFile && [".doc", ".docx", ".ppt", ".pptx"].includes(getFileExt(material?.file_name || "")))
        ? "（当前建议优先上传 PDF，DOCX/PPTX 容易提取失败）"
        : "";
      if (result?.apiQuotaExceeded) {
        setMaterialGenerateMsg(`⚠️ ${result.apiErrorMsg || "Gemini API 配额暂时用完，请等待 1 分钟后再点击补题。"}`);
      } else {
        const diagHint = result?.textDiag?.hint ? ` | ${result.textDiag.hint}` : (result?.parseHint ? ` ${result.parseHint}` : "");
        setMaterialGenerateMsg(inserted > 0 ? `已为该资料补充 ${inserted} 道题。${diagHint}` : `补题完成，但未新增题目。${hint}${diagHint}`);
      }
      return { ok: inserted > 0, inserted };
    } catch (e) {
      setMaterialGenerateMsg("补题失败：" + (e?.message || "未知错误"));
      return { ok: false, inserted: 0 };
    } finally {
      setMaterialGenerating(false);
    }
  };

  useEffect(() => {
    const loadQuestions = async () => {
      let dbQs = [];
      if (materialId) {
        const byMaterial = await supabase.from("questions").select("*").eq("material_id", materialId);
        if (byMaterial.error && isMissingQuestionsMaterialIdColumn(byMaterial.error)) {
          setMaterialFilterFallback(true);
          const fallback = await supabase.from("questions").select("*").order("created_at", { ascending: false }).limit(80);
          dbQs = fallback.data || [];
        } else {
          dbQs = byMaterial.data || [];
        }
      } else {
        const normal = await supabase.from("questions").select("*");
        dbQs = normal.data || [];
      }
      let pool;
      if (materialId) {
        // Only questions from this material (no sample questions mixed in)
        pool = dbQs;
      } else {
        const dbTexts = new Set(dbQs.map(q => q.question));
        const uniqueSamples = ALL_QUESTIONS.filter(q => !dbTexts.has(q.question));
        pool = [...dbQs, ...uniqueSamples];
      }
      if (initialQuestion && !materialId) {
        const rest = pool.filter(q => q.id !== initialQuestion.id).sort(() => Math.random() - 0.5);
        pool = [initialQuestion, ...rest];
      }
      if (materialId && pool.length === 0 && !autoGenTriedRef.current) {
        autoGenTriedRef.current = true;
        const regen = await tryGenerateQuestionsForMaterial(materialId);
        if (regen.ok) {
          // Re-query once after generation
          const retry = await supabase.from("questions").select("*").eq("material_id", materialId);
          pool = retry.data || [];
          if (pool.length === 0 && materialFilterFallback) {
            const fallbackRetry = await supabase.from("questions").select("*").order("created_at", { ascending: false }).limit(80);
            pool = fallbackRetry.data || [];
          }
        }
      }
      pool = pool.filter((q) => !isLowQualityQuestion(q));
      setAllQuestions(pool.sort(() => Math.random() - 0.5));
      setLoading(false);
    };
    loadQuestions();
  }, [materialId]);

  useEffect(() => {
    if (timerOn && quizMode && !finished) {
      timerRef.current = setInterval(() => setTimer(t => t + 1), 1000);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [timerOn, quizMode, finished]);

  useEffect(() => { setTimer(0); }, [current]);

  const allChapters = [...new Set(allQuestions.map(q => q.chapter).filter(Boolean))].sort((a, b) => {
    // Sort chapters numerically: Ch.1, Ch.2, ..., Ch.10
    const numA = parseInt((a.match(/\d+/) || [0])[0]);
    const numB = parseInt((b.match(/\d+/) || [0])[0]);
    if (numA !== numB) return numA - numB;
    return a.localeCompare(b, 'zh');
  });
  const toggleChapter = (ch) => setSelectedChapters(prev =>
    prev.includes(ch) ? prev.filter(x => x !== ch) : [...prev, ch]
  );
  const toggleType = (t) => setSelectedTypes(prev =>
    prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]
  );

  const buildPool = (chapters, types) => {
    let pool = allQuestions;
    if (chapters.length > 0) pool = pool.filter(q => {
      if (!q.chapter) return false;
      const qch = q.chapter.trim();
      return chapters.some(c => {
        const cTrim = c.trim();
        // 1. Exact match
        if (qch === cTrim) return true;
        // 2. "Ch.1 方程求解" matches filter "Ch.1" (space or end after number)
        if (qch.startsWith(cTrim + " ") || qch.startsWith(cTrim + "·") || qch.startsWith(cTrim + "-")) return true;
        // 3. Course-prefixed: "线性代数 Ch.2" filter "线性代数 Ch.2"
        // NO bare startsWith(c) — that would match Ch.1→Ch.10,Ch.11 etc.
        return false;
      });
    });
    if (types.length > 0) pool = pool.filter(q => types.includes(q.type));
    return pool;
  };
  const previewPool = buildPool(selectedChapters, selectedTypes);

  const startQuiz = (chapters, types, count) => {
    const pool = buildPool(chapters, types);
    setDisplayQ(pool.slice(0, count));
    setQuizMode("active");
    setCurrent(0); setSelected(null); setAnswered(false);
    setScore(0); setWrongList([]); setFinished(false); setTimer(0);
  };

  const q = displayQ[current];
  const opts = q?.options ? (typeof q.options === "string" ? JSON.parse(q.options) : q.options) : null;
  const letters = ["A", "B", "C", "D"];

  const handleSubmit = () => {
    if (selected === null) return;
    setAnswered(true);
    const correct = opts
      ? letters[selected] === q.answer
      : (selected === 0 && q.answer === "正确") || (selected === 1 && q.answer === "错误");
    if (correct) {
      setScore(s => s + 1);
      setCorrectStreak(s => {
        const next = s + 1;
        if (next === 3 || next === 5 || next % 5 === 0) {
          setShowWin(true);
          setTimeout(() => setShowWin(false), 2200);
        }
        return next;
      });
    } else {
      setCorrectStreak(0);
      setWrongList(w => [...w, q]);
    }
    if (onAnswer && q) onAnswer(q.id || q.question, correct, q.chapter || "Unknown", q);
  };

  const handleNext = () => {
    if (current >= displayQ.length - 1) {
      setFinished(true);
      // Record study time
      const seconds = Math.round((Date.now() - sessionStartRef.current) / 1000);
      recordStudyTime(seconds);
      // Record session for badge checks
      try {
        const sessions = JSON.parse(localStorage.getItem("mc_sessions") || "[]");
        const curScore = displayQ.filter((_, qi) => qi < current).length; // approx
        sessions.push({ correct: score, total: displayQ.length, ts: Date.now() });
        localStorage.setItem("mc_sessions", JSON.stringify(sessions.slice(-20)));
        if (score === displayQ.length) localStorage.setItem("mc_had_perfect", "true");
      } catch {}
      return;
    }
    setCurrent(c => c + 1); setSelected(null); setAnswered(false); setShowHint(false);
  };
  // Reset streak on quiz restart
  const handleRestartQuiz = () => {
    setCorrectStreak(0); setShowWin(false); setFinished(false);
    setCurrent(0); setSelected(null); setAnswered(false); setScore(0); setWrongList([]);
  };

  // Keyboard shortcuts
  useEffect(() => {
    if (quizMode !== "active" || finished || !q) return;
    const handler = (e) => {
      if (answered) { if (e.key === "Enter" || e.key === "ArrowRight") handleNext(); return; }
      if (e.key === "1") setSelected(0);
      if (e.key === "2") setSelected(1);
      if (e.key === "3") setSelected(2);
      if (e.key === "4") setSelected(3);
      if (e.key === "Enter") handleSubmit();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [quizMode, finished, q, answered, selected]);


  {/* Micro-win celebration overlay */}
  {showWin && (
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, pointerEvents: "none" }}>
      <div style={{ background: "linear-gradient(135deg,#10b981,#059669)", color: "#fff", borderRadius: 24, padding: "28px 48px", textAlign: "center", boxShadow: "0 20px 60px rgba(0,0,0,0.25)", animation: "popIn 0.3s ease" }}>
        <div style={{ fontSize: 56, marginBottom: 8 }}>{correctStreak >= 5 ? "🔥" : "⭐"}</div>
        <div style={{ fontSize: 22, fontWeight: 900, marginBottom: 4 }}>
          {correctStreak >= 5 ? "连续 " + correctStreak + " 题全对！" : "连续三题全对！"}
        </div>
        <div style={{ fontSize: 14, opacity: 0.9 }}>{correctStreak >= 5 ? "你真的太厉害了！🏆" : "棒极了，继续保持！💪"}</div>
      </div>
    </div>
  )}
  if (loading) return <div style={{ padding: "4rem", textAlign: "center", color: "#888" }}>加载题目中…</div>;

  // ── Setup screen ──
  if (!quizMode) return (
    <div style={{ padding: "2rem", maxWidth: 780, margin: "0 auto" }}>
      <Btn size="sm" onClick={() => setPage("首页")} style={{ marginBottom: 20 }}>← 返回</Btn>
      <div style={{ ...s.card, padding: "2rem" }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: "#111", marginBottom: 4 }}>✏️ 练习设置</div>
        {materialId ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: G.blueLight, borderRadius: 10, marginBottom: 20, border: "1.5px solid " + G.blue + "44" }}>
            <div style={{ fontSize: 20 }}>📄</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: G.blue }}>基于资料出题模式</div>
              <div style={{ fontSize: 13, color: G.blue + "cc" }}>{materialTitle} · {allQuestions.length} 道相关题目</div>
            </div>
            <button onClick={() => setPage("资料库")} style={{ marginLeft: "auto", padding: "6px 12px", background: "transparent", color: G.blue, border: "1.5px solid " + G.blue + "44", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "inherit" }}>← 返回资料库</button>
          </div>
        ) : (
          <div style={{ fontSize: 14, color: "#888", marginBottom: 24 }}>自定义范围，精准刷题</div>
        )}
        {materialId && materialFilterFallback && (
          <div style={{ marginBottom: 14, padding: "10px 12px", borderRadius: 10, background: G.amberLight, color: G.amber, fontSize: 13 }}>
            检测到数据库缺少 `questions.material_id`，当前使用“全题库回退模式”。执行 SQL 补齐后可按资料精准出题。
          </div>
        )}
        {materialId && materialGenerateMsg && (
          <div style={{ marginBottom: 14, padding: "10px 12px", borderRadius: 10, background: G.blueLight, color: G.blue, fontSize: 13 }}>
            {materialGenerateMsg}
          </div>
        )}

        {/* Quick start */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 24 }}>
          {[
            { icon: "⚡", label: "每日 5 题", color: G.blue, bg: "#EEF4FF", action: () => startQuiz([], [], 5) },
            { icon: "📚", label: "全部 " + allQuestions.length + " 题", color: G.teal, bg: G.tealLight, action: () => startQuiz([], [], allQuestions.length) },
            { icon: "🎯", label: "自定义范围", color: G.purple, bg: G.purpleLight, action: null },
          ].map(m => (
            <div key={m.label} onClick={m.action || undefined} style={{ border: "2px solid " + m.color + "44", borderRadius: 14, padding: "1.25rem", cursor: m.action ? "pointer" : "default", textAlign: "center", background: m.bg, opacity: m.action ? 1 : 0.6 }}>
              <div style={{ fontSize: 24, marginBottom: 6 }}>{m.icon}</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: m.color }}>{m.label}</div>
            </div>
          ))}
        </div>

        {/* Chapter selection */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#111", marginBottom: 10 }}>📖 章节范围</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => setSelectedChapters([])} style={{ padding: "7px 14px", borderRadius: 20, border: "2px solid " + (selectedChapters.length === 0 ? G.teal : "#e0e0e0"), cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: selectedChapters.length === 0 ? 700 : 400, background: selectedChapters.length === 0 ? G.teal : "#fff", color: selectedChapters.length === 0 ? "#fff" : "#555" }}>全部</button>
            {allChapters.map(ch => (
              <button key={ch} onClick={() => toggleChapter(ch)} style={{ padding: "7px 14px", borderRadius: 20, border: "2px solid " + (selectedChapters.includes(ch) ? G.teal : "#e0e0e0"), cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: selectedChapters.includes(ch) ? 700 : 400, background: selectedChapters.includes(ch) ? G.tealLight : "#fff", color: selectedChapters.includes(ch) ? G.tealDark : "#555" }}>{ch}</button>
            ))}
          </div>
        </div>

        {/* Type selection */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#111", marginBottom: 10 }}>📝 题型</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => setSelectedTypes([])} style={{ padding: "7px 14px", borderRadius: 20, border: "2px solid " + (selectedTypes.length === 0 ? G.blue : "#e0e0e0"), cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: selectedTypes.length === 0 ? 700 : 400, background: selectedTypes.length === 0 ? G.blue : "#fff", color: selectedTypes.length === 0 ? "#fff" : "#555" }}>全部</button>
            {["单选题", "判断题", "多选题", "填空题"].map(t => (
              <button key={t} onClick={() => toggleType(t)} style={{ padding: "7px 14px", borderRadius: 20, border: "2px solid " + (selectedTypes.includes(t) ? G.blue : "#e0e0e0"), cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: selectedTypes.includes(t) ? 700 : 400, background: selectedTypes.includes(t) ? G.blueLight : "#fff", color: selectedTypes.includes(t) ? G.blue : "#555" }}>{t}</button>
            ))}
          </div>
        </div>

        {/* Count slider */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: "#111" }}>🔢 题目数量</span>
            <span style={{ fontSize: 15, fontWeight: 700, color: G.teal }}>{Math.min(quizCount, previewPool.length)} 题（共 {previewPool.length} 可用）</span>
          </div>
          {(() => {
            const sliderMax = Math.max(previewPool.length || 1, 1);
            const t1 = Math.round(sliderMax * 0.25);
            const t2 = Math.round(sliderMax * 0.5);
            const t3 = Math.round(sliderMax * 0.75);
            return (
              <>
                <input type="range" min={1} max={sliderMax} value={Math.min(quizCount, sliderMax)} onChange={e => setQuizCount(Number(e.target.value))} style={{ width: "100%", accentColor: G.teal }} />
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#aaa", marginTop: 4 }}>
                  <span>1</span><span>{t1}</span><span>{t2}</span><span>{t3}</span><span>{sliderMax}</span>
                </div>
              </>
            );
          })()}
        </div>

        {/* Timer toggle */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", background: "#f9f9f9", borderRadius: 12, marginBottom: 20 }}>
          <span style={{ fontSize: 14, color: "#888", flex: 1 }}>⏱ 计时模式</span>
          <div onClick={() => setTimerOn(v => !v)} style={{ width: 44, height: 24, borderRadius: 12, background: timerOn ? G.teal : "#ddd", cursor: "pointer", position: "relative", transition: "background .2s" }}>
            <div style={{ position: "absolute", top: 3, left: timerOn ? 22 : 3, width: 18, height: 18, borderRadius: "50%", background: "#fff", transition: "left .2s" }} />
          </div>
          <span style={{ fontSize: 13, color: "#aaa", minWidth: 60 }}>{timerOn ? "已开启" : "已关闭"}</span>
        </div>

        {materialId && allQuestions.length === 0 ? (
          <div style={{ textAlign: "center", padding: "2rem", background: G.amberLight, borderRadius: 12, marginBottom: 16 }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>📭</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: G.amber, marginBottom: 6 }}>该资料暂无关联题目</div>
            <div style={{ fontSize: 14, color: "#888", marginBottom: 16 }}>此资料上传时未自动生成题目，或题目数量为 0</div>
            <div style={{ display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap" }}>
              <button
                onClick={async () => {
                  const regen = await tryGenerateQuestionsForMaterial(materialId);
                  if (regen.ok) {
                    const retry = await supabase.from("questions").select("*").eq("material_id", materialId);
                    setAllQuestions((retry.data || []).sort(() => Math.random() - 0.5));
                  }
                }}
                disabled={materialGenerating}
                style={{ padding: "10px 22px", background: G.teal, color: "#fff", border: "none", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 600, fontFamily: "inherit" }}
              >
                {materialGenerating ? "正在补题…" : "一键补题"}
              </button>
              <button onClick={() => setPage("上传资料")} style={{ padding: "10px 22px", background: G.amber, color: "#fff", border: "none", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 600, fontFamily: "inherit" }}>重新上传并出题 →</button>
            </div>
          </div>
        ) : (
          <button disabled={previewPool.length === 0} onClick={() => startQuiz(selectedChapters, selectedTypes, quizCount)} style={{ width: "100%", padding: "14px 0", fontSize: 16, fontWeight: 700, fontFamily: "inherit", background: previewPool.length === 0 ? "#ccc" : G.teal, color: "#fff", border: "none", borderRadius: 12, cursor: previewPool.length === 0 ? "not-allowed" : "pointer" }}>
            {previewPool.length === 0 ? "无可用题目" : "开始练习 →"}
          </button>
        )}
        <div style={{ fontSize: 12, color: "#aaa", textAlign: "center", marginTop: 10 }}>⌨️ 键盘：1-4 选择 · Enter 提交/下一题</div>
      </div>
    </div>
  );

  // ── Finished screen ──
  if (finished) {
    const pct = displayQ.length ? Math.round(score / displayQ.length * 100) : 0;
    const cwrong = {};
    wrongList.forEach(w => { cwrong[w.chapter] = (cwrong[w.chapter] || 0) + 1; });
    return (
      <div style={{ padding: "2rem", maxWidth: 700, margin: "0 auto" }}>
        <div style={{ ...s.card, padding: "2.5rem" }}>
          <div style={{ textAlign: "center", marginBottom: 24 }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>{pct >= 80 ? "🎉" : pct >= 60 ? "👍" : "💪"}</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: "#111", marginBottom: 6 }}>练习完成！</div>
            <div style={{ fontSize: 52, fontWeight: 800, color: pct >= 80 ? G.teal : pct >= 60 ? G.amber : G.red }}>{pct}%</div>
            <div style={{ fontSize: 15, color: "#888", margin: "6px 0 12px" }}>答对 {score} / {displayQ.length} 题</div>
            {timerOn && timer > 0 && <div style={{ fontSize: 14, color: "#aaa", marginBottom: 12 }}>⏱ 用时 {Math.floor(timer/60)}分{timer%60}秒 · 平均 {Math.round(timer/displayQ.length)} 秒/题</div>}
            <ProgressBar value={score} max={displayQ.length} color={pct >= 80 ? G.teal : pct >= 60 ? G.amber : G.red} height={10} />
          </div>
          {wrongList.length > 0 && (
            <div style={{ borderTop: "1px solid #f0f0f0", paddingTop: 20 }}>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>⚠️ 本次答错</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
                {Object.entries(cwrong).map(([ch, cnt]) => (
                  <div key={ch} style={{ background: G.redLight, borderRadius: 10, padding: "8px 14px", fontSize: 14 }}>
                    <span style={{ color: G.red }}>{ch}</span> <strong style={{ color: G.red }}>×{cnt}</strong>
                  </div>
                ))}
              </div>
              {wrongList.map((w, i) => (
                <div key={i} style={{ padding: "12px 14px", background: "#fafafa", borderRadius: 10, marginBottom: 8, fontSize: 14 }}>
                  <div style={{ color: "#111", marginBottom: 4 }}>{w.question}</div>
                  <div style={{ color: G.tealDark, fontSize: 13 }}>✓ {w.answer} · {w.explanation}</div>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 20 }}>
            <Btn onClick={() => { setQuizMode(null); setFinished(false); }}>再练一次</Btn>
            <Btn variant="primary" onClick={() => setPage("学习报告")}>查看报告</Btn>
          </div>
        </div>
      </div>
    );
  }

  if (!q) return null;

  // ── Quiz screen ──
  return (
    <div style={{ padding: "2rem", maxWidth: 820, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
        <Btn size="sm" onClick={() => { setQuizMode(null); setFinished(false); }}>← 返回</Btn>
        <div style={{ ...s.card, flex: 1, padding: "12px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>第 {current + 1} / {displayQ.length} 题</div>
            <div style={{ fontSize: 13, color: "#888", marginTop: 2 }}>{q.chapter} · {q.type}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {timerOn && <div style={{ fontSize: 14, color: "#888", background: "#f5f5f5", padding: "4px 12px", borderRadius: 20 }}>⏱ {String(Math.floor(timer/60)).padStart(2,"0")}:{String(timer%60).padStart(2,"0")}</div>}
            <span style={{ fontSize: 14, color: "#666" }}>得分 <strong style={{ color: G.teal, fontSize: 18 }}>{score}</strong>/{current}</span>
            <div style={{ width: 100, height: 6, background: "#f0f0f0", borderRadius: 3 }}>
              <div style={{ height: 6, background: G.teal, borderRadius: 3, width: ((current+1)/displayQ.length*100)+"%" }} />
            </div>
          </div>
        </div>
      </div>
      <div style={{ fontSize: 12, color: "#ccc", textAlign: "right", marginBottom: 6 }}>⌨️ 1-4 选择 · Enter 提交</div>
      <div style={{ ...s.card, marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <Badge color="blue">{q.type}</Badge>
          <Badge color="amber">{q.chapter}</Badge>
        </div>
        <div style={{ fontSize: 18, color: "#111", lineHeight: 1.75, marginBottom: 22 }}>{q.question}</div>
        {opts && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {opts.map((opt, i) => {
              let border = "2px solid #eee", bg = "#fafafa", col = "#333";
              if (answered) {
                if (letters[i] === q.answer) { bg = G.tealLight; border = "2px solid "+G.teal; col = G.tealDark; }
                else if (i === selected && letters[i] !== q.answer) { bg = G.redLight; border = "2px solid "+G.red; col = G.red; }
              } else if (selected === i) { bg = G.tealLight; border = "2px solid "+G.teal; col = G.tealDark; }
              return (
                <div key={i} onClick={() => !answered && setSelected(i)} style={{ padding: "14px 18px", border, borderRadius: 12, cursor: answered ? "default" : "pointer", background: bg, display: "flex", gap: 14, alignItems: "center" }}>
                  <div style={{ width: 28, height: 28, borderRadius: "50%", border: "2px solid "+col+"44", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, flexShrink: 0, background: selected === i ? G.teal : "transparent", color: selected === i ? "#fff" : col }}>{letters[i]}</div>
                  <span style={{ fontSize: 15, color: col }}>{opt}</span>
                  {answered && letters[i] === q.answer && <span style={{ marginLeft: "auto", color: G.teal }}>✓</span>}
                </div>
              );
            })}
          </div>
        )}
        {!opts && q.type === "判断题" && (
          <div style={{ display: "flex", gap: 12 }}>
            {["正确","错误"].map((opt, i) => {
              let border = "2px solid #eee", bg = "#fafafa";
              if (answered) { if (opt === q.answer) { bg = G.tealLight; border = "2px solid "+G.teal; } else if (i === selected) { bg = G.redLight; border = "2px solid "+G.red; } } else if (selected === i) { bg = G.tealLight; border = "2px solid "+G.teal; }
              return <div key={i} onClick={() => !answered && setSelected(i)} style={{ flex: 1, padding: "16px 0", border, borderRadius: 12, cursor: answered ? "default" : "pointer", background: bg, textAlign: "center", fontSize: 17, fontWeight: 600 }}>{opt}</div>;
            })}
          </div>
        )}
      </div>
      {(showHint || answered) && (() => {
        // Error root cause analysis
        const isWrong = answered && (() => {
          if (opts) return letters[selected] !== q.answer;
          return !((selected === 0 && q.answer === "正确") || (selected === 1 && q.answer === "错误"));
        })();
        const rootCause = isWrong ? (() => {
          const exp = String(q.explanation || "");
          if (/计算|乘|除|加|减|代入|化简/.test(exp)) return { type: "计算失误", color: G.amber, icon: "🔢", tip: "本题考察计算能力，建议重新推导一遍验证" };
          if (/公式|定理|定义|法则/.test(exp)) return { type: "公式误用", color: G.red, icon: "📐", tip: "建议回顾相关公式定理，加深记忆" };
          return { type: "概念理解", color: G.purple, icon: "💡", tip: "建议查看知识点卡片，理解底层概念" };
        })() : null;

        // Multi-step hints (split explanation into steps)
        const hintSteps = (() => {
          const exp = String(q.explanation || "");
          // Split by period/semicolon into max 3 steps
          const parts = exp.split(/[。；;]/).map(s => s.trim()).filter(s => s.length > 4).slice(0, 3);
          if (parts.length >= 2) return parts;
          return [exp]; // single step
        })();

        return (
          <div style={{ ...s.card, marginBottom: 14, borderLeft: "4px solid " + (isWrong ? G.red : G.teal), background: isWrong ? "#fff8f8" : "#fafffe" }}>
            {isWrong && rootCause && (
              <div style={{ marginBottom: 10, padding: "8px 12px", background: rootCause.color + "18", borderRadius: 8, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 18 }}>{rootCause.icon}</span>
                <div>
                  <span style={{ fontWeight: 700, color: rootCause.color, fontSize: 13 }}>错误类型：{rootCause.type}</span>
                  <div style={{ fontSize: 12, color: "#666", marginTop: 2 }}>{rootCause.tip}</div>
                </div>
              </div>
            )}
            <div style={{ display: "flex", gap: 14 }}>
              <div style={{ width: 34, height: 34, borderRadius: "50%", background: isWrong ? G.red : G.teal, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <span style={{ color: "#fff", fontSize: 12, fontWeight: 700 }}>{isWrong ? "❌" : "AI"}</span>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#111", marginBottom: 8 }}>
                  {answered ? "正确答案：" + q.answer : "🔍 分步提示"}
                </div>
                {hintSteps.length > 1 ? hintSteps.map((step, si) => (
                  <div key={si} style={{ display: "flex", gap: 10, marginBottom: 8, alignItems: "flex-start" }}>
                    <div style={{ width: 22, height: 22, borderRadius: "50%", background: G.teal + "22", border: "1.5px solid " + G.teal, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: G.teal, flexShrink: 0, marginTop: 1 }}>
                      {si + 1}
                    </div>
                    <div style={{ fontSize: 14, color: "#444", lineHeight: 1.7 }}>{step}</div>
                  </div>
                )) : (
                  <div style={{ fontSize: 15, color: "#444", lineHeight: 1.7 }}>{q.explanation}</div>
                )}
                {q.source_quote && (
                  <div style={{ marginTop: 8, fontSize: 12, color: "#666", lineHeight: 1.6, padding: "6px 10px", background: "#f8fafc", borderRadius: 6 }}>
                    📄 资料依据：{String(q.source_quote).slice(0, 140)}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <Btn onClick={() => { if (current > 0) { setCurrent(c => c-1); setSelected(null); setAnswered(false); setShowHint(false); } }}>← 上一题</Btn>
        <div style={{ display: "flex", gap: 10 }}>
          {!answered && <Btn size="sm" onClick={() => setShowHint(v => !v)}>💡 {showHint ? "隐藏" : "提示"}</Btn>}
          {!answered
            ? <Btn variant="primary" onClick={handleSubmit} disabled={selected === null}>提交答案</Btn>
            : <Btn variant="primary" onClick={handleNext}>{current >= displayQ.length-1 ? "查看结果 →" : "下一题 →"}</Btn>}
        </div>
      </div>
    </div>
  );
}

function FlashcardPage({ setPage }) {
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [filter, setFilter] = useState("全部");
  const [srMode, setSrMode] = useState(false); // spaced repetition mode
  const [known, setKnown] = useState(new Set());
  const [showWinFlash, setShowWinFlash] = useState(false);
  const chapters = ["全部", ...new Set(FLASHCARDS.map(f => f.chapter))];
  const allFiltered = filter === "全部" ? FLASHCARDS : FLASHCARDS.filter(f => f.chapter === filter);
  // SR mode: show due cards first
  const filtered = srMode
    ? [...allFiltered].sort((a, b) => {
        const aDue = SM2.isDue(a.front || a.id || "");
        const bDue = SM2.isDue(b.front || b.id || "");
        return bDue - aDue;
      })
    : allFiltered;
  const card = filtered[idx];
  const dueCount = SM2.getDueCount(allFiltered);

  useEffect(() => {
    const handler = (e) => {
      if (e.key === "ArrowRight" || e.key === "l") { setIdx(i => Math.min(filtered.length - 1, i + 1)); setFlipped(false); }
      if (e.key === "ArrowLeft" || e.key === "j") { setIdx(i => Math.max(0, i - 1)); setFlipped(false); }
      if (e.key === " " || e.key === "k") { e.preventDefault(); setFlipped(v => !v); }
      if (e.key === "Enter" && flipped) { setKnown(k => new Set([...k, card?.front])); if (idx < filtered.length - 1) { setIdx(i => i + 1); setFlipped(false); } }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [flipped, idx, filtered.length, card]);

  return (
    <div style={{ padding: "2rem", maxWidth: 720, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
        <Btn size="sm" onClick={() => setPage("首页")}>← 返回</Btn>
        <div style={{ fontSize: 22, fontWeight: 700, color: "#111" }}>记忆卡片</div>
        <Badge color="purple">{filtered.length} 张</Badge>
        {known.size > 0 && <Badge color="teal">已掌握 {known.size} 张</Badge>}
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        {chapters.map(c => (
          <button key={c} onClick={() => { setFilter(c); setIdx(0); setFlipped(false); }} style={{ fontSize: 13, padding: "7px 16px", borderRadius: 20, border: "2px solid " + (filter === c ? G.purple : "#e0e0e0"), cursor: "pointer", fontFamily: "inherit", fontWeight: filter === c ? 600 : 400, background: filter === c ? G.purple : "#fff", color: filter === c ? "#fff" : "#666" }}>{c}</button>
        ))}
      </div>

      {/* SM-2 info bar */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
        {dueCount > 0 && (
          <div style={{ background: G.amberLight, borderRadius: 10, padding: "8px 14px", fontSize: 13, color: G.amber, fontWeight: 600, flex: 1 }}>
            📅 今日待复习 <strong>{dueCount}</strong> 张卡片（艾宾浩斯间隔）
          </div>
        )}
        <button onClick={() => setSrMode(v => !v)} style={{ padding: "8px 16px", borderRadius: 10, border: "1.5px solid " + (srMode ? G.purple : "#ddd"), background: srMode ? G.purple : "#fff", color: srMode ? "#fff" : "#666", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>
          {srMode ? "🔀 间隔模式" : "📚 顺序模式"}
        </button>
      </div>
      {showWinFlash && (
        <div style={{ position: "fixed", top: "30%", left: "50%", transform: "translateX(-50%)", background: "linear-gradient(135deg,#8b5cf6,#7c3aed)", color: "#fff", borderRadius: 20, padding: "20px 40px", textAlign: "center", zIndex: 9999, boxShadow: "0 20px 60px rgba(0,0,0,0.2)", animation: "popIn 0.3s ease", pointerEvents: "none" }}>
          <div style={{ fontSize: 40, marginBottom: 6 }}>🎉</div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>太棒了！又掌握 {known.size} 张！</div>
          <div style={{ fontSize: 13, opacity: 0.85, marginTop: 4 }}>坚持复习，记忆更持久！</div>
        </div>
      )}
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, fontSize: 14, color: "#888" }}>
          <span>{idx + 1} / {filtered.length}</span>
          <span style={{ color: G.purple }}>已掌握 {known.size}/{filtered.length}</span>
        </div>
        <ProgressBar value={idx + 1} max={filtered.length} color={G.purple} height={6} />
      </div>

      {/* Card */}
      <div onClick={() => setFlipped(v => !v)} style={{ background: flipped ? `linear-gradient(135deg, ${G.teal}, #0a7a5a)` : "#fff", border: flipped ? "none" : "2px solid #eee", borderRadius: 24, padding: "3.5rem 2.5rem", textAlign: "center", cursor: "pointer", minHeight: 220, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", transition: "all .25s", marginBottom: 20, boxShadow: flipped ? "0 8px 32px rgba(29,158,117,0.25)" : "0 4px 20px rgba(0,0,0,0.06)" }}>
        <div style={{ fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: flipped ? "rgba(255,255,255,0.6)" : "#bbb", marginBottom: 20, fontWeight: 500 }}>
          {flipped ? "答案 · 点击返回" : `${card?.chapter} · 点击翻转查看答案`}
        </div>
        <div style={{ fontSize: 22, fontWeight: 700, color: flipped ? "#fff" : "#111", lineHeight: 1.5, maxWidth: 480 }}>
          {flipped ? card?.back : card?.front}
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "center", gap: 12 }}>
        <Btn onClick={() => { setIdx(i => Math.max(0, i - 1)); setFlipped(false); }}>← 上一张</Btn>
        {flipped && <Btn variant="danger" onClick={() => { setIdx(i => Math.min(filtered.length - 1, i + 1)); setFlipped(false); }}>还不熟悉</Btn>}
        {flipped && <Btn variant="danger" onClick={() => {
              SM2.update(card.front || card.id || "", 1);
              if (idx < filtered.length - 1) { setIdx(i => i + 1); setFlipped(false); }
            }}>😕 不熟悉</Btn>}
        {flipped && <Btn variant="primary" onClick={() => {
              SM2.update(card.front || card.id || "", 5);
              setKnown(k => new Set([...k, card.front]));
              const newKnownSize = known.size + 1;
              if (newKnownSize % 5 === 0 || newKnownSize === 1) { setShowWinFlash(true); setTimeout(() => setShowWinFlash(false), 1800); }
              if (idx < filtered.length - 1) { setIdx(i => i + 1); setFlipped(false); }
            }}>✓ 已掌握</Btn>}
        {!flipped && <Btn onClick={() => { setIdx(i => Math.min(filtered.length - 1, i + 1)); setFlipped(false); }}>下一张 →</Btn>}
      </div>
    </div>
  );
}

// ── Report Page ───────────────────────────────────────────────────────────────

// ── ExamPlanSection: 考试倒计时 + 个性化复习日历 ─────────────────────────────
function ExamPlanSection({ weak, setPage }) {
  const [showForm, setShowForm] = useState(() => !localStorage.getItem("mc_exam_date"));
  const [examDate, setExamDate] = useState(() => localStorage.getItem("mc_exam_date") || "");
  const [examSubject, setExamSubject] = useState(() => localStorage.getItem("mc_exam_subject") || "");
  const [examChapters, setExamChapters] = useState(() => {
    try { return JSON.parse(localStorage.getItem("mc_exam_chapters") || "[]"); } catch { return []; }
  });
  const allChaptersOpts = ["Ch.1 方程求解","Ch.2 线性方程组","Ch.3 插值","Ch.4 最小二乘","Ch.5 数值微积分","最优化 Ch.1","ODE 基础","概率论基础"];

  const daysLeft = examDate ? Math.ceil((new Date(examDate) - new Date()) / 86400000) : null;

  const saveExam = () => {
    localStorage.setItem("mc_exam_date", examDate);
    localStorage.setItem("mc_exam_subject", examSubject);
    localStorage.setItem("mc_exam_chapters", JSON.stringify(examChapters));
    setShowForm(false);
  };

  const generatePlan = () => {
    const scope = examChapters.length > 0 ? examChapters : (weak.length > 0 ? weak.map(w => w.name) : ["综合复习"]);
    // Assign each day a primary chapter by evenly distributing chapters
    const dayChapter = Array.from({ length: planLen }, (_, di) => scope[di % scope.length]);
    const planLen = daysLeft !== null && daysLeft > 7 ? Math.min(daysLeft + 1, 14) : 7;
    return Array.from({ length: planLen }, (_, di) => {
      const date = new Date(Date.now() + di * 86400000);
      const dayNames = ["日","一","二","三","四","五","六"];
      const dLeft = daysLeft !== null ? daysLeft - di : null;
      const isExamDay = daysLeft !== null && dLeft === 0;
      const isPast = dLeft !== null && dLeft < 0;
      const chap = dayChapter[di];
      const chapShort = chap ? chap.split(" ").slice(0,2).join(" ") : "综合";
      let tasks = [];
      let chapter = "";
      if (isExamDay) {
        tasks = ["🎓 考试日！加油！", "相信自己，沉着作答"];
      } else if (isPast) {
        tasks = ["已过考试日"];
      } else if (dLeft !== null && dLeft === 1) {
        tasks = ["轻松回顾全部重点", "早睡！保持最佳状态"];
        chapter = "冲刺";
      } else if (dLeft !== null && dLeft <= 3) {
        // Sprint: cycle chapters for last 3 days
        const sprintChap = scope[(dLeft - 1) % scope.length];
        const sprintShort = sprintChap ? sprintChap.split(" ").slice(0,2).join(" ") : "总复习";
        tasks = ["🔥 " + sprintShort + " 冲刺复习", "重点公式快速过 · 错题再做一遍"];
        chapter = sprintShort;
      } else {
        // Normal days: assign chapter, vary activity type
        const pattern = di % 3;
        if (pattern === 0) {
          tasks = ["📖 精读 " + chapShort, "练习对应题目 8 道"];
        } else if (pattern === 1) {
          tasks = ["🃏 记忆卡片 15 张", "📝 " + chapShort + " 错题回顾"];
        } else {
          tasks = ["💬 " + chapShort + " AI 助教提问", "🔁 巩固薄弱知识点"];
        }
        chapter = chapShort;
      }
      const intensity = isExamDay ? "exam" : (dLeft !== null && dLeft <= 1) ? "light" : (dLeft !== null && dLeft <= 3 ? "sprint" : (di % 3 === 0 ? "high" : "normal"));
      const bg = isExamDay ? "linear-gradient(135deg,#fef3c7,#fde68a)" : isPast ? "#f5f5f5" :
                 intensity === "light" ? "#f0fdf8" : intensity === "sprint" ? "#fff1f2" :
                 intensity === "high" ? "#eff6ff" : "#fafbff";
      const border = isExamDay ? "#fcd34d" : isPast ? "#e5e5e5" :
                     intensity === "sprint" ? "#fca5a5" : intensity === "high" ? G.blue+"66" : G.teal+"44";
      return { date, dayName: dayNames[date.getDay()], tasks, bg, border, isExamDay, isPast, dLeft, chapter };
    });
  };
  const plan = generatePlan();

  return (
    <div style={{ ...s.card, marginTop: 0, marginBottom: 24 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, paddingBottom: 12, borderBottom: "1px solid #f0f0f0" }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>📅 个性化备考计划</div>
          {daysLeft !== null && (
            <div style={{ fontSize: 13, color: daysLeft <= 3 ? G.red : G.blue, marginTop: 3, fontWeight: 600 }}>
              {daysLeft > 0 ? "距 " + (examSubject || "考试") + " 还有 " + daysLeft + " 天" : daysLeft === 0 ? "今天就是考试日！加油！🎓" : "考试已结束"}
            </div>
          )}
        </div>
        <button onClick={() => setShowForm(v => !v)} style={{ padding: "8px 16px", background: G.blue, color: "#fff", border: "none", borderRadius: 10, cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: "inherit" }}>
          {showForm ? "取消" : examDate ? "✏️ 修改考试" : "⚙️ 设置考试"}
        </button>
      </div>

      {showForm && (
        <div style={{ background: G.blueLight, borderRadius: 12, padding: "16px", marginBottom: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#555", display: "block", marginBottom: 4 }}>📚 科目名称</label>
              <input value={examSubject} onChange={e => setExamSubject(e.target.value)} placeholder="如：数值分析期末" style={{ width: "100%", padding: "9px 12px", borderRadius: 9, border: "1.5px solid #ddd", fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#555", display: "block", marginBottom: 4 }}>📅 考试日期</label>
              <input type="date" value={examDate} onChange={e => setExamDate(e.target.value)} style={{ width: "100%", padding: "9px 12px", borderRadius: 9, border: "1.5px solid #ddd", fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#555", display: "block", marginBottom: 6 }}>📖 考试范围（点击选择章节，留空则自动按薄弱章节安排）{examChapters.length > 0 && <span style={{ marginLeft:8, background:G.blue, color:"#fff", padding:"1px 8px", borderRadius:20, fontSize:11 }}>{examChapters.length} 章已选</span>}</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {allChaptersOpts.map(ch => (
                <button key={ch} onClick={() => setExamChapters(prev => prev.includes(ch) ? prev.filter(x => x !== ch) : [...prev, ch])}
                  style={{ padding: "6px 12px", borderRadius: 20, border: "1.5px solid " + (examChapters.includes(ch) ? G.blue : "#ddd"), background: examChapters.includes(ch) ? G.blue : "#fff", color: examChapters.includes(ch) ? "#fff" : "#555", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
                  {ch}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={saveExam} style={{ flex: 1, padding: "10px 0", background: G.teal, color: "#fff", border: "none", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 700, fontFamily: "inherit" }}>✓ 保存计划</button>
            {examDate && <button onClick={() => { localStorage.removeItem("mc_exam_date"); localStorage.removeItem("mc_exam_subject"); localStorage.removeItem("mc_exam_chapters"); setExamDate(""); setExamSubject(""); setExamChapters([]); setShowForm(false); }} style={{ padding: "10px 16px", background: G.redLight, color: G.red, border: "none", borderRadius: 10, cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: "inherit" }}>删除</button>}
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 8 }}>
        {plan.map(({ date, dayName, tasks, bg, border, isExamDay, isPast, dLeft, chapter }, di) => (
          <div key={di} style={{ background: bg, border: "2px solid " + border, borderRadius: 16, padding: "14px 8px", textAlign: "center", opacity: isPast ? 0.45 : 1, transition: "transform .15s", cursor: "default", minWidth: 120, flex: "0 0 auto" }}>
            <div style={{ fontSize: 12, color: "#999", fontWeight: 600, marginBottom: 4, letterSpacing: "0.05em" }}>{"周" + dayName}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: isExamDay ? "#92400e" : di === 0 ? G.teal : "#222", lineHeight: 1, marginBottom: 4 }}>
              {date.getDate()}
              {di === 0 && <span style={{ fontSize: 10, marginLeft: 3, background: G.blue, color: "#fff", padding: "1px 5px", borderRadius: 6, fontWeight: 700, verticalAlign: "middle" }}>今</span>}
            </div>
            {dLeft !== null && dLeft > 0 && !isExamDay && (
              <div style={{ fontSize: 11, color: isExamDay ? "#92400e" : "#aaa", marginBottom: 6, fontWeight: 600 }}>剩 {dLeft} 天</div>
            )}
            {chapter && !isPast && !isExamDay && (
              <div style={{ fontSize: 11, background: "rgba(29,158,117,0.12)", color: G.teal, borderRadius: 20, padding: "2px 8px", marginBottom: 6, fontWeight: 700, display: "inline-block" }}>{chapter}</div>
            )}
            {tasks.map((t, ti) => (
              <div key={ti} style={{ fontSize: 12, color: isExamDay ? "#92400e" : "#444", lineHeight: 1.55, background: "rgba(255,255,255,0.75)", borderRadius: 8, padding: "4px 6px", marginBottom: 4, wordBreak: "keep-all" }}>{t}</div>
            ))}
          </div>
        ))}
      </div>
      <div style={{ marginTop: 10, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div style={{ fontSize: 12, color: "#aaa" }}>
          {daysLeft !== null ? "📅 根据考试倒计时自动安排 · " : ""}{examChapters.length > 0 ? "已选 " + examChapters.length + " 个章节" : "建议设置考试范围"} · 每天 20-30 分钟
        </div>
        {setPage && (
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setPage("资料对话")} style={{ padding:"6px 14px", background:G.purpleLight, color:G.purple, border:"none", borderRadius:8, cursor:"pointer", fontSize:12, fontWeight:600, fontFamily:"inherit" }}>🤖 AI 助教复习</button>
            <button onClick={() => setPage("题库练习")} style={{ padding:"6px 14px", background:G.tealLight, color:G.teal, border:"none", borderRadius:8, cursor:"pointer", fontSize:12, fontWeight:600, fontFamily:"inherit" }}>✏️ 开始练习</button>
          </div>
        )}
      </div>
    </div>
  );
}


function ReportPage({ setPage }) {
  const savedAnswers = (() => {
    try { return JSON.parse(localStorage.getItem("mc_answers") || "{}"); } catch { return {}; }
  })();
  const chapterStats = getChapterStats(savedAnswers);
  const hasRealData = Object.keys(chapterStats).length > 0;

  const demoStats = [
    { name: "Ch.1 方程求解", correct: 7, total: 10 },
    { name: "Ch.2 线性方程组", correct: 6, total: 10 },
    { name: "Ch.3 插值", correct: 4, total: 10 },
    { name: "Ch.4 最小二乘", correct: 3, total: 8 },
    { name: "Ch.5 数值微积分", correct: 5, total: 8 },
    { name: "最优化 Ch.1", correct: 5, total: 10 },
  ];
  const stats = hasRealData
    ? Object.entries(chapterStats).map(([name, s]) => ({ name, correct: s.correct, total: s.total }))
    : demoStats;

  const tc = stats.reduce((a, c) => a + c.correct, 0);
  const tq = stats.reduce((a, c) => a + c.total, 0);
  const pct = tq > 0 ? Math.round(tc / tq * 100) : 0;
  const weak = [...stats].sort((a, b) => (a.correct / a.total) - (b.correct / b.total)).slice(0, 3);
  const strong = [...stats].sort((a, b) => (b.correct / b.total) - (a.correct / a.total)).slice(0, 2);

  const streak = (() => {
    try { return JSON.parse(localStorage.getItem("mc_streak") || "{}").days || 0; } catch { return 0; }
  })();

  const getLevel = (p) => {
    if (p >= 90) return { label: "大师级", emoji: "🏆", color: G.amber, desc: "超越了90%的同学！" };
    if (p >= 75) return { label: "熟练级", emoji: "⭐", color: G.teal, desc: "掌握扎实，继续保持！" };
    if (p >= 60) return { label: "进阶中", emoji: "📈", color: G.blue, desc: "你在快速进步！" };
    return { label: "学习中", emoji: "🌱", color: G.purple, desc: "每天一小步，坚持就是胜利！" };
  };
  const level = getLevel(pct);

  // SVG Radar Chart
  const radarData = stats.slice(0, 6).map(s => ({ label: s.name.split(" ")[0], value: s.correct / s.total }));
  const N = radarData.length || 1;
  const cx = 110, cy = 110, R = 80;
  const angleStep = (2 * Math.PI) / N;
  const toXY = (i, r) => ({
    x: cx + r * Math.sin(i * angleStep),
    y: cy - r * Math.cos(i * angleStep),
  });
  const radarPoints = radarData.map((d, i) => toXY(i, d.value * R));
  const radarPath = radarPoints.map((p, i) => (i === 0 ? "M" + p.x + "," + p.y : "L" + p.x + "," + p.y)).join(" ") + " Z";
  const gridLevels = [0.25, 0.5, 0.75, 1.0];

  return (
    <div style={{ padding: "2rem", maxWidth: 960, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 24 }}>
        <Btn size="sm" onClick={() => setPage("首页")}>← 返回</Btn>
        <div style={{ fontSize: 22, fontWeight: 700, color: "#111" }}>📊 学习报告</div>
        {!hasRealData && <span style={{ fontSize: 12, background: G.amberLight, color: G.amber, padding: "3px 10px", borderRadius: 20, fontWeight: 600 }}>演示数据 — 完成题库练习后显示真实数据</span>}
        <div style={{ marginLeft: "auto" }}>
          <Btn size="sm" onClick={() => { if (window.confirm("确定重置本地答题记录？")) { localStorage.removeItem("mc_answers"); window.location.reload(); } }}>重置记录</Btn>
        </div>
      </div>

      {/* ── 备考计划（页面顶部） ── */}
      <ExamPlanSection weak={weak} setPage={setPage} />

      {/* 顶部：级别 + 统计卡片 */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 14, marginBottom: 24 }}>
        <div style={{ background: "linear-gradient(135deg," + level.color + "22," + level.color + "11)", borderRadius: 16, padding: "20px 24px", border: "1.5px solid " + level.color + "44", display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ fontSize: 48 }}>{level.emoji}</div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: level.color, letterSpacing: "0.1em", marginBottom: 4 }}>当前熟练度</div>
            <div style={{ fontSize: 28, fontWeight: 900, color: level.color, lineHeight: 1 }}>{level.label}</div>
            <div style={{ fontSize: 13, color: "#555", marginTop: 4 }}>{level.desc}</div>
            <div style={{ marginTop: 8, fontSize: 12, color: "#888" }}>总正确率 {pct}% · 已答 {tq} 题</div>
          </div>
        </div>
        <StatCard icon="✏️" label="答题总数" value={tq} sub={"正确 " + tc + " 题"} color={G.blue} />
        <div style={{ background: streak >= 3 ? "linear-gradient(135deg,#fef3c7,#fde68a)" : "#f8fafc", borderRadius: 16, padding: "18px 20px", border: "1.5px solid " + (streak >= 3 ? "#fcd34d" : "#eee"), textAlign: "center" }}>
          <div style={{ fontSize: 32, marginBottom: 4 }}>{streak >= 7 ? "🔥" : streak >= 3 ? "⚡" : "📅"}</div>
          <div style={{ fontSize: 24, fontWeight: 900, color: streak >= 3 ? G.amber : "#999" }}>{streak}</div>
          <div style={{ fontSize: 12, color: "#666", fontWeight: 600 }}>天连续学习</div>
          {streak === 0 && <div style={{ fontSize: 11, color: "#bbb", marginTop: 4 }}>今天开始打卡吧！</div>}
          {streak >= 3 && <div style={{ fontSize: 11, color: G.amber, marginTop: 4, fontWeight: 600 }}>坚持得很好！🎉</div>}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        {/* 雷达图 */}
        <div style={{ ...s.card }}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16, paddingBottom: 12, borderBottom: "1px solid #f0f0f0" }}>📡 能力雷达图</div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <svg width="220" height="220" viewBox="0 0 220 220">
              {gridLevels.map((lv, gi) => (
                <polygon key={gi}
                  points={Array.from({ length: N }, (_, i) => { const p = toXY(i, lv * R); return p.x + "," + p.y; }).join(" ")}
                  fill="none" stroke="#e5e7eb" strokeWidth="1"
                />
              ))}
              {radarData.map((_, i) => {
                const outer = toXY(i, R);
                return <line key={i} x1={cx} y1={cy} x2={outer.x} y2={outer.y} stroke="#e5e7eb" strokeWidth="1" />;
              })}
              <path d={radarPath} fill={G.teal + "55"} stroke={G.teal} strokeWidth="2" />
              {radarPoints.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r="4" fill={G.teal} stroke="#fff" strokeWidth="1.5" />
              ))}
              {radarData.map((d, i) => {
                const p = toXY(i, R + 18);
                return <text key={i} x={p.x} y={p.y} textAnchor="middle" dominantBaseline="middle" fontSize="10" fill="#555" fontFamily="system-ui,sans-serif">{d.label}</text>;
              })}
            </svg>
            <div style={{ flex: 1, minWidth: 0 }}>
              {radarData.map((d, i) => (
                <div key={i} style={{ marginBottom: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
                    <span style={{ color: "#555", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "70%" }}>{d.label}</span>
                    <span style={{ fontWeight: 700, color: d.value >= 0.8 ? G.teal : d.value >= 0.6 ? G.amber : G.red, flexShrink: 0 }}>{Math.round(d.value * 100)}%</span>
                  </div>
                  <ProgressBar value={Math.round(d.value * 100)} max={100} color={d.value >= 0.8 ? G.teal : d.value >= 0.6 ? G.amber : G.red} height={5} />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 章节掌握度 */}
        <div style={{ ...s.card }}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16, paddingBottom: 12, borderBottom: "1px solid #f0f0f0" }}>📚 章节掌握度</div>
          {stats.map((c, i) => {
            const p = Math.round(c.correct / c.total * 100);
            const col = p >= 80 ? G.teal : p >= 60 ? G.amber : G.red;
            const badge = p >= 80 ? "✅" : p >= 60 ? "📈" : "⚠️";
            return (
              <div key={i} style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <span style={{ fontSize: 13, color: "#333" }}>{c.name}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: col }}>{badge} {p}%</span>
                </div>
                <ProgressBar value={c.correct} max={c.total} color={col} height={6} />
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* 薄弱章节 */}
        <div style={{ ...s.card }}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 14, paddingBottom: 12, borderBottom: "1px solid #f0f0f0" }}>⚠️ 薄弱章节（优先复习）</div>
          {weak.map((c, i) => {
            const p = Math.round(c.correct / c.total * 100);
            return (
              <div key={i} style={{ padding: "12px 0", borderBottom: i < weak.length-1 ? "1px solid #f5f5f5" : "none" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontWeight: 600, color: "#333", fontSize: 14 }}>{c.name}</div>
                    <div style={{ fontSize: 12, color: "#aaa", marginTop: 2 }}>建议：先复习知识点再做题</div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <Badge color="red">{p}%</Badge>
                    <Btn size="sm" onClick={() => setPage("题库练习")}>练习</Btn>
                  </div>
                </div>
              </div>
            );
          })}
          <div style={{ marginTop: 14, padding: "12px 14px", background: G.amberLight, borderRadius: 10, fontSize: 13, color: "#92400e", lineHeight: 1.7 }}>
            💡 <strong>建议：</strong>从 <strong>{weak[0]?.name.split(" ")[0] || "薄弱章节"}</strong> 开始，先看知识点卡片，再做 5 题巩固！
          </div>
        </div>

        {/* 优势 + 学习计划 */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ ...s.card }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 14, paddingBottom: 12, borderBottom: "1px solid #f0f0f0" }}>🌟 优势章节</div>
            {strong.map((c, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: i < strong.length-1 ? "1px solid #f5f5f5" : "none" }}>
                <span style={{ fontSize: 14, color: "#333" }}>{c.name}</span>
                <Badge color="teal">{Math.round(c.correct / c.total * 100)}% 🎉</Badge>
              </div>
            ))}
            <div style={{ marginTop: 12, padding: "10px 12px", background: G.tealLight, borderRadius: 10, fontSize: 13, color: "#065f46" }}>
              🎊 {strong[0]?.name.split(" ")[0]} 已达优秀水平！
            </div>
          </div>

          <div style={{ ...s.card }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 14, paddingBottom: 12, borderBottom: "1px solid #f0f0f0" }}>🗓️ 今日计划</div>
            {[
              { day: "🔥 现在", task: "复习 " + (weak[0]?.name.split(" ")[0] || "薄弱章节"), urgent: true },
              { day: "✏️ 今天", task: "完成 10 道练习题", urgent: false },
              { day: "🃏 今晚", task: "记忆卡片复习 15 张", urgent: false },
            ].map((a, i) => (
              <div key={i} style={{ display: "flex", gap: 12, padding: "9px 0", borderBottom: i < 2 ? "1px solid #f5f5f5" : "none", alignItems: "center" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: "#aaa", fontWeight: 600 }}>{a.day}</div>
                  <div style={{ fontSize: 14, color: "#333" }}>{a.task}</div>
                </div>
                {a.urgent && <Badge color="red">今日必做</Badge>}
              </div>
            ))}
            <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
              <Btn variant="primary" onClick={() => setPage("题库练习")} style={{ flex: 1 }}>开始练习</Btn>
              <Btn onClick={() => setPage("知识点")} style={{ flex: 1 }}>知识点</Btn>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}

// ── Upload Page ─────────────────────────────────────────────────────────────
function UploadPage({ setPage, profile }) {
  const DEFAULT_UPLOAD_COURSES = ["数值分析", "线性代数", "概率论", "数理统计", "ODE", "最优化", "高等数学"];
  const [title, setTitle] = useState("");
  const [course, setCourse] = useState("线性代数");
  const [customCourse, setCustomCourse] = useState("");
  const [addingCourse, setAddingCourse] = useState(false);
  const [courses, setCourses] = useState(DEFAULT_UPLOAD_COURSES);
  const [chapter, setChapter] = useState("全部");
  const [desc, setDesc] = useState("");
  const [file, setFile] = useState(null);
  const [isPublic, setIsPublic] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [step, setStep] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const pdfRef = useRef();

  const CHAPTERS = ["全部", ...Array.from({ length: 12 }, (_, i) => `Ch.${i + 1}`)];
  const getExt = (name = "") => {
    const idx = name.lastIndexOf(".");
    return idx >= 0 ? name.slice(idx).toLowerCase() : "";
  };
  const buildUploadError = (err) => {
    const msg = String(err?.message || "未知错误");
    if (/row-level security|permission denied|42501/i.test(msg)) {
      if (profile?.role === "student") {
        return "当前数据库策略仅允许教师直接发布资料。学生上传需走“待审核”流程（你现在的 SQL 还未开启该策略）。";
      }
      return "权限不足：请检查 Supabase RLS 策略（materials 表 / storage bucket）的 insert 与 upload 权限。";
    }
    return msg;
  };

  const handleUpload = async () => {
    if (!title.trim()) { setError("请填写资料名称"); return; }
    if (!file) { setError("请选择 PDF / PPT / DOC 文件"); return; }
    const ext = getExt(file.name);
    if (!MATERIAL_ALLOWED_EXTS.includes(ext)) {
      setError("仅支持 PDF / PPT / DOC 文件（.pdf .ppt .pptx .doc .docx）");
      return;
    }
    if (file.size > 50 * 1024 * 1024) { setError("文件超过 50MB，请压缩后再上传"); return; }
    setUploading(true); setError(""); setSuccess("");
    try {
      // Upload file to Supabase Storage
      setStep("上传文件到存储空间…");
      const filePath = `${profile?.id || "anon"}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const { data: storageData, error: storageErr } = await supabase.storage
        .from("materials")
        .upload(filePath, file, { upsert: false });
      if (storageErr) throw new Error("存储失败: " + storageErr.message + (storageErr.code ? ` (code: ${storageErr.code})` : ""));

      // Get public URL
      const { data: { publicUrl } } = supabase.storage.from("materials").getPublicUrl(filePath);

      // Save metadata to DB
      setStep("保存到资料库…");
      const basePayload = {
        title: title.trim(),
        course,
        chapter: chapter === "全部" ? null : chapter,
        description: desc.trim() || null,
        file_name: file.name,
        file_size: file.size > 1024 * 1024
          ? (file.size / 1024 / 1024).toFixed(1) + " MB"
          : (file.size / 1024).toFixed(0) + " KB",
        file_data: publicUrl,
        uploader_name: profile?.name || "用户",
        uploaded_by: profile?.id || null,
        is_public: isPublic,
      };
      const statusValue = profile?.role === "teacher" ? "approved" : "pending";
      let { data: insertedMaterial, error: dbErr } = await supabase.from("materials").insert({
        ...basePayload,
        status: statusValue,
      }).select().single();
      // Backward compatible: older schema may not have status column yet (incl. PGRST204).
      if (dbErr && isMissingMaterialsStatusColumn(dbErr)) {
        const retry = await supabase.from("materials").insert(basePayload).select().single();
        dbErr = retry.error;
        insertedMaterial = retry.data || null;
      }
      if (dbErr) throw new Error(dbErr.message + (dbErr.code ? ` (code: ${dbErr.code})` : ""));
      if (insertedMaterial && statusValue === "approved") {
        setStep("解析资料并生成知识点与题目…");
        try {
          const result = await processMaterialWithAI({
            material: insertedMaterial,
            file,
            fallbackText: `${title} ${desc}`,
            genCount: 10,
            actorName: profile?.name || "用户",
          });
          if (result.apiQuotaExceeded) {
            setSuccess(`上传成功！资料已保存。⚠️ ${result.apiErrorMsg || "Gemini API 配额暂时用完，请在资料库点击「补题」重试出题。"}`);
          } else {
            const linkedHint = result.materialLinked ? "" : "（题目已入库，可在题库正常练习）";
            const diagHint = result?.textDiag?.hint ? ` 📊 ${result.textDiag.hint}` : (result.parseHint ? ` ${result.parseHint}` : "");
            setSuccess(`上传成功！已提取 ${result.topics.length} 个知识点，入库 ${result.insertedCount ?? result.questions.length} 道题目。${linkedHint}${diagHint}`);
          }
        } catch (e) {
          setSuccess("上传成功！资料已发布，AI 解析稍后可在教师端重试。");
        }
      } else {
        setSuccess(profile?.role === "teacher" ? "上传成功！资料已发布到资料库。" : "上传成功！资料已提交，等待教师审核后发布。");
      }
      setTitle(""); setDesc(""); setFile(null); setChapter("全部");
    } catch (e) {
      setError("上传失败：" + buildUploadError(e));
    }
    setUploading(false); setStep("");
  };

  return (
    <div style={{ padding: "2rem", maxWidth: 680, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 28 }}>
        <Btn size="sm" onClick={() => setPage("资料库")}>← 资料库</Btn>
        <div>
          <div style={{ fontSize: 24, fontWeight: 700, color: "#111" }}>上传资料</div>
          <div style={{ fontSize: 14, color: "#888", marginTop: 2 }}>上传后所有用户均可在资料库查看、做笔记</div>
        </div>
      </div>

      <div style={{ ...s.card, padding: "2rem" }}>
        {/* 资料名称 */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ ...s.label }}>资料名称 *</label>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="例：第三章 插值方法讲义" style={{ ...s.input }} />
        </div>

        {/* 课程名称 */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ ...s.label }}>课程名称 *</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            {courses.map(c => (
              <button key={c} onClick={() => { setCourse(c); setAddingCourse(false); }} style={{ padding: "8px 16px", borderRadius: 20, border: "2px solid " + (course === c ? G.teal : "#e0e0e0"), cursor: "pointer", fontFamily: "inherit", fontSize: 14, fontWeight: course === c ? 700 : 400, background: course === c ? G.teal : "#fff", color: course === c ? "#fff" : "#555" }}>{c}</button>
            ))}
            <button onClick={() => setAddingCourse(v => !v)} style={{ padding: "8px 16px", borderRadius: 20, border: "2px dashed #ccc", cursor: "pointer", fontFamily: "inherit", fontSize: 14, color: "#888", background: "transparent" }}>+ 添加课程</button>
          </div>
          {addingCourse && (
            <div style={{ display: "flex", gap: 8 }}>
              <input value={customCourse} onChange={e => setCustomCourse(e.target.value)} placeholder="输入新课程名称" style={{ ...s.input, marginBottom: 0, flex: 1 }} />
              <button onClick={() => { if (customCourse.trim()) { setCourses(c => [...c, customCourse.trim()]); setCourse(customCourse.trim()); setCustomCourse(""); setAddingCourse(false); } }} style={{ padding: "10px 18px", background: G.teal, color: "#fff", border: "none", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 600, fontFamily: "inherit", flexShrink: 0 }}>确认添加</button>
            </div>
          )}
        </div>

        {/* 章节 */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ ...s.label }}>章节范围</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {CHAPTERS.map(c => (
              <button key={c} onClick={() => setChapter(c)} style={{ padding: "7px 14px", borderRadius: 20, border: "2px solid " + (chapter === c ? G.blue : "#e0e0e0"), cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: chapter === c ? 700 : 400, background: chapter === c ? G.blueLight : "#fff", color: chapter === c ? G.blue : "#555" }}>{c}</button>
            ))}
          </div>
        </div>

        {/* 简介 */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ ...s.label }}>简介（可选）</label>
          <textarea value={desc} onChange={e => setDesc(e.target.value)} placeholder="简单描述资料内容，帮助其他同学了解…" rows={3} style={{ width: "100%", fontSize: 14, padding: "12px", border: "1.5px solid #e0e0e0", borderRadius: 10, fontFamily: "inherit", resize: "vertical", color: "#111", lineHeight: 1.6, boxSizing: "border-box" }} />
        </div>

        {/* 文件上传 */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ ...s.label }}>上传资料文件 *</label>
          <div onClick={() => pdfRef.current?.click()} style={{ border: "2px dashed " + (file ? G.teal : "#ddd"), borderRadius: 14, padding: "2.5rem", textAlign: "center", cursor: "pointer", background: file ? G.tealLight : "#fafafa" }}>
            <input ref={pdfRef} type="file" accept=".pdf,.ppt,.pptx,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation" style={{ display: "none" }} onChange={e => { const f = e.target.files[0]; if (f) setFile(f); }} />
            <div style={{ fontSize: 32, marginBottom: 10 }}>{file ? "✅" : "📂"}</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: file ? G.tealDark : "#333", marginBottom: 4 }}>{file ? file.name : "点击选择文件（PDF/PPT/DOC）"}</div>
            <div style={{ fontSize: 13, color: "#aaa" }}>{file ? `${(file.size / 1024).toFixed(0)} KB` : "支持 PDF/PPT/DOC，最大 50MB"}</div>
          </div>
          <div style={{ marginTop: 12, fontSize: 13, color: "#666", lineHeight: 1.55 }}>
            <strong style={{ color: "#444" }}>关于扫描版 PDF：</strong>
            若文件是纸质书拍照/扫描生成的 PDF（页内文字无法用鼠标选中），本站无法读出正文，AI 只能根据标题与简介生成占位内容。
            请换出版社「电子版」教材，或先用 Acrobat / ABBYY 等做 OCR 后再上传。
          </div>
        </div>

        {/* 可见范围 */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ ...s.label }}>可见范围</label>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => setIsPublic(true)} style={{ flex: 1, padding: "12px 0", fontSize: 14, fontFamily: "inherit", border: isPublic ? `2px solid ${G.teal}` : "2px solid #e0e0e0", borderRadius: 10, cursor: "pointer", fontWeight: isPublic ? 700 : 400, background: isPublic ? G.tealLight : "#fff", color: isPublic ? G.tealDark : "#666" }}>
              🌐 公开<div style={{ fontSize: 11, fontWeight: 400, marginTop: 3, color: isPublic ? G.tealDark : "#aaa" }}>所有同学可见</div>
            </button>
            <button onClick={() => setIsPublic(false)} style={{ flex: 1, padding: "12px 0", fontSize: 14, fontFamily: "inherit", border: !isPublic ? `2px solid ${G.blue}` : "2px solid #e0e0e0", borderRadius: 10, cursor: "pointer", fontWeight: !isPublic ? 700 : 400, background: !isPublic ? G.blueLight : "#fff", color: !isPublic ? G.blue : "#666" }}>
              🔒 仅自己<div style={{ fontSize: 11, fontWeight: 400, marginTop: 3, color: !isPublic ? G.blue : "#aaa" }}>只有你能看到</div>
            </button>
          </div>
        </div>

        {error && <div style={{ padding: "12px 16px", background: G.redLight, color: G.red, borderRadius: 10, fontSize: 14, marginBottom: 16 }}>{error}</div>}
        {success && (
          <div style={{ padding: "14px 16px", background: G.tealLight, color: G.tealDark, borderRadius: 10, fontSize: 14, marginBottom: 16 }}>
            {success}
            <button onClick={() => setPage("资料库")} style={{ marginLeft: 14, padding: "6px 14px", background: G.teal, color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: "inherit" }}>查看资料库 →</button>
          </div>
        )}
        {uploading && step && <div style={{ padding: "12px 16px", background: G.blueLight, color: G.blue, borderRadius: 10, fontSize: 14, marginBottom: 16 }}>⏳ {step}</div>}

        <button disabled={uploading || !file || !title} onClick={handleUpload} style={{ width: "100%", padding: "14px 0", fontSize: 16, fontWeight: 700, fontFamily: "inherit", background: uploading || !file || !title ? "#ccc" : G.teal, color: "#fff", border: "none", borderRadius: 12, cursor: uploading || !file || !title ? "not-allowed" : "pointer" }}>
          {uploading ? step || "上传中…" : isPublic ? "📤 发布到资料库（公开）" : "🔒 上传到我的私有资料"}
        </button>
      </div>
    </div>
  );
}

// ── Materials Library Page ─────────────────────────────────────────────────────

// ── Materials Library Page ──────────────────────────────────────────────────

// ── Wrong Drill ───────────────────────────────────────────────────────────────
function WrongDrill({ questions, onExit, onMastered }) {
  const [idx, setIdx] = useState(0);
  const [selected, setSelected] = useState(null);
  const [answered, setAnswered] = useState(false);
  const [masteredCount, setMasteredCount] = useState(0);
  const q = questions[idx];
  const opts = q?.options ? (typeof q.options === "string" ? JSON.parse(q.options) : q.options) : null;
  const letters = ["A","B","C","D"];
  if (!q) return (
    <div style={{ ...s.card, textAlign: "center", padding: "3rem" }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>🎉</div>
      <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>复习完成！</div>
      <div style={{ fontSize: 15, color: "#888", marginBottom: 20 }}>本次掌握 {masteredCount}/{questions.length} 题</div>
      <Btn variant="primary" onClick={onExit}>返回错题本</Btn>
    </div>
  );
  const isCorrect = answered && (opts ? letters[selected] === q.answer : (selected === 0 && q.answer === "正确") || (selected === 1 && q.answer === "错误"));
  const handleSubmit = () => {
    if (selected === null) return;
    setAnswered(true);
    if (isCorrect) { setMasteredCount(c => c+1); if (onMastered) onMastered(q.id || q.question); }
  };
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <Btn size="sm" onClick={onExit}>退出</Btn>
        <div style={{ flex: 1, height: 6, background: "#f0f0f0", borderRadius: 3 }}>
          <div style={{ height: 6, borderRadius: 3, background: G.teal, width: (idx/questions.length*100)+"%" }} />
        </div>
        <span style={{ fontSize: 14, color: "#888" }}>{idx+1}/{questions.length}</span>
      </div>
      <div style={{ ...s.card, marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}><Badge color="red">错题</Badge><Badge color="amber">{q.chapter}</Badge></div>
        <div style={{ fontSize: 18, lineHeight: 1.75, marginBottom: 20 }}>{q.question}</div>
        {opts ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {opts.map((opt, i) => {
              let border = "2px solid #eee", bg = "#fafafa", col = "#333";
              if (answered) { if (letters[i] === q.answer) { bg = G.tealLight; border = "2px solid "+G.teal; col = G.tealDark; } else if (i === selected) { bg = G.redLight; border = "2px solid "+G.red; col = G.red; } } else if (selected === i) { bg = G.tealLight; border = "2px solid "+G.teal; }
              return <div key={i} onClick={() => !answered && setSelected(i)} style={{ padding: "12px 16px", border, borderRadius: 12, cursor: answered ? "default" : "pointer", background: bg, display: "flex", gap: 12, alignItems: "center" }}>
                <div style={{ width: 26, height: 26, borderRadius: "50%", background: selected===i ? G.teal : "transparent", border: "2px solid "+col+"44", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: selected===i ? "#fff" : col, flexShrink: 0 }}>{letters[i]}</div>
                <span style={{ fontSize: 15, color: col }}>{opt}</span>
              </div>;
            })}
          </div>
        ) : (
          <div style={{ display: "flex", gap: 10 }}>
            {["正确","错误"].map((opt, i) => {
              let border = "2px solid #eee", bg = "#fafafa";
              if (answered) { if (opt === q.answer) { bg = G.tealLight; border = "2px solid "+G.teal; } else if (i === selected) { bg = G.redLight; border = "2px solid "+G.red; } } else if (selected === i) { bg = G.tealLight; border = "2px solid "+G.teal; }
              return <div key={i} onClick={() => !answered && setSelected(i)} style={{ flex: 1, padding: "14px 0", border, borderRadius: 12, textAlign: "center", fontSize: 16, fontWeight: 600, cursor: answered ? "default" : "pointer", background: bg }}>{opt}</div>;
            })}
          </div>
        )}
      </div>
      {answered && (
        <div style={{ ...s.card, marginBottom: 14, borderLeft: "4px solid "+(isCorrect ? G.teal : G.red), background: isCorrect ? "#f0fdf8" : "#fff8f8" }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: isCorrect ? G.teal : G.red, marginBottom: 6 }}>
            {isCorrect ? "✅ 答对！已从错题本移除" : "❌ 答错了，正确答案："+q.answer}
          </div>
          <div style={{ fontSize: 14, color: "#444", lineHeight: 1.7 }}>{q.explanation}</div>
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <Btn onClick={onExit}>{isCorrect ? "已掌握，退出" : "退出"}</Btn>
        {!answered
          ? <Btn variant="primary" onClick={handleSubmit} disabled={selected === null}>提交答案</Btn>
          : <Btn variant="primary" onClick={() => { setIdx(i => i+1); setSelected(null); setAnswered(false); }}>{idx < questions.length-1 ? "继续 →" : "完成"}</Btn>}
      </div>
    </div>
  );
}

// ── Wrong Page ─────────────────────────────────────────────────────────────────
function WrongPage({ setPage, sessionAnswers = {} }) {
  const chapterStats = getChapterStats(sessionAnswers);
  const weakChapters = Object.entries(chapterStats)
    .filter(([, s]) => s.total >= 2 && s.correct / s.total < 0.75)
    .sort((a, b) => (a[1].correct/a[1].total) - (b[1].correct/b[1].total));

  const WRONG_QS = [
    ALL_QUESTIONS.find(q => q.id === "4"),
    ALL_QUESTIONS.find(q => q.id === "11"),
    ALL_QUESTIONS.find(q => q.id === "7"),
    ALL_QUESTIONS.find(q => q.id === "26"),
  ].filter(Boolean);

  const [drillMode, setDrillMode] = useState(false);
  const [drillStart, setDrillStart] = useState(0);
  const [mastered, setMastered] = useState(new Set());
  const [aiWrongQs, setAiWrongQs] = useState([]);
  const [regenLoading, setRegenLoading] = useState(false);
  const [regenMsg, setRegenMsg] = useState("");
  const [aiDrillMode, setAiDrillMode] = useState(false);
  const mergedWrong = [...WRONG_QS, ...aiWrongQs];
  const remaining = mergedWrong.filter(q => !mastered.has(q.id || q.question));

  const regenerateWrongQuestions = async () => {
    setRegenLoading(true);
    setRegenMsg("");
    try {
      // 针对最弱章节生成变式题
      const targetChapters = weakChapters.slice(0, 2).map(([ch]) => ch);
      const chapter = targetChapters.length > 0
        ? targetChapters.join(" 和 ")
        : (WRONG_QS[0]?.chapter || "数学综合");
      const aiCfg = getAIConfig();
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chapter, type: "单选题", count: 8,
          userProvider: aiCfg.provider, userKey: aiCfg.key, userCustomUrl: aiCfg.customUrl,
        }),
      });
      const data = await res.json();
      if (data?.error) throw new Error(data.error);
      const rows = (data.questions || []).map((q, idx2) => ({
        id: "ai_wrong_" + Date.now() + "_" + idx2,
        chapter,
        type: q.type || "单选题",
        question: q.question,
        options: q.options || null,
        answer: q.answer,
        explanation: q.explanation || "",
      }));
      if (rows.length === 0) throw new Error("AI 未返回题目，请检查 API Key 配置");
      setAiWrongQs(rows);
      setRegenMsg(`✅ 已针对薄弱章节生成 ${rows.length} 道变式题！点击下方"专项练习"开始练习。`);
    } catch (err) {
      setRegenMsg("❌ 生成失败：" + (err?.message || "请检查 API 设置"));
    }
    setRegenLoading(false);
  };

  if (drillMode) return (
    <div style={{ padding: "2rem", maxWidth: 780, margin: "0 auto" }}>
      <WrongDrill questions={remaining.slice(drillStart)} onExit={() => setDrillMode(false)} onMastered={id => setMastered(s => new Set([...s, id]))} />
    </div>
  );
  if (aiDrillMode && aiWrongQs.length > 0) return (
    <div style={{ padding: "2rem", maxWidth: 780, margin: "0 auto" }}>
      <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 12 }}>
        <Btn onClick={() => setAiDrillMode(false)}>← 返回错题本</Btn>
        <span style={{ fontSize: 16, fontWeight: 700, color: G.blue }}>🤖 AI 变式题专项练习</span>
      </div>
      <WrongDrill questions={aiWrongQs} onExit={() => setAiDrillMode(false)} onMastered={() => {}} />
    </div>
  );

  return (
    <div style={{ padding: "2rem", maxWidth: 900, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 24 }}>
        <Btn size="sm" onClick={() => setPage("首页")}>← 返回</Btn>
        <div style={{ fontSize: 22, fontWeight: 700, color: "#111" }}>错题本 & 薄弱分析</div>
        {remaining.length > 0 && <Badge color="red">{remaining.length} 题</Badge>}
        {mastered.size > 0 && <Badge color="teal">已掌握 {mastered.size}</Badge>}
      </div>

      {/* Weak chapter stats from session */}
      {weakChapters.length > 0 && (
        <div style={{ ...s.card, marginBottom: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>📊 薄弱章节（根据本次答题记录）</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10 }}>
            {weakChapters.map(([ch, stat]) => {
              const pct = Math.round(stat.correct/stat.total*100);
              return (
                <div key={ch} style={{ background: G.redLight, borderRadius: 12, padding: "14px", border: "1px solid "+G.red+"22" }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: G.red, marginBottom: 4 }}>{ch}</div>
                  <div style={{ fontSize: 26, fontWeight: 800, color: G.red, marginBottom: 4 }}>{pct}%</div>
                  <div style={{ fontSize: 12, color: "#888", marginBottom: 8 }}>{stat.correct}/{stat.total} 题正确</div>
                  <ProgressBar value={stat.correct} max={stat.total} color={G.red} height={5} />
                  <button onClick={() => setPage("题库练习")} style={{ marginTop: 10, width: "100%", padding: "7px 0", background: G.red, color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "inherit" }}>专项练习 →</button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Wrong list */}
      <div style={{ ...s.card }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, paddingBottom: 14, borderBottom: "1px solid #f0f0f0" }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>收录错题 <span style={{ fontSize: 14, color: "#aaa", fontWeight: 400 }}>({remaining.length}题)</span></div>
          <div style={{ display: "flex", gap: 8 }}>
            {remaining.length > 0 && (
              <button onClick={regenerateWrongQuestions} disabled={regenLoading} style={{ padding: "10px 14px", background: G.blue, color: "#fff", border: "none", borderRadius: 12, cursor: "pointer", fontSize: 13, fontWeight: 700, fontFamily: "inherit" }}>
                {regenLoading ? "AI生成中…" : "AI变式出题"}
              </button>
            )}
            {remaining.length > 0 && (
              <button onClick={() => { setDrillStart(0); setDrillMode(true); }} style={{ padding: "10px 22px", background: G.teal, color: "#fff", border: "none", borderRadius: 12, cursor: "pointer", fontSize: 14, fontWeight: 700, fontFamily: "inherit" }}>🔄 全部复习</button>
            )}
          </div>
        </div>
        {regenMsg && <div style={{ padding: "10px 12px", borderRadius: 10, background: G.blueLight, color: G.blue, marginBottom: 12, fontSize: 14 }}>{regenMsg}</div>}
        {aiWrongQs.length > 0 && (
          <div style={{ marginBottom: 14, padding: "14px 16px", background: "linear-gradient(135deg,#eff6ff,#dbeafe)", borderRadius: 12, border: "1px solid #bfdbfe", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div>
              <div style={{ fontWeight: 700, color: G.blue, fontSize: 14, marginBottom: 2 }}>🤖 AI 变式题已就绪 — {aiWrongQs.length} 道</div>
              <div style={{ fontSize: 12, color: "#64748b" }}>针对薄弱章节量身定制，点击右侧开始专项练习</div>
            </div>
            <button onClick={() => setAiDrillMode(true)} style={{ padding: "10px 20px", background: G.blue, color: "#fff", border: "none", borderRadius: 10, cursor: "pointer", fontSize: 13, fontWeight: 700, fontFamily: "inherit", flexShrink: 0, whiteSpace: "nowrap" }}>🎯 专项练习</button>
          </div>
        )}
        {aiWrongQs.length > 0 && (
          <div style={{ marginBottom: 14, padding: "14px 16px", background: "linear-gradient(135deg,#eff6ff,#dbeafe)", borderRadius: 12, border: "1px solid #bfdbfe", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontWeight: 700, color: G.blue, fontSize: 14, marginBottom: 2 }}>🤖 AI 变式题已生成 {aiWrongQs.length} 道</div>
              <div style={{ fontSize: 12, color: "#64748b" }}>针对你的薄弱点量身定制，点击右侧开始专项练习</div>
            </div>
            <button onClick={() => setAiDrillMode(true)} style={{ padding: "10px 20px", background: G.blue, color: "#fff", border: "none", borderRadius: 10, cursor: "pointer", fontSize: 13, fontWeight: 700, fontFamily: "inherit", flexShrink: 0 }}>🎯 专项练习</button>
          </div>
        )}
        {remaining.length === 0 && <div style={{ textAlign: "center", padding: "3rem", color: "#888" }}><div style={{ fontSize: 40, marginBottom: 10 }}>🎉</div><div style={{ fontSize: 18, fontWeight: 600 }}>所有错题已掌握！</div></div>}
        {remaining.map((q, i) => (
          <div key={i} style={{ padding: "16px 0", borderBottom: i < remaining.length-1 ? "1px solid #f5f5f5" : "none", display: "flex", alignItems: "flex-start", gap: 14 }}>
            <div style={{ width: 10, height: 10, borderRadius: "50%", background: G.red, marginTop: 8, flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, color: "#111", marginBottom: 4 }}>{q.question}</div>
              <div style={{ fontSize: 13, color: G.tealDark, marginBottom: 3 }}>✓ {q.answer}</div>
              <div style={{ fontSize: 12, color: "#aaa" }}>{q.chapter} · {q.type}</div>
            </div>
            <button onClick={() => { setDrillStart(i); setDrillMode(true); }} style={{ padding: "8px 14px", background: G.redLight, color: G.red, border: "1px solid "+G.red+"44", borderRadius: 10, cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: "inherit", flexShrink: 0 }}>重做</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Teacher Page ──────────────────────────────────────────────────────────────

// ── Materials Library Page ──────────────────────────────────────────────────
function MaterialsPage({ setPage, profile }) {
  const [materials, setMaterials] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [note, setNote] = useState("");
  const [noteSaved, setNoteSaved] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [filter, setFilter] = useState("全部");
  const [search, setSearch] = useState("");
  const [deletingId, setDeletingId] = useState(null);
  const loadMaterials = async () => {
    let query = supabase.from("materials").select("*").order("created_at", { ascending: false });
    let dataRows = [];
    let err = null;
    try {
      const { data, error } = await query;
      dataRows = data || [];
      err = error || null;
    } catch (e) {
      err = e;
    }
    // If status column does not exist yet, still load list.
    if (err && isMissingMaterialsStatusColumn(err)) {
      const fallback = await supabase.from("materials").select("*").order("created_at", { ascending: false });
      dataRows = fallback.data || [];
    }
    const visible = profile?.role === "teacher"
      ? dataRows
      : dataRows.filter(m => {
          const approved = (m.status || "approved") === "approved";
          const isOwner = m.uploaded_by === profile?.id;
          // is_public 字段不存在时（旧数据）默认视为公开
          const pub = m.is_public !== false;
          return isOwner || (approved && pub);
        });
    setMaterials(visible);
    setLoading(false);
  };

  useEffect(() => {
    loadMaterials();
  }, [profile?.id, profile?.role]);

  const deleteMaterial = async (m) => {
    if (!window.confirm(`确认删除资料「${m.title}」？`)) return;
    setDeletingId(m.id);
    const { error } = await supabase.from("materials").delete().eq("id", m.id);
    if (error) alert("删除失败：" + error.message);
    await loadMaterials();
    setDeletingId(null);
  };

  useEffect(() => {
    if (!selected || !profile) return;
    setNote(""); setNoteSaved(false);
    supabase.from("notes").select("content").eq("user_id", profile.id).eq("material_id", selected.id).single().then(({ data }) => {
      if (data) setNote(data.content);
    });
  }, [selected, profile]);

  const saveNote = async () => {
    if (!profile || !selected) return;
    setSavingNote(true);
    const { error } = await supabase.from("notes").upsert({ user_id: profile.id, material_id: selected.id, content: note, updated_at: new Date().toISOString() }, { onConflict: "user_id,material_id" });
    if (!error) { setNoteSaved(true); setTimeout(() => setNoteSaved(false), 2000); }
    setSavingNote(false);
  };

  const courses = ["全部", ...new Set(materials.map(m => m.course))];
  const filtered = materials.filter(m => (filter === "全部" || m.course === filter) && (!search.trim() || [m.title, m.course, m.description].some(s => s && s.toLowerCase().includes(search.toLowerCase()))));

  if (selected) return (
    <div style={{ padding: "2rem", maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
        <Btn size="sm" onClick={() => setSelected(null)}>← 返回资料库</Btn>
        <div style={{ fontSize: 20, fontWeight: 700, color: "#111" }}>{selected.title}</div>
        <Badge color={getCourseColor(selected.course)}>{selected.course}</Badge>
        {selected.chapter && <Badge color="amber">{selected.chapter}</Badge>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 16 }}>
        {/* PDF Viewer */}
        <div style={{ ...s.card, padding: 0, overflow: "hidden" }}>
          {selected.file_data ? (
            <iframe
              src={selected.file_data}
              style={{ width: "100%", height: "75vh", border: "none" }}
              title={selected.title}
            />
          ) : (
            <div style={{ height: "75vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#aaa", gap: 14 }}>
              <div style={{ fontSize: 48 }}>📄</div>
              <div style={{ fontSize: 16 }}>PDF 文件未上传或已过期</div>
              <div style={{ fontSize: 13 }}>请联系教师重新上传</div>
            </div>
          )}
        </div>

        {/* Notes panel */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ ...s.card }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>📋 资料信息</div>
            <div style={{ fontSize: 13, color: "#888", lineHeight: 1.8 }}>
              <div>上传者：{selected.uploader_name || "用户"}</div>
              <div>文件：{selected.file_name}</div>
              <div>大小：{selected.file_size}</div>
              <div>时间：{new Date(selected.created_at).toLocaleDateString("zh-CN")}</div>
            </div>
            {selected.description && (
              <div style={{ marginTop: 12, fontSize: 14, color: "#444", lineHeight: 1.6, padding: "10px 14px", background: G.tealLight, borderRadius: 10 }}>{selected.description}</div>
            )}
          </div>

          <div style={{ ...s.card, flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>✏️ 我的笔记</div>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="在此记录学习笔记、重点、疑问…支持 Markdown 格式"
              style={{ width: "100%", minHeight: 200, fontSize: 14, padding: "12px", border: "1.5px solid #e0e0e0", borderRadius: 10, fontFamily: "inherit", resize: "vertical", color: "#111", lineHeight: 1.7, boxSizing: "border-box" }}
            />
            {/* Image upload for notes */}
            <div style={{ marginTop: 10, marginBottom: 10 }}>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 14px", background: G.purpleLight, color: G.purple, borderRadius: 10, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
                🖼️ 插入图片
                <input type="file" accept="image/*" style={{ display: "none" }} onChange={async e => {
                  const file = e.target.files[0]; if (!file) return;
                  if (file.size > 2 * 1024 * 1024) { alert("图片不能超过 2MB"); return; }
                  const b64 = await new Promise(res => { const r = new FileReader(); r.onload = ev => res(ev.target.result); r.readAsDataURL(file); });
                  setNote(n => n + `
![图片](${b64})
`);
                  e.target.value = "";
                }} />
              </label>
              <span style={{ marginLeft: 10, fontSize: 12, color: "#aaa" }}>图片限 2MB</span>
            </div>
            {/* Preview images in note */}
            {note.match(/!\[.*?\]\((data:image[^)]+)\)/g) && (
              <div style={{ marginBottom: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                {note.match(/!\[.*?\]\((data:image[^)]+)\)/g)?.map((m, i) => {
                  const src = m.match(/\((data:image[^)]+)\)/)?.[1];
                  return src ? <img key={i} src={src} alt="笔记图片" style={{ height: 80, borderRadius: 8, border: "1px solid #eee", objectFit: "cover" }} /> : null;
                })}
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 12, color: "#aaa" }}>{note.replace(/!\[.*?\]\(data:image[^)]+\)/g, "[图]").length} 字</span>
              <button onClick={saveNote} disabled={savingNote || !note.trim()} style={{ padding: "9px 20px", background: noteSaved ? G.tealLight : G.teal, color: noteSaved ? G.tealDark : "#fff", border: "none", borderRadius: 10, cursor: savingNote ? "not-allowed" : "pointer", fontSize: 14, fontWeight: 600, fontFamily: "inherit" }}>
                {noteSaved ? "✓ 已保存" : savingNote ? "保存中…" : "保存笔记"}
              </button>
            </div>
          </div>

          <button onClick={() => setPage("quiz_material_" + selected.id + "_" + encodeURIComponent(selected.title))} style={{ width: "100%", padding: "12px 0", background: G.teal, color: "#fff", border: "none", borderRadius: 12, cursor: "pointer", fontSize: 15, fontWeight: 700, fontFamily: "inherit" }}>
            ✏️ 基于此资料做练习题
          </button>
          <button onClick={() => setPage("题库练习")} style={{ width: "100%", padding: "10px 0", background: "transparent", color: G.blue, border: "1.5px solid " + G.blue, borderRadius: 12, cursor: "pointer", fontSize: 14, fontWeight: 600, fontFamily: "inherit", marginTop: 8 }}>
            📚 进入全部题库
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ padding: "2rem", maxWidth: 1000, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 26, fontWeight: 700, color: "#111", marginBottom: 4 }}>📚 教材资料库</div>
          <div style={{ fontSize: 15, color: "#888" }}>所有上传的教材均可查看和做笔记</div>
        </div>
        <Btn variant="primary" onClick={() => setPage("上传资料")}>+ 上传资料</Btn>
      </div>

      {/* Search + Filter */}
      <div style={{ marginBottom: 16 }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 搜索资料名称、课程或简介…" style={{ width: "100%", fontSize: 15, padding: "12px 16px", border: "1.5px solid #e0e0e0", borderRadius: 12, fontFamily: "inherit", color: "#111", boxSizing: "border-box", marginBottom: 12 }} />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {courses.map(c => (
            <button key={c} onClick={() => setFilter(c)} style={{ fontSize: 14, padding: "8px 18px", borderRadius: 20, border: "2px solid " + (filter === c ? G.teal : "#e0e0e0"), cursor: "pointer", fontFamily: "inherit", fontWeight: filter === c ? 700 : 400, background: filter === c ? G.teal : "#fff", color: filter === c ? "#fff" : "#666" }}>{c}</button>
          ))}
        </div>
      </div>

      {loading && <div style={{ textAlign: "center", padding: "4rem", color: "#aaa", fontSize: 16 }}>加载中…</div>}

      {!loading && filtered.length === 0 && (
        <div style={{ ...s.card, textAlign: "center", padding: "4rem" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📭</div>
          <div style={{ fontSize: 18, fontWeight: 600, color: "#333", marginBottom: 8 }}>暂无资料</div>
          <div style={{ fontSize: 15, color: "#888" }}>{profile?.role === "teacher" ? "点击右上角上传第一份教材" : "请等待教师上传教材"}</div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
        {filtered.map(m => (
          <div key={m.id} onClick={() => setSelected(m)} style={{ ...s.card, cursor: "pointer", transition: "transform .15s, box-shadow .15s", borderTop: `4px solid ${getCourseBorderColor(m.course)}` }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>📄</div>
            <div style={{ fontSize: 17, fontWeight: 700, color: "#111", marginBottom: 6 }}>{m.title}</div>
            {m.description && <div style={{ fontSize: 14, color: "#666", marginBottom: 10, lineHeight: 1.6, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{m.description}</div>}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
              <Badge color={getCourseColor(m.course)}>{m.course}</Badge>
              {m.chapter && <Badge color="amber">{m.chapter}</Badge>}
              {(m.status || "approved") !== "approved" && <Badge color="red">待审核</Badge>}
              {m.is_public === false && <Badge color="blue">🔒 仅自己</Badge>}
            </div>
            <div style={{ fontSize: 12, color: "#aaa", borderTop: "1px solid #f5f5f5", paddingTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>{m.uploader_name || "用户"} 上传 · {new Date(m.created_at).toLocaleDateString("zh-CN")}</span>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={e => { e.stopPropagation(); setPage("quiz_material_" + m.id + "_" + encodeURIComponent(m.title)); }} style={{ padding: "4px 10px", background: G.blue, color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 11, fontWeight: 600, fontFamily: "inherit" }}>做题 ✏️</button>
                {profile?.role === "teacher" && (
                  <button onClick={e => { e.stopPropagation(); deleteMaterial(m); }} disabled={deletingId === m.id} style={{ padding: "4px 10px", background: G.red, color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 11, fontWeight: 600, fontFamily: "inherit" }}>
                    {deletingId === m.id ? "删除中…" : "删除"}
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── MathText: 渲染含 LaTeX 公式的文本 ────────────────────────────────────────
function MathText({ text }) {
  if (!text) return <span />;
  const parts = text.split(/(\$\$[\s\S]*?\$\$|\$[^$\n]+?\$)/);
  return (
    <span>
      {parts.map((part, i) => {
        if (part.startsWith('$$') && part.endsWith('$$') && part.length > 4) {
          const inner = part.slice(2, -2).trim();
          try {
            const html = katex.renderToString(inner, { throwOnError: false, displayMode: true });
            return <div key={i} style={{ overflowX: 'auto', margin: '6px 0' }} dangerouslySetInnerHTML={{ __html: html }} />;
          } catch(e) { return <code key={i}>{part}</code>; }
        } else if (part.startsWith('$') && part.endsWith('$') && part.length > 2) {
          const inner = part.slice(1, -1).trim();
          try {
            const html = katex.renderToString(inner, { throwOnError: false, displayMode: false });
            return <span key={i} dangerouslySetInnerHTML={{ __html: html }} />;
          } catch(e) { return <code key={i}>{part}</code>; }
        }
        return <span key={i} style={{ whiteSpace: 'pre-wrap' }}>{part}</span>;
      })}
    </span>
  );
}
function MaterialChatPage({ setPage, profile }) {
  const [materials, setMaterials] = useState([]);
  const [materialId, setMaterialId] = useState("");
  const [question, setQuestion] = useState("");
  const [chatting, setChatting] = useState(false);
  const [history, setHistory] = useState([]);
  const [chatMode, setChatMode] = useState("chat");
  const chatEndRef = useRef(null);
  const selectedMaterial = materials.find(m => m.id === materialId);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [history]);

  useEffect(() => {
    const loadChatMaterials = async () => {
      let rows = [];
      let { data, error } = await supabase.from("materials").select("id,title,course,status,uploaded_by").order("created_at", { ascending: false });
      if (error && isMissingMaterialsStatusColumn(error)) {
        const fallback = await supabase.from("materials").select("id,title,course,uploaded_by").order("created_at", { ascending: false });
        data = fallback.data;
      }
      rows = data || [];
      const visible = profile?.role === "teacher"
        ? rows
        : rows.filter(m => m.uploaded_by === profile?.id || ((m.status || "approved") === "approved" && m.is_public !== false));
      setMaterials(visible);
      if (visible[0]?.id) setMaterialId(visible[0].id);
    };
    loadChatMaterials();
  }, [profile?.id, profile?.role]);

  const ask = async () => {
    if (!materialId || !question.trim()) return;
    setChatting(true);
    const selected = materials.find(m => m.id === materialId);
    const askText = question.trim();
    setQuestion("");
    setHistory(prev => [...prev, { role: "user", text: askText }]);
    try {
      // 获取资料相关题目的解析作为上下文
      let contextChunks = "";
      try {
        const { data } = await supabase.from("questions")
          .select("question,explanation,answer")
          .eq("material_id", materialId)
          .limit(12);
        if (data && data.length > 0) {
          contextChunks = data.map(q => `题：${q.question}\n答：${q.answer}（${q.explanation || ""}）`).join("\n\n");
        }
      } catch (e) {}

      const aiCfg = getAIConfig();
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: chatMode,
          question: askText,
          materialTitle: selected?.title || "本资料",
          materialContext: contextChunks || "",
          conversationHistory: history.slice(-12).map(h => ({ role: h.role, content: h.text })),
          userProvider: aiCfg.provider,
          userKey: aiCfg.key,
          userCustomUrl: aiCfg.customUrl,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setHistory(prev => [...prev, { role: "assistant", text: data.answer || "暂时无法回答", sources: [] }]);
    } catch (err) {
      setHistory(prev => [...prev, { role: "assistant", text: "回答失败：" + (err?.message || "未知错误。请在首页「⚙️ AI 设置」配置 API Key。"), sources: [] }]);
    }
    setChatting(false);
  };

  return (
    <div style={{ padding: "2rem", maxWidth: 980, margin: "0 auto" }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <Btn size="sm" onClick={() => setPage("资料库")}>← 返回资料库</Btn>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{chatMode === "tutor" ? "🤖 AI 复习助教" : "💬 资料对话"}</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => { setChatMode("chat"); setHistory([]); }} style={{ padding: "7px 18px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", background: chatMode === "chat" ? G.teal : "#f0f0f0", color: chatMode === "chat" ? "#fff" : "#666", border: "none", borderRadius: 20, cursor: "pointer" }}>💬 自由对话</button>
          <button onClick={() => { setChatMode("tutor"); setHistory([]); }} style={{ padding: "7px 18px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", background: chatMode === "tutor" ? G.purple : "#f0f0f0", color: chatMode === "tutor" ? "#fff" : "#666", border: "none", borderRadius: 20, cursor: "pointer" }}>🤖 复习助教</button>
        </div>
        {chatMode === "tutor" && (
          <div style={{ marginTop: 12, padding: "12px 16px", background: "#F0F4FF", borderRadius: 12, border: "1px solid #C7D9FF", fontSize: 13, color: "#3B5998", lineHeight: 1.6 }}>
            <strong>AI 复习助教模式：</strong>逐知识点教学+即时检验，适应你的节奏。试试：「帮我制定复习计划」「我不会XX，从零教我」
          </div>
        )}
      </div>
      <div style={{ ...s.card, marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: "#666", marginBottom: 8 }}>选择资料</div>
        <select value={materialId} onChange={(e) => setMaterialId(e.target.value)} style={s.input}>
          {materials.map(m => <option key={m.id} value={m.id}>{m.title} · {m.course}</option>)}
        </select>
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <Btn
            size="sm"
            variant="primary"
            onClick={() => materialId && selectedMaterial && setPage("quiz_material_" + materialId + "_" + encodeURIComponent(selectedMaterial.title || ""))}
            disabled={!materialId || !selectedMaterial}
          >
            去做这份资料的题
          </Btn>
          <Btn size="sm" onClick={() => setPage("知识点")}>看知识点卡片</Btn>
        </div>
      </div>
      <div style={{ ...s.card, padding: 0, overflow: "hidden" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 0, minHeight: 400, maxHeight: 480, overflowY: "auto", padding: "16px 16px 8px" }}>
          {history.length === 0 && (
            <div style={{ textAlign: "center", paddingTop: 60, color: "#bbb" }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>💬</div>
              <div style={{ fontSize: 14, lineHeight: 1.8, color: "#666" }}>
                {chatMode === "tutor" ? (
                  <>
                    <div style={{ fontWeight: 600, marginBottom: 8, color: "#555" }}>🤖 AI 复习助教就绪</div>
                    试试说：<br />
                    「帮我制定 3 天复习计划」<br />
                    「教我这份资料的第一章」<br />
                    「我不会插值法，从零教我」
                  </>
                ) : (
                  <>
                    可以问我：<br />
                    「这份资料的核心知识点是什么？」<br />
                    「请给我一道例题并详细讲解步骤」
                  </>
                )}
              </div>
            </div>
          )}
          {history.map((m, idx) => (
            <div key={idx} style={{ display: "flex", gap: 10, marginBottom: 16, flexDirection: m.role === "user" ? "row-reverse" : "row", alignItems: "flex-start" }}>
              {m.role === "user" ? (
                <div style={{ width: 34, height: 34, borderRadius: "50%", background: G.teal, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, color: "#fff", flexShrink: 0 }}>
                  {(profile?.name || "U")[0].toUpperCase()}
                </div>
              ) : (
                <div style={{ width: 34, height: 34, borderRadius: "50%", background: chatMode === "tutor" ? G.blue : G.purple, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>{chatMode === "tutor" ? "🤖" : "📐"}</div>
              )}
              <div style={{ maxWidth: "80%", background: m.role === "user" ? G.teal : "#fff", color: m.role === "user" ? "#fff" : "#222", borderRadius: m.role === "user" ? "16px 4px 16px 16px" : "4px 16px 16px 16px", padding: "10px 14px", fontSize: 14, lineHeight: 1.8, boxShadow: "0 1px 6px rgba(0,0,0,0.07)", border: m.role === "assistant" ? "1px solid #f0f0f0" : "none" }}>
                <MathText text={m.text} />
                {m.role === "assistant" && (
                  <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap", borderTop: "1px solid #f0f0f0", paddingTop: 8 }}>
                    <button onClick={() => materialId && selectedMaterial && setPage("quiz_material_" + materialId + "_" + encodeURIComponent(selectedMaterial.title || ""))} style={{ padding: "4px 10px", background: G.blueLight, color: G.blue, border: "none", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "inherit" }}>✏️ 做相关题目</button>
                    <button onClick={() => setPage("知识点")} style={{ padding: "4px 10px", background: G.purpleLight, color: G.purple, border: "none", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "inherit" }}>📚 知识点卡片</button>
                  </div>
                )}
              </div>
            </div>
          ))}
          {chatting && (
            <div style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 16 }}>
              <div style={{ width: 34, height: 34, borderRadius: "50%", background: G.purple, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>📐</div>
              <div style={{ background: "#fff", border: "1px solid #f0f0f0", borderRadius: "4px 16px 16px 16px", padding: "12px 16px", fontSize: 14, color: "#999" }}>··· 思考中</div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>
        <div style={{ borderTop: "1px solid #f0f0f0", padding: "12px 16px", display: "flex", gap: 10, background: "#fafafa" }}>
          <input value={question} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !chatting) ask(); }} placeholder="输入你的问题，按 Enter 发送…" style={{ ...s.input, marginBottom: 0, flex: 1 }} />
          <Btn variant="primary" onClick={ask} disabled={chatting || !materialId || !question.trim()}>{chatting ? "…" : "发送"}</Btn>
        </div>
      </div>
    </div>
  );
}

// ── Teacher Page ──────────────────────────────────────────────────────────────
function TeacherPage({ setPage, profile }) {
  const [tab, setTab] = useState("学生管理");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiQuestions, setAiQuestions] = useState([]);
  const [aiChapter, setAiChapter] = useState("Ch.1 · 方程求解");
  const [aiType, setAiType] = useState("单选题");
  const [aiCount, setAiCount] = useState("3");
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [aiError, setAiError] = useState("");
  const [dbQuestions, setDbQuestions] = useState([]);
  const [saving, setSaving] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [hwAssigned, setHwAssigned] = useState({});
  const pdfRef = useRef();
  // Material upload states
  const [matTitle, setMatTitle] = useState("");
  const [matCourse, setMatCourse] = useState("数值分析");
  const [matChapter, setMatChapter] = useState("");
  const [matDesc, setMatDesc] = useState("");
  const [matFile, setMatFile] = useState(null);
  const [matError, setMatError] = useState("");
  const [matSuccess, setMatSuccess] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [extractStep, setExtractStep] = useState("");
  const [extractResult, setExtractResult] = useState(null);
  const [uploadedMaterials, setUploadedMaterials] = useState([]);
  const [reviewBusyId, setReviewBusyId] = useState(null);
  const [reviewMsg, setReviewMsg] = useState("");
  const [seeding, setSeeding] = useState(false);
  const [seedMsg, setSeedMsg] = useState("");
  const [previewQuestion, setPreviewQuestion] = useState(null);
  const [importingCsv, setImportingCsv] = useState(false);
  const [importMsg, setImportMsg] = useState("");
  const csvRef = useRef();
  const [analytics, setAnalytics] = useState({ students: 0, answers: 0, accuracy: 0, weak: [], mastery: [] });

  const refreshMaterials = async () => {
    const { data } = await supabase.from("materials").select("*").order("created_at", { ascending: false });
    if (data) setUploadedMaterials(data);
  };

  useEffect(() => {
    supabase.from("questions").select("*").order("created_at", { ascending: false }).then(({ data }) => { if (data) setDbQuestions(data); });
    refreshMaterials();
    Promise.all([
      supabase.from("profiles").select("id").eq("role", "student"),
      supabase.from("answers").select("is_correct,question_id"),
      supabase.from("questions").select("id,chapter"),
      supabase.from("questions") /* topic_mastery stub */.select("status"),
    ]).then(([stuRes, ansRes, qRes, masteryRes]) => {
      const students = (stuRes.data || []).length;
      const answers = ansRes.data || [];
      const qmap = {};
      (qRes.data || []).forEach(q => { qmap[q.id] = q.chapter || "未知章节"; });
      const chapterStat = {};
      answers.forEach(a => {
        const ch = qmap[a.question_id] || "未知章节";
        if (!chapterStat[ch]) chapterStat[ch] = { total: 0, correct: 0 };
        chapterStat[ch].total += 1;
        if (a.is_correct) chapterStat[ch].correct += 1;
      });
      const weak = Object.entries(chapterStat)
        .filter(([, s]) => s.total >= 2)
        .map(([ch, s]) => ({ chapter: ch, pct: Math.round((s.correct / s.total) * 100), total: s.total }))
        .sort((a, b) => a.pct - b.pct)
        .slice(0, 6);
      const masteryRows = masteryRes.data || [];
      const done = masteryRows.filter(r => r.status === "done").length;
      const masteryPct = masteryRows.length ? Math.round((done / masteryRows.length) * 100) : 0;
      const correctCount = answers.filter(a => a.is_correct).length;
      const accuracy = answers.length ? Math.round((correctCount / answers.length) * 100) : 0;
      setAnalytics({ students, answers: answers.length, accuracy, weak, mastery: [{ label: "知识点掌握率", value: masteryPct }] });
    });
  }, []);

  const pendingMaterials = uploadedMaterials.filter(m => (m.status || "approved") === "pending");
  const reviewMaterial = async (material, status) => {
    setReviewMsg("");
    setReviewBusyId(material.id);
    const payload = {
      status,
      reviewed_by: profile?.id || null,
      reviewed_at: new Date().toISOString(),
    };
    let { error } = await supabase.from("materials").update(payload).eq("id", material.id);
    if (error && isMissingMaterialsStatusColumn(error)) {
      error = null;
      if (status === "approved") {
        try {
          await processMaterialWithAI({
            material: { ...material, status: "approved" },
            file: null,
            fallbackText: `${material?.title || ""} ${material?.description || ""}`,
            genCount: 10,
            actorName: profile?.name || "教师",
          });
        } catch (e) {}
      }
      setReviewMsg(
        status === "approved"
          ? "已触发资料解析。若需在后台区分「待审核」，请在 Supabase 执行 sql/materials_review_workflow.sql 添加 status 列。"
          : "数据库暂无 status 列，无法写入驳回状态；请执行 sql/materials_review_workflow.sql 后重试。"
      );
      await refreshMaterials();
    } else if (error) {
      setReviewMsg("审核失败：" + error.message);
    } else {
      if (status === "approved") {
        try {
          await processMaterialWithAI({
            material: { ...material, status: "approved" },
            file: null,
            fallbackText: `${material?.title || ""} ${material?.description || ""}`,
            genCount: 10,
            actorName: profile?.name || "教师",
          });
        } catch (e) {}
      }
      setReviewMsg(status === "approved" ? "已通过并发布到资料库。" : "已驳回该资料。");
      await refreshMaterials();
    }
    setReviewBusyId(null);
  };

  const handlePdfDrop = useCallback((e) => {
    e.preventDefault();
    const files = [...(e.dataTransfer?.files || e.target.files || [])];
    setUploadedFiles(prev => [...prev, ...files.map(f => ({ name: f.name, size: (f.size / 1024).toFixed(0) + " KB", date: new Date().toLocaleDateString("zh-CN") }))]);
  }, []);

  const generateQuestions = async (targetChapter) => {
    const chapter = targetChapter || aiChapter;
    setAiLoading(true); setAiError(""); setAiQuestions([]);
    try {
      const aiCfg = getAIConfig();
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chapter, type: aiType, count: aiCount,
          userProvider: aiCfg.provider, userKey: aiCfg.key, userCustomUrl: aiCfg.customUrl,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setAiQuestions(data.questions);
      if (targetChapter) setTab("AI 出题");
    } catch (err) {
      setAiError("生成失败：" + err.message);
    }
    setAiLoading(false);
  };

  const handleUploadAndExtract = async () => {
    if (!matFile || !matTitle) return;
    setExtracting(true); setMatError(""); setMatSuccess(""); setExtractResult(null);
    try {
      // Step 1: Check file size and read as base64
      setExtractStep("读取 PDF 文件…");
      if (matFile.size > 5 * 1024 * 1024) {
        throw new Error("文件过大（超过 5MB），请压缩后重试或上传较小的文件");
      }
      const fileData = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result);
        reader.onerror = () => reject(new Error("读取失败"));
        reader.readAsDataURL(matFile);
      });

      // Step 2: Extract text from PDF (read as text)
      setExtractStep("提取 PDF 文字内容…");
      const textReader = new FileReader();
      const pdfText = await new Promise((resolve) => {
        textReader.onload = e => resolve(e.target.result || "");
        textReader.onerror = () => resolve("");
        textReader.readAsText(matFile);
      });

      // Step 3: Call AI extraction API
      setExtractStep("AI 正在分析教材内容并生成题目…");
      const aiCfg = getAIConfig();
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: pdfText, course: matCourse, chapter: matChapter, count: 5,
          userProvider: aiCfg.provider, userKey: aiCfg.key, userCustomUrl: aiCfg.customUrl,
        }),
      });
      const result = await res.json();
      if (result.error) throw new Error(result.error);
      setExtractResult(result);

      // Step 4: Save material to Supabase
      setExtractStep("保存教材到资料库…");
      const { data: matData, error: matErr } = await supabase.from("materials").insert({
        title: matTitle, course: matCourse, chapter: matChapter, description: matDesc,
        file_name: matFile.name, file_size: (matFile.size / 1024).toFixed(0) + " KB",
        file_data: fileData, uploader_name: "教师",
      }).select().single();
      if (matErr) throw new Error("保存资料失败: " + matErr.message);
      setUploadedMaterials(prev => [matData, ...prev]);

      // Step 5: Save questions to DB
      setExtractStep("保存题目到题库…");
      if (result.questions?.length > 0) {
        const qs = result.questions.map(q => ({
          chapter: matChapter || matCourse, course: matCourse,
          type: "单选题", question: q.question,
          options: q.options, answer: q.answer, explanation: q.explanation,
        }));
        await supabase.from("questions").insert(qs);
        const { data: newQs } = await supabase.from("questions").select("*").order("created_at", { ascending: false });
        if (newQs) setDbQuestions(newQs);
      }

      setMatSuccess(`上传成功！提取了 ${result.topics?.length || 0} 个知识点，生成了 ${result.questions?.length || 0} 道题目，已发布到资料库。`);
      setMatTitle(""); setMatChapter(""); setMatDesc(""); setMatFile(null);
    } catch (err) {
      setMatError("上传失败：" + err.message);
    }
    setExtracting(false); setExtractStep("");
  };

  const saveToDb = async (q) => {
    setSaving(true);
    const { error } = await supabase.from("questions").insert({
      chapter: aiChapter, course: aiChapter.includes("优化") ? "最优化" : "数值分析",
      type: aiType, question: q.question, options: q.options, answer: q.answer, explanation: q.explanation,
    });
    if (!error) {
      const { data } = await supabase.from("questions").select("*").order("created_at", { ascending: false });
      if (data) setDbQuestions(data);
      alert("已保存到题库！");
    }
    setSaving(false);
  };

  const deleteQuestion = async (id) => {
    await supabase.from("questions").delete().eq("id", id);
    setDbQuestions(prev => prev.filter(q => q.id !== id));
  };
  const seedQuestionBank = async () => {
    setSeeding(true);
    setSeedMsg("");
    try {
      const { data: existing } = await supabase.from("questions").select("question");
      const exists = new Set((existing || []).map(q => q.question));
      const rows = ALL_QUESTIONS
        .filter(q => !exists.has(q.question))
        .map((q) => ({
          chapter: q.chapter,
          course: q.chapter?.startsWith("最优化") ? "最优化" : "数值分析",
          type: q.type,
          question: q.question,
          options: q.options,
          answer: q.answer,
          explanation: q.explanation,
          difficulty: "基础",
          created_by: profile?.id || null,
        }));
      if (rows.length === 0) {
        setSeedMsg("当前数据库已包含基础题库，无需重复导入。");
      } else {
        const { error } = await supabase.from("questions").insert(rows);
        if (error) throw error;
        setSeedMsg(`导入完成：新增 ${rows.length} 道基础题目。`);
      }
      const { data } = await supabase.from("questions").select("*").order("created_at", { ascending: false });
      if (data) setDbQuestions(data);
    } catch (err) {
      setSeedMsg("导入失败：" + (err?.message || "未知错误"));
    }
    setSeeding(false);
  };
  const parseCsvLine = (line) => {
    const out = [];
    let cur = "";
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuote = !inQuote;
        }
      } else if (ch === "," && !inQuote) {
        out.push(cur.trim());
        cur = "";
      } else {
        cur += ch;
      }
    }
    out.push(cur.trim());
    return out;
  };
  const parseCsvText = (text) => {
    const lines = (text || "").replace(/\r/g, "").split("\n").filter(Boolean);
    if (lines.length < 2) return [];
    const headers = parseCsvLine(lines[0]).map(h => h.trim());
    return lines.slice(1).map((line) => {
      const cols = parseCsvLine(line);
      const row = {};
      headers.forEach((h, i) => { row[h] = cols[i] || ""; });
      return row;
    });
  };
  const normalizeOptions = (raw) => {
    const txt = String(raw || "").trim();
    if (!txt) return null;
    return txt.split("|").map(s => s.trim()).filter(Boolean);
  };
  const normalizeAnswer = (type, answer) => {
    const a = String(answer || "").trim().toUpperCase().replace(/\s+/g, "");
    if (type === "单选题") return a.replace("，", ",");
    if (type === "多选题") return a.replace("，", ",");
    return String(answer || "").trim();
  };
  const handleImportCsv = async (file) => {
    if (!file) return;
    setImportingCsv(true);
    setImportMsg("");
    try {
      const text = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(String(e.target?.result || ""));
        reader.onerror = () => reject(new Error("读取 CSV 失败"));
        reader.readAsText(file, "utf-8");
      });
      const rows = parseCsvText(text);
      if (rows.length === 0) throw new Error("CSV 没有可导入的数据行");
      const legalTypes = new Set(["单选题", "多选题", "填空题", "判断题", "计算题"]);
      const legalDifficulty = new Set(["基础", "进阶", "综合"]);
      const errors = [];
      const normalized = rows.map((r, idx) => {
        const lineNo = idx + 2;
        const chapter = (r.chapter || "").trim();
        const course = (r.course || "").trim() || (chapter.startsWith("最优化") ? "最优化" : "数值分析");
        const type = (r.type || "").trim();
        const question = (r.question || "").trim();
        const options = normalizeOptions(r.options);
        const answer = normalizeAnswer(type, r.answer);
        const explanation = (r.explanation || "").trim() || null;
        const difficulty = legalDifficulty.has((r.difficulty || "").trim()) ? (r.difficulty || "").trim() : "基础";
        if (!chapter || !type || !question || !answer) errors.push(`第 ${lineNo} 行缺少必填字段`);
        if (type && !legalTypes.has(type)) errors.push(`第 ${lineNo} 行题型非法：${type}`);
        if ((type === "单选题" || type === "多选题") && (!options || options.length < 2)) {
          errors.push(`第 ${lineNo} 行选项不足（用 | 分隔，如 A.xxx|B.xxx）`);
        }
        if (type === "判断题" && !["正确", "错误"].includes(answer)) {
          errors.push(`第 ${lineNo} 行判断题答案必须为“正确/错误”`);
        }
        if (type === "单选题" && !/^[A-D]$/.test(answer)) {
          errors.push(`第 ${lineNo} 行单选题答案格式应为 A/B/C/D`);
        }
        if (type === "多选题" && !/^[A-D](,[A-D])*$/.test(answer)) {
          errors.push(`第 ${lineNo} 行多选题答案格式应为 A,C 或 A,B,D`);
        }
        return { chapter, course, type, question, options, answer, explanation, difficulty, created_by: profile?.id || null };
      });
      if (errors.length > 0) throw new Error(errors.slice(0, 8).join("；"));
      const { data: existing } = await supabase.from("questions").select("question");
      const exists = new Set((existing || []).map(q => q.question));
      const toInsert = normalized.filter(r => !exists.has(r.question));
      if (toInsert.length === 0) {
        setImportMsg("CSV 校验通过，但题目已全部存在（按题干去重）。");
      } else {
        const { error } = await supabase.from("questions").insert(toInsert);
        if (error) throw error;
        setImportMsg(`CSV 导入完成：新增 ${toInsert.length} 题（原始 ${rows.length} 行）。`);
      }
      const { data } = await supabase.from("questions").select("*").order("created_at", { ascending: false });
      if (data) setDbQuestions(data);
    } catch (err) {
      setImportMsg("CSV 导入失败：" + (err?.message || "未知错误"));
    }
    setImportingCsv(false);
  };

  const STUDENTS = [
    { name: "张同学", email: "zhang@example.com", pct: 82, questions: 48, weak: ["Ch.3 插值", "Ch.4 最小二乘"], strong: ["Ch.1 方程求解", "Ch.2 线性方程组"] },
    { name: "李同学", email: "li@example.com", pct: 65, questions: 32, weak: ["Ch.5 数值微积分", "最优化 Ch.1"], strong: ["Ch.1 方程求解"] },
    { name: "王同学", email: "wang@example.com", pct: 91, questions: 60, weak: [], strong: ["Ch.1", "Ch.2", "Ch.3"] },
    { name: "陈同学", email: "chen@example.com", pct: 43, questions: 20, weak: ["Ch.2 线性方程组", "Ch.3 插值", "最优化 Ch.1"], strong: [] },
    { name: "刘同学", email: "liu@example.com", pct: 77, questions: 41, weak: ["Ch.4 最小二乘"], strong: ["Ch.1", "Ch.2"] },
  ];

  const sel = { width: "100%", fontSize: 14, padding: "11px 12px", border: "1.5px solid #e0e0e0", borderRadius: 10, fontFamily: "inherit", background: "#fff", color: "#111" };

  return (
    <div style={{ padding: "2rem", maxWidth: 1020, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 24 }}>
        <Btn size="sm" onClick={() => setPage("首页")}>← 返回</Btn>
        <div style={{ fontSize: 22, fontWeight: 700, color: "#111" }}>教师管理</div>
      </div>

      <div style={{ display: "flex", gap: 0, borderBottom: "2px solid #f0f0f0", marginBottom: 20 }}>
        {["学生管理", "AI 出题", "题库管理", "审核资料", "学情分析"].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: "12px 22px", fontSize: 15, fontFamily: "inherit", border: "none", borderBottom: tab === t ? `3px solid ${G.teal}` : "3px solid transparent", background: "none", cursor: "pointer", color: tab === t ? G.teal : "#888", fontWeight: tab === t ? 700 : 400, marginBottom: -2 }}>{t}</button>
        ))}
      </div>

      {tab === "学生管理" && (
        <>
          <div style={{ ...s.card, marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "1.25rem 1.75rem" }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>班级邀请码</div>
              <div style={{ fontSize: 14, color: "#888" }}>学生注册时输入此邀请码加入班级</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: G.teal, letterSpacing: "0.2em", background: G.tealLight, padding: "10px 24px", borderRadius: 12 }}>MATH2024</div>
              <Btn size="sm" onClick={() => { navigator.clipboard.writeText("MATH2024"); alert("邀请码已复制！"); }}>复制</Btn>
            </div>
          </div>

          {selectedStudent ? (
            <div style={{ ...s.card }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20, paddingBottom: 16, borderBottom: "1px solid #f0f0f0" }}>
                <Btn size="sm" onClick={() => setSelectedStudent(null)}>← 返回</Btn>
                <div style={{ width: 44, height: 44, borderRadius: "50%", background: G.teal, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 700, color: "#fff" }}>{selectedStudent.name[0]}</div>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>{selectedStudent.name}</div>
                  <div style={{ fontSize: 14, color: "#888" }}>{selectedStudent.email}</div>
                </div>
                <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
                  <Badge color={selectedStudent.pct >= 80 ? "teal" : selectedStudent.pct >= 60 ? "amber" : "red"}>正确率 {selectedStudent.pct}%</Badge>
                  <Badge color="blue">答题 {selectedStudent.questions} 题</Badge>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 14 }}>⚠️ 薄弱章节</div>
                  {selectedStudent.weak.length === 0
                    ? <div style={{ fontSize: 15, color: "#888" }}>暂无明显薄弱点 🎉</div>
                    : selectedStudent.weak.map((w, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0", borderBottom: "1px solid #f5f5f5" }}>
                        <span style={{ fontSize: 15 }}>{w}</span>
                        <div style={{ display: "flex", gap: 8 }}>
                          <Btn size="sm" onClick={() => generateQuestions(w)}>AI 出针对题</Btn>
                          <Btn size="sm" variant="primary" onClick={() => { setHwAssigned(prev => ({ ...prev, [selectedStudent.name]: [...(prev[selectedStudent.name] || []), w] })); alert(`已向 ${selectedStudent.name} 布置 ${w} 专项作业！`); }}>布置作业</Btn>
                        </div>
                      </div>
                    ))
                  }
                </div>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 14 }}>✅ 擅长章节</div>
                  {selectedStudent.strong.length === 0
                    ? <div style={{ fontSize: 15, color: "#888" }}>暂无数据</div>
                    : selectedStudent.strong.map((str, i) => (
                      <div key={i} style={{ padding: "12px 0", borderBottom: "1px solid #f5f5f5", display: "flex", justifyContent: "space-between" }}>
                        <span style={{ fontSize: 15 }}>{str}</span>
                        <Badge color="teal">掌握良好</Badge>
                      </div>
                    ))
                  }
                  {hwAssigned[selectedStudent.name]?.length > 0 && (
                    <div style={{ marginTop: 16 }}>
                      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>📋 已布置作业</div>
                      {hwAssigned[selectedStudent.name].map((hw, i) => <div key={i} style={{ fontSize: 14, color: "#666", padding: "4px 0" }}>· {hw}</div>)}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div style={{ ...s.card }}>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 18, paddingBottom: 14, borderBottom: "1px solid #f0f0f0", display: "flex", justifyContent: "space-between" }}>
                <span>班级学生 <span style={{ fontSize: 14, color: "#aaa", fontWeight: 400 }}>共 {STUDENTS.length} 人</span></span>
                <Badge color="blue">点击查看详情</Badge>
              </div>
              {STUDENTS.map((st, i) => {
                const col = st.pct >= 80 ? G.teal : st.pct >= 60 ? G.amber : G.red;
                return (
                  <div key={i} onClick={() => setSelectedStudent(st)} style={{ display: "flex", alignItems: "center", gap: 16, padding: "16px 0", borderBottom: i < STUDENTS.length - 1 ? "1px solid #f5f5f5" : "none", cursor: "pointer" }}>
                    <div style={{ width: 42, height: 42, borderRadius: "50%", background: G.tealLight, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 700, color: G.teal, flexShrink: 0 }}>{st.name[0]}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>{st.name}</div>
                      <ProgressBar value={st.pct} color={col} height={6} />
                    </div>
                    <div style={{ textAlign: "right", minWidth: 90 }}>
                      <div style={{ fontSize: 18, fontWeight: 700, color: col }}>{st.pct}%</div>
                      <div style={{ fontSize: 12, color: "#aaa" }}>{st.questions} 题</div>
                    </div>
                    {st.weak.length > 0 && <Badge color="red">{st.weak.length} 个薄弱点</Badge>}
                    {st.pct >= 80 && <Badge color="teal">优秀</Badge>}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {tab === "AI 出题" && (
        <div style={{ ...s.card }}>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>AI 智能出题</div>
          <div style={{ fontSize: 15, color: "#888", marginBottom: 20 }}>基于教材内容自动生成题目并保存到题库</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 100px 110px", gap: 12, marginBottom: 20, alignItems: "end" }}>
            {[
              { label: "章节", value: aiChapter, onChange: setAiChapter, options: ["Ch.1 · 方程求解", "Ch.2 · 线性方程组", "Ch.3 · 插值", "Ch.4 · 最小二乘", "Ch.5 · 数值微积分", "Ch.6 · 常微分方程", "最优化 Ch.1 · 优化模型"] },
              { label: "题型", value: aiType, onChange: setAiType, options: ["单选题", "多选题", "填空题", "判断题"] },
              { label: "数量", value: aiCount, onChange: setAiCount, options: ["1", "3", "5"] },
            ].map(f => (
              <div key={f.label}>
                <div style={{ fontSize: 13, color: "#666", marginBottom: 6, fontWeight: 500 }}>{f.label}</div>
                <select value={f.value} onChange={e => f.onChange(e.target.value)} style={sel}>{f.options.map(o => <option key={o}>{o}</option>)}</select>
              </div>
            ))}
            <button disabled={aiLoading} onClick={() => generateQuestions()} style={{ padding: "11px 0", fontSize: 15, fontWeight: 700, fontFamily: "inherit", background: aiLoading ? "#9FE1CB" : G.teal, color: "#fff", border: "none", borderRadius: 10, cursor: aiLoading ? "not-allowed" : "pointer" }}>{aiLoading ? "生成中…" : "✨ 生成"}</button>
          </div>
          {aiError && <div style={{ padding: "12px 16px", background: G.redLight, color: G.red, borderRadius: 10, fontSize: 14, marginBottom: 16 }}>{aiError}</div>}
          {aiLoading && <div style={{ textAlign: "center", padding: "3rem", color: "#888", fontSize: 16, background: "#fafafa", borderRadius: 12 }}>⏳ AI 正在生成题目…</div>}
          {aiQuestions.map((q, i) => (
            <div key={i} style={{ border: "1.5px solid #eee", borderRadius: 14, padding: "1.5rem", marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                <div style={{ display: "flex", gap: 8 }}><Badge color="blue">{aiType}</Badge><Badge color="amber">{aiChapter}</Badge></div>
                <Btn size="sm" variant="primary" onClick={() => saveToDb(q)} disabled={saving}>+ 保存到题库</Btn>
              </div>
              <div style={{ fontSize: 15, marginBottom: 14, lineHeight: 1.7 }}>{q.question}</div>
              {q.options && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
                  {q.options.map((opt, j) => (
                    <div key={j} style={{ fontSize: 14, padding: "9px 12px", background: opt.startsWith(q.answer) ? G.tealLight : "#f5f5f5", borderRadius: 8, color: opt.startsWith(q.answer) ? G.tealDark : "#666", fontWeight: opt.startsWith(q.answer) ? 600 : 400 }}>{opt}</div>
                  ))}
                </div>
              )}
              <div style={{ fontSize: 14, color: "#666", background: "#f9f9f9", padding: "10px 14px", borderRadius: 8 }}>
                <strong>答案：</strong>{q.answer}　·　<strong>解析：</strong>{q.explanation}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "题库管理" && (
        <div style={{ ...s.card }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 18, paddingBottom: 14, borderBottom: "1px solid #f0f0f0" }}>
            <div style={{ fontSize: 18, fontWeight: 700 }}>题库管理</div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <Badge color="blue">共 {dbQuestions.length} 题</Badge>
              <input ref={csvRef} type="file" accept=".csv,text/csv" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImportCsv(f); e.target.value = ""; }} />
              <Btn size="sm" onClick={() => csvRef.current?.click()} disabled={importingCsv}>{importingCsv ? "导入中…" : "CSV 批量导入"}</Btn>
              <Btn size="sm" variant="primary" onClick={seedQuestionBank} disabled={seeding}>{seeding ? "导入中…" : "一键导入基础题库"}</Btn>
            </div>
          </div>
          {seedMsg && <div style={{ padding: "10px 12px", borderRadius: 10, background: G.tealLight, color: G.tealDark, marginBottom: 12, fontSize: 14 }}>{seedMsg}</div>}
          {importMsg && <div style={{ padding: "10px 12px", borderRadius: 10, background: G.blueLight, color: G.blue, marginBottom: 12, fontSize: 14 }}>{importMsg}</div>}
          <div style={{ fontSize: 12, color: "#888", marginBottom: 12 }}>
            CSV 表头格式：chapter,course,type,question,options,answer,explanation,difficulty。<br />
            其中 options 用 | 分隔（示例：A.选项1|B.选项2|C.选项3|D.选项4）。
          </div>
          {dbQuestions.length === 0 && <div style={{ textAlign: "center", padding: "3rem", color: "#aaa", fontSize: 16 }}>📝 暂无题目，请先用 AI 出题</div>}
          {dbQuestions.map((q, i) => (
            <div key={i} style={{ borderBottom: "1px solid #f5f5f5" }}>
              <div onClick={() => setPreviewQuestion(previewQuestion?.id === q.id ? null : q)} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 0", cursor: "pointer" }}>
                <Badge color="amber">{q.chapter}</Badge>
                <div style={{ flex: 1, fontSize: 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{q.question}</div>
                <Badge color="blue">{q.type}</Badge>
                <Btn size="sm" onClick={(e) => { e.stopPropagation(); setPreviewQuestion(previewQuestion?.id === q.id ? null : q); }}>{previewQuestion?.id === q.id ? "收起" : "查看"}</Btn>
                <Btn size="sm" onClick={(e) => { e.stopPropagation(); deleteQuestion(q.id); if (previewQuestion?.id === q.id) setPreviewQuestion(null); }}>删除</Btn>
              </div>
              {previewQuestion?.id === q.id && (
                <div style={{ border: "1px solid #e8f2ee", background: "#f8fffb", borderRadius: 12, padding: "14px 16px", marginBottom: 14 }}>
                  <div style={{ fontSize: 15, color: "#111", lineHeight: 1.7, marginBottom: 10 }}>{q.question}</div>
                  {q.options && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
                      {(typeof q.options === "string" ? JSON.parse(q.options) : q.options).map((opt, idx) => (
                        <div key={idx} style={{ fontSize: 13, padding: "8px 10px", background: "#fff", border: "1px solid #eee", borderRadius: 8, color: "#444" }}>{opt}</div>
                      ))}
                    </div>
                  )}
                  <div style={{ fontSize: 13, color: "#555" }}>
                    <strong>答案：</strong>{q.answer}
                    {q.explanation ? <>　·　<strong>解析：</strong>{q.explanation}</> : null}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {tab === "审核资料" && (
        <div style={{ ...s.card }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 18, paddingBottom: 14, borderBottom: "1px solid #f0f0f0" }}>
            <div style={{ fontSize: 18, fontWeight: 700 }}>资料审核</div>
            <Badge color="amber">待审核 {pendingMaterials.length}</Badge>
          </div>
          {reviewMsg && <div style={{ padding: "10px 12px", borderRadius: 10, background: G.blueLight, color: G.blue, marginBottom: 12, fontSize: 14 }}>{reviewMsg}</div>}
          {pendingMaterials.length === 0 && <div style={{ textAlign: "center", padding: "2.5rem", color: "#999" }}>暂无待审核资料</div>}
          {pendingMaterials.map((m) => (
            <div key={m.id} style={{ border: "1px solid #eee", borderRadius: 12, padding: "14px 16px", marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "#111" }}>{m.title}</div>
                  <div style={{ fontSize: 12, color: "#999", marginTop: 4 }}>{m.uploader_name || "用户"} · {new Date(m.created_at).toLocaleString("zh-CN")}</div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                  <Btn size="sm" onClick={() => reviewMaterial(m, "rejected")} disabled={reviewBusyId === m.id}>驳回</Btn>
                  <Btn size="sm" variant="primary" onClick={() => reviewMaterial(m, "approved")} disabled={reviewBusyId === m.id}>{reviewBusyId === m.id ? "处理中…" : "通过发布"}</Btn>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <Badge color="blue">{m.course || "未知课程"}</Badge>
                {m.chapter && <Badge color="amber">{m.chapter}</Badge>}
                <Badge color="red">待审核</Badge>
              </div>
              {m.description && <div style={{ fontSize: 14, color: "#666", lineHeight: 1.6 }}>{m.description}</div>}
            </div>
          ))}
        </div>
      )}
      {tab === "学情分析" && (
        <div style={{ ...s.card }}>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>班级学情分析</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 16 }}>
            <StatCard icon="👥" label="学生人数" value={analytics.students} color={G.blue} />
            <StatCard icon="📝" label="答题记录" value={analytics.answers} color={G.teal} />
            <StatCard icon="🎯" label="整体正确率" value={analytics.accuracy + "%"} color={analytics.accuracy >= 75 ? G.teal : G.red} />
            <StatCard icon="🧠" label="知识点掌握" value={(analytics.mastery[0]?.value || 0) + "%"} color={G.purple} />
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>薄弱章节 Top</div>
          {analytics.weak.length === 0 && <div style={{ color: "#888", fontSize: 14 }}>暂无足够数据，请先让学生完成练习。</div>}
          {analytics.weak.map((w) => (
            <div key={w.chapter} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #f3f3f3" }}>
              <div style={{ fontSize: 14 }}>{w.chapter}</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <Badge color={w.pct >= 75 ? "teal" : w.pct >= 60 ? "amber" : "red"}>{w.pct}%</Badge>
                <span style={{ fontSize: 12, color: "#999" }}>{w.total} 次作答</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Root App ──────────────────────────────────────────────────────────────────

// ── Skill Tree Page ───────────────────────────────────────────────────────────
const SKILL_TREE = [
  // 数值分析链
  { id: "误差分析",      label: "误差分析",    emoji: "📏", deps: [],                      course: "数值分析", x: 80,  y: 60 },
  { id: "浮点数系统",    label: "浮点数系统",  emoji: "💾", deps: ["误差分析"],             course: "数值分析", x: 80,  y: 170 },
  { id: "方程求解",      label: "方程求解",    emoji: "🔍", deps: ["浮点数系统"],           course: "数值分析", x: 80,  y: 280 },
  { id: "插值方法",      label: "插值法",      emoji: "📈", deps: ["方程求解"],             course: "数值分析", x: 80,  y: 390 },
  { id: "数值积分",      label: "数值积分",    emoji: "∫",  deps: ["插值方法"],             course: "数值分析", x: 80,  y: 500 },
  { id: "数值微分",      label: "数值微分",    emoji: "Δ",deps: ["插值方法"],            course: "数值分析", x: 240, y: 500 },
  // 线性代数链
  { id: "矩阵运算",      label: "矩阵运算",    emoji: "🔢", deps: [],                      course: "线性代数", x: 440, y: 60 },
  { id: "线性方程组",    label: "线性方程组",  emoji: "📐", deps: ["矩阵运算"],             course: "线性代数", x: 440, y: 170 },
  { id: "行列式",        label: "行列式",      emoji: "▣", deps: ["矩阵运算"],            course: "线性代数", x: 580, y: 170 },
  { id: "向量空间",      label: "向量空间",    emoji: "↗",  deps: ["线性方程组","行列式"],  course: "线性代数", x: 510, y: 280 },
  { id: "特征值",        label: "特征值", emoji: "λ", deps: ["向量空间"],         course: "线性代数", x: 510, y: 390 },
  // 微分方程链
  { id: "一阶ODE",       label: "一阶ODE",    emoji: "🔄", deps: [],                  course: "ODE",      x: 780, y: 60 },
  { id: "分离变量法",    label: "分离变量法",  emoji: "⊕", deps: ["一阶ODE"],              course: "ODE",      x: 680, y: 170 },
  { id: "积分因子",      label: "积分因子法",  emoji: "μ", deps: ["一阶ODE"],              course: "ODE",      x: 870, y: 170 },
  { id: "二阶ODE",       label: "二阶ODE", emoji: "y''", deps: ["分离变量法","积分因子"], course: "ODE", x: 780, y: 280 },
  { id: "拉普拉斯变换",  label: "Laplace变换", emoji: "ʟ", deps: ["二阶ODE"],             course: "ODE",      x: 780, y: 390 },
  // 概率统计链
  { id: "概率基础",      label: "概率基础",    emoji: "🎲", deps: [],                      course: "概率论",   x: 1060, y: 60 },
  { id: "随机变量",      label: "随机变量",    emoji: "X",  deps: ["概率基础"],            course: "概率论",   x: 1060, y: 170 },
  { id: "期望与方差",    label: "期望方差",  emoji: "𝔼", deps: ["随机变量"],           course: "概率论",   x: 1060, y: 280 },
  { id: "大数定律",      label: "大数定律", emoji: "∞", deps: ["期望与方差"],          course: "概率论",   x: 1060, y: 390 },
];

const COURSE_COLORS_TREE = {
  "数值分析": { bg: "#dbeafe", border: "#3b82f6", text: "#1d4ed8" },
  "线性代数": { bg: "#dcfce7", border: "#22c55e", text: "#15803d" },
  "ODE":      { bg: "#fce7f3", border: "#ec4899", text: "#be185d" },
  "概率论":   { bg: "#fef3c7", border: "#f59e0b", text: "#b45309" },
};

function SkillTreePage({ setPage }) {
  const [mastery, setMastery] = useState(() => {
    try { return JSON.parse(localStorage.getItem("mc_skill_mastery") || "{}"); } catch { return {}; }
  });
  const [tooltip, setTooltip] = useState(null);
  const [selectedCourse, setSelectedCourse] = useState("全部");

  const courses = ["全部", ...new Set(SKILL_TREE.map(s => s.course))];

  const getNodeStatus = (node) => {
    if (mastery[node.id] === 2) return "mastered";
    if (mastery[node.id] === 1) return "learning";
    const allDepsOk = node.deps.every(d => mastery[d] >= 1);
    return allDepsOk ? "unlocked" : "locked";
  };

  const handleNodeClick = (node) => {
    const status = getNodeStatus(node);
    if (status === "locked") return;
    setMastery(prev => {
      const cur = prev[node.id] || 0;
      const next = { ...prev, [node.id]: (cur + 1) % 3 };
      localStorage.setItem("mc_skill_mastery", JSON.stringify(next));
      return next;
    });
  };

  const filteredNodes = selectedCourse === "全部" ? SKILL_TREE : SKILL_TREE.filter(n => n.course === selectedCourse);

  const nodeStatusStyle = (status) => {
    if (status === "mastered") return { bg: G.teal, border: G.tealDark, text: "#fff", shadow: "0 4px 16px " + G.teal + "66" };
    if (status === "learning") return { bg: G.amber, border: G.amber, text: "#fff", shadow: "0 4px 12px " + G.amber + "55" };
    if (status === "unlocked") return { bg: "#fff", border: G.blue, text: G.blue, shadow: "0 2px 8px rgba(0,0,0,0.1)" };
    return { bg: "#f1f5f9", border: "#cbd5e1", text: "#94a3b8", shadow: "none" };
  };

  const masteredCount = SKILL_TREE.filter(n => mastery[n.id] === 2).length;
  const learningCount = SKILL_TREE.filter(n => mastery[n.id] === 1).length;

  // Calculate SVG viewport
  const maxX = Math.max(...filteredNodes.map(n => n.x)) + 160;
  const maxY = Math.max(...filteredNodes.map(n => n.y)) + 100;

  return (
    <div style={{ padding: "2rem", maxWidth: 1200, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
        <Btn size="sm" onClick={() => setPage("首页")}>← 返回</Btn>
        <div style={{ fontSize: 22, fontWeight: 700 }}>🌳 知识技能树</div>
        <div style={{ display: "flex", gap: 10, marginLeft: 12 }}>
          <span style={{ fontSize: 13, background: G.tealLight, color: G.teal, padding: "4px 12px", borderRadius: 20, fontWeight: 600 }}>✅ 已掌握 {masteredCount}</span>
          <span style={{ fontSize: 13, background: G.amberLight, color: G.amber, padding: "4px 12px", borderRadius: 20, fontWeight: 600 }}>📖 学习中 {learningCount}</span>
          <span style={{ fontSize: 13, background: "#f1f5f9", color: "#64748b", padding: "4px 12px", borderRadius: 20, fontWeight: 600 }}>🔒 未解锁 {SKILL_TREE.length - masteredCount - learningCount}</span>
        </div>
      </div>

      {/* Course filter */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        {courses.map(c => (
          <button key={c} onClick={() => setSelectedCourse(c)} style={{ padding: "7px 16px", borderRadius: 20, border: "1.5px solid " + (selectedCourse === c ? G.teal : "#ddd"), background: selectedCourse === c ? G.teal : "#fff", color: selectedCourse === c ? "#fff" : "#555", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>{c}</button>
        ))}
      </div>

      {/* Legend */}
      <div style={{ display: "flex", gap: 16, marginBottom: 16, fontSize: 12, color: "#666" }}>
        {[["✅", G.teal, "已掌握（点击重置）"], ["📖", G.amber, "学习中（点击升级）"], ["🔓", G.blue, "可解锁（点击开始）"], ["🔒", "#999", "前置未完成"]].map(([ico, col, label]) => (
          <span key={label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ color: col, fontWeight: 700 }}>{ico}</span>{label}
          </span>
        ))}
        <span style={{ marginLeft: "auto", fontSize: 12, color: "#aaa" }}>点击节点切换状态 · 完成前置节点后解锁后续</span>
      </div>

      {/* SVG Tree */}
      <div style={{ ...s.card, padding: 0, overflowX: "auto", overflowY: "auto", maxHeight: 620 }}>
        <svg width={Math.max(maxX, 400)} height={Math.max(maxY, 300)} style={{ minWidth: "100%", display: "block" }}>
          {/* Draw dependency edges */}
          {filteredNodes.map(node =>
            node.deps.filter(d => filteredNodes.find(n => n.id === d)).map(depId => {
              const dep = filteredNodes.find(n => n.id === depId);
              if (!dep) return null;
              const status = getNodeStatus(node);
              const depStatus = getNodeStatus({ ...dep, deps: [] });
              const lineColor = (status === "locked") ? "#e2e8f0" : G.teal + "88";
              return (
                <line key={depId + "->" + node.id}
                  x1={dep.x + 60} y1={dep.y + 36}
                  x2={node.x + 60} y2={node.y}
                  stroke={lineColor} strokeWidth="2" strokeDasharray={status === "locked" ? "5,5" : "0"}
                />
              );
            })
          )}
          {/* Draw nodes */}
          {filteredNodes.map(node => {
            const status = getNodeStatus(node);
            const st = nodeStatusStyle(status);
            const courseColor = COURSE_COLORS_TREE[node.course] || {};
            return (
              <g key={node.id} transform={"translate(" + node.x + "," + node.y + ")"}
                onClick={() => handleNodeClick(node)}
                onMouseEnter={() => setTooltip(node.id)}
                onMouseLeave={() => setTooltip(null)}
                style={{ cursor: status === "locked" ? "not-allowed" : "pointer" }}>
                {/* Shadow */}
                <rect x="2" y="3" width="118" height="70" rx="14" fill="rgba(0,0,0,0.06)" />
                {/* Card */}
                <rect x="0" y="0" width="118" height="70" rx="14"
                  fill={st.bg} stroke={st.border} strokeWidth="2"
                />
                {/* Course color bar */}
                <rect x="0" y="0" width="5" height="70" rx="3" fill={courseColor.border || "#ccc"} />
                {/* Emoji */}
                <text x="22" y="30" fontSize="16" textAnchor="middle" dominantBaseline="middle">{node.emoji}</text>
                {/* Label */}
                <text x="66" y="27" fontSize="11" fontWeight="700" fill={st.text} textAnchor="middle" dominantBaseline="middle" fontFamily="system-ui,sans-serif">{node.label}</text>
                {/* Status */}
                <text x="66" y="52" fontSize="10" fill={st.text} textAnchor="middle" dominantBaseline="middle" fontFamily="system-ui,sans-serif" opacity="0.8">
                  {status === "mastered" ? "✅ 已掌握" : status === "learning" ? "📖 学习中" : status === "unlocked" ? "🔓 点击开始" : "🔒 待解锁"}
                </text>
                {/* Tooltip */}
                {tooltip === node.id && (
                  <g>
                    <rect x="10" y="-50" width="120" height="38" rx="8" fill="#1e293b" />
                    <text x="70" y="-37" fontSize="11" fill="#fff" textAnchor="middle" fontFamily="system-ui,sans-serif">{node.course}</text>
                    <text x="70" y="-22" fontSize="10" fill="#94a3b8" textAnchor="middle" fontFamily="system-ui,sans-serif">{node.deps.length === 0 ? "无前置要求" : "前置：" + node.deps.join("、")}</text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Progress summary */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12, marginTop: 16 }}>
        {[...new Set(SKILL_TREE.map(n => n.course))].map(course => {
          const courseNodes = SKILL_TREE.filter(n => n.course === course);
          const courseMastered = courseNodes.filter(n => mastery[n.id] === 2).length;
          const col = COURSE_COLORS_TREE[course];
          return (
            <div key={course} style={{ background: col?.bg || "#f8fafc", borderRadius: 12, padding: "14px 16px", border: "1.5px solid " + (col?.border || "#ddd") + "66" }}>
              <div style={{ fontWeight: 700, color: col?.text || "#333", fontSize: 14, marginBottom: 6 }}>{course}</div>
              <ProgressBar value={courseMastered} max={courseNodes.length} color={col?.border || G.teal} height={6} />
              <div style={{ fontSize: 12, color: "#888", marginTop: 4 }}>{courseMastered}/{courseNodes.length} 个知识点已掌握</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}


export default function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [page, setPage] = useState("首页");
  const [loading, setLoading] = useState(true);
  const [retryQuestion, setRetryQuestion] = useState(null);
  const [chapterFilter, setChapterFilter] = useState(null);
  const [sessionAnswers, setSessionAnswers] = useState({});
  const [emailJustConfirmed, setEmailJustConfirmed] = useState(false);
  const recordAnswer = async (qid, correct, chapter, questionPayload = null) => {
    try {
      const updated = { ...sessionAnswers, [qid]: { correct, chapter } };
      setSessionAnswers(updated);
    } catch (e) {}
    try {
      if (!session?.user?.id) return;
      await supabase.from("answers").insert({
        user_id: session.user.id,
        question_id: String(qid).length > 30 ? null : qid,
        is_correct: !!correct,
        user_answer: null,
      });
      if (!correct && questionPayload?.question) {
        await supabase.from("questions") /* wrong_drill_logs stub */.insert({
          user_id: session.user.id,
          question_id: String(qid).length > 30 ? null : qid,
          chapter: chapter || null,
          question: questionPayload.question,
          correct_answer: questionPayload.answer || null,
          explanation: questionPayload.explanation || null,
        });
      }
    } catch (e) {}
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) loadProfile(session.user.id);
      else setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" || event === "EMAIL_CONFIRMED") {
        // 判断是否来自邮箱验证（注册时打的标记）
        const pendingTs = localStorage.getItem("mc_confirm_pending");
        if (pendingTs) {
          const age = Date.now() - Number(pendingTs);
          // 标记有效期 48 小时（用户可能不会立刻点确认链接）
          if (age < 48 * 3600 * 1000) {
            setEmailJustConfirmed(true);
          }
          localStorage.removeItem("mc_confirm_pending");
        }
      }
      setSession(session);
      if (session) loadProfile(session.user.id);
      else { setProfile(null); setLoading(false); }
    });

    return () => subscription.unsubscribe();
  }, []);

  const loadProfile = async (userId) => {
    const { data } = await supabase.from("profiles").select("*").eq("id", userId).single();
    setProfile(data);
    setLoading(false);
  };

  const handleLogout = async () => { await supabase.auth.signOut(); setPage("首页"); };

  const handleSetPage = (p) => {
    if (p !== "题库练习") { setRetryQuestion(null); setChapterFilter(null); }
    setPage(p);
  };

  if (loading) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, #f0fdf8, #e8f4ff)" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ width: 48, height: 48, borderRadius: 14, background: G.teal, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, margin: "0 auto 14px" }}>📐</div>
        <div style={{ fontSize: 15, color: "#888" }}>加载中…</div>
      </div>
    </div>
  );

  if (emailJustConfirmed) return <EmailConfirmedPage onContinue={() => { setEmailJustConfirmed(false); }} />;
  if (!session) return <AuthPage />;

  const renderPage = () => {
    if (page === "首页") return <HomePage setPage={handleSetPage} profile={profile} />;
    if (page === "资料库") return <MaterialsPage setPage={handleSetPage} profile={profile} />;
    if (page === "上传资料") return <UploadPage setPage={handleSetPage} profile={profile} />;
    if (page === "资料对话") return <MaterialChatPage setPage={handleSetPage} profile={profile} />;
    if (page === "知识点") return <KnowledgePage setPage={handleSetPage} setChapterFilter={setChapterFilter} sessionAnswers={sessionAnswers} />;
    if (page === "题库练习" || page.startsWith("quiz_material_")) {
      let matId = null, matTitle = null;
      if (page.startsWith("quiz_material_")) {
        const parts = page.replace("quiz_material_", "").split("_");
        matId = parts[0];
        matTitle = decodeURIComponent(parts.slice(1).join("_"));
      }
      return <QuizPage setPage={handleSetPage} initialQuestion={retryQuestion} chapterFilter={chapterFilter} setChapterFilter={setChapterFilter} materialId={matId} materialTitle={matTitle} onAnswer={(qid, correct, chapter, payload) => { recordAnswer(qid, correct, chapter, payload); }} />;
    }
    if (page === "记忆卡片") return <FlashcardPage setPage={handleSetPage} />;
    if (page === "学习报告") return <ReportPage setPage={handleSetPage} />;
    if (page === "技能树") return <SkillTreePage setPage={handleSetPage} />;
    if (page === "错题本") return <WrongPage setPage={handleSetPage} sessionAnswers={sessionAnswers} />;
    if (page === "教师管理") return <TeacherPage setPage={handleSetPage} profile={profile} />;
    return null;
  };

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(160deg, #f6fef9 0%, #f0f4ff 50%, #faf8ff 100%)" }}>
      <TopNav page={page} setPage={handleSetPage} profile={profile} onLogout={handleLogout} />
      {renderPage()}
    </div>
  );
}