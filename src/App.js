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

const VIZ_MAP = {
  "二分法": <VizBisection />,
  "Newton 法": <VizNewton />,
  "LU 分解": <VizLU />,
  "梯形法 / Simpson 法": <VizSimpson />,
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
  },
  "Gauss 消去法": {
    intro: "高斯消去法是解线性方程组 Ax=b 的标准算法，分前向消元（化为上三角）和回代两步。",
    formulas: [
      { label: "消元乘子", tex: "m_{ik} = \\frac{a_{ik}^{(k)}}{a_{kk}^{(k)}},\\; i > k" },
      { label: "计算复杂度", tex: "\\frac{n^3}{3} + O(n^2) \\text{ 次运算}" },
    ],
    steps: ["对每列 k，计算消元乘子 mₖₗ", "用第 k 行消去下面各行的第 k 列元素", "回代从最后一行求解各未知数"],
    note: "必须选主元（Pivoting）避免数值不稳定。部分主元法选每列最大元素。",
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
  },
  "法方程": {
    intro: "线性最小二乘求 x 使 ‖b-Ax‖₂ 最小，对目标函数求导置零得到法方程（正规方程）。",
    formulas: [
      { label: "最小化目标", tex: "\\min_x \\|Ax - b\\|_2^2" },
      { label: "法方程", tex: "A^\\top A\\, x = A^\\top b" },
    ],
    steps: ["建立超定方程组 Ax≈b（方程数 > 未知数）", "构造法方程 AᵀAx=Aᵀb", "求解得到最优参数"],
    note: "AᵀA 的条件数是 A 的平方，数值稳定性差。实践中用 QR 分解更好。",
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
  },
  "Euler 法": {
    intro: "Euler 法是求解 ODE 初值问题 y'=f(t,y) 最简单的方法：用当前斜率直接预测下一步。",
    formulas: [
      { label: "Euler 迭代", tex: "w_{i+1} = w_i + h\\,f(t_i,\\,w_i)" },
      { label: "局部截断误差", tex: "\\tau = \\tfrac{h}{2}y''(\\xi)=O(h^2),\\quad \\text{全局} O(h)" },
    ],
    steps: ["从初始值 w₀=y₀ 出发", "依次计算 wᵢ₊₁=wᵢ+h·f(tᵢ,wᵢ)", "推进到目标时间"],
    note: "一阶方法，精度低，步长需很小。仅用于理论分析和教学示例，实践用 RK4。",
  },
  "Runge-Kutta 法": {
    intro: "RK4 在一个步长内取四个斜率采样点加权平均，得到四阶精度，是最常用的 ODE 求解器。",
    formulas: [
      { label: "经典 RK4 格式", tex: "w_{i+1} = w_i + \\tfrac{h}{6}(k_1+2k_2+2k_3+k_4)" },
      { label: "局部截断误差", tex: "O(h^5),\\quad \\text{全局误差 } O(h^4)" },
    ],
    steps: ["计算 k₁=f(tᵢ,wᵢ)", "计算 k₂=f(tᵢ+h/2, wᵢ+hk₁/2)", "计算 k₃=f(tᵢ+h/2, wᵢ+hk₂/2)", "计算 k₄=f(tᵢ+h, wᵢ+hk₃)", "更新 wᵢ₊₁"],
    note: "每步 4 次函数求值，精度与计算量均衡。自适应步长版本（RK45）更实用。",
  },
  "最小二乘数据拟合": {
    intro: "给定 m 个数据点，寻找参数 x 使模型与观测值的残差平方和最小，是数据科学的核心方法。",
    formulas: [
      { label: "残差向量", tex: "r = b - Ax,\\quad r_i = b_i - \\sum_j a_{ij}x_j" },
      { label: "最小二乘目标", tex: "\\min_x \\|r\\|_2^2 = \\min_x \\sum_{i=1}^m r_i^2" },
    ],
    steps: ["收集数据点 (tᵢ,bᵢ)", "建立矩阵方程 Ax≈b", "用法方程或 QR 分解求 x*"],
    note: "线性最小二乘：参数线性出现，有解析解。非线性：需要 Gauss-Newton 迭代。",
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
  },
};

