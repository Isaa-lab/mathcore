import { useState, useRef, useCallback } from "react";

// ── Palette ──────────────────────────────────────────────────────────────────
const G = {
  teal: "#1D9E75", tealLight: "#E1F5EE", tealDark: "#0F6E56",
  blue: "#185FA5", blueLight: "#E6F1FB",
  amber: "#BA7517", amberLight: "#FAEEDA",
  red: "#A32D2D", redLight: "#FCEBEB",
};

// ── Tiny UI helpers ───────────────────────────────────────────────────────────
const css = (base, extra = {}) => ({ ...base, ...extra });

const Btn = ({ children, onClick, variant = "outline", size = "md", style = {} }) => {
  const pad = size === "sm" ? "5px 12px" : "8px 20px";
  const fz  = size === "sm" ? 12 : 13;
  const base = variant === "primary"
    ? { background: G.teal, color: "#fff", border: "none" }
    : { background: "transparent", color: "var(--color-text-primary)", border: "0.5px solid var(--color-border-secondary)" };
  return (
    <button onClick={onClick} style={css({
      padding: pad, fontSize: fz, fontFamily: "var(--font-sans)",
      borderRadius: 8, cursor: "pointer", fontWeight: 500,
      transition: "opacity .15s", ...base, ...style,
    })}>{children}</button>
  );
};

const Badge = ({ children, color = "teal" }) => {
  const map = { teal: [G.tealLight, G.tealDark], blue: [G.blueLight, G.blue], amber: [G.amberLight, G.amber], red: [G.redLight, G.red] };
  const [bg, fg] = map[color] || map.teal;
  return <span style={{ background: bg, color: fg, fontSize: 10, padding: "2px 8px", borderRadius: 10, fontWeight: 500 }}>{children}</span>;
};

const Card = ({ children, style = {}, onClick }) => (
  <div onClick={onClick} style={css({
    background: "var(--color-background-primary)",
    border: "0.5px solid var(--color-border-tertiary)",
    borderRadius: 12, padding: "1rem 1.25rem",
    cursor: onClick ? "pointer" : "default",
  }, style)}>{children}</div>
);

const SectionLabel = ({ children }) => (
  <div style={{ fontSize: 11, fontWeight: 500, color: "var(--color-text-secondary)", letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 10 }}>{children}</div>
);

// ── Top Navigation ────────────────────────────────────────────────────────────
const NAV_STUDENT = ["首页", "知识点", "题库练习", "错题本"];
const NAV_TEACHER = ["首页", "知识点", "题库练习", "错题本", "教师管理"];

