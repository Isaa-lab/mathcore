import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";

// ── Supabase ──────────────────────────────────────────────────────────────────
const supabase = createClient(
  "https://kadjwgslbpklwbpvpsze.supabase.co",
  "sb_publishable_TvfRCNQCSs92EmZ02J5H1A_yM3FrFUp"
);

// ── Colors ────────────────────────────────────────────────────────────────────
const G = {
  teal: "#1D9E75", tealLight: "#E1F5EE", tealDark: "#0F6E56",
  blue: "#185FA5", blueLight: "#E6F1FB",
  amber: "#BA7517", amberLight: "#FAEEDA",
  red: "#A32D2D", redLight: "#FCEBEB",
};

// ── Tiny UI helpers ───────────────────────────────────────────────────────────
const Btn = ({ children, onClick, variant = "outline", size = "md", style = {}, disabled = false }) => {
  const pad = size === "sm" ? "5px 12px" : "8px 20px";
  const fz = size === "sm" ? 12 : 13;
  const base = variant === "primary"
    ? { background: disabled ? "#9FE1CB" : G.teal, color: "#fff", border: "none" }
    : { background: "transparent", color: "var(--color-text-primary)", border: "0.5px solid var(--color-border-secondary)" };
  return (
    <button disabled={disabled} onClick={onClick} style={{
      padding: pad, fontSize: fz, fontFamily: "var(--font-sans)",
      borderRadius: 8, cursor: disabled ? "not-allowed" : "pointer",
      fontWeight: 500, transition: "opacity .15s", ...base, ...style,
    }}>{children}</button>
  );
};

const Badge = ({ children, color = "teal" }) => {
  const map = { teal: [G.tealLight, G.tealDark], blue: [G.blueLight, G.blue], amber: [G.amberLight, G.amber], red: [G.redLight, G.red] };
  const [bg, fg] = map[color] || map.teal;
  return <span style={{ background: bg, color: fg, fontSize: 10, padding: "2px 8px", borderRadius: 10, fontWeight: 500 }}>{children}</span>;
};

const Card = ({ children, style = {}, onClick }) => (
  <div onClick={onClick} style={{
    background: "var(--color-background-primary)",
    border: "0.5px solid var(--color-border-tertiary)",
    borderRadius: 12, padding: "1rem 1.25rem",
    cursor: onClick ? "pointer" : "default", ...style,
  }}>{children}</div>
);

const Input = ({ label, type = "text", value, onChange, placeholder }) => (
  <div style={{ marginBottom: 14 }}>
    {label && <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 5 }}>{label}</div>}
    <input
      type={type} value={value} onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={{ width: "100%", fontSize: 14, padding: "10px 12px", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 8, background: "var(--color-background-primary)", color: "var(--color-text-primary)", fontFamily: "var(--font-sans)", boxSizing: "border-box" }}
    />
  </div>
);

const Alert = ({ msg, type = "error" }) => msg ? (
  <div style={{ padding: "10px 12px", borderRadius: 8, fontSize: 13, marginBottom: 12, background: type === "error" ? G.redLight : G.tealLight, color: type === "error" ? G.red : G.tealDark }}>
    {msg}
  </div>
) : null;

