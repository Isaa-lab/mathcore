import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";
import katex from "katex";
import "katex/dist/katex.min.css";

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

// ── KaTeX Math Component ──────────────────────────────────────────────────────
const M = ({ tex, block = false }) => {
  const ref = useRef();
  useEffect(() => {
    if (ref.current) {
      try {
        katex.render(tex, ref.current, { throwOnError: false, displayMode: block });
      } catch (e) {}
    }
  }, [tex, block]);
  return <span ref={ref} style={{ display: block ? "block" : "inline", margin: block ? "0.75rem 0" : "0 2px" }} />;
};

// ── Knowledge Content ─────────────────────────────────────────────────────────
const KNOWLEDGE_CONTENT = {
  "二分法": {
    intro: "二分法（Bisection Method）是求方程 f(x)=0 实根的最简单数值方法。其核心思想是利用连续函数的中间值定理，每次将有根区间缩短一半。",
    formulas: [
      { label: "迭代公式", tex: "c = \\frac{a+b}{2}" },
      { label: "误差上界", tex: "|c - r| \\leq \\frac{b-a}{2^{n+1}}" },
      { label: "收敛阶", tex: "p = 1,\\quad C = \\frac{1}{2}" },
    ],
    steps: ["确认 f(a)·f(b) < 0，即区间 [a,b] 内有根", "计算中点 c = (a+b)/2", "若 f(a)·f(c) < 0，令 b=c；否则令 a=c", "重复直到误差满足要求"],
    note: "优点：一定收敛，实现简单。缺点：收敛慢（线性），不能求复数根或重根。"
  },
  "Newton 法": {
    intro: "Newton 法（牛顿法）利用函数的切线来逼近零点，具有二阶收敛速度，是最重要的求根方法之一。",
    formulas: [
      { label: "迭代公式", tex: "x_{n+1} = x_n - \\frac{f(x_n)}{f'(x_n)}" },
      { label: "误差关系（二阶收敛）", tex: "e_{n+1} \\approx \\frac{f''(x^*)}{2f'(x^*)} e_n^2" },
      { label: "收敛条件", tex: "\\left|\\frac{f(x)f''(x)}{[f'(x)]^2}\\right| < 1" },
    ],
    steps: ["选取初始近似值 x₀", "计算 x_{n+1} = x_n - f(x_n)/f'(x_n)", "若 |x_{n+1} - x_n| < ε，停止迭代"],
    note: "二阶收敛意味着每步有效数字大约翻倍。缺陷：需要计算导数，且初始值需要足够接近真实根。"
  },
  "不动点迭代": {
    intro: "将方程 f(x)=0 改写为 x=g(x)，然后用迭代序列 x_{n+1}=g(x_n) 来求解。",
    formulas: [
      { label: "迭代格式", tex: "x_{n+1} = g(x_n)" },
      { label: "收敛条件（压缩映射）", tex: "|g'(x)| \\leq L < 1,\\quad x \\in [a,b]" },
      { label: "误差估计", tex: "|x^* - x_n| \\leq \\frac{L^n}{1-L}|x_1 - x_0|" },
    ],
    steps: ["将 f(x)=0 改写为 x=g(x)", "验证 |g'(x)| < 1 在根的附近成立", "从初始值 x₀ 开始迭代"],
    note: "收敛速度取决于 |g'(x*)| 的大小，越小收敛越快。当 |g'(x*)| = 0 时得到超线性收敛。"
  },
  "Gauss 消去法": {
    intro: "高斯消去法（Gaussian Elimination）是求解线性方程组 Ax=b 的标准方法，分为前向消元和回代两步。",
    formulas: [
      { label: "消元乘子", tex: "m_{ik} = \\frac{a_{ik}^{(k)}}{a_{kk}^{(k)}},\\quad i > k" },
      { label: "计算量", tex: "\\frac{n^3}{3} + O(n^2) \\text{ 次乘除法}" },
      { label: "回代公式", tex: "x_i = \\frac{1}{a_{ii}^{(i)}}\\left(b_i^{(i)} - \\sum_{j=i+1}^{n} a_{ij}^{(i)} x_j\\right)" },
    ],
    steps: ["前向消元：通过行变换将 A 化为上三角矩阵", "回代：从最后一个方程开始逐个求解 xₙ, x_{n-1}, ..., x₁"],
    note: "需要选主元（Pivoting）来避免数值不稳定。部分主元法（Partial Pivoting）选每列绝对值最大的元素作为主元。"
  },
  "LU 分解": {
    intro: "LU 分解将矩阵 A 分解为下三角矩阵 L 和上三角矩阵 U 的乘积，适合需要多次求解同一系数矩阵的情况。",
    formulas: [
      { label: "分解形式", tex: "A = LU" },
      { label: "带行交换（部分主元）", tex: "PA = LU" },
      { label: "求解过程", tex: "Ax=b \\Rightarrow LUx=b \\Rightarrow \\begin{cases}Ly=b \\\\ Ux=y\\end{cases}" },
    ],
    steps: ["分解 A = LU（与高斯消去等价）", "前代求解 Ly = b", "回代求解 Ux = y"],
    note: "LU 分解只需做一次（O(n³)），之后对每个新的 b 只需 O(n²) 的前代和回代，适合多右端项情形。"
  },
  "Lagrange 插值": {
    intro: "拉格朗日插值构造一个次数不超过 n 的多项式，使其在 n+1 个节点处精确取到给定函数值。",
    formulas: [
      { label: "插值多项式", tex: "P_n(x) = \\sum_{k=0}^{n} y_k L_k(x)" },
      { label: "基函数", tex: "L_k(x) = \\prod_{j=0,j\\neq k}^{n} \\frac{x - x_j}{x_k - x_j}" },
      { label: "误差公式", tex: "f(x) - P_n(x) = \\frac{f^{(n+1)}(\\xi)}{(n+1)!} \\prod_{i=0}^{n}(x-x_i)" },
    ],
    steps: ["确定 n+1 个插值节点 (x₀,y₀),...,(xₙ,yₙ)", "计算每个基函数 Lₖ(x)", "将所有项加权求和得到 Pₙ(x)"],
    note: "Runge 现象：高次等距节点插值在端点附近振荡剧烈。解决方法：使用 Chebyshev 节点。"
  },
  "法方程": {
    intro: "线性最小二乘问题求解超定方程组 Ax≈b，使残差 ‖b-Ax‖₂ 最小。最优性条件导出法方程（正规方程）。",
    formulas: [
      { label: "最小化目标", tex: "\\min_x \\|b - Ax\\|_2^2" },
      { label: "法方程（Normal Equations）", tex: "A^T A x = A^T b" },
      { label: "最小二乘解", tex: "x^* = (A^T A)^{-1} A^T b" },
    ],
    steps: ["建立矩阵 A 和向量 b（由数据点构成）", "形成法方程 AᵀAx = Aᵀb", "求解线性方程组得到最优参数 x*"],
    note: "法方程方法简单，但 AᵀA 的条件数是 A 条件数的平方，数值稳定性差。实践中推荐用 QR 分解。"
  },
  "梯形法 / Simpson 法": {
    intro: "数值积分方法用多项式近似被积函数，然后精确积分该多项式，从而近似原积分。",
    formulas: [
      { label: "梯形法", tex: "\\int_a^b f(x)dx \\approx \\frac{h}{2}[f(a) + f(b)],\\quad h=b-a" },
      { label: "复合梯形法误差", tex: "E_T = -\\frac{(b-a)h^2}{12}f''(\\xi) = O(h^2)" },
      { label: "Simpson 法", tex: "\\int_a^b f(x)dx \\approx \\frac{h}{6}[f(a) + 4f(\\tfrac{a+b}{2}) + f(b)]" },
      { label: "Simpson 误差", tex: "E_S = -\\frac{(b-a)h^4}{180}f^{(4)}(\\xi) = O(h^4)" },
    ],
    steps: ["将积分区间 [a,b] 分成 n 个子区间，步长 h=(b-a)/n", "在每个子区间上应用梯形或 Simpson 法则", "求和得到总积分近似值"],
    note: "Simpson 法对次数 ≤3 的多项式精确，因此误差比梯形法高两阶。Romberg 法通过外推进一步提高精度。"
  },
  "Euler 法": {
    intro: "Euler 法是求解初值问题 y'=f(t,y), y(t₀)=y₀ 最简单的单步方法，用切线斜率来预测下一步的值。",
    formulas: [
      { label: "Euler 迭代格式", tex: "w_{i+1} = w_i + h f(t_i, w_i)" },
      { label: "局部截断误差", tex: "\\tau_{i+1} = \\frac{h}{2}y''(\\xi_i) = O(h^2)" },
      { label: "全局误差", tex: "\\max_i |y(t_i) - w_i| = O(h)" },
    ],
    steps: ["从初始值 w₀ = y₀ 开始", "计算 w_{i+1} = wᵢ + h·f(tᵢ, wᵢ)", "重复直到到达目标时间点"],
    note: "Euler 法是一阶方法，精度低，主要用于理论分析。实践中应使用 Runge-Kutta 4 阶方法（RK4）。"
  },
  "Runge-Kutta 法": {
    intro: "Runge-Kutta 方法通过在一个步长内多次计算斜率，然后加权平均，从而获得更高阶的精度。经典 RK4 是最常用的版本。",
    formulas: [
      { label: "经典 RK4", tex: "w_{i+1} = w_i + \\frac{h}{6}(k_1 + 2k_2 + 2k_3 + k_4)" },
      { label: "斜率计算", tex: "\\begin{aligned}k_1 &= f(t_i,w_i)\\\\ k_2 &= f(t_i+\\tfrac{h}{2}, w_i+\\tfrac{h}{2}k_1)\\\\ k_3 &= f(t_i+\\tfrac{h}{2}, w_i+\\tfrac{h}{2}k_2)\\\\ k_4 &= f(t_i+h, w_i+hk_3)\\end{aligned}" },
      { label: "局部截断误差", tex: "\\tau = O(h^5),\\quad \\text{全局误差 } O(h^4)" },
    ],
    steps: ["计算四个斜率 k₁, k₂, k₃, k₄", "加权平均：w_{i+1} = wᵢ + h(k₁+2k₂+2k₃+k₄)/6", "重复推进"],
    note: "RK4 每步需要 4 次函数求值，是精度与计算量的良好平衡。自适应步长版本（如 RK45）可以自动调节步长。"
  },
  "最小二乘数据拟合": {
    intro: "最小二乘数据拟合寻找参数 x，使模型预测值与观测数据的误差（残差）的平方和最小。",
    formulas: [
      { label: "残差向量", tex: "r = b - Ax = \\begin{pmatrix}b_1 - (x_1 + x_2t_1 + \\cdots)\\\\ \\vdots \\\\ b_m - (x_1 + x_2t_m + \\cdots)\\end{pmatrix}" },
      { label: "最小二乘目标", tex: "\\min_x \\|r\\|_2^2 = \\min_x \\sum_{i=1}^{m} r_i^2" },
      { label: "线性模型（参数线性）", tex: "b(t) = x_1 + x_2 t + x_3 t^2" },
    ],
    steps: ["收集数据点 (t₁,b₁), ..., (tₘ,bₘ)", "建立矩阵方程 Ax ≈ b", "用法方程或 QR 分解求解 x*"],
    note: "线性最小二乘：所有参数线性出现，有解析解。非线性最小二乘：参数非线性出现，需要 Gauss-Newton 或 L-M 迭代法。"
  },
  "投资组合选择 (Markowitz)": {
    intro: "Markowitz（1959）投资组合理论通过优化方法在收益和风险之间寻求平衡，奠定了现代金融理论的基础，获 1990 年诺贝尔经济学奖。",
    formulas: [
      { label: "投资组合期望收益", tex: "\\bar{r}_P = \\mu^T x = \\sum_{j=1}^{N} x_j \\mu_j" },
      { label: "投资组合风险（方差）", tex: "\\sigma_P^2 = x^T V x = \\sum_{i=1}^{N}\\sum_{j=1}^{N} x_i x_j v_{ij}" },
      { label: "均值-方差优化模型", tex: "\\min_x\\; x^T V x \\quad \\text{s.t.}\\; \\mu^T x \\geq p,\\; a^T x \\leq B,\\; x \\geq 0" },
    ],
    steps: ["估计各证券的期望收益 μⱼ 和协方差矩阵 V", "设定目标收益下界 p 和预算上界 B", "求解二次规划问题得到最优配置 x*"],
    note: "三种等价建模方式：(1) 最大化收益-α风险；(2) 最小化风险约束收益；(3) 最大化收益约束风险。均为非线性规划问题。"
  },
  "SVM 分类": {
    intro: "支持向量机（SVM）通过求解最大间隔超平面来分离两类数据，是数据挖掘的核心方法之一。",
    formulas: [
      { label: "分离超平面", tex: "(w, x) + b = 0" },
      { label: "最大间隔优化（硬间隔）", tex: "\\min_w \\|w\\|^2 \\quad \\text{s.t.}\\; y_i[(w,x^i)+b] \\geq 1" },
      { label: "软间隔（含松弛变量）", tex: "\\min_w \\|w\\|^2 + C\\sum_i \\xi_i \\quad \\text{s.t.}\\; y_i[(w,x^i)+b] \\geq 1-\\xi_i,\\; \\xi_i \\geq 0" },
      { label: "间隔宽度", tex: "\\text{margin} = \\frac{2}{\\|w\\|}" },
    ],
    steps: ["整理训练数据 {(xⁱ, yᵢ)}，yᵢ ∈ {+1, -1}", "求解二次规划问题得到最优 ŵ 和 b̂", "用 y = sign((ŵ,x) + b̂) 预测新样本"],
    note: "参数 C 控制对误分类的惩罚力度：C 大 → 惩罚重 → 尽量不误分；C 小 → 允许更多误分但间隔更宽。"
  },
};