function TopNav({ page, setPage, role, setRole }) {
  const links = role === "teacher" ? NAV_TEACHER : NAV_STUDENT;
  return (
    <div style={{ background: "var(--color-background-primary)", borderBottom: "0.5px solid var(--color-border-tertiary)", padding: "0 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", height: 52, position: "sticky", top: 0, zIndex: 100 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 500, color: "var(--color-text-primary)" }}>
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: G.teal }} />
        MathCore
      </div>
      <div style={{ display: "flex", gap: 4 }}>
        {links.map(l => (
          <button key={l} onClick={() => setPage(l)} style={{ padding: "6px 14px", borderRadius: 8, fontSize: 13, fontFamily: "var(--font-sans)", border: "none", cursor: "pointer", background: page === l ? "var(--color-background-secondary)" : "transparent", color: page === l ? "var(--color-text-primary)" : "var(--color-text-secondary)", fontWeight: page === l ? 500 : 400 }}>{l}</button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>角色:</span>
        {["student", "teacher"].map(r => (
          <button key={r} onClick={() => { setRole(r); if (r === "student" && page === "教师管理") setPage("首页"); }} style={{ fontSize: 11, padding: "3px 10px", borderRadius: 20, cursor: "pointer", fontFamily: "var(--font-sans)", border: role === r ? "none" : "0.5px solid var(--color-border-secondary)", background: role === r ? G.teal : "transparent", color: role === r ? "#fff" : "var(--color-text-secondary)" }}>{r === "student" ? "学生" : "教师"}</button>
        ))}
      </div>
    </div>
  );
}

// ── Home Page ─────────────────────────────────────────────────────────────────
function HomePage({ setPage }) {
  const quick = [
    { icon: "📖", title: "继续学习", desc: "第4章 · 最小二乘法", page: "知识点" },
    { icon: "✏️", title: "每日练习", desc: "今日推荐 5 道题", page: "题库练习" },
    { icon: "📊", title: "学习报告", desc: "正确率 · 薄弱点分析", page: null },
    { icon: "🔖", title: "错题本", desc: "收录 8 道错题", page: "错题本" },
  ];
  return (
    <div style={{ padding: "1.5rem", maxWidth: 900, margin: "0 auto" }}>
      <Card style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: G.teal, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>数学与应用数学学习平台</div>
        <div style={{ fontSize: 22, fontWeight: 500, marginBottom: 6, color: "var(--color-text-primary)" }}>系统学习，从知识点到实战演练</div>
        <div style={{ fontSize: 14, color: "var(--color-text-secondary)", lineHeight: 1.6, marginBottom: 16 }}>涵盖数值分析、最优化理论两门核心课程，AI 智能出题，帮助你掌握每一个知识点。</div>
        <div style={{ display: "flex", gap: 8 }}>
          <Btn variant="primary" onClick={() => setPage("知识点")}>开始学习</Btn>
          <Btn onClick={() => setPage("题库练习")}>进入题库</Btn>
        </div>
      </Card>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 12 }}>
        {[["2", "门课程"], ["19", "章节"], ["340+", "题目"]].map(([n, l]) => (
          <div key={l} style={{ background: "var(--color-background-secondary)", borderRadius: 8, padding: "1rem" }}>
            <div style={{ fontSize: 24, fontWeight: 500, color: "var(--color-text-primary)" }}>{n}</div>
            <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 2 }}>{l}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {quick.map(q => (
          <Card key={q.title} onClick={() => q.page && setPage(q.page)} style={{ cursor: q.page ? "pointer" : "default" }}>
            <div style={{ fontSize: 18, marginBottom: 6 }}>{q.icon}</div>
            <div style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-primary)", marginBottom: 2 }}>{q.title}</div>
            <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>{q.desc}</div>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ── Knowledge Page ────────────────────────────────────────────────────────────
const CHAPTERS = [
  { id: 0, course: "数值分析", num: "Ch.0", name: "基础知识 Fundamentals", topics: ["多项式求值", "二进制与浮点数", "有效数字与舍入误差", "微积分基础回顾"] },
  { id: 1, course: "数值分析", num: "Ch.1", name: "方程求解 Solving Equations", topics: ["二分法", "不动点迭代", "误差分析", "Newton 法", "割线法"] },
  { id: 2, course: "数值分析", num: "Ch.2", name: "线性方程组 Systems of Equations", topics: ["Gauss 消去法", "LU 分解", "条件数与误差", "Jacobi / Gauss-Seidel 迭代"] },
  { id: 3, course: "数值分析", num: "Ch.3", name: "插值 Interpolation", topics: ["Lagrange 插值", "Newton 差商", "Chebyshev 插值", "三次样条", "Bézier 曲线"] },
  { id: 4, course: "数值分析", num: "Ch.4", name: "最小二乘 Least Squares", topics: ["法方程", "数据拟合模型", "QR 分解", "GMRES", "非线性最小二乘"] },
  { id: 5, course: "数值分析", num: "Ch.5", name: "数值微积分", topics: ["有限差分公式", "梯形法 / Simpson 法", "Romberg 积分", "Gauss 积分"] },
  { id: 6, course: "数值分析", num: "Ch.6", name: "常微分方程 ODEs", topics: ["Euler 法", "Runge-Kutta 法", "方程组", "刚性方程与隐式法"] },
  { id: 7, course: "数值分析", num: "Ch.7", name: "边值问题 BVP", topics: ["打靶法", "有限差分法", "有限元 / Galerkin 法"] },
  { id: 8, course: "数值分析", num: "Ch.8", name: "偏微分方程 PDEs", topics: ["抛物型方程", "双曲型方程", "椭圆型方程", "Crank-Nicolson 法"] },
  { id: 9, course: "数值分析", num: "Ch.9", name: "随机数与 Monte Carlo", topics: ["伪随机数生成", "Monte Carlo 模拟", "方差缩减"] },
  { id: 10, course: "最优化", num: "Ch.1", name: "优化模型概论", topics: ["最小二乘数据拟合", "线性 vs 非线性模型", "残差向量与范数", "非线性规划定义"] },
  { id: 11, course: "最优化", num: "Ch.1", name: "非线性规划应用案例", topics: ["设施选址问题", "球缺体积最优化", "投资组合选择 (Markowitz)", "交通流最小化", "最大似然估计", "SVM 分类"] },
];

function KnowledgePage({ setPage }) {
  const [sel, setSel] = useState(CHAPTERS[0]);
  const [filter, setFilter] = useState("全部");
  const courses = ["全部", "数值分析", "最优化"];
  const filtered = filter === "全部" ? CHAPTERS : CHAPTERS.filter(c => c.course === filter);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", gap: 12, padding: "1.5rem", maxWidth: 1100, margin: "0 auto" }}>
      {/* Sidebar */}
      <div>
        <Card style={{ padding: "10px 0", marginBottom: 10 }}>
          <div style={{ padding: "0 12px 8px", display: "flex", gap: 4 }}>
            {courses.map(c => (
              <button key={c} onClick={() => setFilter(c)} style={{ flex: 1, fontSize: 11, padding: "4px 0", borderRadius: 6, border: "none", cursor: "pointer", fontFamily: "var(--font-sans)", background: filter === c ? G.teal : "var(--color-background-secondary)", color: filter === c ? "#fff" : "var(--color-text-secondary)" }}>{c}</button>
            ))}
          </div>
          {filtered.map(ch => (
            <div key={ch.id} onClick={() => setSel(ch)} style={{ padding: "8px 14px", cursor: "pointer", fontSize: 13, borderRadius: 0, background: sel.id === ch.id ? G.tealLight : "transparent", color: sel.id === ch.id ? G.tealDark : "var(--color-text-secondary)", borderLeft: sel.id === ch.id ? `3px solid ${G.teal}` : "3px solid transparent", fontWeight: sel.id === ch.id ? 500 : 400 }}>
              <span style={{ fontSize: 10, opacity: .7, marginRight: 4 }}>{ch.num}</span>{ch.name.split(" ")[0]}
            </div>
          ))}
        </Card>
      </div>
      {/* Content */}
      <Card>
        <div style={{ borderBottom: "0.5px solid var(--color-border-tertiary)", paddingBottom: "1rem", marginBottom: "1rem", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 500, color: "var(--color-text-primary)", marginBottom: 4 }}>{sel.name}</div>
            <div style={{ display: "flex", gap: 6 }}>
              <Badge color={sel.course === "数值分析" ? "teal" : "blue"}>{sel.course}</Badge>
              <Badge color="amber">{sel.num}</Badge>
            </div>
          </div>
          <Btn variant="primary" size="sm" onClick={() => setPage("题库练习")}>章节练习 →</Btn>
        </div>
        <SectionLabel>本章知识点</SectionLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {sel.topics.map((t, i) => (
            <div key={i} style={{ border: "0.5px solid var(--color-border-tertiary)", borderRadius: 8, padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 500, color: "var(--color-text-primary)", marginBottom: 2 }}>{t}</div>
                <div style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>点击展开详细内容</div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <Badge color={i < 2 ? "teal" : i < 3 ? "amber" : "red"}>{i < 2 ? "已完成" : i < 3 ? "学习中" : "未开始"}</Badge>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ── Quiz Page ─────────────────────────────────────────────────────────────────
const SAMPLE_Q = {
  chapter: "Ch.1 · 方程求解",
  type: "单选题",
  text: "在使用二分法求方程 f(x) = 0 的根时，每迭代一次，有根区间的长度变为原来的：",
  options: ["1/3", "1/2", "1/4", "不确定，取决于 f(x)"],
  answer: 1,
  hint: "二分法每次将区间从 [a,b] 分成两半，取包含根的那半，因此区间长度每次精确地缩小为 1/2。这也是二分法误差以线性速率收敛的原因。",
};

function QuizPage() {
  const [selected, setSelected] = useState(null);
  const [showHint, setShowHint] = useState(false);
  const [answered, setAnswered] = useState(false);

  const optLetters = ["A", "B", "C", "D"];

  const handleAnswer = () => { if (selected !== null) setAnswered(true); };

  return (
    <div style={{ padding: "1.5rem", maxWidth: 780, margin: "0 auto" }}>
      {/* Header */}
      <Card style={{ marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-primary)" }}>第 3 题 / 共 10 题</div>
          <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 2 }}>{SAMPLE_Q.chapter} · {SAMPLE_Q.type}</div>
          <div style={{ height: 4, background: "var(--color-background-secondary)", borderRadius: 2, marginTop: 8, width: 200 }}>
            <div style={{ height: 4, background: G.teal, borderRadius: 2, width: "30%" }} />
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Btn size="sm">🔖 收藏</Btn>
          <Btn size="sm">退出</Btn>
        </div>
      </Card>

      {/* Question */}
      <Card style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 12 }}>第 3 题 · 单选题</div>
        <div style={{ fontSize: 15, color: "var(--color-text-primary)", lineHeight: 1.7, marginBottom: 20 }}>{SAMPLE_Q.text}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {SAMPLE_Q.options.map((opt, i) => {
            let bg = "transparent", border = "0.5px solid var(--color-border-tertiary)", color = "var(--color-text-primary)";
            if (answered) {
              if (i === SAMPLE_Q.answer) { bg = G.tealLight; border = `1.5px solid ${G.teal}`; }
              else if (i === selected && i !== SAMPLE_Q.answer) { bg = "#FCEBEB"; border = "1.5px solid #A32D2D"; }
            } else if (selected === i) { bg = G.tealLight; border = `1.5px solid ${G.teal}`; }
            return (
              <div key={i} onClick={() => !answered && setSelected(i)} style={{ padding: "12px 16px", border, borderRadius: 8, cursor: answered ? "default" : "pointer", background: bg, display: "flex", gap: 12, alignItems: "center", transition: "all .15s" }}>
                <div style={{ width: 24, height: 24, borderRadius: "50%", border: "0.5px solid var(--color-border-secondary)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 500, flexShrink: 0, background: selected === i || (answered && i === SAMPLE_Q.answer) ? G.teal : "transparent", color: selected === i || (answered && i === SAMPLE_Q.answer) ? "#fff" : "var(--color-text-secondary)" }}>{optLetters[i]}</div>
                <span style={{ fontSize: 14, color }}>{opt}</span>
              </div>
            );
          })}
        </div>
      </Card>

      {/* AI Hint */}
      {(showHint || answered) && (
        <Card style={{ marginBottom: 12, background: "var(--color-background-secondary)", border: "none" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <div style={{ width: 22, height: 22, borderRadius: "50%", background: G.teal, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <span style={{ color: "#fff", fontSize: 10, fontWeight: 700 }}>AI</span>
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 500, color: "var(--color-text-primary)", marginBottom: 4 }}>解题提示</div>
              <div style={{ fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.6 }}>{SAMPLE_Q.hint}</div>
            </div>
          </div>
        </Card>
      )}

      {/* Actions */}
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <Btn>← 上一题</Btn>
        <div style={{ display: "flex", gap: 8 }}>
          {!answered && <Btn size="sm" onClick={() => setShowHint(v => !v)}>💡 {showHint ? "隐藏" : "提示"}</Btn>}
          {!answered ? <Btn variant="primary" onClick={handleAnswer}>提交答案</Btn> : <Btn variant="primary">下一题 →</Btn>}
        </div>
      </div>
    </div>
  );
}

// ── Flashcard Page ────────────────────────────────────────────────────────────
function FlashcardPage() {
  const cards = [
    { front: "二分法的收敛阶是？", back: "线性收敛，误差每步缩小 1/2，即 p = 1，C = 1/2" },
    { front: "Newton 法的收敛阶是？", back: "二阶（平方）收敛，即 p = 2，收敛速度远快于二分法" },
    { front: "什么是 LU 分解？", back: "将矩阵 A 分解为下三角矩阵 L 与上三角矩阵 U 的乘积，即 A = LU" },
  ];
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  return (
    <div style={{ padding: "1.5rem", maxWidth: 600, margin: "0 auto" }}>
      <div style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 16, textAlign: "center" }}>记忆卡片 · {idx + 1} / {cards.length}</div>
      <div onClick={() => setFlipped(v => !v)} style={{ background: flipped ? G.teal : "var(--color-background-primary)", border: `0.5px solid ${flipped ? G.teal : "var(--color-border-tertiary)"}`, borderRadius: 16, padding: "3rem 2rem", textAlign: "center", cursor: "pointer", minHeight: 180, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", transition: "all .2s", marginBottom: 16 }}>
        <div style={{ fontSize: 11, color: flipped ? "rgba(255,255,255,.7)" : "var(--color-text-tertiary)", marginBottom: 12, letterSpacing: "0.07em", textTransform: "uppercase" }}>{flipped ? "答案" : "问题（点击翻转）"}</div>
        <div style={{ fontSize: 18, fontWeight: 500, color: flipped ? "#fff" : "var(--color-text-primary)", lineHeight: 1.5 }}>{flipped ? cards[idx].back : cards[idx].front}</div>
      </div>
      <div style={{ display: "flex", justifyContent: "center", gap: 10 }}>
        <Btn onClick={() => { setIdx(i => Math.max(0, i - 1)); setFlipped(false); }}>← 上一张</Btn>
        <Btn variant="primary" onClick={() => { setIdx(i => Math.min(cards.length - 1, i + 1)); setFlipped(false); }}>下一张 →</Btn>
      </div>
    </div>
  );
}

// ── Teacher Dashboard ─────────────────────────────────────────────────────────
function TeacherPage() {
  const [tab, setTab] = useState("上传教材");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiQuestions, setAiQuestions] = useState([]);
  const [aiChapter, setAiChapter] = useState("Ch.1 · 方程求解");
  const [aiType, setAiType] = useState("单选题");
  const [aiCount, setAiCount] = useState("3");
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [uploadedQFiles, setUploadedQFiles] = useState([]);
  const [aiError, setAiError] = useState("");
  const pdfRef = useRef();
  const qRef = useRef();

  const TABS = ["上传教材", "上传题目", "AI 出题", "题库管理", "学生进度"];

  // File upload handlers
  const handlePdfDrop = useCallback((e) => {
    e.preventDefault();
    const files = [...(e.dataTransfer?.files || e.target.files || [])];
    const valid = files.filter(f => f.type === "application/pdf" || f.name.endsWith(".pdf"));
    setUploadedFiles(prev => [...prev, ...valid.map(f => ({ name: f.name, size: (f.size / 1024).toFixed(0) + " KB", status: "已上传", date: new Date().toLocaleDateString("zh-CN") }))]);
  }, []);

  const handleQDrop = useCallback((e) => {
    e.preventDefault();
    const files = [...(e.dataTransfer?.files || e.target.files || [])];
    setUploadedQFiles(prev => [...prev, ...files.map(f => ({ name: f.name, size: (f.size / 1024).toFixed(0) + " KB", status: "已上传", date: new Date().toLocaleDateString("zh-CN") }))]);
  }, []);

  // AI Question generation
  const generateQuestions = async () => {
    setAiLoading(true);
    setAiError("");
    setAiQuestions([]);
    try {
      const prompt = `你是一位数学课程出题专家，请为以下课程章节生成 ${aiCount} 道${aiType}。

章节：${aiChapter}
题型：${aiType}

要求：
- 题目紧贴数值分析 / 最优化课程内容
- 如果是单选题或多选题，提供4个选项，标明正确答案
- 如果是判断题，给出"正确/错误"及解析
- 如果是填空题，给出答案
- 每道题提供简短解析（50字以内）

请以 JSON 数组格式返回，结构如下：
[{"question":"题目内容","options":["A.选项1","B.选项2","C.选项3","D.选项4"],"answer":"A","explanation":"解析内容"}]

判断题和填空题 options 设为 null。仅返回 JSON，不要其他文字。`;

      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      const data = await res.json();
      const text = data.content?.map(b => b.text || "").join("") || "";
      const clean = text.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);
      setAiQuestions(parsed);
    } catch (err) {
      setAiError("生成失败，请稍后重试。(" + err.message + ")");
    }
    setAiLoading(false);
  };

  const DropZone = ({ onDrop, inputRef, accept, label, sublabel }) => (
    <div onDrop={onDrop} onDragOver={e => e.preventDefault()} onClick={() => inputRef.current?.click()} style={{ border: "1.5px dashed var(--color-border-secondary)", borderRadius: 12, padding: "2.5rem", textAlign: "center", cursor: "pointer", marginBottom: 16 }}>
      <input ref={inputRef} type="file" accept={accept} multiple style={{ display: "none" }} onChange={onDrop} />
      <div style={{ fontSize: 28, marginBottom: 8 }}>📂</div>
      <div style={{ fontSize: 14, fontWeight: 500, color: "var(--color-text-primary)", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>{sublabel}</div>
    </div>
  );

  const FileList = ({ files, onRemove }) => files.length > 0 && (
    <div>
      <SectionLabel>已上传文件</SectionLabel>
      {files.map((f, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
          <span style={{ fontSize: 16 }}>📄</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, color: "var(--color-text-primary)" }}>{f.name}</div>
            <div style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>{f.size} · {f.date}</div>
          </div>
          <Badge color="teal">{f.status}</Badge>
          <button onClick={() => onRemove(i)} style={{ fontSize: 11, color: "var(--color-text-tertiary)", background: "none", border: "none", cursor: "pointer" }}>删除</button>
        </div>
      ))}
    </div>
  );

  const MOCK_QS = [
    { q: "二分法每步误差缩小比例", type: "单选", ch: "Ch.1" },
    { q: "LU分解的计算复杂度 O(?)", type: "填空", ch: "Ch.2" },
    { q: "Runge-Kutta 4阶方法推导", type: "计算", ch: "Ch.6" },
    { q: "Lagrange 插值误差公式", type: "判断", ch: "Ch.3" },
  ];

  const STUDENTS = [
    { name: "张同学", pct: 82 }, { name: "李同学", pct: 65 },
    { name: "王同学", pct: 91 }, { name: "陈同学", pct: 43 }, { name: "刘同学", pct: 77 },
  ];

  return (
    <div style={{ padding: "1.5rem", maxWidth: 960, margin: "0 auto" }}>
      {/* Tabs */}
      <div style={{ display: "flex", gap: 0, borderBottom: "0.5px solid var(--color-border-tertiary)", marginBottom: 16 }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: "10px 18px", fontSize: 13, fontFamily: "var(--font-sans)", border: "none", borderBottom: tab === t ? `2px solid ${G.teal}` : "2px solid transparent", background: "none", cursor: "pointer", color: tab === t ? G.teal : "var(--color-text-secondary)", fontWeight: tab === t ? 500 : 400, marginBottom: -0.5 }}>{t}</button>
        ))}
      </div>

      {tab === "上传教材" && (
        <Card>
          <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 4, color: "var(--color-text-primary)" }}>上传教材 PDF</div>
          <div style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 16 }}>上传教材后，AI 将自动提取知识点并用于生成题目</div>
          <DropZone onDrop={handlePdfDrop} inputRef={pdfRef} accept=".pdf" label="拖拽 PDF 教材到此处，或点击选择文件" sublabel="支持多文件上传，仅限 PDF 格式" />
          <FileList files={uploadedFiles} onRemove={i => setUploadedFiles(f => f.filter((_, j) => j !== i))} />
          {uploadedFiles.length === 0 && (
            <div style={{ textAlign: "center", padding: "1rem 0", fontSize: 13, color: "var(--color-text-tertiary)" }}>
              已有教材：数值分析 (Sauer) · 最优化 Ch.1 (OR4030)
            </div>
          )}
        </Card>
      )}

      {tab === "上传题目" && (
        <Card>
          <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 4, color: "var(--color-text-primary)" }}>批量上传题目</div>
          <div style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 16 }}>支持 CSV / Excel / JSON 格式，题目将导入题库</div>
          <DropZone onDrop={handleQDrop} inputRef={qRef} accept=".csv,.xlsx,.json" label="拖拽题目文件到此处，或点击选择" sublabel="支持 CSV、Excel、JSON 格式" />
          <FileList files={uploadedQFiles} onRemove={i => setUploadedQFiles(f => f.filter((_, j) => j !== i))} />
          <div style={{ marginTop: 12, padding: 12, background: "var(--color-background-secondary)", borderRadius: 8 }}>
            <SectionLabel>CSV 格式模板</SectionLabel>
            <pre style={{ fontSize: 11, color: "var(--color-text-secondary)", fontFamily: "var(--font-mono)", lineHeight: 1.6 }}>chapter,type,question,optionA,optionB,optionC,optionD,answer,explanation{"\n"}Ch.1,单选题,二分法每步误差缩小为,1/4,1/2,1/3,不确定,B,每次将区间对半分</pre>
          </div>
        </Card>
      )}

      {tab === "AI 出题" && (
        <Card>
          <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 4, color: "var(--color-text-primary)" }}>AI 智能出题</div>
          <div style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 16 }}>基于已上传的教材内容，自动生成指定章节和题型的题目</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 80px auto", gap: 8, marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 4 }}>章节</div>
              <select value={aiChapter} onChange={e => setAiChapter(e.target.value)} style={{ width: "100%", fontSize: 13, padding: "8px 10px", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 8, background: "var(--color-background-primary)", color: "var(--color-text-primary)", fontFamily: "var(--font-sans)" }}>
                <option>Ch.1 · 方程求解</option>
                <option>Ch.2 · 线性方程组</option>
                <option>Ch.3 · 插值</option>
                <option>Ch.4 · 最小二乘</option>
                <option>Ch.5 · 数值微积分</option>
                <option>Ch.6 · 常微分方程</option>
                <option>最优化 Ch.1 · 优化模型</option>
              </select>
            </div>
            <div>
              <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 4 }}>题型</div>
              <select value={aiType} onChange={e => setAiType(e.target.value)} style={{ width: "100%", fontSize: 13, padding: "8px 10px", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 8, background: "var(--color-background-primary)", color: "var(--color-text-primary)", fontFamily: "var(--font-sans)" }}>
                {["单选题", "多选题", "填空题", "判断题", "计算题"].map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 4 }}>数量</div>
              <select value={aiCount} onChange={e => setAiCount(e.target.value)} style={{ width: "100%", fontSize: 13, padding: "8px 10px", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 8, background: "var(--color-background-primary)", color: "var(--color-text-primary)", fontFamily: "var(--font-sans)" }}>
                {["1", "3", "5"].map(n => <option key={n}>{n}</option>)}
              </select>
            </div>
            <div style={{ display: "flex", alignItems: "flex-end" }}>
              <Btn variant="primary" onClick={generateQuestions}>{aiLoading ? "生成中…" : "生成"}</Btn>
            </div>
          </div>

          {aiError && <div style={{ color: G.red, fontSize: 13, marginBottom: 12, padding: "8px 12px", background: "#FCEBEB", borderRadius: 8 }}>{aiError}</div>}

          {aiLoading && (
            <div style={{ textAlign: "center", padding: "2rem", color: "var(--color-text-secondary)", fontSize: 13 }}>
              <div style={{ width: 20, height: 20, border: `2px solid ${G.teal}`, borderTopColor: "transparent", borderRadius: "50%", animation: "spin 1s linear infinite", margin: "0 auto 10px" }} />
              AI 正在根据教材内容生成题目…
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>
          )}

          {aiQuestions.length > 0 && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <SectionLabel>已生成 {aiQuestions.length} 道题目</SectionLabel>
                <Btn size="sm" variant="primary">全部加入题库</Btn>
              </div>
              {aiQuestions.map((q, i) => (
                <div key={i} style={{ border: "0.5px solid var(--color-border-tertiary)", borderRadius: 8, padding: "1rem", marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-primary)" }}>第 {i + 1} 题</div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <Badge color="blue">{aiType}</Badge>
                      <Btn size="sm">加入题库</Btn>
                    </div>
                  </div>
                  <div style={{ fontSize: 14, color: "var(--color-text-primary)", marginBottom: 10, lineHeight: 1.6 }}>{q.question}</div>
                  {q.options && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 8 }}>
                      {q.options.map((opt, j) => (
                        <div key={j} style={{ fontSize: 12, padding: "6px 10px", background: opt.startsWith(q.answer) ? G.tealLight : "var(--color-background-secondary)", borderRadius: 6, color: opt.startsWith(q.answer) ? G.tealDark : "var(--color-text-secondary)" }}>{opt}</div>
                      ))}
                    </div>
                  )}
                  <div style={{ fontSize: 12, color: "var(--color-text-secondary)", background: "var(--color-background-secondary)", padding: "8px 10px", borderRadius: 6 }}>
                    <strong>答案：</strong>{q.answer}　<strong>解析：</strong>{q.explanation}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {tab === "题库管理" && (
        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div style={{ fontSize: 15, fontWeight: 500, color: "var(--color-text-primary)" }}>题库管理</div>
            <div style={{ display: "flex", gap: 8 }}>
              <Btn size="sm">筛选</Btn>
              <Btn size="sm" variant="primary">+ 手动添加</Btn>
            </div>
          </div>
          {MOCK_QS.map((q, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
              <Badge color="amber">{q.ch}</Badge>
              <div style={{ flex: 1, fontSize: 13, color: "var(--color-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{q.q}</div>
              <Badge color="blue">{q.type}</Badge>
              <div style={{ display: "flex", gap: 6 }}>
                <Btn size="sm">编辑</Btn>
                <Btn size="sm">删除</Btn>
              </div>
            </div>
          ))}
        </Card>
      )}

      {tab === "学生进度" && (
        <Card>
          <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 16, color: "var(--color-text-primary)" }}>学生学习进度</div>
          {STUDENTS.map((s, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
              <div style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--color-background-secondary)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 500, flexShrink: 0 }}>{s.name[0]}</div>
              <div style={{ flex: 1, fontSize: 13, color: "var(--color-text-primary)" }}>{s.name}</div>
              <div style={{ width: 120, height: 4, background: "var(--color-background-secondary)", borderRadius: 2 }}>
                <div style={{ height: 4, borderRadius: 2, background: s.pct >= 80 ? G.teal : s.pct >= 60 ? G.amber : G.red, width: `${s.pct}%` }} />
              </div>
              <div style={{ fontSize: 13, color: "var(--color-text-secondary)", minWidth: 36, textAlign: "right" }}>{s.pct}%</div>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

// ── Root App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [page, setPage] = useState("首页");
  const [role, setRole] = useState("student");

  const renderPage = () => {
    if (page === "首页") return <HomePage setPage={setPage} />;
    if (page === "知识点") return <KnowledgePage setPage={setPage} />;
    if (page === "题库练习") return (
      <div style={{ padding: "1.5rem", maxWidth: 900, margin: "0 auto" }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          {["答题模式", "记忆卡片"].map(t => (
            <Btn key={t} variant={t === "答题模式" ? "primary" : "outline"}>{t}</Btn>
          ))}
        </div>
        <QuizPage />
      </div>
    );
    if (page === "错题本") return (
      <div style={{ padding: "1.5rem", maxWidth: 780, margin: "0 auto" }}>
        <Card>
          <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 12, color: "var(--color-text-primary)" }}>错题本</div>
          {["Newton法收敛条件", "Lagrange插值误差估计", "LU分解适用条件"].map((q, i) => (
            <div key={i} style={{ padding: "10px 0", borderBottom: "0.5px solid var(--color-border-tertiary)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 13, color: "var(--color-text-primary)" }}>{q}</div>
              <div style={{ display: "flex", gap: 6 }}>
                <Badge color="red">错误</Badge>
                <Btn size="sm">重做</Btn>
              </div>
            </div>
          ))}
        </Card>
      </div>
    );
    if (page === "教师管理") return <TeacherPage />;
    return null;
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--color-background-tertiary)" }}>
      <TopNav page={page} setPage={setPage} role={role} setRole={setRole} />
      {renderPage()}
    </div>
  );
}