// ── Auth Page ─────────────────────────────────────────────────────────────────
function AuthPage({ onAuth }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("student");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const handleLogin = async () => {
    setLoading(true); setError("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError("邮箱或密码错误，请重试");
    setLoading(false);
  };

  const handleRegister = async () => {
    if (!name.trim()) { setError("请输入你的姓名"); return; }
    if (password.length < 6) { setError("密码至少需要 6 位"); return; }
    setLoading(true); setError("");
    const { error } = await supabase.auth.signUp({
      email, password,
      options: { data: { name, role } }
    });
    if (error) setError(error.message);
    else setSuccess("注册成功！请检查邮箱完成验证，然后登录。");
    setLoading(false);
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--color-background-tertiary)", display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
      <div style={{ width: "100%", maxWidth: 400 }}>
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 20, fontWeight: 500, color: "var(--color-text-primary)" }}>
            <div style={{ width: 10, height: 10, borderRadius: "50%", background: G.teal }} />
            MathCore
          </div>
          <div style={{ fontSize: 13, color: "var(--color-text-secondary)", marginTop: 4 }}>数学与应用数学学习平台</div>
        </div>

        <Card>
          {/* Tab */}
          <div style={{ display: "flex", marginBottom: 20, border: "0.5px solid var(--color-border-tertiary)", borderRadius: 8, overflow: "hidden" }}>
            {[["login", "登录"], ["register", "注册"]].map(([m, label]) => (
              <button key={m} onClick={() => { setMode(m); setError(""); setSuccess(""); }} style={{ flex: 1, padding: "9px 0", fontSize: 13, fontFamily: "var(--font-sans)", border: "none", cursor: "pointer", background: mode === m ? G.teal : "transparent", color: mode === m ? "#fff" : "var(--color-text-secondary)", fontWeight: mode === m ? 500 : 400 }}>{label}</button>
            ))}
          </div>

          <Alert msg={error} type="error" />
          <Alert msg={success} type="success" />

          {mode === "register" && (
            <>
              <Input label="姓名" value={name} onChange={setName} placeholder="你的名字" />
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 5 }}>身份</div>
                <div style={{ display: "flex", gap: 8 }}>
                  {[["student", "学生"], ["teacher", "教师"]].map(([r, label]) => (
                    <button key={r} onClick={() => setRole(r)} style={{ flex: 1, padding: "9px 0", fontSize: 13, fontFamily: "var(--font-sans)", border: role === r ? `1.5px solid ${G.teal}` : "0.5px solid var(--color-border-tertiary)", borderRadius: 8, cursor: "pointer", background: role === r ? G.tealLight : "transparent", color: role === r ? G.tealDark : "var(--color-text-secondary)", fontWeight: role === r ? 500 : 400 }}>{label}</button>
                  ))}
                </div>
              </div>
            </>
          )}

          <Input label="邮箱" type="email" value={email} onChange={setEmail} placeholder="your@email.com" />
          <Input label="密码" type="password" value={password} onChange={setPassword} placeholder={mode === "register" ? "至少 6 位" : "输入密码"} />

          <Btn variant="primary" onClick={mode === "login" ? handleLogin : handleRegister} disabled={loading} style={{ width: "100%", padding: "11px 0", fontSize: 14 }}>
            {loading ? "处理中…" : mode === "login" ? "登录" : "注册"}
          </Btn>

          {mode === "login" && (
            <div style={{ textAlign: "center", marginTop: 12, fontSize: 12, color: "var(--color-text-tertiary)" }}>
              还没有账号？<span onClick={() => setMode("register")} style={{ color: G.teal, cursor: "pointer" }}>立即注册</span>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

// ── Top Navigation ────────────────────────────────────────────────────────────
function TopNav({ page, setPage, profile, onLogout }) {
  const links = profile?.role === "teacher"
    ? ["首页", "知识点", "题库练习", "错题本", "教师管理"]
    : ["首页", "知识点", "题库练习", "错题本"];

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
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
          {profile?.name || profile?.email}
          <Badge color={profile?.role === "teacher" ? "blue" : "teal"} style={{ marginLeft: 6 }}>
            {profile?.role === "teacher" ? "教师" : "学生"}
          </Badge>
        </div>
        <Btn size="sm" onClick={onLogout}>退出</Btn>
      </div>
    </div>
  );
}

// ── Home Page ─────────────────────────────────────────────────────────────────
function HomePage({ setPage, profile }) {
  const quick = [
    { icon: "📖", title: "继续学习", desc: "第4章 · 最小二乘法", page: "知识点" },
    { icon: "✏️", title: "每日练习", desc: "今日推荐 5 道题", page: "题库练习" },
    { icon: "📊", title: "学习报告", desc: "正确率 · 薄弱点分析", page: null },
    { icon: "🔖", title: "错题本", desc: "收录错题", page: "错题本" },
  ];
  return (
    <div style={{ padding: "1.5rem", maxWidth: 900, margin: "0 auto" }}>
      <Card style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: G.teal, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>数学与应用数学学习平台</div>
        <div style={{ fontSize: 22, fontWeight: 500, marginBottom: 6, color: "var(--color-text-primary)" }}>
          你好，{profile?.name || "同学"} 👋
        </div>
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
  { id: 11, course: "最优化", num: "Ch.1b", name: "非线性规划应用案例", topics: ["设施选址问题", "球缺体积最优化", "投资组合选择 (Markowitz)", "交通流最小化", "最大似然估计", "SVM 分类"] },
];

function KnowledgePage({ setPage }) {
  const [sel, setSel] = useState(CHAPTERS[0]);
  const [filter, setFilter] = useState("全部");
  const courses = ["全部", "数值分析", "最优化"];
  const filtered = filter === "全部" ? CHAPTERS : CHAPTERS.filter(c => c.course === filter);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", gap: 12, padding: "1.5rem", maxWidth: 1100, margin: "0 auto" }}>
      <div>
        <Card style={{ padding: "10px 0" }}>
          <div style={{ padding: "0 12px 8px", display: "flex", gap: 4 }}>
            {courses.map(c => (
              <button key={c} onClick={() => setFilter(c)} style={{ flex: 1, fontSize: 11, padding: "4px 0", borderRadius: 6, border: "none", cursor: "pointer", fontFamily: "var(--font-sans)", background: filter === c ? G.teal : "var(--color-background-secondary)", color: filter === c ? "#fff" : "var(--color-text-secondary)" }}>{c}</button>
            ))}
          </div>
          {filtered.map(ch => (
            <div key={ch.id} onClick={() => setSel(ch)} style={{ padding: "8px 14px", cursor: "pointer", fontSize: 13, background: sel.id === ch.id ? G.tealLight : "transparent", color: sel.id === ch.id ? G.tealDark : "var(--color-text-secondary)", borderLeft: sel.id === ch.id ? `3px solid ${G.teal}` : "3px solid transparent", fontWeight: sel.id === ch.id ? 500 : 400 }}>
              <span style={{ fontSize: 10, opacity: .7, marginRight: 4 }}>{ch.num}</span>{ch.name.split(" ")[0]}
            </div>
          ))}
        </Card>
      </div>
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
        <div style={{ fontSize: 11, fontWeight: 500, color: "var(--color-text-secondary)", letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 10 }}>本章知识点</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {sel.topics.map((t, i) => (
            <div key={i} style={{ border: "0.5px solid var(--color-border-tertiary)", borderRadius: 8, padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 500, color: "var(--color-text-primary)", marginBottom: 2 }}>{t}</div>
                <div style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>点击展开详细内容</div>
              </div>
              <Badge color={i < 2 ? "teal" : i < 3 ? "amber" : "red"}>{i < 2 ? "已完成" : i < 3 ? "学习中" : "未开始"}</Badge>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ── Quiz Page ─────────────────────────────────────────────────────────────────
function QuizPage() {
  const [questions, setQuestions] = useState([]);
  const [current, setCurrent] = useState(0);
  const [selected, setSelected] = useState(null);
  const [answered, setAnswered] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [loading, setLoading] = useState(true);

  const SAMPLE = {
    chapter: "Ch.1 · 方程求解", type: "单选题",
    question: "在使用二分法求方程 f(x) = 0 的根时，每迭代一次，有根区间的长度变为原来的：",
    options: ["1/3", "1/2", "1/4", "不确定，取决于 f(x)"],
    answer: "B",
    explanation: "二分法每次将区间从 [a,b] 分成两半，取包含根的那半，因此区间长度每次精确地缩小为 1/2。",
  };

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.from("questions").select("*").limit(10);
      setQuestions(data?.length ? data : [SAMPLE]);
      setLoading(false);
    };
    load();
  }, []);

  const q = questions[current] || SAMPLE;
  const opts = q.options ? (typeof q.options === "string" ? JSON.parse(q.options) : q.options) : SAMPLE.options;
  const optLetters = ["A", "B", "C", "D"];

  if (loading) return <div style={{ padding: "3rem", textAlign: "center", color: "var(--color-text-secondary)" }}>加载题目中…</div>;

  return (
    <div style={{ padding: "1.5rem", maxWidth: 780, margin: "0 auto" }}>
      <Card style={{ marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-primary)" }}>第 {current + 1} 题 / 共 {questions.length} 题</div>
          <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 2 }}>{q.chapter || "Ch.1"} · {q.type || "单选题"}</div>
          <div style={{ height: 4, background: "var(--color-background-secondary)", borderRadius: 2, marginTop: 8, width: 200 }}>
            <div style={{ height: 4, background: G.teal, borderRadius: 2, width: `${((current + 1) / questions.length) * 100}%` }} />
          </div>
        </div>
        <Btn size="sm">🔖 收藏</Btn>
      </Card>

      <Card style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12 }}>第 {current + 1} 题 · {q.type || "单选题"}</div>
        <div style={{ fontSize: 15, color: "var(--color-text-primary)", lineHeight: 1.7, marginBottom: 20 }}>{q.question}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {opts.map((opt, i) => {
            let border = "0.5px solid var(--color-border-tertiary)", bg = "transparent";
            if (answered) {
              if (optLetters[i] === q.answer) { bg = G.tealLight; border = `1.5px solid ${G.teal}`; }
              else if (i === selected && optLetters[i] !== q.answer) { bg = G.redLight; border = `1.5px solid ${G.red}`; }
            } else if (selected === i) { bg = G.tealLight; border = `1.5px solid ${G.teal}`; }
            return (
              <div key={i} onClick={() => !answered && setSelected(i)} style={{ padding: "12px 16px", border, borderRadius: 8, cursor: answered ? "default" : "pointer", background: bg, display: "flex", gap: 12, alignItems: "center", transition: "all .15s" }}>
                <div style={{ width: 24, height: 24, borderRadius: "50%", border: "0.5px solid var(--color-border-secondary)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 500, flexShrink: 0, background: selected === i ? G.teal : "transparent", color: selected === i ? "#fff" : "var(--color-text-secondary)" }}>{optLetters[i]}</div>
                <span style={{ fontSize: 14, color: "var(--color-text-primary)" }}>{opt}</span>
              </div>
            );
          })}
        </div>
      </Card>

      {(showHint || answered) && (
        <Card style={{ marginBottom: 12, background: "var(--color-background-secondary)", border: "none" }}>
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ width: 22, height: 22, borderRadius: "50%", background: G.teal, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <span style={{ color: "#fff", fontSize: 10, fontWeight: 700 }}>AI</span>
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 500, color: "var(--color-text-primary)", marginBottom: 4 }}>解题提示</div>
              <div style={{ fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.6 }}>{q.explanation || SAMPLE.explanation}</div>
            </div>
          </div>
        </Card>
      )}

      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <Btn onClick={() => { setCurrent(c => Math.max(0, c - 1)); setSelected(null); setAnswered(false); setShowHint(false); }}>← 上一题</Btn>
        <div style={{ display: "flex", gap: 8 }}>
          {!answered && <Btn size="sm" onClick={() => setShowHint(v => !v)}>💡 提示</Btn>}
          {!answered
            ? <Btn variant="primary" onClick={() => selected !== null && setAnswered(true)}>提交答案</Btn>
            : <Btn variant="primary" onClick={() => { setCurrent(c => Math.min(questions.length - 1, c + 1)); setSelected(null); setAnswered(false); setShowHint(false); }}>下一题 →</Btn>
          }
        </div>
      </div>
    </div>
  );
}