// ── UI Components ─────────────────────────────────────────────────────────────
const Btn = ({ children, onClick, variant = "outline", size = "md", style = {}, disabled = false }) => {
  const pad = size === "sm" ? "5px 12px" : size === "lg" ? "12px 28px" : "8px 20px";
  const fz = size === "sm" ? 12 : size === "lg" ? 15 : 13;
  const base = variant === "primary"
    ? { background: disabled ? "#9FE1CB" : G.teal, color: "#fff", border: "none" }
    : variant === "danger"
    ? { background: G.redLight, color: G.red, border: `0.5px solid ${G.red}` }
    : { background: "transparent", color: "var(--color-text-primary)", border: "0.5px solid var(--color-border-secondary)" };
  return (
    <button disabled={disabled} onClick={onClick} style={{ padding: pad, fontSize: fz, fontFamily: "var(--font-sans)", borderRadius: 8, cursor: disabled ? "not-allowed" : "pointer", fontWeight: 500, ...base, ...style }}>{children}</button>
  );
};

const Badge = ({ children, color = "teal" }) => {
  const map = { teal: [G.tealLight, G.tealDark], blue: [G.blueLight, G.blue], amber: [G.amberLight, G.amber], red: [G.redLight, G.red], purple: [G.purpleLight, G.purple] };
  const [bg, fg] = map[color] || map.teal;
  return <span style={{ background: bg, color: fg, fontSize: 10, padding: "2px 8px", borderRadius: 10, fontWeight: 500, whiteSpace: "nowrap" }}>{children}</span>;
};

const Card = ({ children, style = {}, onClick }) => (
  <div onClick={onClick} style={{ background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 12, padding: "1.25rem", cursor: onClick ? "pointer" : "default", ...style }}>{children}</div>
);

const StatCard = ({ label, value, sub, color = G.teal }) => (
  <div style={{ background: "var(--color-background-secondary)", borderRadius: 10, padding: "1rem 1.25rem", borderLeft: `3px solid ${color}` }}>
    <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
    <div style={{ fontSize: 26, fontWeight: 500, color: "var(--color-text-primary)", marginBottom: 2 }}>{value}</div>
    {sub && <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>{sub}</div>}
  </div>
);

const ProgressBar = ({ value, max = 100, color = G.teal, height = 6 }) => (
  <div style={{ height, background: "var(--color-background-secondary)", borderRadius: height, overflow: "hidden" }}>
    <div style={{ height, width: `${Math.min(100, (value / max) * 100)}%`, background: color, borderRadius: height, transition: "width .4s ease" }} />
  </div>
);

const Input = ({ label, type = "text", value, onChange, placeholder }) => (
  <div style={{ marginBottom: 14 }}>
    {label && <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 5 }}>{label}</div>}
    <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      style={{ width: "100%", fontSize: 14, padding: "10px 12px", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 8, background: "var(--color-background-primary)", color: "var(--color-text-primary)", fontFamily: "var(--font-sans)", boxSizing: "border-box" }} />
  </div>
);

const Alert = ({ msg, type = "error" }) => msg ? (
  <div style={{ padding: "10px 12px", borderRadius: 8, fontSize: 13, marginBottom: 12, background: type === "error" ? G.redLight : G.tealLight, color: type === "error" ? G.red : G.tealDark }}>{msg}</div>
) : null;