// ── Topic Modal ───────────────────────────────────────────────────────────────
function TopicModal({ topic, onClose }) {
  const content = KNOWLEDGE_CONTENT[topic];
  const vizKey = content?.viz;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 300, padding: "1rem" }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 20, padding: "2rem", maxWidth: 660, width: "100%", maxHeight: "88vh", overflowY: "auto", boxShadow: "0 24px 60px rgba(0,0,0,0.18)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18, paddingBottom: 14, borderBottom: `2px solid ${G.tealLight}` }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 600, color: "#111", marginBottom: 4 }}>{topic}</div>
            <div style={{ fontSize: 12, color: G.teal, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.08em" }}>知识点详解</div>
          </div>
          <button onClick={onClose} style={{ width: 36, height: 36, borderRadius: "50%", border: "none", background: "#f5f5f5", cursor: "pointer", fontSize: 16, color: "#666", display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
        </div>

        {!content ? (
          <div style={{ padding: "2rem", textAlign: "center", color: "#888", fontSize: 15 }}>该知识点内容正在整理中，敬请期待 📚</div>
        ) : (
          <>
            {/* Visualization */}
            {vizKey && VIZ_MAP[vizKey] && (
              <div style={{ marginBottom: 20, borderRadius: 12, overflow: "hidden" }}>{VIZ_MAP[vizKey]}</div>
            )}

            {/* Intro */}
            <div style={{ fontSize: 15, color: "#444", lineHeight: 1.8, marginBottom: 20, padding: "14px 18px", background: G.tealLight, borderRadius: 12, borderLeft: `4px solid ${G.teal}` }}>{content.intro}</div>

            {/* Formulas */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#111", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>核心公式</div>
              {content.formulas.map((f, i) => (
                <div key={i} style={{ marginBottom: 10, padding: "14px 18px", background: "#fafafa", borderRadius: 10, border: "1px solid #eee" }}>
                  <div style={{ fontSize: 12, color: G.teal, fontWeight: 500, marginBottom: 8 }}>{f.label}</div>
                  <M tex={f.tex} block />
                </div>
              ))}
            </div>

            {/* Steps */}
            {content.steps && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#111", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>算法步骤</div>
                {content.steps.map((s, i) => (
                  <div key={i} style={{ display: "flex", gap: 12, marginBottom: 10 }}>
                    <div style={{ width: 26, height: 26, borderRadius: "50%", background: G.teal, color: "#fff", fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{i + 1}</div>
                    <div style={{ fontSize: 14, color: "#333", lineHeight: 1.65, paddingTop: 2 }}>{s}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Note */}
            {content.note && (
              <div style={{ padding: "14px 18px", background: G.amberLight, borderRadius: 10, borderLeft: `4px solid ${G.amber}`, fontSize: 14, color: "#5a3a00", lineHeight: 1.7 }}>
                <strong>💡 注意：</strong>{content.note}
              </div>
            )}
          </>
        )}

        <div style={{ marginTop: 20, display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "10px 24px", background: G.teal, color: "#fff", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 500, cursor: "pointer" }}>关闭</button>
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
];

// ── Shared UI ─────────────────────────────────────────────────────────────────
const s = {
  card: { background: "#fff", border: "1px solid #eee", borderRadius: 16, padding: "1.5rem" },
  input: { width: "100%", fontSize: 15, padding: "12px 14px", border: "1.5px solid #e0e0e0", borderRadius: 10, fontFamily: "inherit", boxSizing: "border-box", outline: "none", color: "#111" },
  label: { fontSize: 13, color: "#555", marginBottom: 6, display: "block", fontWeight: 500 },
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
  <div style={{ background: "#fff", borderRadius: 16, padding: "1.25rem 1.5rem", border: "1px solid #eee", borderTop: `4px solid ${color}` }}>
    <div style={{ fontSize: 24, marginBottom: 6 }}>{icon}</div>
    <div style={{ fontSize: 28, fontWeight: 700, color: "#111", marginBottom: 2 }}>{value}</div>
    <div style={{ fontSize: 13, color: "#888" }}>{label}</div>
    {sub && <div style={{ fontSize: 11, color: "#aaa", marginTop: 2 }}>{sub}</div>}
  </div>
);

const ProgressBar = ({ value, max = 100, color = G.teal, height = 8 }) => (
  <div style={{ height, background: "#f0f0f0", borderRadius: height, overflow: "hidden" }}>
    <div style={{ height, width: `${Math.min(100, (value / max) * 100)}%`, background: color, borderRadius: height, transition: "width .5s ease" }} />
  </div>
);

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

  const handleLogin = async () => {
    setLoading(true); setError("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError("邮箱或密码错误，请重试");
    setLoading(false);
  };

  const handleRegister = async () => {
    if (!name.trim()) { setError("请输入姓名"); return; }
    if (password.length < 6) { setError("密码至少 6 位"); return; }
    if (role === "student" && !classCode.trim()) { setError("学生需要输入班级邀请码"); return; }
    setLoading(true); setError("");
    const { error } = await supabase.auth.signUp({ email, password, options: { data: { name, role, classCode } } });
    if (error) setError(error.message);
    else setSuccess("注册成功！请检查邮箱完成验证后登录。");
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
          {success && <div style={{ padding: "12px 16px", background: G.tealLight, color: G.tealDark, borderRadius: 10, fontSize: 14, marginBottom: 16 }}>{success}</div>}

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
              {role === "student" && (
                <div style={{ marginBottom: 14 }}>
                  <label style={s.label}>班级邀请码</label>
                  <input style={s.input} value={classCode} onChange={e => setClassCode(e.target.value)} placeholder="请向老师获取（如：MATH2024）" />
                </div>
              )}
            </>
          )}

          <div style={{ marginBottom: 14 }}>
            <label style={s.label}>邮箱</label>
            <input style={s.input} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="your@email.com" />
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={s.label}>密码</label>
            <input style={s.input} type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder={mode === "register" ? "至少 6 位" : "输入密码"} />
          </div>

          <button disabled={loading} onClick={mode === "login" ? handleLogin : handleRegister} style={{ width: "100%", padding: "14px 0", fontSize: 16, fontWeight: 600, fontFamily: "inherit", background: loading ? "#9FE1CB" : G.teal, color: "#fff", border: "none", borderRadius: 12, cursor: loading ? "not-allowed" : "pointer" }}>
            {loading ? "处理中…" : mode === "login" ? "登录" : "注册账号"}
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
function TopNav({ page, setPage, profile, onLogout }) {
  const links = profile?.role === "teacher"
    ? ["首页", "资料库", "知识点", "题库练习", "记忆卡片", "学习报告", "错题本", "教师管理"]
    : ["首页", "资料库", "知识点", "题库练习", "记忆卡片", "学习报告", "错题本"];
  return (
    <div style={{ background: "#fff", borderBottom: "1px solid #f0f0f0", padding: "0 2rem", display: "flex", alignItems: "center", justifyContent: "space-between", height: 64, position: "sticky", top: 0, zIndex: 100, boxShadow: "0 1px 12px rgba(0,0,0,0.04)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: G.teal, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>📐</div>
        <span style={{ fontSize: 18, fontWeight: 700, color: "#111", letterSpacing: "-0.3px" }}>MathCore</span>
      </div>
      <div style={{ display: "flex", gap: 2 }}>
        {links.map(l => (
          <button key={l} onClick={() => setPage(l)} style={{ padding: "8px 14px", borderRadius: 10, fontSize: 14, fontFamily: "inherit", border: "none", cursor: "pointer", fontWeight: page === l ? 600 : 400, background: page === l ? G.tealLight : "transparent", color: page === l ? G.tealDark : "#666" }}>{l}</button>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 36, height: 36, borderRadius: "50%", background: G.teal, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 700, color: "#fff" }}>{(profile?.name || "U")[0].toUpperCase()}</div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#111" }}>{profile?.name}</div>
          <div style={{ fontSize: 11, color: "#999" }}>{profile?.role === "teacher" ? "教师" : "学生"}</div>
        </div>
        <button onClick={onLogout} style={{ fontSize: 13, padding: "7px 14px", border: "1.5px solid #e0e0e0", borderRadius: 8, cursor: "pointer", background: "#fff", color: "#666", fontFamily: "inherit" }}>退出</button>
      </div>
    </div>
  );
}

// ── Home Page ─────────────────────────────────────────────────────────────────
function HomePage({ setPage, profile }) {
  return (
    <div style={{ padding: "2rem", maxWidth: 1000, margin: "0 auto" }}>
      {/* Hero */}
      <div style={{ background: `linear-gradient(135deg, ${G.teal} 0%, #0a7a5a 100%)`, borderRadius: 24, padding: "2.5rem 3rem", marginBottom: 24, color: "#fff", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", right: -20, top: -20, width: 180, height: 180, borderRadius: "50%", background: "rgba(255,255,255,0.08)" }} />
        <div style={{ position: "absolute", right: 60, bottom: -40, width: 120, height: 120, borderRadius: "50%", background: "rgba(255,255,255,0.05)" }} />
        <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: "0.12em", opacity: 0.7, textTransform: "uppercase", marginBottom: 10 }}>数学与应用数学学习平台</div>
        <div style={{ fontSize: 30, fontWeight: 700, marginBottom: 10, letterSpacing: "-0.5px" }}>你好，{profile?.name || "同学"} 👋</div>
        <div style={{ fontSize: 16, opacity: 0.85, lineHeight: 1.7, marginBottom: 24, maxWidth: 520 }}>涵盖数值分析、最优化理论两门课程，AI 智能出题与记忆卡片，系统提升数学能力。</div>
        <div style={{ display: "flex", gap: 12 }}>
          <button onClick={() => setPage("知识点")} style={{ padding: "12px 28px", fontSize: 15, fontWeight: 600, fontFamily: "inherit", background: "#fff", color: G.teal, border: "none", borderRadius: 12, cursor: "pointer" }}>开始学习</button>
          <button onClick={() => setPage("题库练习")} style={{ padding: "12px 28px", fontSize: 15, fontWeight: 600, fontFamily: "inherit", background: "rgba(255,255,255,0.15)", color: "#fff", border: "2px solid rgba(255,255,255,0.3)", borderRadius: 12, cursor: "pointer" }}>进入题库</button>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 24 }}>
        <StatCard icon="📚" label="门课程" value="2" sub="数值分析 · 最优化" color={G.teal} />
        <StatCard icon="📖" label="章节" value="12" sub="共 19 小节" color={G.blue} />
        <StatCard icon="✏️" label="题目" value={ALL_QUESTIONS.length + "+"} sub="持续更新" color={G.amber} />
        <StatCard icon="🃏" label="记忆卡片" value={FLASHCARDS.length} sub="公式定理" color={G.purple} />
      </div>

      {/* Quick access */}
      <div style={{ fontSize: 14, fontWeight: 600, color: "#888", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 14 }}>快速入口</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        {[
          { icon: "⚡", title: "每日练习", desc: "今日推荐 5 道精选题目", page: "题库练习", bg: "#EEF4FF", accent: G.blue, tag: "今日" },
          { icon: "🃏", title: "记忆卡片", desc: "核心公式与定理快速记忆", page: "记忆卡片", bg: G.purpleLight, accent: G.purple, tag: null },
          { icon: "📊", title: "学习报告", desc: "查看正确率与薄弱知识点", page: "学习报告", bg: G.amberLight, accent: G.amber, tag: null },
          { icon: "🔖", title: "错题本", desc: "收录错题，针对性复习", page: "错题本", bg: G.redLight, accent: G.red, tag: null },
        ].map(q => (
          <div key={q.title} onClick={() => setPage(q.page)} style={{ background: q.bg, borderRadius: 16, padding: "1.5rem", cursor: "pointer", display: "flex", gap: 16, alignItems: "flex-start", border: `1px solid ${q.accent}22`, transition: "transform .15s" }}>
            <div style={{ width: 48, height: 48, borderRadius: 14, background: q.accent, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, flexShrink: 0 }}>{q.icon}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: "#111", marginBottom: 4 }}>{q.title}</div>
              <div style={{ fontSize: 14, color: "#666" }}>{q.desc}</div>
            </div>
            {q.tag && <span style={{ background: G.blue, color: "#fff", fontSize: 11, padding: "3px 10px", borderRadius: 20, fontWeight: 600, whiteSpace: "nowrap", height: "fit-content" }}>{q.tag}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Knowledge Page ────────────────────────────────────────────────────────────
function KnowledgePage({ setPage, setChapterFilter, sessionAnswers = {} }) {
  const [sel, setSel] = useState(CHAPTERS[0]);
  const [filter, setFilter] = useState("全部");
  const [openTopic, setOpenTopic] = useState(null);
  const chapterStats = getChapterStats(sessionAnswers);
  const filtered = filter === "全部" ? CHAPTERS : CHAPTERS.filter(c => c.course === filter);
  return (
    <>
      {openTopic && <TopicModal topic={openTopic} onClose={() => setOpenTopic(null)} />}
      <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 16, padding: "2rem", maxWidth: 1140, margin: "0 auto" }}>
        {/* Sidebar */}
        <div style={{ ...s.card, padding: "1.25rem 0", height: "fit-content" }}>
          <div style={{ padding: "12px 14px", borderBottom: "1px solid #f0f0f0", marginBottom: 8 }}>
            <div style={{ fontSize: 12, color: "#aaa", marginBottom: 8, fontWeight: 500 }}>课程筛选</div>
            <div style={{ display: "flex", gap: 4 }}>
              {["全部", "数值分析", "最优化"].map(c => (
                <button key={c} onClick={() => setFilter(c)} style={{ flex: 1, fontSize: 12, padding: "6px 0", borderRadius: 8, border: "none", cursor: "pointer", fontFamily: "inherit", fontWeight: filter === c ? 600 : 400, background: filter === c ? G.teal : "#f5f5f5", color: filter === c ? "#fff" : "#666" }}>{c}</button>
              ))}
            </div>
            {Object.keys(chapterStats || {}).length > 0 && (
              <div style={{ marginTop: 10, fontSize: 12, color: "#888" }}>
                已练习 <strong style={{ color: G.teal }}>{Object.keys(chapterStats).length}</strong> 个章节
              </div>
            )}
          </div>
          {filtered.map(ch => (
            <div key={ch.id} onClick={() => setSel(ch)} style={{ padding: "10px 16px", cursor: "pointer", fontSize: 14, borderLeft: `3px solid ${sel.id === ch.id ? G.teal : "transparent"}`, background: sel.id === ch.id ? G.tealLight : "transparent", color: sel.id === ch.id ? G.tealDark : "#555", fontWeight: sel.id === ch.id ? 600 : 400, display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 11, color: sel.id === ch.id ? G.teal : "#bbb", minWidth: 32, fontWeight: 500 }}>{ch.num}</span>
              {ch.name}
            </div>
          ))}
        </div>

        {/* Content */}
        <div style={{ ...s.card }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, paddingBottom: 16, borderBottom: "1px solid #f0f0f0" }}>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700, color: "#111", marginBottom: 8 }}>{sel.num} · {sel.name}</div>
              <div style={{ display: "flex", gap: 8 }}>
                <Badge color={sel.course === "数值分析" ? "teal" : "blue"}>{sel.course}</Badge>
                <Badge color="red">{sel.topics.length} 个知识点</Badge>
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              {chapterStats[sel.num] && chapterStats[sel.num].total > 0 && (
                <div style={{ fontSize: 13, color: "#888", padding: "4px 10px", background: G.tealLight, borderRadius: 8 }}>
                  本章已答 <strong style={{ color: G.teal }}>{chapterStats[sel.num].total}</strong> 题 · 正确率 <strong style={{ color: G.teal }}>{Math.round((chapterStats[sel.num].correct || 0) / chapterStats[sel.num].total * 100)}%</strong>
                </div>
              )}
              <Btn size="sm" onClick={() => setPage("记忆卡片")}>🃏 记忆卡片</Btn>
              <Btn size="sm" variant="primary" onClick={() => { setChapterFilter(sel.num); setPage("题库练习"); }}>章节练习 →</Btn>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {sel.topics.map((t, i) => {
              const hasContent = !!KNOWLEDGE_CONTENT[t];
              const accuracy = getTopicAccuracy(t, chapterStats);
              const status = getTopicStatus(t, chapterStats);
              const statusColor = status === "done" ? G.teal : status === "doing" ? G.amber : "#ddd";
              const statusLabel = status === "done" ? "✓ 已完成" : status === "doing" ? "进行中" : "未开始";
              const statusBg = status === "done" ? G.tealLight : status === "doing" ? G.amberLight + "44" : "#f9f9f9";
              return (
                <div key={i} onClick={() => setOpenTopic(t)} style={{ border: `1.5px solid ${hasContent ? statusColor + "55" : "#eee"}`, borderRadius: 14, padding: "16px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", background: statusBg, transition: "all .15s" }}>
                  <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                    <div style={{ width: 32, height: 32, borderRadius: "50%", background: status === "done" ? G.teal : "#e8e8e8", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: status === "done" ? "#fff" : "#aaa", flexShrink: 0 }}>{i + 1}</div>
                    <div>
                      <div style={{ fontSize: 16, fontWeight: 600, color: "#111", marginBottom: 3 }}>{t}</div>
                      <div style={{ fontSize: 12, color: "#888" }}>{hasContent ? "点击查看公式、步骤与可视化 →" : "内容整理中…"}</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                    {accuracy && accuracy.total > 0 && (
                      <div style={{ textAlign: "right", minWidth: 52 }}>
                        <div style={{ fontSize: 16, fontWeight: 700, color: (accuracy.pct || 0) >= 80 ? G.teal : (accuracy.pct || 0) >= 60 ? G.amber : G.red }}>{accuracy.pct || 0}%</div>
                        <div style={{ fontSize: 11, color: "#aaa" }}>{accuracy.correct || 0}/{accuracy.total}题</div>
                      </div>
                    )}
                    {hasContent && <span style={{ fontSize: 18 }}>📐</span>}
                    <Badge color={status === "done" ? "teal" : status === "doing" ? "amber" : "red"}>{statusLabel}</Badge>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}

// ── Quiz Page ─────────────────────────────────────────────────────────────────
function QuizPage({ setPage, initialQuestion = null, chapterFilter = null, setChapterFilter, onAnswer }) {
  const [questions, setQuestions] = useState([]);
  const [current, setCurrent] = useState(0);
  const [selected, setSelected] = useState(null);
  const [answered, setAnswered] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [loading, setLoading] = useState(true);
  const [score, setScore] = useState(0);
  const [wrongList, setWrongList] = useState([]);
  const [finished, setFinished] = useState(false);
  const [quizMode, setQuizMode] = useState(initialQuestion ? "single" : null);

  useEffect(() => {
    supabase.from("questions").select("*").then(({ data }) => {
      const dbQs = data || [];
      const dbTexts = new Set(dbQs.map(q => q.question));
      const uniqueSamples = ALL_QUESTIONS.filter(q => !dbTexts.has(q.question));
      let pool = [...dbQs, ...uniqueSamples];
      // filter by chapter if set
      if (chapterFilter) {
        const filtered = pool.filter(q => q.chapter && q.chapter.startsWith(chapterFilter));
        pool = filtered.length > 0 ? filtered : pool;
      }
      if (initialQuestion) {
        const rest = pool.filter(q => q.id !== initialQuestion.id).sort(() => Math.random() - 0.5);
        setQuestions([initialQuestion, ...rest.slice(0, 4)]);
      } else {
        setQuestions(pool.sort(() => Math.random() - 0.5));
      }
      setLoading(false);
    });
  }, []);

  if (!quizMode && !loading) return (
    <div style={{ padding: "2rem", maxWidth: 640, margin: "0 auto" }}>
      <Btn size="sm" onClick={() => setPage("首页")} style={{ marginBottom: 20 }}>← 返回</Btn>
      <div style={{ ...s.card, textAlign: "center", padding: "3rem" }}>
        <div style={{ fontSize: 36, marginBottom: 14 }}>✏️</div>
        <div style={{ fontSize: 24, fontWeight: 700, marginBottom: 10, color: "#111" }}>选择练习模式</div>
        {chapterFilter && <div style={{ display: "inline-block", background: G.tealLight, color: G.tealDark, fontSize: 14, fontWeight: 600, padding: "6px 16px", borderRadius: 20, marginBottom: 12 }}>📖 {chapterFilter} 章节题目</div>}
        <div style={{ fontSize: 15, color: "#888", marginBottom: 28 }}>共 {questions.length} 道题目可用{chapterFilter ? `（已筛选 ${chapterFilter} 章节）` : "（全部章节）"}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          {[
            { mode: "daily", icon: "⚡", title: "每日练习", desc: chapterFilter ? `本章随机 5 题` : "随机 5 题，轻松刷题", bg: "#EEF4FF", color: G.blue },
            { mode: "full", icon: "📚", title: chapterFilter ? "章节全练" : "完整练习", desc: chapterFilter ? `${chapterFilter} 全部题目` : "全部题目，系统训练", bg: G.tealLight, color: G.teal },
          ].map(m => (
            <div key={m.mode} onClick={() => setQuizMode(m.mode)} style={{ background: m.bg, border: `2px solid ${m.color}44`, borderRadius: 16, padding: "1.5rem", cursor: "pointer" }}>
              <div style={{ fontSize: 28, marginBottom: 10 }}>{m.icon}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: m.color, marginBottom: 6 }}>{m.title}</div>
              <div style={{ fontSize: 14, color: "#666" }}>{m.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const displayQ = quizMode === "daily" ? questions.slice(0, 5) : questions;
  const q = displayQ[current];
  const opts = q?.options ? (typeof q.options === "string" ? JSON.parse(q.options) : q.options) : null;
  const letters = ["A", "B", "C", "D"];

  const handleSubmit = () => {
    if (selected === null) return;
    setAnswered(true);
    const correct = opts
      ? letters[selected] === q.answer
      : (selected === 0 && q.answer === "正确") || (selected === 1 && q.answer === "错误");
    if (correct) setScore(s => s + 1);
    else setWrongList(w => [...w, q]);
    if (onAnswer && q) onAnswer(q.id || q.question, correct, q.chapter || "Unknown");
  };

  const handleNext = () => {
    if (current >= displayQ.length - 1) { setFinished(true); return; }
    setCurrent(c => c + 1); setSelected(null); setAnswered(false); setShowHint(false);
  };

  if (loading) return <div style={{ padding: "4rem", textAlign: "center", color: "#888", fontSize: 16 }}>加载题目中…</div>;

  if (finished) {
    const pct = Math.round(score / displayQ.length * 100);
    const cwrong = {};
    wrongList.forEach(w => { cwrong[w.chapter] = (cwrong[w.chapter] || 0) + 1; });
    return (
      <div style={{ padding: "2rem", maxWidth: 700, margin: "0 auto" }}>
        <div style={{ ...s.card, padding: "2.5rem" }}>
          <div style={{ textAlign: "center", marginBottom: 28 }}>
            <div style={{ fontSize: 52, marginBottom: 14 }}>{pct >= 80 ? "🎉" : pct >= 60 ? "👍" : "💪"}</div>
            <div style={{ fontSize: 26, fontWeight: 700, color: "#111", marginBottom: 8 }}>练习完成！</div>
            <div style={{ fontSize: 52, fontWeight: 800, color: pct >= 80 ? G.teal : pct >= 60 ? G.amber : G.red, marginBottom: 6 }}>{pct}%</div>
            <div style={{ fontSize: 16, color: "#888", marginBottom: 20 }}>答对 {score} / {displayQ.length} 题</div>
            <ProgressBar value={score} max={displayQ.length} color={pct >= 80 ? G.teal : pct >= 60 ? G.amber : G.red} height={10} />
          </div>
          {wrongList.length > 0 && (
            <div style={{ borderTop: "1px solid #f0f0f0", paddingTop: 20, marginTop: 8 }}>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 14 }}>⚠️ 本次薄弱章节</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 18 }}>
                {Object.entries(cwrong).map(([ch, cnt]) => (
                  <div key={ch} style={{ background: G.redLight, borderRadius: 10, padding: "10px 14px", display: "flex", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 14, color: G.red }}>{ch}</span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: G.red }}>错 {cnt} 题</span>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 14, color: "#888", marginBottom: 14 }}>答错的题目：</div>
              {wrongList.map((w, i) => (
                <div key={i} style={{ padding: "14px 16px", background: "#fafafa", borderRadius: 12, marginBottom: 10, border: "1px solid #f0f0f0" }}>
                  <div style={{ fontSize: 15, color: "#111", marginBottom: 6 }}>{w.question}</div>
                  <div style={{ fontSize: 13, color: G.tealDark }}>✓ 正确答案：{w.answer} · {w.explanation}</div>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 20 }}>
            <Btn onClick={() => { setCurrent(0); setSelected(null); setAnswered(false); setFinished(false); setScore(0); setWrongList([]); setQuizMode(null); }}>再练一次</Btn>
            <Btn variant="primary" onClick={() => setPage("学习报告")}>查看完整报告</Btn>
          </div>
        </div>
      </div>
    );
  }

  if (!q) return null;

  return (
    <div style={{ padding: "2rem", maxWidth: 820, margin: "0 auto" }}>
      {/* Progress header */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
        <Btn size="sm" onClick={() => { setQuizMode(null); setCurrent(0); setScore(0); setWrongList([]); setAnswered(false); setSelected(null); }}>← 返回</Btn>
        <div style={{ ...s.card, flex: 1, padding: "14px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#111" }}>{quizMode === "daily" ? "⚡ 每日练习" : "📚 完整练习"} · 第 {current + 1} / {displayQ.length} 题</div>
            <div style={{ fontSize: 13, color: "#888", marginTop: 2 }}>{q.chapter} · {q.type}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ fontSize: 14, color: "#666" }}>得分 <strong style={{ color: G.teal, fontSize: 18 }}>{score}</strong>/{current}</div>
            <div style={{ width: 120, height: 6, background: "#f0f0f0", borderRadius: 3 }}>
              <div style={{ height: 6, background: G.teal, borderRadius: 3, width: `${((current + 1) / displayQ.length) * 100}%` }} />
            </div>
          </div>
        </div>
      </div>

      {/* Question card */}
      <div style={{ ...s.card, marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
          <Badge color="blue">{q.type}</Badge>
          <Badge color="amber">{q.chapter}</Badge>
        </div>
        <div style={{ fontSize: 18, color: "#111", lineHeight: 1.75, marginBottom: 24, fontWeight: 400 }}>{q.question}</div>

        {opts && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {opts.map((opt, i) => {
              let border = "2px solid #eee", bg = "#fafafa", col = "#333";
              if (answered) {
                if (letters[i] === q.answer) { bg = G.tealLight; border = `2px solid ${G.teal}`; col = G.tealDark; }
                else if (i === selected && letters[i] !== q.answer) { bg = G.redLight; border = `2px solid ${G.red}`; col = G.red; }
              } else if (selected === i) { bg = G.tealLight; border = `2px solid ${G.teal}`; col = G.tealDark; }
              return (
                <div key={i} onClick={() => !answered && setSelected(i)} style={{ padding: "14px 18px", border, borderRadius: 12, cursor: answered ? "default" : "pointer", background: bg, display: "flex", gap: 14, alignItems: "center", transition: "all .15s" }}>
                  <div style={{ width: 30, height: 30, borderRadius: "50%", border: `2px solid ${col}44`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, flexShrink: 0, background: selected === i ? G.teal : "transparent", color: selected === i ? "#fff" : col }}>{letters[i]}</div>
                  <span style={{ fontSize: 15, color: col }}>{opt}</span>
                  {answered && letters[i] === q.answer && <span style={{ marginLeft: "auto", color: G.teal, fontSize: 18 }}>✓</span>}
                </div>
              );
            })}
          </div>
        )}

        {!opts && q.type === "判断题" && (
          <div style={{ display: "flex", gap: 12 }}>
            {["正确", "错误"].map((opt, i) => {
              let border = "2px solid #eee", bg = "#fafafa";
              if (answered) {
                if (opt === q.answer) { bg = G.tealLight; border = `2px solid ${G.teal}`; }
                else if (i === selected && opt !== q.answer) { bg = G.redLight; border = `2px solid ${G.red}`; }
              } else if (selected === i) { bg = G.tealLight; border = `2px solid ${G.teal}`; }
              return (
                <div key={i} onClick={() => !answered && setSelected(i)} style={{ flex: 1, padding: "16px 0", border, borderRadius: 12, cursor: answered ? "default" : "pointer", background: bg, textAlign: "center", fontSize: 17, fontWeight: 600, color: "#333" }}>{opt}</div>
              );
            })}
          </div>
        )}
      </div>

      {/* Hint */}
      {(showHint || answered) && (
        <div style={{ ...s.card, marginBottom: 14, background: "#fafffe", borderLeft: `4px solid ${G.teal}` }}>
          <div style={{ display: "flex", gap: 14 }}>
            <div style={{ width: 34, height: 34, borderRadius: "50%", background: G.teal, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <span style={{ color: "#fff", fontSize: 12, fontWeight: 700 }}>AI</span>
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#111", marginBottom: 6 }}>{answered ? `正确答案：${q.answer}` : "解题提示"}</div>
              <div style={{ fontSize: 15, color: "#444", lineHeight: 1.7 }}>{q.explanation}</div>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <Btn onClick={() => { if (current > 0) { setCurrent(c => c - 1); setSelected(null); setAnswered(false); setShowHint(false); } }}>← 上一题</Btn>
        <div style={{ display: "flex", gap: 10 }}>
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
        {flipped && <Btn variant="primary" onClick={() => { setKnown(k => new Set([...k, card.front])); if (idx < filtered.length - 1) { setIdx(i => i + 1); setFlipped(false); } }}>✓ 已掌握</Btn>}
        {!flipped && <Btn onClick={() => { setIdx(i => Math.min(filtered.length - 1, i + 1)); setFlipped(false); }}>下一张 →</Btn>}
      </div>
    </div>
  );
}

// ── Report Page ───────────────────────────────────────────────────────────────
function ReportPage({ setPage }) {
  const stats = [
    { name: "Ch.1 方程求解", correct: 7, total: 10 },
    { name: "Ch.2 线性方程组", correct: 6, total: 10 },
    { name: "Ch.3 插值", correct: 4, total: 10 },
    { name: "Ch.4 最小二乘", correct: 3, total: 8 },
    { name: "Ch.5 数值微积分", correct: 5, total: 8 },
    { name: "最优化 Ch.1", correct: 5, total: 10 },
  ];
  const tc = stats.reduce((a, c) => a + c.correct, 0);
  const tq = stats.reduce((a, c) => a + c.total, 0);
  const pct = Math.round(tc / tq * 100);
  const weak = [...stats].sort((a, b) => (a.correct / a.total) - (b.correct / b.total)).slice(0, 3);

  return (
    <div style={{ padding: "2rem", maxWidth: 960, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 24 }}>
        <Btn size="sm" onClick={() => setPage("首页")}>← 返回</Btn>
        <div style={{ fontSize: 22, fontWeight: 700, color: "#111" }}>学习报告</div>
        <div style={{ marginLeft: "auto" }}>
          <Btn size="sm" onClick={() => { if (window.confirm("确定重置本地答题记录？")) { localStorage.removeItem("mc_answers"); window.location.reload(); } }}>重置记录</Btn>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 24 }}>
        <StatCard icon="🎯" label="总体正确率" value={`${pct}%`} sub={`${tc}/${tq} 题`} color={pct >= 80 ? G.teal : pct >= 60 ? G.amber : G.red} />
        <StatCard icon="📖" label="已练习章节" value={stats.length} sub="共 12 章" color={G.blue} />
        <StatCard icon="✏️" label="答题总数" value={tq} sub="累计" color={G.amber} />
        <StatCard icon="🃏" label="记忆卡片" value={`${Math.round(FLASHCARDS.length * 0.4)}/${FLASHCARDS.length}`} sub="已掌握" color={G.purple} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div style={{ ...s.card }}>
          <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 18, paddingBottom: 14, borderBottom: "1px solid #f0f0f0" }}>各章节正确率</div>
          {stats.map((c, i) => {
            const p = Math.round(c.correct / c.total * 100);
            const col = p >= 80 ? G.teal : p >= 60 ? G.amber : G.red;
            return (
              <div key={i} style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ fontSize: 14, color: "#333" }}>{c.name}</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: col }}>{p}%</span>
                </div>
                <ProgressBar value={c.correct} max={c.total} color={col} height={8} />
              </div>
            );
          })}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ ...s.card }}>
            <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 14, paddingBottom: 12, borderBottom: "1px solid #f0f0f0" }}>⚠️ 薄弱章节</div>
            {weak.map((c, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: i < weak.length - 1 ? "1px solid #f5f5f5" : "none" }}>
                <span style={{ fontSize: 15, color: "#333" }}>{c.name}</span>
                <div style={{ display: "flex", gap: 10 }}>
                  <Badge color="red">{Math.round(c.correct / c.total * 100)}%</Badge>
                  <Btn size="sm" onClick={() => { if (setChapterFilter) setChapterFilter(c.name.split(" ")[0]); setPage("题库练习"); }}>练习</Btn>
                </div>
              </div>
            ))}
          </div>

          <div style={{ ...s.card }}>
            <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 14, paddingBottom: 12, borderBottom: "1px solid #f0f0f0" }}>📅 近期活动</div>
            {[
              { day: "今天", action: "每日练习 · 5题", score: "4/5", good: false },
              { day: "昨天", action: "Ch.2 线性方程组", score: "6/10", good: true },
              { day: "3天前", action: "Ch.1 方程求解", score: "7/10", good: true },
            ].map((a, i) => (
              <div key={i} style={{ display: "flex", gap: 12, padding: "10px 0", borderBottom: i < 2 ? "1px solid #f5f5f5" : "none" }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: a.good ? G.teal : G.amber, marginTop: 6, flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, color: "#aaa" }}>{a.day}</div>
                  <div style={{ fontSize: 15, color: "#333" }}>{a.action}</div>
                </div>
                <Badge color={a.good ? "teal" : "amber"}>{a.score}</Badge>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Wrong Page ────────────────────────────────────────────────────────────────
function WrongPage({ setPage, setRetryQuestion }) {
  const wrongs = [
    { q: ALL_QUESTIONS.find(q => q.id === "4"), label: "Newton法对任意初始值都能收敛" },
    { q: ALL_QUESTIONS.find(q => q.id === "11"), label: "Runge 现象" },
    { q: ALL_QUESTIONS.find(q => q.id === "7"), label: "LU 分解存在性" },
    { q: ALL_QUESTIONS.find(q => q.id === "26"), label: "非线性规划全局最优" },
  ].filter(w => w.q);

  return (
    <div style={{ padding: "2rem", maxWidth: 820, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 24 }}>
        <Btn size="sm" onClick={() => setPage("首页")}>← 返回</Btn>
        <div style={{ fontSize: 22, fontWeight: 700, color: "#111" }}>错题本</div>
        <Badge color="red">{wrongs.length} 题</Badge>
      </div>

      <div style={{ ...s.card }}>
        {wrongs.map((w, i) => (
          <div key={i} style={{ padding: "18px 0", borderBottom: i < wrongs.length - 1 ? "1px solid #f5f5f5" : "none" }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: G.red, marginTop: 6, flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 16, color: "#111", marginBottom: 6, fontWeight: 400 }}>{w.q.question}</div>
                <div style={{ fontSize: 14, color: G.tealDark, marginBottom: 6 }}>
                  ✓ 正确答案：{w.q.answer}
                </div>
                <div style={{ fontSize: 13, color: "#999" }}>{w.q.chapter} · {w.q.type}</div>
              </div>
              <button
                onClick={() => { setRetryQuestion(w.q); setPage("题库练习"); }}
                style={{ padding: "9px 18px", background: G.teal, color: "#fff", border: "none", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 600, fontFamily: "inherit", flexShrink: 0 }}
              >重做此题</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}


// ── Materials Library Page ─────────────────────────────────────────────────────
function MaterialsPage({ setPage, profile }) {
  const [materials, setMaterials] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [note, setNote] = useState("");
  const [noteSaved, setNoteSaved] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [filter, setFilter] = useState("全部");

  useEffect(() => {
    supabase.from("materials").select("*").order("created_at", { ascending: false }).then(({ data }) => {
      setMaterials(data || []);
      setLoading(false);
    });
  }, []);

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
  const filtered = filter === "全部" ? materials : materials.filter(m => m.course === filter);

  if (selected) return (
    <div style={{ padding: "2rem", maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
        <Btn size="sm" onClick={() => setSelected(null)}>← 返回资料库</Btn>
        <div style={{ fontSize: 20, fontWeight: 700, color: "#111" }}>{selected.title}</div>
        <Badge color={selected.course === "数值分析" ? "teal" : "blue"}>{selected.course}</Badge>
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
              <div>上传者：{selected.uploader_name || "教师"}</div>
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
              placeholder="在此记录学习笔记、重点、疑问…"
              style={{ width: "100%", minHeight: 260, fontSize: 14, padding: "12px", border: "1.5px solid #e0e0e0", borderRadius: 10, fontFamily: "inherit", resize: "vertical", color: "#111", lineHeight: 1.7, boxSizing: "border-box" }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
              <span style={{ fontSize: 12, color: "#aaa" }}>{note.length} 字</span>
              <button onClick={saveNote} disabled={savingNote || !note.trim()} style={{ padding: "9px 20px", background: noteSaved ? G.tealLight : G.teal, color: noteSaved ? G.tealDark : "#fff", border: "none", borderRadius: 10, cursor: savingNote ? "not-allowed" : "pointer", fontSize: 14, fontWeight: 600, fontFamily: "inherit" }}>
                {noteSaved ? "✓ 已保存" : savingNote ? "保存中…" : "保存笔记"}
              </button>
            </div>
          </div>

          <Btn variant="primary" onClick={() => setPage("题库练习")}>做相关练习题 →</Btn>
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
        {profile?.role === "teacher" && <Btn variant="primary" onClick={() => setPage("教师管理")}>上传新教材 +</Btn>}
      </div>

      {/* Filter */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        {courses.map(c => (
          <button key={c} onClick={() => setFilter(c)} style={{ fontSize: 14, padding: "8px 18px", borderRadius: 20, border: "2px solid " + (filter === c ? G.teal : "#e0e0e0"), cursor: "pointer", fontFamily: "inherit", fontWeight: filter === c ? 700 : 400, background: filter === c ? G.teal : "#fff", color: filter === c ? "#fff" : "#666" }}>{c}</button>
        ))}
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
          <div key={m.id} onClick={() => setSelected(m)} style={{ ...s.card, cursor: "pointer", transition: "transform .15s, box-shadow .15s", borderTop: `4px solid ${m.course === "数值分析" ? G.teal : G.blue}` }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>📄</div>
            <div style={{ fontSize: 17, fontWeight: 700, color: "#111", marginBottom: 6 }}>{m.title}</div>
            {m.description && <div style={{ fontSize: 14, color: "#666", marginBottom: 10, lineHeight: 1.6, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{m.description}</div>}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
              <Badge color={m.course === "数值分析" ? "teal" : "blue"}>{m.course}</Badge>
              {m.chapter && <Badge color="amber">{m.chapter}</Badge>}
            </div>
            <div style={{ fontSize: 12, color: "#aaa", borderTop: "1px solid #f5f5f5", paddingTop: 10, display: "flex", justifyContent: "space-between" }}>
              <span>{m.uploader_name || "教师"} 上传</span>
              <span>{new Date(m.created_at).toLocaleDateString("zh-CN")}</span>
            </div>
          </div>
        ))}
      </div>
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

  useEffect(() => {
    supabase.from("questions").select("*").order("created_at", { ascending: false }).then(({ data }) => { if (data) setDbQuestions(data); });
    supabase.from("materials").select("*").order("created_at", { ascending: false }).then(({ data }) => { if (data) setUploadedMaterials(data); });
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
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: pdfText, course: matCourse, chapter: matChapter, count: 5 }),
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
        {["学生管理", "上传教材", "AI 出题", "题库管理"].map(t => (
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

      {tab === "上传教材" && (
        <div style={{ ...s.card }}>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>上传教材 PDF</div>
          <div style={{ fontSize: 15, color: "#888", marginBottom: 20 }}>上传后 AI 自动提取知识点并生成题目，所有学生均可在资料库查看</div>

          {/* Upload form */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 13, color: "#666", marginBottom: 5, fontWeight: 500 }}>资料标题 *</div>
              <input value={matTitle} onChange={e => setMatTitle(e.target.value)} placeholder="例：数值分析第三章讲义" style={{ ...s.input }} />
            </div>
            <div>
              <div style={{ fontSize: 13, color: "#666", marginBottom: 5, fontWeight: 500 }}>课程</div>
              <select value={matCourse} onChange={e => setMatCourse(e.target.value)} style={{ width: "100%", fontSize: 14, padding: "11px 12px", border: "1.5px solid #e0e0e0", borderRadius: 10, fontFamily: "inherit", background: "#fff" }}>
                <option>数值分析</option>
                <option>最优化</option>
              </select>
            </div>
            <div>
              <div style={{ fontSize: 13, color: "#666", marginBottom: 5, fontWeight: 500 }}>章节</div>
              <input value={matChapter} onChange={e => setMatChapter(e.target.value)} placeholder="例：Ch.3 插值" style={{ ...s.input }} />
            </div>
            <div>
              <div style={{ fontSize: 13, color: "#666", marginBottom: 5, fontWeight: 500 }}>简介（可选）</div>
              <input value={matDesc} onChange={e => setMatDesc(e.target.value)} placeholder="本资料涵盖…" style={{ ...s.input }} />
            </div>
          </div>

          <div onDrop={handlePdfDrop} onDragOver={e => e.preventDefault()} onClick={() => pdfRef.current?.click()} style={{ border: "2px dashed " + (matFile ? G.teal : "#ddd"), borderRadius: 16, padding: "2.5rem", textAlign: "center", cursor: "pointer", marginBottom: 16, background: matFile ? G.tealLight : "#fafafa" }}>
            <input ref={pdfRef} type="file" accept=".pdf" style={{ display: "none" }} onChange={e => { const f = e.target.files[0]; if (f) setMatFile(f); }} />
            <div style={{ fontSize: 36, marginBottom: 10 }}>{matFile ? "✅" : "📂"}</div>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4, color: matFile ? G.tealDark : "#333" }}>{matFile ? matFile.name : "点击选择 PDF 文件"}</div>
            <div style={{ fontSize: 13, color: "#aaa" }}>{matFile ? (matFile.size / 1024).toFixed(0) + " KB" : "仅支持 PDF 格式"}</div>
          </div>

          {matError && <div style={{ padding: "12px 16px", background: G.redLight, color: G.red, borderRadius: 10, fontSize: 14, marginBottom: 14 }}>{matError}</div>}
          {matSuccess && <div style={{ padding: "12px 16px", background: G.tealLight, color: G.tealDark, borderRadius: 10, fontSize: 14, marginBottom: 14 }}>{matSuccess}</div>}

          {extracting && (
            <div style={{ padding: "20px", background: "#fafafa", borderRadius: 12, marginBottom: 14, textAlign: "center" }}>
              <div style={{ fontSize: 24, marginBottom: 8 }}>⏳</div>
              <div style={{ fontSize: 15, color: "#666" }}>{extractStep}</div>
            </div>
          )}

          {extractResult && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12, color: G.tealDark }}>✅ AI 提取结果</div>
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 13, color: "#888", marginBottom: 8, fontWeight: 500 }}>提取到的知识点：</div>
                {extractResult.topics?.map((t, i) => (
                  <div key={i} style={{ padding: "8px 14px", background: G.tealLight, borderRadius: 8, marginBottom: 6, fontSize: 14, color: G.tealDark }}>
                    <strong>{t.name}</strong>：{t.summary}
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 13, color: "#888", marginBottom: 8, fontWeight: 500 }}>生成了 {extractResult.questions?.length || 0} 道题目（将自动保存到题库）</div>
            </div>
          )}

          <button disabled={extracting || !matFile || !matTitle} onClick={handleUploadAndExtract} style={{ width: "100%", padding: "14px 0", fontSize: 16, fontWeight: 700, fontFamily: "inherit", background: extracting || !matFile || !matTitle ? "#ccc" : G.teal, color: "#fff", border: "none", borderRadius: 12, cursor: extracting || !matFile || !matTitle ? "not-allowed" : "pointer" }}>
            {extracting ? extractStep : "📤 上传教材并 AI 出题"}
          </button>

          {/* Existing materials */}
          {uploadedMaterials.length > 0 && (
            <div style={{ marginTop: 20, borderTop: "1px solid #f0f0f0", paddingTop: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#888", marginBottom: 12 }}>已上传的资料</div>
              {uploadedMaterials.map((m, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 0", borderBottom: "1px solid #f5f5f5" }}>
                  <span style={{ fontSize: 20 }}>📄</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 15, fontWeight: 500 }}>{m.title}</div>
                    <div style={{ fontSize: 12, color: "#aaa" }}>{m.file_name} · {m.file_size}</div>
                  </div>
                  <Badge color="teal">已发布</Badge>
                  <Btn size="sm" onClick={async () => { await supabase.from("materials").delete().eq("id", m.id); setUploadedMaterials(prev => prev.filter(x => x.id !== m.id)); }}>删除</Btn>
                </div>
              ))}
            </div>
          )}
        </div>
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
            <Badge color="blue">共 {dbQuestions.length} 题</Badge>
          </div>
          {dbQuestions.length === 0 && <div style={{ textAlign: "center", padding: "3rem", color: "#aaa", fontSize: 16 }}>📝 暂无题目，请先用 AI 出题</div>}
          {dbQuestions.map((q, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 0", borderBottom: "1px solid #f5f5f5" }}>
              <Badge color="amber">{q.chapter}</Badge>
              <div style={{ flex: 1, fontSize: 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{q.question}</div>
              <Badge color="blue">{q.type}</Badge>
              <Btn size="sm" onClick={() => deleteQuestion(q.id)}>删除</Btn>
            </div>
          ))}
        </div>
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
  const [retryQuestion, setRetryQuestion] = useState(null);
  const [chapterFilter, setChapterFilter] = useState(null);
  const [sessionAnswers, setSessionAnswers] = useState({});

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

  if (!session) return <AuthPage />;

  const renderPage = () => {
    if (page === "首页") return <HomePage setPage={handleSetPage} profile={profile} />;
    if (page === "资料库") return <MaterialsPage setPage={handleSetPage} profile={profile} />;
    if (page === "知识点") return <KnowledgePage setPage={handleSetPage} setChapterFilter={setChapterFilter} sessionAnswers={sessionAnswers} />;
    if (page === "题库练习") return <QuizPage setPage={handleSetPage} initialQuestion={retryQuestion} chapterFilter={chapterFilter} setChapterFilter={setChapterFilter} onAnswer={(qid, correct, chapter) => { try { const updated = { ...sessionAnswers, [qid]: { correct, chapter } }; setSessionAnswers(updated); } catch(e) {} }} />;
    if (page === "记忆卡片") return <FlashcardPage setPage={handleSetPage} />;
    if (page === "学习报告") return <ReportPage setPage={handleSetPage} />;
    if (page === "错题本") return <WrongPage setPage={handleSetPage} setRetryQuestion={setRetryQuestion} />;
    if (page === "教师管理") return <TeacherPage setPage={handleSetPage} />;
    return null;
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f8f9fb" }}>
      <TopNav page={page} setPage={handleSetPage} profile={profile} onLogout={handleLogout} />
      {renderPage()}
    </div>
  );
}