// ── Wrong Questions Page ──────────────────────────────────────────────────────
function WrongPage() {
  return (
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
}

// ── Teacher Page ──────────────────────────────────────────────────────────────
function TeacherPage() {
  const [tab, setTab] = useState("上传教材");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiQuestions, setAiQuestions] = useState([]);
  const [aiChapter, setAiChapter] = useState("Ch.1 · 方程求解");
  const [aiType, setAiType] = useState("单选题");
  const [aiCount, setAiCount] = useState("3");
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [aiError, setAiError] = useState("");
  const [dbQuestions, setDbQuestions] = useState([]);
  const [saving, setSaving] = useState(false);
  const pdfRef = useRef();

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.from("questions").select("*").order("created_at", { ascending: false });
      if (data) setDbQuestions(data);
    };
    load();
  }, []);

  const handlePdfDrop = useCallback((e) => {
    e.preventDefault();
    const files = [...(e.dataTransfer?.files || e.target.files || [])];
    setUploadedFiles(prev => [...prev, ...files.map(f => ({ name: f.name, size: (f.size / 1024).toFixed(0) + " KB", date: new Date().toLocaleDateString("zh-CN") }))]);
  }, []);

  const generateQuestions = async () => {
    setAiLoading(true); setAiError(""); setAiQuestions([]);
    try {
      const prompt = `你是数学课程出题专家，请为"${aiChapter}"生成${aiCount}道${aiType}。要求紧贴数值分析/最优化课程。请以JSON数组返回，结构：[{"question":"题目","options":["A.选项1","B.选项2","C.选项3","D.选项4"],"answer":"A","explanation":"解析"}]。判断题和填空题options设为null。仅返回JSON。`;
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000, messages: [{ role: "user", content: prompt }] }),
      });
      const data = await res.json();
      const text = data.content?.map(b => b.text || "").join("") || "";
      const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
      setAiQuestions(parsed);
    } catch (err) {
      setAiError("生成失败，请稍后重试。");
    }
    setAiLoading(false);
  };

  const saveToDb = async (q) => {
    setSaving(true);
    const { error } = await supabase.from("questions").insert({
      chapter: aiChapter, course: aiChapter.includes("优化") ? "最优化" : "数值分析",
      type: aiType, question: q.question,
      options: q.options, answer: q.answer, explanation: q.explanation,
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

  const TABS = ["上传教材", "AI 出题", "题库管理", "学生进度"];
  const STUDENTS = [{ name: "张同学", pct: 82 }, { name: "李同学", pct: 65 }, { name: "王同学", pct: 91 }, { name: "陈同学", pct: 43 }];

  return (
    <div style={{ padding: "1.5rem", maxWidth: 960, margin: "0 auto" }}>
      <div style={{ display: "flex", gap: 0, borderBottom: "0.5px solid var(--color-border-tertiary)", marginBottom: 16 }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: "10px 18px", fontSize: 13, fontFamily: "var(--font-sans)", border: "none", borderBottom: tab === t ? `2px solid ${G.teal}` : "2px solid transparent", background: "none", cursor: "pointer", color: tab === t ? G.teal : "var(--color-text-secondary)", fontWeight: tab === t ? 500 : 400, marginBottom: -0.5 }}>{t}</button>
        ))}
      </div>

      {tab === "上传教材" && (
        <Card>
          <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 4, color: "var(--color-text-primary)" }}>上传教材 PDF</div>
          <div style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 16 }}>上传教材后，AI 将自动提取知识点并用于生成题目</div>
          <div onDrop={handlePdfDrop} onDragOver={e => e.preventDefault()} onClick={() => pdfRef.current?.click()} style={{ border: "1.5px dashed var(--color-border-secondary)", borderRadius: 12, padding: "2.5rem", textAlign: "center", cursor: "pointer", marginBottom: 16 }}>
            <input ref={pdfRef} type="file" accept=".pdf" multiple style={{ display: "none" }} onChange={handlePdfDrop} />
            <div style={{ fontSize: 28, marginBottom: 8 }}>📂</div>
            <div style={{ fontSize: 14, fontWeight: 500, color: "var(--color-text-primary)", marginBottom: 4 }}>拖拽 PDF 教材到此处，或点击选择</div>
            <div style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>支持多文件上传，仅限 PDF 格式</div>
          </div>
          {uploadedFiles.map((f, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
              <span>📄</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, color: "var(--color-text-primary)" }}>{f.name}</div>
                <div style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>{f.size} · {f.date}</div>
              </div>
              <Badge color="teal">已上传</Badge>
            </div>
          ))}
          <div style={{ marginTop: 12, fontSize: 13, color: "var(--color-text-tertiary)", textAlign: "center" }}>已有教材：数值分析 (Sauer 2nd Ed.) · 最优化 Ch.1 (OR4030)</div>
        </Card>
      )}

      {tab === "AI 出题" && (
        <Card>
          <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 4, color: "var(--color-text-primary)" }}>AI 智能出题</div>
          <div style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 16 }}>基于教材内容，自动生成题目并保存到数据库</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 80px auto", gap: 8, marginBottom: 16, alignItems: "end" }}>
            <div>
              <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 4 }}>章节</div>
              <select value={aiChapter} onChange={e => setAiChapter(e.target.value)} style={{ width: "100%", fontSize: 13, padding: "8px 10px", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 8, background: "var(--color-background-primary)", color: "var(--color-text-primary)", fontFamily: "var(--font-sans)" }}>
                {["Ch.1 · 方程求解", "Ch.2 · 线性方程组", "Ch.3 · 插值", "Ch.4 · 最小二乘", "Ch.5 · 数值微积分", "Ch.6 · 常微分方程", "最优化 Ch.1 · 优化模型"].map(o => <option key={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 4 }}>题型</div>
              <select value={aiType} onChange={e => setAiType(e.target.value)} style={{ width: "100%", fontSize: 13, padding: "8px 10px", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 8, background: "var(--color-background-primary)", color: "var(--color-text-primary)", fontFamily: "var(--font-sans)" }}>
                {["单选题", "多选题", "填空题", "判断题"].map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 4 }}>数量</div>
              <select value={aiCount} onChange={e => setAiCount(e.target.value)} style={{ width: "100%", fontSize: 13, padding: "8px 10px", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 8, background: "var(--color-background-primary)", color: "var(--color-text-primary)", fontFamily: "var(--font-sans)" }}>
                {["1", "3", "5"].map(n => <option key={n}>{n}</option>)}
              </select>
            </div>
            <Btn variant="primary" onClick={generateQuestions}>{aiLoading ? "生成中…" : "生成"}</Btn>
          </div>

          {aiError && <div style={{ color: G.red, fontSize: 13, padding: "8px 12px", background: G.redLight, borderRadius: 8, marginBottom: 12 }}>{aiError}</div>}
          {aiLoading && <div style={{ textAlign: "center", padding: "2rem", color: "var(--color-text-secondary)", fontSize: 13 }}>AI 正在生成题目…</div>}

          {aiQuestions.map((q, i) => (
            <div key={i} style={{ border: "0.5px solid var(--color-border-tertiary)", borderRadius: 8, padding: "1rem", marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <Badge color="blue">{aiType}</Badge>
                <Btn size="sm" variant="primary" onClick={() => saveToDb(q)} disabled={saving}>保存到题库</Btn>
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
        </Card>
      )}

      {tab === "题库管理" && (
        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div style={{ fontSize: 15, fontWeight: 500, color: "var(--color-text-primary)" }}>题库管理 <span style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>共 {dbQuestions.length} 题</span></div>
          </div>
          {dbQuestions.length === 0 && <div style={{ textAlign: "center", padding: "2rem", color: "var(--color-text-tertiary)", fontSize: 13 }}>暂无题目，请先用 AI 出题或手动添加</div>}
          {dbQuestions.map((q, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
              <Badge color="amber">{q.chapter}</Badge>
              <div style={{ flex: 1, fontSize: 13, color: "var(--color-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{q.question}</div>
              <Badge color="blue">{q.type}</Badge>
              <Btn size="sm" onClick={() => deleteQuestion(q.id)}>删除</Btn>
            </div>
          ))}
        </Card>
      )}

      {tab === "学生进度" && (
        <Card>
          <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 16, color: "var(--color-text-primary)" }}>学生学习进度</div>
          {STUDENTS.map((s, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
              <div style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--color-background-secondary)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 500 }}>{s.name[0]}</div>
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
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [page, setPage] = useState("首页");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) loadProfile(session.user.id);
      else setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
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

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setPage("首页");
  };

  if (loading) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--color-background-tertiary)" }}>
      <div style={{ fontSize: 14, color: "var(--color-text-secondary)" }}>加载中…</div>
    </div>
  );

  if (!session) return <AuthPage onAuth={setSession} />;

  const renderPage = () => {
    if (page === "首页") return <HomePage setPage={setPage} profile={profile} />;
    if (page === "知识点") return <KnowledgePage setPage={setPage} />;
    if (page === "题库练习") return <QuizPage />;
    if (page === "错题本") return <WrongPage />;
    if (page === "教师管理") return <TeacherPage />;
    return null;
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--color-background-tertiary)" }}>
      <TopNav page={page} setPage={setPage} profile={profile} onLogout={handleLogout} />
      {renderPage()}
    </div>
  );
}