// ── Topic Content Modal ───────────────────────────────────────────────────────
function TopicModal({ topic, onClose }) {
  const content = KNOWLEDGE_CONTENT[topic];
  if (!content) return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: "var(--color-background-primary)", borderRadius: 16, padding: "2rem", maxWidth: 540, width: "90%", maxHeight: "80vh", overflowY: "auto" }}>
        <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 12 }}>{topic}</div>
        <div style={{ fontSize: 14, color: "var(--color-text-secondary)", lineHeight: 1.7 }}>该知识点的详细内容正在整理中，请持续关注更新。</div>
        <Btn size="sm" onClick={onClose} style={{ marginTop: 16 }}>关闭</Btn>
      </div>
    </div>
  );

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: "var(--color-background-primary)", borderRadius: 16, padding: "2rem", maxWidth: 620, width: "92%", maxHeight: "85vh", overflowY: "auto" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16, paddingBottom: 14, borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
          <div style={{ fontSize: 18, fontWeight: 500, color: "var(--color-text-primary)" }}>{topic}</div>
          <button onClick={onClose} style={{ fontSize: 18, background: "none", border: "none", cursor: "pointer", color: "var(--color-text-tertiary)", lineHeight: 1 }}>✕</button>
        </div>

        {/* Intro */}
        <div style={{ fontSize: 14, color: "var(--color-text-secondary)", lineHeight: 1.75, marginBottom: 20 }}>{content.intro}</div>

        {/* Formulas */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 10 }}>核心公式</div>
          {content.formulas.map((f, i) => (
            <div key={i} style={{ marginBottom: 12, padding: "12px 16px", background: "var(--color-background-secondary)", borderRadius: 10, borderLeft: `3px solid ${G.teal}` }}>
              <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginBottom: 8 }}>{f.label}</div>
              <M tex={f.tex} block />
            </div>
          ))}
        </div>

        {/* Steps */}
        {content.steps && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 10 }}>算法步骤</div>
            {content.steps.map((s, i) => (
              <div key={i} style={{ display: "flex", gap: 12, marginBottom: 8, alignItems: "flex-start" }}>
                <div style={{ width: 22, height: 22, borderRadius: "50%", background: G.teal, color: "#fff", fontSize: 11, fontWeight: 500, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>{i + 1}</div>
                <div style={{ fontSize: 14, color: "var(--color-text-primary)", lineHeight: 1.6 }}>{s}</div>
              </div>
            ))}
          </div>
        )}

        {/* Note */}
        {content.note && (
          <div style={{ padding: "12px 14px", background: G.amberLight, borderRadius: 8, borderLeft: `3px solid ${G.amber}`, fontSize: 13, color: "#633806", lineHeight: 1.6 }}>
            💡 {content.note}
          </div>
        )}

        <div style={{ marginTop: 20, display: "flex", justifyContent: "flex-end" }}>
          <Btn variant="primary" size="sm" onClick={onClose}>关闭</Btn>
        </div>
      </div>
    </div>
  );
}

// ── Sample Questions & Flashcards ─────────────────────────────────────────────
const SAMPLE_QUESTIONS = [
  { id: "s1", chapter: "Ch.1", type: "单选题", question: "二分法每迭代一次，有根区间的长度变为原来的：", options: ["1/3", "1/2", "1/4", "不确定"], answer: "B", explanation: "二分法每次将区间对半分，区间长度精确缩小为 1/2。" },
  { id: "s2", chapter: "Ch.1", type: "单选题", question: "Newton 法的收敛阶为：", options: ["线性收敛 p=1", "超线性收敛", "二阶收敛 p=2", "不收敛"], answer: "C", explanation: "Newton 法在单根附近具有二阶（平方）收敛性。" },
  { id: "s3", chapter: "Ch.2", type: "单选题", question: "高斯消去法的计算复杂度为：", options: ["O(n)", "O(n²)", "O(n³)", "O(2ⁿ)"], answer: "C", explanation: "高斯消去共约 n³/3 次浮点运算，复杂度为 O(n³)。" },
  { id: "s4", chapter: "Ch.2", type: "判断题", question: "对任意矩阵 A，LU 分解一定存在。", options: null, answer: "错误", explanation: "若主元为零则需行交换（PA=LU），并非所有矩阵都有 LU 分解。" },
  { id: "s5", chapter: "Ch.3", type: "单选题", question: "n+1 个节点的 Lagrange 插值多项式的次数最高为：", options: ["n-1", "n", "n+1", "2n"], answer: "B", explanation: "n+1 个节点确定唯一次数不超过 n 的插值多项式。" },
  { id: "s6", chapter: "Ch.4", type: "单选题", question: "线性最小二乘问题的法方程为：", options: ["Ax = b", "AᵀAx = Aᵀb", "AAᵀx = b", "A²x = b²"], answer: "B", explanation: "对残差的 2-范数平方求导并令其为零，得到法方程 AᵀAx = Aᵀb。" },
  { id: "s7", chapter: "Ch.5", type: "单选题", question: "Simpson 法则的截断误差阶为：", options: ["O(h²)", "O(h³)", "O(h⁴)", "O(h⁵)"], answer: "C", explanation: "Simpson 法则截断误差为 O(h⁴)。" },
  { id: "s8", chapter: "Ch.6", type: "单选题", question: "Euler 法的局部截断误差为：", options: ["O(h)", "O(h²)", "O(h³)", "O(h⁴)"], answer: "B", explanation: "Euler 法是一阶方法，局部截断误差为 O(h²)，全局误差为 O(h)。" },
  { id: "s9", chapter: "最优化 Ch.1", type: "单选题", question: "线性最小二乘模型的特征是：", options: ["目标函数线性", "所有参数线性出现", "约束线性", "残差线性"], answer: "B", explanation: "线性最小二乘指所有待求参数在模型函数中线性出现。" },
  { id: "s10", chapter: "最优化 Ch.1", type: "单选题", question: "SVM 最大间隔优化的目标函数为：", options: ["min ‖w‖", "min ‖w‖²", "max ‖w‖", "max 2/‖w‖"], answer: "B", explanation: "最大化间隔 2/‖w‖ 等价于最小化 ‖w‖²，后者为凸二次规划问题。" },
  { id: "s11", chapter: "Ch.1", type: "单选题", question: "不动点迭代 x_{n+1}=g(x_n) 收敛的充分条件是：", options: ["|g'(x*)| > 1", "|g'(x*)| = 1", "|g'(x*)| < 1", "g'(x*) = 0"], answer: "C", explanation: "压缩映射条件：|g'(x*)| < 1 保证迭代收敛。" },
  { id: "s12", chapter: "Ch.3", type: "单选题", question: "Runge 现象指的是：", options: ["节点过少导致误差大", "高次等距插值在端点振荡", "插值多项式不唯一", "Chebyshev 插值的缺陷"], answer: "B", explanation: "高次等距节点多项式插值在区间端点附近出现剧烈振荡，称为 Runge 现象。" },
  { id: "s13", chapter: "Ch.4", type: "判断题", question: "QR 分解比法方程方法在数值上更稳定。", options: null, answer: "正确", explanation: "法方程使条件数平方，QR 分解直接处理 A，数值更稳定。" },
  { id: "s14", chapter: "Ch.6", type: "单选题", question: "经典四阶 Runge-Kutta 法每步需要计算几次函数值：", options: ["1次", "2次", "3次", "4次"], answer: "D", explanation: "RK4 每步计算 k₁, k₂, k₃, k₄ 共 4 次函数求值。" },
  { id: "s15", chapter: "最优化 Ch.1", type: "单选题", question: "Markowitz 投资组合模型中 σ²_P = xᵀVx 表示：", options: ["期望收益", "投资预算", "投资组合风险（方差）", "证券数量"], answer: "C", explanation: "σ²_P = xᵀVx 是投资组合收益率的方差，衡量风险水平。" },
];

const FLASHCARDS = [
  { front: "二分法的收敛阶", back: "线性收敛，p=1，误差每步缩小为 1/2", chapter: "Ch.1" },
  { front: "Newton 法的收敛阶", back: "二阶收敛，p=2，每步误差平方级缩小", chapter: "Ch.1" },
  { front: "不动点迭代收敛条件", back: "|g′(x*)| < 1（压缩映射定理）", chapter: "Ch.1" },
  { front: "高斯消去法复杂度", back: "O(n³)，约 n³/3 次浮点运算", chapter: "Ch.2" },
  { front: "LU 分解的用途", back: "A=LU，高效求解多个右端项的方程组", chapter: "Ch.2" },
  { front: "条件数 κ(A) 含义", back: "κ(A)=‖A‖·‖A⁻¹‖，衡量线性系统对扰动的敏感程度", chapter: "Ch.2" },
  { front: "Lagrange 插值误差公式", back: "f^(n+1)(ξ)/(n+1)! · ∏(x-xᵢ)", chapter: "Ch.3" },
  { front: "Runge 现象", back: "高次等距节点插值在端点振荡，用 Chebyshev 节点可避免", chapter: "Ch.3" },
  { front: "法方程（Normal Equations）", back: "AᵀAx = Aᵀb，最小二乘问题的最优性条件", chapter: "Ch.4" },
  { front: "QR 分解的优点", back: "数值稳定性好，条件数不被平方，优于法方程方法", chapter: "Ch.4" },
  { front: "Simpson 法则精度", back: "截断误差 O(h⁴)，对 ≤3 次多项式精确积分", chapter: "Ch.5" },
  { front: "Euler 法的误差阶", back: "局部截断误差 O(h²)，全局误差 O(h)，一阶方法", chapter: "Ch.6" },
  { front: "RK4 的精度", back: "四阶方法，局部截断误差 O(h⁵)，全局误差 O(h⁴)", chapter: "Ch.6" },
  { front: "投资组合风险 σ²_P", back: "σ²_P = xᵀVx，V 为协方差矩阵，x 为持仓向量", chapter: "最优化 Ch.1" },
  { front: "SVM 最大间隔", back: "margin = 2/‖w‖，最大化间隔 ⟺ 最小化 ‖w‖²", chapter: "最优化 Ch.1" },
];

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
];

// ── Auth ──────────────────────────────────────────────────────────────────────
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

  const handleLogin = async () => {
    setLoading(true); setError("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError("邮箱或密码错误，请重试");
    setLoading(false);
  };

  const handleRegister = async () => {
    if (!name.trim()) { setError("请输入你的姓名"); return; }
    if (password.length < 6) { setError("密码至少需要 6 位"); return; }
    if (role === "student" && !classCode.trim()) { setError("学生需要输入班级邀请码"); return; }
    setLoading(true); setError("");
    const { error } = await supabase.auth.signUp({ email, password, options: { data: { name, role, classCode } } });
    if (error) setError(error.message);
    else setSuccess("注册成功！请检查邮箱完成验证，然后登录。");
    setLoading(false);
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--color-background-tertiary)", display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
      <div style={{ width: "100%", maxWidth: 420 }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 10, fontSize: 22, fontWeight: 500, color: "var(--color-text-primary)" }}>
            <div style={{ width: 12, height: 12, borderRadius: "50%", background: G.teal }} />MathCore
          </div>
          <div style={{ fontSize: 13, color: "var(--color-text-secondary)", marginTop: 6 }}>数学与应用数学学习平台</div>
        </div>
        <Card style={{ padding: "1.75rem" }}>
          <div style={{ display: "flex", marginBottom: 24, background: "var(--color-background-secondary)", borderRadius: 8, padding: 3 }}>
            {[["login", "登录"], ["register", "注册"]].map(([m, label]) => (
              <button key={m} onClick={() => { setMode(m); setError(""); setSuccess(""); }} style={{ flex: 1, padding: "8px 0", fontSize: 13, fontFamily: "var(--font-sans)", border: "none", cursor: "pointer", borderRadius: 6, background: mode === m ? "var(--color-background-primary)" : "transparent", color: mode === m ? "var(--color-text-primary)" : "var(--color-text-secondary)", fontWeight: mode === m ? 500 : 400 }}>{label}</button>
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
                  {[["student", "🎓 学生"], ["teacher", "👨‍🏫 教师"]].map(([r, label]) => (
                    <button key={r} onClick={() => setRole(r)} style={{ flex: 1, padding: "10px 0", fontSize: 13, fontFamily: "var(--font-sans)", border: role === r ? `1.5px solid ${G.teal}` : "0.5px solid var(--color-border-tertiary)", borderRadius: 8, cursor: "pointer", background: role === r ? G.tealLight : "transparent", color: role === r ? G.tealDark : "var(--color-text-secondary)", fontWeight: role === r ? 500 : 400 }}>{label}</button>
                  ))}
                </div>
              </div>
              {role === "student" && (
                <div style={{ marginBottom: 14 }}>
                  <Input label="班级邀请码" value={classCode} onChange={setClassCode} placeholder="请向老师获取邀请码" />
                  <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: -8 }}>向你的教师获取邀请码（如：MATH2024）</div>
                </div>
              )}
            </>
          )}
          <Input label="邮箱" type="email" value={email} onChange={setEmail} placeholder="your@email.com" />
          <Input label="密码" type="password" value={password} onChange={setPassword} placeholder={mode === "register" ? "至少 6 位" : "输入密码"} />
          <Btn variant="primary" onClick={mode === "login" ? handleLogin : handleRegister} disabled={loading} style={{ width: "100%", padding: "12px 0", fontSize: 14 }}>
            {loading ? "处理中…" : mode === "login" ? "登录" : "注册账号"}
          </Btn>
          <div style={{ textAlign: "center", marginTop: 14, fontSize: 12, color: "var(--color-text-tertiary)" }}>
            {mode === "login" ? <>还没有账号？<span onClick={() => setMode("register")} style={{ color: G.teal, cursor: "pointer" }}>立即注册</span></> : <>已有账号？<span onClick={() => setMode("login")} style={{ color: G.teal, cursor: "pointer" }}>直接登录</span></>}
          </div>
        </Card>
      </div>
    </div>
  );
}

// ── Top Nav ───────────────────────────────────────────────────────────────────
function TopNav({ page, setPage, profile, onLogout }) {
  const links = profile?.role === "teacher"
    ? ["首页", "知识点", "题库练习", "记忆卡片", "学习报告", "错题本", "教师管理"]
    : ["首页", "知识点", "题库练习", "记忆卡片", "学习报告", "错题本"];
  return (
    <div style={{ background: "var(--color-background-primary)", borderBottom: "0.5px solid var(--color-border-tertiary)", padding: "0 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", height: 54, position: "sticky", top: 0, zIndex: 100 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 500, color: "var(--color-text-primary)" }}>
        <div style={{ width: 9, height: 9, borderRadius: "50%", background: G.teal }} />MathCore
      </div>
      <div style={{ display: "flex", gap: 2 }}>
        {links.map(l => (
          <button key={l} onClick={() => setPage(l)} style={{ padding: "6px 10px", borderRadius: 8, fontSize: 12, fontFamily: "var(--font-sans)", border: "none", cursor: "pointer", background: page === l ? G.tealLight : "transparent", color: page === l ? G.tealDark : "var(--color-text-secondary)", fontWeight: page === l ? 500 : 400 }}>{l}</button>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ width: 30, height: 30, borderRadius: "50%", background: G.tealLight, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 500, color: G.tealDark }}>{(profile?.name || "U")[0].toUpperCase()}</div>
        <div>
          <div style={{ fontSize: 12, fontWeight: 500, color: "var(--color-text-primary)", lineHeight: 1.2 }}>{profile?.name || profile?.email}</div>
          <div style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>{profile?.role === "teacher" ? "教师" : "学生"}</div>
        </div>
        <Btn size="sm" onClick={onLogout}>退出</Btn>
      </div>
    </div>
  );
}

// ── Home Page ─────────────────────────────────────────────────────────────────
function HomePage({ setPage, profile }) {
  const quick = [
    { icon: "✏️", title: "每日练习", desc: "今日推荐 5 道题", page: "题库练习", color: G.blueLight, tag: "今日" },
    { icon: "🃏", title: "记忆卡片", desc: "公式定理快速记忆", page: "记忆卡片", color: G.purpleLight, tag: null },
    { icon: "📊", title: "学习报告", desc: "查看正确率与薄弱点", page: "学习报告", color: G.amberLight, tag: null },
    { icon: "🔖", title: "错题本", desc: "收录错题，巩固记忆", page: "错题本", color: G.redLight, tag: null },
  ];
  return (
    <div style={{ padding: "1.5rem", maxWidth: 920, margin: "0 auto" }}>
      <Card style={{ marginBottom: 14, padding: "1.75rem", borderLeft: `4px solid ${G.teal}` }}>
        <div style={{ fontSize: 11, color: G.teal, fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 10 }}>数学与应用数学学习平台</div>
        <div style={{ fontSize: 24, fontWeight: 500, marginBottom: 8, color: "var(--color-text-primary)" }}>你好，{profile?.name || "同学"} 👋</div>
        <div style={{ fontSize: 14, color: "var(--color-text-secondary)", lineHeight: 1.7, marginBottom: 18, maxWidth: 560 }}>涵盖数值分析、最优化理论两门核心课程，AI 智能出题，帮助你系统掌握每一个知识点。</div>
        <div style={{ display: "flex", gap: 10 }}>
          <Btn variant="primary" size="lg" onClick={() => setPage("知识点")}>开始学习</Btn>
          <Btn size="lg" onClick={() => setPage("题库练习")}>进入题库</Btn>
        </div>
      </Card>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 14 }}>
        <StatCard label="课程" value="2" sub="数值分析 · 最优化" color={G.teal} />
        <StatCard label="章节" value="12" sub="共 19 小节" color={G.blue} />
        <StatCard label="题目" value={SAMPLE_QUESTIONS.length + "+"} sub="持续更新中" color={G.amber} />
        <StatCard label="记忆卡片" value={FLASHCARDS.length} sub="公式定理" color={G.purple} />
      </div>
      <div style={{ fontSize: 11, fontWeight: 500, color: "var(--color-text-tertiary)", letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 10 }}>快速入口</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {quick.map(q => (
          <Card key={q.title} onClick={() => setPage(q.page)} style={{ cursor: "pointer", display: "flex", gap: 14, alignItems: "flex-start", padding: "1rem 1.25rem" }}>
            <div style={{ width: 42, height: 42, borderRadius: 10, background: q.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>{q.icon}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 500, color: "var(--color-text-primary)", marginBottom: 3 }}>{q.title}</div>
              <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>{q.desc}</div>
            </div>
            {q.tag && <Badge color="blue">{q.tag}</Badge>}
          </Card>
        ))}
      </div>
    </div>
  );
}

// ── Knowledge Page ────────────────────────────────────────────────────────────
function KnowledgePage({ setPage }) {
  const [sel, setSel] = useState(CHAPTERS[0]);
  const [filter, setFilter] = useState("全部");
  const [openTopic, setOpenTopic] = useState(null);
  const filtered = filter === "全部" ? CHAPTERS : CHAPTERS.filter(c => c.course === filter);

  return (
    <>
      {openTopic && <TopicModal topic={openTopic} onClose={() => setOpenTopic(null)} />}
      <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", gap: 14, padding: "1.5rem", maxWidth: 1100, margin: "0 auto" }}>
        <Card style={{ padding: "1rem 0", height: "fit-content" }}>
          <div style={{ padding: "0 12px 10px", display: "flex", gap: 4 }}>
            {["全部", "数值分析", "最优化"].map(c => (
              <button key={c} onClick={() => setFilter(c)} style={{ flex: 1, fontSize: 11, padding: "5px 0", borderRadius: 6, border: "none", cursor: "pointer", fontFamily: "var(--font-sans)", background: filter === c ? G.teal : "var(--color-background-secondary)", color: filter === c ? "#fff" : "var(--color-text-secondary)", fontWeight: filter === c ? 500 : 400 }}>{c}</button>
            ))}
          </div>
          {filtered.map(ch => (
            <div key={ch.id} onClick={() => setSel(ch)} style={{ padding: "9px 16px", cursor: "pointer", fontSize: 13, background: sel.id === ch.id ? G.tealLight : "transparent", color: sel.id === ch.id ? G.tealDark : "var(--color-text-secondary)", borderLeft: `3px solid ${sel.id === ch.id ? G.teal : "transparent"}`, fontWeight: sel.id === ch.id ? 500 : 400, display: "flex", gap: 8 }}>
              <span style={{ fontSize: 10, opacity: .6, minWidth: 28 }}>{ch.num}</span>{ch.name}
            </div>
          ))}
        </Card>

        <Card>
          <div style={{ borderBottom: "0.5px solid var(--color-border-tertiary)", paddingBottom: "1rem", marginBottom: "1.25rem", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 500, color: "var(--color-text-primary)", marginBottom: 6 }}>{sel.num} · {sel.name}</div>
              <div style={{ display: "flex", gap: 6 }}>
                <Badge color={sel.course === "数值分析" ? "teal" : "blue"}>{sel.course}</Badge>
                <Badge color="red">{sel.topics.length} 个知识点</Badge>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <Btn size="sm" onClick={() => setPage("记忆卡片")}>🃏 记忆卡片</Btn>
              <Btn variant="primary" size="sm" onClick={() => setPage("题库练习")}>章节练习 →</Btn>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {sel.topics.map((t, i) => {
              const hasContent = !!KNOWLEDGE_CONTENT[t];
              return (
                <div key={i} onClick={() => setOpenTopic(t)} style={{ border: `0.5px solid ${hasContent ? "var(--color-border-tertiary)" : "var(--color-border-tertiary)"}`, borderRadius: 10, padding: "14px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", background: i < 2 ? G.tealLight + "55" : "transparent", transition: "border-color .15s" }}>
                  <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                    <div style={{ width: 28, height: 28, borderRadius: "50%", background: i < 2 ? G.teal : "var(--color-background-secondary)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 500, color: i < 2 ? "#fff" : "var(--color-text-tertiary)", flexShrink: 0 }}>{i + 1}</div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 500, color: "var(--color-text-primary)", marginBottom: 2 }}>{t}</div>
                      <div style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>{hasContent ? "点击查看详细内容、公式与步骤" : "内容整理中…"}</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    {hasContent && <span style={{ fontSize: 11, color: G.teal }}>有内容 →</span>}
                    <Badge color={i < 2 ? "teal" : i < 3 ? "amber" : "red"}>{i < 2 ? "✓ 已完成" : i < 3 ? "进行中" : "未开始"}</Badge>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </>
  );
}

// ── Quiz Page ─────────────────────────────────────────────────────────────────
function QuizPage({ setPage }) {
  const [questions, setQuestions] = useState([]);
  const [current, setCurrent] = useState(0);
  const [selected, setSelected] = useState(null);
  const [answered, setAnswered] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [loading, setLoading] = useState(true);
  const [score, setScore] = useState(0);
  const [wrongList, setWrongList] = useState([]);
  const [finished, setFinished] = useState(false);
  const [quizMode, setQuizMode] = useState(null);

  useEffect(() => {
    supabase.from("questions").select("*").then(({ data }) => {
      const pool = data?.length ? [...data, ...SAMPLE_QUESTIONS] : SAMPLE_QUESTIONS;
      setQuestions(pool.sort(() => Math.random() - 0.5));
      setLoading(false);
    });
  }, []);

  if (!quizMode && !loading) return (
    <div style={{ padding: "1.5rem", maxWidth: 600, margin: "0 auto" }}>
      <Btn size="sm" onClick={() => setPage("首页")} style={{ marginBottom: 14 }}>← 返回</Btn>
      <Card style={{ textAlign: "center", padding: "2.5rem 2rem" }}>
        <div style={{ fontSize: 28, marginBottom: 12 }}>✏️</div>
        <div style={{ fontSize: 18, fontWeight: 500, marginBottom: 8, color: "var(--color-text-primary)" }}>选择练习模式</div>
        <div style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 24 }}>共 {questions.length} 道题目可用</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div onClick={() => setQuizMode("daily")} style={{ border: `1.5px solid ${G.blue}`, borderRadius: 12, padding: "1.25rem", cursor: "pointer", background: G.blueLight }}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>⚡</div>
            <div style={{ fontSize: 14, fontWeight: 500, color: G.blue, marginBottom: 4 }}>每日练习</div>
            <div style={{ fontSize: 12, color: "#185FA5" }}>随机 5 题，轻松刷题</div>
          </div>
          <div onClick={() => setQuizMode("full")} style={{ border: `1.5px solid ${G.teal}`, borderRadius: 12, padding: "1.25rem", cursor: "pointer", background: G.tealLight }}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>📚</div>
            <div style={{ fontSize: 14, fontWeight: 500, color: G.teal, marginBottom: 4 }}>完整练习</div>
            <div style={{ fontSize: 12, color: G.tealDark }}>全部题目，系统训练</div>
          </div>
        </div>
      </Card>
    </div>
  );

  const displayQ = quizMode === "daily" ? questions.slice(0, 5) : questions;
  const q = displayQ[current];
  const opts = q?.options ? (typeof q.options === "string" ? JSON.parse(q.options) : q.options) : null;
  const optLetters = ["A", "B", "C", "D"];

  const handleSubmit = () => {
    if (selected === null) return;
    setAnswered(true);
    const correct = opts
      ? optLetters[selected] === q.answer
      : (selected === 0 && q.answer === "正确") || (selected === 1 && q.answer === "错误");
    if (correct) setScore(s => s + 1);
    else setWrongList(w => [...w, q]);
  };

  const handleNext = () => {
    if (current >= displayQ.length - 1) { setFinished(true); return; }
    setCurrent(c => c + 1); setSelected(null); setAnswered(false); setShowHint(false);
  };

  if (loading) return <div style={{ padding: "3rem", textAlign: "center", color: "var(--color-text-secondary)" }}>加载题目中…</div>;

  if (finished) {
    const pct = Math.round(score / displayQ.length * 100);
    const chapterWrong = {};
    wrongList.forEach(w => { chapterWrong[w.chapter] = (chapterWrong[w.chapter] || 0) + 1; });
    return (
      <div style={{ padding: "1.5rem", maxWidth: 680, margin: "0 auto" }}>
        <Card style={{ padding: "2rem" }}>
          <div style={{ textAlign: "center", marginBottom: 20 }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>{pct >= 80 ? "🎉" : pct >= 60 ? "👍" : "💪"}</div>
            <div style={{ fontSize: 20, fontWeight: 500, marginBottom: 6, color: "var(--color-text-primary)" }}>练习完成！</div>
            <div style={{ fontSize: 38, fontWeight: 500, color: pct >= 80 ? G.teal : pct >= 60 ? G.amber : G.red }}>{pct}%</div>
            <div style={{ fontSize: 14, color: "var(--color-text-secondary)", margin: "6px 0 14px" }}>答对 {score} / {displayQ.length} 题</div>
            <ProgressBar value={score} max={displayQ.length} color={pct >= 80 ? G.teal : pct >= 60 ? G.amber : G.red} height={8} />
          </div>
          {wrongList.length > 0 && (
            <div style={{ borderTop: "0.5px solid var(--color-border-tertiary)", paddingTop: 16, marginTop: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 10 }}>⚠️ 本次薄弱章节</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
                {Object.entries(chapterWrong).map(([ch, cnt]) => (
                  <div key={ch} style={{ background: G.redLight, borderRadius: 8, padding: "8px 12px", display: "flex", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 12, color: G.red }}>{ch}</span>
                    <span style={{ fontSize: 12, fontWeight: 500, color: G.red }}>错 {cnt} 题</span>
                  </div>
                ))}
              </div>
              {wrongList.map((w, i) => (
                <div key={i} style={{ padding: "10px 12px", background: "var(--color-background-secondary)", borderRadius: 8, marginBottom: 8, fontSize: 13 }}>
                  <div style={{ marginBottom: 4 }}>{w.question}</div>
                  <div style={{ color: G.tealDark, fontSize: 12 }}>✓ {w.answer} · {w.explanation}</div>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 16 }}>
            <Btn onClick={() => { setCurrent(0); setSelected(null); setAnswered(false); setFinished(false); setScore(0); setWrongList([]); setQuizMode(null); }}>再练一次</Btn>
            <Btn variant="primary" onClick={() => setPage("学习报告")}>查看完整报告</Btn>
          </div>
        </Card>
      </div>
    );
  }

  if (!q) return null;

  return (
    <div style={{ padding: "1.5rem", maxWidth: 780, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <Btn size="sm" onClick={() => { setQuizMode(null); setCurrent(0); setScore(0); setWrongList([]); setAnswered(false); setSelected(null); }}>← 返回</Btn>
        <Card style={{ flex: 1, padding: "10px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-primary)" }}>{quizMode === "daily" ? "⚡ 每日练习" : "📚 完整练习"} · 第 {current + 1} / {displayQ.length} 题</div>
            <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginTop: 1 }}>{q.chapter} · {q.type}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>得分 <strong style={{ color: G.teal }}>{score}</strong>/{current}</span>
            <div style={{ width: 100, height: 5, background: "var(--color-background-secondary)", borderRadius: 3 }}>
              <div style={{ height: 5, background: G.teal, borderRadius: 3, width: `${((current + 1) / displayQ.length) * 100}%` }} />
            </div>
          </div>
        </Card>
      </div>

      <Card style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <Badge color="blue">{q.type}</Badge>
          <Badge color="amber">{q.chapter}</Badge>
        </div>
        <div style={{ fontSize: 16, color: "var(--color-text-primary)", lineHeight: 1.7, marginBottom: 20 }}>{q.question}</div>

        {opts && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {opts.map((opt, i) => {
              let border = "0.5px solid var(--color-border-tertiary)", bg = "transparent";
              if (answered) {
                if (optLetters[i] === q.answer) { bg = G.tealLight; border = `1.5px solid ${G.teal}`; }
                else if (i === selected && optLetters[i] !== q.answer) { bg = G.redLight; border = `1.5px solid ${G.red}`; }
              } else if (selected === i) { bg = G.tealLight; border = `1.5px solid ${G.teal}`; }
              return (
                <div key={i} onClick={() => !answered && setSelected(i)} style={{ padding: "12px 16px", border, borderRadius: 10, cursor: answered ? "default" : "pointer", background: bg, display: "flex", gap: 12, alignItems: "center" }}>
                  <div style={{ width: 26, height: 26, borderRadius: "50%", border: "0.5px solid var(--color-border-secondary)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 500, flexShrink: 0, background: selected === i ? G.teal : "transparent", color: selected === i ? "#fff" : "var(--color-text-secondary)" }}>{optLetters[i]}</div>
                  <span style={{ fontSize: 14, color: "var(--color-text-primary)" }}>{opt}</span>
                  {answered && optLetters[i] === q.answer && <span style={{ marginLeft: "auto", color: G.teal }}>✓</span>}
                </div>
              );
            })}
          </div>
        )}

        {!opts && q.type === "判断题" && (
          <div style={{ display: "flex", gap: 10 }}>
            {["正确", "错误"].map((opt, i) => {
              let border = "0.5px solid var(--color-border-tertiary)", bg = "transparent";
              if (answered) {
                if (opt === q.answer) { bg = G.tealLight; border = `1.5px solid ${G.teal}`; }
                else if (i === selected && opt !== q.answer) { bg = G.redLight; border = `1.5px solid ${G.red}`; }
              } else if (selected === i) { bg = G.tealLight; border = `1.5px solid ${G.teal}`; }
              return (
                <div key={i} onClick={() => !answered && setSelected(i)} style={{ flex: 1, padding: "14px 16px", border, borderRadius: 10, cursor: answered ? "default" : "pointer", background: bg, textAlign: "center", fontSize: 15, fontWeight: 500, color: "var(--color-text-primary)" }}>{opt}</div>
              );
            })}
          </div>
        )}
      </Card>

      {(showHint || answered) && (
        <Card style={{ marginBottom: 12, background: "var(--color-background-secondary)", border: "none" }}>
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ width: 28, height: 28, borderRadius: "50%", background: G.teal, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <span style={{ color: "#fff", fontSize: 11, fontWeight: 700 }}>AI</span>
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 500, color: "var(--color-text-primary)", marginBottom: 5 }}>{answered ? `正确答案：${q.answer}` : "解题提示"}</div>
              <div style={{ fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.6 }}>{q.explanation}</div>
            </div>
          </div>
        </Card>
      )}

      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <Btn onClick={() => { if (current > 0) { setCurrent(c => c - 1); setSelected(null); setAnswered(false); setShowHint(false); } }}>← 上一题</Btn>
        <div style={{ display: "flex", gap: 8 }}>
          {!answered && <Btn size="sm" onClick={() => setShowHint(v => !v)}>💡 {showHint ? "隐藏" : "提示"}</Btn>}
          {!answered
            ? <Btn variant="primary" onClick={handleSubmit} disabled={selected === null}>提交答案</Btn>
            : <Btn variant="primary" onClick={handleNext}>{current >= displayQ.length - 1 ? "查看结果 →" : "下一题 →"}</Btn>
          }
        </div>
      </div>
    </div>
  );
}

// ── Flashcard Page ────────────────────────────────────────────────────────────
function FlashcardPage({ setPage }) {
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [filter, setFilter] = useState("全部");
  const [known, setKnown] = useState(new Set());
  const chapters = ["全部", ...new Set(FLASHCARDS.map(f => f.chapter))];
  const filtered = filter === "全部" ? FLASHCARDS : FLASHCARDS.filter(f => f.chapter === filter);
  const card = filtered[idx];

  const markKnown = () => {
    setKnown(k => new Set([...k, card.front]));
    if (idx < filtered.length - 1) { setIdx(i => i + 1); setFlipped(false); }
  };

  return (
    <div style={{ padding: "1.5rem", maxWidth: 680, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <Btn size="sm" onClick={() => setPage("首页")}>← 返回</Btn>
        <div style={{ fontSize: 17, fontWeight: 500, color: "var(--color-text-primary)" }}>记忆卡片</div>
        <Badge color="purple">{filtered.length} 张</Badge>
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
        {chapters.map(c => (
          <button key={c} onClick={() => { setFilter(c); setIdx(0); setFlipped(false); }} style={{ fontSize: 12, padding: "5px 12px", borderRadius: 20, border: "0.5px solid var(--color-border-secondary)", cursor: "pointer", fontFamily: "var(--font-sans)", background: filter === c ? G.purple : "transparent", color: filter === c ? "#fff" : "var(--color-text-secondary)" }}>{c}</button>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--color-text-tertiary)", marginBottom: 8 }}>
        <span>{idx + 1} / {filtered.length}</span>
        <span style={{ color: G.teal }}>已掌握 {known.size} 张</span>
      </div>
      <ProgressBar value={idx + 1} max={filtered.length} color={G.purple} height={4} />

      <div onClick={() => setFlipped(v => !v)} style={{ marginTop: 16, background: flipped ? G.teal : "var(--color-background-primary)", border: `1.5px solid ${flipped ? G.teal : "var(--color-border-tertiary)"}`, borderRadius: 16, padding: "3rem 2rem", textAlign: "center", cursor: "pointer", minHeight: 200, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", transition: "all .2s", marginBottom: 16 }}>
        <div style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: flipped ? "rgba(255,255,255,.6)" : "var(--color-text-tertiary)", marginBottom: 16 }}>{flipped ? "答案（点击返回）" : `${card?.chapter} · 点击翻转查看答案`}</div>
        <div style={{ fontSize: 20, fontWeight: 500, color: flipped ? "#fff" : "var(--color-text-primary)", lineHeight: 1.5, maxWidth: 420 }}>{flipped ? card?.back : card?.front}</div>
      </div>

      <div style={{ display: "flex", justifyContent: "center", gap: 10 }}>
        <Btn onClick={() => { setIdx(i => Math.max(0, i - 1)); setFlipped(false); }}>← 上一张</Btn>
        {flipped && <Btn variant="danger" onClick={() => { setIdx(i => Math.min(filtered.length - 1, i + 1)); setFlipped(false); }}>还不熟悉</Btn>}
        {flipped && <Btn variant="primary" onClick={markKnown}>✓ 已掌握</Btn>}
        {!flipped && <Btn onClick={() => { setIdx(i => Math.min(filtered.length - 1, i + 1)); setFlipped(false); }}>下一张 →</Btn>}
      </div>
      {known.size > 0 && (
        <div style={{ marginTop: 16, padding: "10px 14px", background: G.tealLight, borderRadius: 8, fontSize: 13, color: G.tealDark, textAlign: "center" }}>
          已掌握 {known.size} / {filtered.length} 张 · 继续加油！
        </div>
      )}
    </div>
  );
}

// ── Report Page ───────────────────────────────────────────────────────────────
function ReportPage({ setPage }) {
  const chapterStats = [
    { name: "Ch.1 方程求解", correct: 7, total: 10 },
    { name: "Ch.2 线性方程组", correct: 6, total: 10 },
    { name: "Ch.3 插值", correct: 4, total: 10 },
    { name: "Ch.4 最小二乘", correct: 3, total: 8 },
    { name: "Ch.5 数值微积分", correct: 5, total: 8 },
    { name: "最优化 Ch.1", correct: 5, total: 10 },
  ];
  const totalCorrect = chapterStats.reduce((a, c) => a + c.correct, 0);
  const totalQ = chapterStats.reduce((a, c) => a + c.total, 0);
  const pct = Math.round(totalCorrect / totalQ * 100);
  const weak = [...chapterStats].sort((a, b) => (a.correct / a.total) - (b.correct / b.total)).slice(0, 3);

  return (
    <div style={{ padding: "1.5rem", maxWidth: 900, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <Btn size="sm" onClick={() => setPage("首页")}>← 返回</Btn>
        <div style={{ fontSize: 17, fontWeight: 500, color: "var(--color-text-primary)" }}>学习报告</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 14 }}>
        <StatCard label="总体正确率" value={`${pct}%`} sub={`${totalCorrect}/${totalQ} 题`} color={pct >= 80 ? G.teal : pct >= 60 ? G.amber : G.red} />
        <StatCard label="已练习章节" value={chapterStats.length} sub="共 12 章" color={G.blue} />
        <StatCard label="答题总数" value={totalQ} sub="累计" color={G.amber} />
        <StatCard label="记忆卡片" value={`${Math.round(FLASHCARDS.length * 0.4)}/${FLASHCARDS.length}`} sub="已掌握" color={G.purple} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Card>
          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 14, paddingBottom: 10, borderBottom: "0.5px solid var(--color-border-tertiary)" }}>各章节正确率</div>
          {chapterStats.map((c, i) => {
            const p = Math.round(c.correct / c.total * 100);
            const color = p >= 80 ? G.teal : p >= 60 ? G.amber : G.red;
            return (
              <div key={i} style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                  <span style={{ fontSize: 12 }}>{c.name}</span>
                  <span style={{ fontSize: 12, fontWeight: 500, color }}>{p}%</span>
                </div>
                <ProgressBar value={c.correct} max={c.total} color={color} height={5} />
              </div>
            );
          })}
        </Card>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Card>
            <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 12, paddingBottom: 10, borderBottom: "0.5px solid var(--color-border-tertiary)" }}>⚠️ 薄弱章节</div>
            {weak.map((c, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: i < weak.length - 1 ? "0.5px solid var(--color-border-tertiary)" : "none" }}>
                <span style={{ fontSize: 13 }}>{c.name}</span>
                <div style={{ display: "flex", gap: 8 }}>
                  <Badge color="red">{Math.round(c.correct / c.total * 100)}%</Badge>
                  <Btn size="sm" onClick={() => setPage("题库练习")}>练习</Btn>
                </div>
              </div>
            ))}
          </Card>
          <Card>
            <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 12, paddingBottom: 10, borderBottom: "0.5px solid var(--color-border-tertiary)" }}>📅 近期活动</div>
            {[
              { day: "今天", action: "每日练习 · 5题", score: "4/5", color: G.amber },
              { day: "昨天", action: "Ch.2 线性方程组", score: "6/10", color: G.teal },
              { day: "3天前", action: "Ch.1 方程求解", score: "7/10", color: G.teal },
            ].map((a, i) => (
              <div key={i} style={{ display: "flex", gap: 10, padding: "8px 0", borderBottom: i < 2 ? "0.5px solid var(--color-border-tertiary)" : "none" }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: a.color, marginTop: 6, flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>{a.day}</div>
                  <div style={{ fontSize: 13 }}>{a.action}</div>
                </div>
                <Badge color={a.color === G.teal ? "teal" : "amber"}>{a.score}</Badge>
              </div>
            ))}
          </Card>
        </div>
      </div>
    </div>
  );
}

// ── Wrong Page ────────────────────────────────────────────────────────────────
function WrongPage({ setPage }) {
  const wrongs = [
    { q: "Newton法的收敛条件", ch: "Ch.1", date: "今天", answer: "|g'(x*)| < 1" },
    { q: "Lagrange插值误差估计公式", ch: "Ch.3", date: "昨天", answer: "f^(n+1)(ξ)/(n+1)! · ∏(x-xᵢ)" },
    { q: "LU分解的适用条件", ch: "Ch.2", date: "3天前", answer: "主元不为零，否则需要 PA=LU" },
    { q: "Simpson法则的误差阶", ch: "Ch.5", date: "4天前", answer: "O(h⁴)" },
  ];
  return (
    <div style={{ padding: "1.5rem", maxWidth: 780, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <Btn size="sm" onClick={() => setPage("首页")}>← 返回</Btn>
        <div style={{ fontSize: 17, fontWeight: 500, color: "var(--color-text-primary)" }}>错题本</div>
        <Badge color="red">{wrongs.length} 题</Badge>
      </div>
      <Card>
        {wrongs.map((w, i) => (
          <div key={i} style={{ padding: "14px 0", borderBottom: i < wrongs.length - 1 ? "0.5px solid var(--color-border-tertiary)" : "none" }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: G.red, marginTop: 6, flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, marginBottom: 4 }}>{w.q}</div>
                <div style={{ fontSize: 12, color: G.tealDark, marginBottom: 4 }}>正确答案：{w.answer}</div>
                <div style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>{w.ch} · {w.date}</div>
              </div>
              <Btn size="sm" onClick={() => setPage("题库练习")}>重做</Btn>
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}

// ── Teacher Page ──────────────────────────────────────────────────────────────
function TeacherPage({ setPage }) {
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

  useEffect(() => {
    supabase.from("questions").select("*").order("created_at", { ascending: false }).then(({ data }) => { if (data) setDbQuestions(data); });
  }, []);

  const handlePdfDrop = useCallback((e) => {
    e.preventDefault();
    const files = [...(e.dataTransfer?.files || e.target.files || [])];
    setUploadedFiles(prev => [...prev, ...files.map(f => ({ name: f.name, size: (f.size / 1024).toFixed(0) + " KB", date: new Date().toLocaleDateString("zh-CN") }))]);
  }, []);

  const generateQuestions = async (targetChapter) => {
    const chapter = targetChapter || aiChapter;
    setAiLoading(true); setAiError(""); setAiQuestions([]);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chapter, type: aiType, count: aiCount }),
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

  const assignHomework = (studentName, chapter) => {
    setHwAssigned(prev => ({ ...prev, [studentName]: [...(prev[studentName] || []), chapter] }));
    alert(`已向 ${studentName} 布置 ${chapter} 专项作业！`);
  };

  const STUDENTS = [
    { name: "张同学", email: "zhang@example.com", pct: 82, questions: 48, weak: ["Ch.3 插值", "Ch.4 最小二乘"], strong: ["Ch.1 方程求解", "Ch.2 线性方程组"] },
    { name: "李同学", email: "li@example.com", pct: 65, questions: 32, weak: ["Ch.5 数值微积分", "最优化 Ch.1"], strong: ["Ch.1 方程求解"] },
    { name: "王同学", email: "wang@example.com", pct: 91, questions: 60, weak: [], strong: ["Ch.1", "Ch.2", "Ch.3"] },
    { name: "陈同学", email: "chen@example.com", pct: 43, questions: 20, weak: ["Ch.2 线性方程组", "Ch.3 插值", "最优化 Ch.1"], strong: [] },
    { name: "刘同学", email: "liu@example.com", pct: 77, questions: 41, weak: ["Ch.4 最小二乘"], strong: ["Ch.1", "Ch.2"] },
  ];

  const selectStyle = { width: "100%", fontSize: 13, padding: "9px 10px", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 8, background: "var(--color-background-primary)", color: "var(--color-text-primary)", fontFamily: "var(--font-sans)" };

  return (
    <div style={{ padding: "1.5rem", maxWidth: 980, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <Btn size="sm" onClick={() => setPage("首页")}>← 返回</Btn>
        <div style={{ fontSize: 17, fontWeight: 500, color: "var(--color-text-primary)" }}>教师管理</div>
      </div>
      <div style={{ display: "flex", gap: 0, borderBottom: "0.5px solid var(--color-border-tertiary)", marginBottom: 16 }}>
        {["学生管理", "上传教材", "AI 出题", "题库管理"].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: "10px 20px", fontSize: 13, fontFamily: "var(--font-sans)", border: "none", borderBottom: tab === t ? `2px solid ${G.teal}` : "2px solid transparent", background: "none", cursor: "pointer", color: tab === t ? G.teal : "var(--color-text-secondary)", fontWeight: tab === t ? 500 : 400, marginBottom: -0.5 }}>{t}</button>
        ))}
      </div>

      {tab === "学生管理" && (
        <div>
          <Card style={{ marginBottom: 14, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "1rem 1.5rem" }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>班级邀请码</div>
              <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>学生注册时输入此邀请码加入班级</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ fontSize: 24, fontWeight: 500, color: G.teal, letterSpacing: "0.15em", background: G.tealLight, padding: "8px 20px", borderRadius: 10 }}>MATH2024</div>
              <Btn size="sm" onClick={() => { navigator.clipboard.writeText("MATH2024"); alert("邀请码已复制！"); }}>复制</Btn>
            </div>
          </Card>

          {selectedStudent ? (
            <Card>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, paddingBottom: 12, borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
                <Btn size="sm" onClick={() => setSelectedStudent(null)}>← 返回列表</Btn>
                <div style={{ width: 36, height: 36, borderRadius: "50%", background: G.tealLight, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 500, color: G.tealDark }}>{selectedStudent.name[0]}</div>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 500 }}>{selectedStudent.name}</div>
                  <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>{selectedStudent.email}</div>
                </div>
                <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                  <Badge color={selectedStudent.pct >= 80 ? "teal" : selectedStudent.pct >= 60 ? "amber" : "red"}>正确率 {selectedStudent.pct}%</Badge>
                  <Badge color="blue">答题 {selectedStudent.questions} 题</Badge>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 10 }}>⚠️ 薄弱章节</div>
                  {selectedStudent.weak.length === 0
                    ? <div style={{ fontSize: 13, color: "var(--color-text-tertiary)" }}>暂无明显薄弱点 🎉</div>
                    : selectedStudent.weak.map((w, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
                        <span style={{ fontSize: 13 }}>{w}</span>
                        <div style={{ display: "flex", gap: 6 }}>
                          <Btn size="sm" onClick={() => generateQuestions(w)}>AI 出针对题</Btn>
                          <Btn size="sm" variant="primary" onClick={() => assignHomework(selectedStudent.name, w)}>布置作业</Btn>
                        </div>
                      </div>
                    ))
                  }
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 10 }}>✅ 擅长章节</div>
                  {selectedStudent.strong.length === 0
                    ? <div style={{ fontSize: 13, color: "var(--color-text-tertiary)" }}>暂无数据</div>
                    : selectedStudent.strong.map((s, i) => (
                      <div key={i} style={{ padding: "10px 0", borderBottom: "0.5px solid var(--color-border-tertiary)", display: "flex", justifyContent: "space-between" }}>
                        <span style={{ fontSize: 13 }}>{s}</span>
                        <Badge color="teal">掌握良好</Badge>
                      </div>
                    ))
                  }
                  {hwAssigned[selectedStudent.name]?.length > 0 && (
                    <div style={{ marginTop: 14 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>📋 已布置作业</div>
                      {hwAssigned[selectedStudent.name].map((hw, i) => <div key={i} style={{ fontSize: 12, color: "var(--color-text-secondary)", padding: "4px 0" }}>· {hw}</div>)}
                    </div>
                  )}
                </div>
              </div>
            </Card>
          ) : (
            <Card>
              <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 14, paddingBottom: 10, borderBottom: "0.5px solid var(--color-border-tertiary)", display: "flex", justifyContent: "space-between" }}>
                <span>班级学生 <span style={{ fontSize: 12, color: "var(--color-text-tertiary)", fontWeight: 400 }}>共 {STUDENTS.length} 人</span></span>
                <Badge color="blue">点击查看详情</Badge>
              </div>
              {STUDENTS.map((s, i) => {
                const color = s.pct >= 80 ? G.teal : s.pct >= 60 ? G.amber : G.red;
                return (
                  <div key={i} onClick={() => setSelectedStudent(s)} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 0", borderBottom: i < STUDENTS.length - 1 ? "0.5px solid var(--color-border-tertiary)" : "none", cursor: "pointer" }}>
                    <div style={{ width: 36, height: 36, borderRadius: "50%", background: G.tealLight, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 500, color: G.tealDark, flexShrink: 0 }}>{s.name[0]}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 5 }}>{s.name}</div>
                      <ProgressBar value={s.pct} color={color} height={4} />
                    </div>
                    <div style={{ textAlign: "right", minWidth: 80 }}>
                      <div style={{ fontSize: 14, fontWeight: 500, color }}>{s.pct}%</div>
                      <div style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>{s.questions} 题</div>
                    </div>
                    {s.weak.length > 0 && <Badge color="red">{s.weak.length} 个薄弱点</Badge>}
                    {s.pct >= 80 && <Badge color="teal">优秀</Badge>}
                  </div>
                );
              })}
            </Card>
          )}
        </div>
      )}

      {tab === "上传教材" && (
        <Card>
          <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 4 }}>上传教材 PDF</div>
          <div style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 18 }}>上传教材后，AI 将基于内容自动生成题目</div>
          <div onDrop={handlePdfDrop} onDragOver={e => e.preventDefault()} onClick={() => pdfRef.current?.click()} style={{ border: "1.5px dashed var(--color-border-secondary)", borderRadius: 12, padding: "3rem", textAlign: "center", cursor: "pointer", marginBottom: 16, background: "var(--color-background-secondary)" }}>
            <input ref={pdfRef} type="file" accept=".pdf" multiple style={{ display: "none" }} onChange={handlePdfDrop} />
            <div style={{ fontSize: 32, marginBottom: 10 }}>📂</div>
            <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 6 }}>拖拽 PDF 教材到此处，或点击选择</div>
            <div style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>支持多文件，仅限 PDF</div>
          </div>
          {uploadedFiles.map((f, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
              <span style={{ fontSize: 18 }}>📄</span>
              <div style={{ flex: 1 }}><div style={{ fontSize: 13, fontWeight: 500 }}>{f.name}</div><div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 2 }}>{f.size} · {f.date}</div></div>
              <Badge color="teal">已上传</Badge>
            </div>
          ))}
          <div style={{ marginTop: 14, padding: "12px 14px", background: "var(--color-background-secondary)", borderRadius: 8, fontSize: 13, color: "var(--color-text-secondary)" }}>
            📚 已有教材：<strong>数值分析 (Sauer, 2nd Ed.)</strong> · <strong>最优化 Ch.1 (OR4030)</strong>
          </div>
        </Card>
      )}

      {tab === "AI 出题" && (
        <Card>
          <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 4 }}>AI 智能出题</div>
          <div style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 18 }}>基于教材内容，自动生成题目并保存到数据库</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 90px 100px", gap: 10, marginBottom: 18, alignItems: "end" }}>
            <div>
              <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 5 }}>章节</div>
              <select value={aiChapter} onChange={e => setAiChapter(e.target.value)} style={selectStyle}>
                {["Ch.1 · 方程求解", "Ch.2 · 线性方程组", "Ch.3 · 插值", "Ch.4 · 最小二乘", "Ch.5 · 数值微积分", "Ch.6 · 常微分方程", "最优化 Ch.1 · 优化模型"].map(o => <option key={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 5 }}>题型</div>
              <select value={aiType} onChange={e => setAiType(e.target.value)} style={selectStyle}>
                {["单选题", "多选题", "填空题", "判断题"].map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 5 }}>数量</div>
              <select value={aiCount} onChange={e => setAiCount(e.target.value)} style={selectStyle}>
                {["1", "3", "5"].map(n => <option key={n}>{n}</option>)}
              </select>
            </div>
            <Btn variant="primary" onClick={() => generateQuestions()} disabled={aiLoading} style={{ padding: "9px 0" }}>{aiLoading ? "生成中…" : "✨ 生成"}</Btn>
          </div>
          <Alert msg={aiError} type="error" />
          {aiLoading && <div style={{ textAlign: "center", padding: "2.5rem", color: "var(--color-text-secondary)", fontSize: 13, background: "var(--color-background-secondary)", borderRadius: 10 }}>⏳ AI 正在生成题目…</div>}
          {aiQuestions.map((q, i) => (
            <div key={i} style={{ border: "0.5px solid var(--color-border-tertiary)", borderRadius: 10, padding: "1.25rem", marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                <div style={{ display: "flex", gap: 6 }}><Badge color="blue">{aiType}</Badge><Badge color="amber">{aiChapter}</Badge></div>
                <Btn size="sm" variant="primary" onClick={() => saveToDb(q)} disabled={saving}>+ 保存到题库</Btn>
              </div>
              <div style={{ fontSize: 14, marginBottom: 12, lineHeight: 1.7 }}>{q.question}</div>
              {q.options && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 10 }}>
                  {q.options.map((opt, j) => (
                    <div key={j} style={{ fontSize: 12, padding: "7px 10px", background: opt.startsWith(q.answer) ? G.tealLight : "var(--color-background-secondary)", borderRadius: 6, color: opt.startsWith(q.answer) ? G.tealDark : "var(--color-text-secondary)", fontWeight: opt.startsWith(q.answer) ? 500 : 400 }}>{opt}</div>
                  ))}
                </div>
              )}
              <div style={{ fontSize: 12, color: "var(--color-text-secondary)", background: "var(--color-background-secondary)", padding: "10px 12px", borderRadius: 8 }}>
                <strong>答案：</strong>{q.answer}　·　<strong>解析：</strong>{q.explanation}
              </div>
            </div>
          ))}
        </Card>
      )}

      {tab === "题库管理" && (
        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, paddingBottom: 12, borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
            <div style={{ fontSize: 15, fontWeight: 500 }}>题库管理</div>
            <Badge color="blue">共 {dbQuestions.length} 题</Badge>
          </div>
          {dbQuestions.length === 0 && <div style={{ textAlign: "center", padding: "3rem", color: "var(--color-text-tertiary)", fontSize: 13 }}>📝 暂无题目，请先使用 AI 出题</div>}
          {dbQuestions.map((q, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
              <Badge color="amber">{q.chapter}</Badge>
              <div style={{ flex: 1, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{q.question}</div>
              <Badge color="blue">{q.type}</Badge>
              <Btn size="sm" onClick={() => deleteQuestion(q.id)}>删除</Btn>
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

  const handleLogout = async () => { await supabase.auth.signOut(); setPage("首页"); };

  if (loading) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--color-background-tertiary)" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: G.teal }} />
        <div style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>加载中…</div>
      </div>
    </div>
  );

  if (!session) return <AuthPage />;

  const renderPage = () => {
    if (page === "首页") return <HomePage setPage={setPage} profile={profile} />;
    if (page === "知识点") return <KnowledgePage setPage={setPage} />;
    if (page === "题库练习") return <QuizPage setPage={setPage} />;
    if (page === "记忆卡片") return <FlashcardPage setPage={setPage} />;
    if (page === "学习报告") return <ReportPage setPage={setPage} />;
    if (page === "错题本") return <WrongPage setPage={setPage} />;
    if (page === "教师管理") return <TeacherPage setPage={setPage} />;
    return null;
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--color-background-tertiary)" }}>
      <TopNav page={page} setPage={setPage} profile={profile} onLogout={handleLogout} />
      {renderPage()}
    </div>
  );
}