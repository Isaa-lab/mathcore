/**
 * seed.js  —  为 MathCore 数据库插入教材记录和高质量题目
 * 运行: node seed.js
 */
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  "https://kadjwgslbpklwbpvpsze.supabase.co",
  "sb_publishable_TvfRCNQCSs92EmZ02J5H1A_yM3FrFUp"
);

// ── Materials ────────────────────────────────────────────────────────────────
const MATERIALS = [
  {
    title: "An Introduction to Mathematical Statistics (Bijma, 2016)",
    course: "数理统计",
    chapter: "全部",
    file_name: "Fetsje Bijma_An introduction to Mathematical Statistics 2016.pdf",
    file_size: 0,
    file_data: null,
    uploader_name: "教师",
    description: "Fetsje Bijma 著，涵盖参数估计、假设检验、线性模型等数理统计核心内容，2016年版。",
  },
  {
    title: "Linear Algebra with Applications (Steven J. Leon, 9th Ed.)",
    course: "线性代数",
    chapter: "全部",
    file_name: "Linear Algebra with Applications (Steven J_ Leon) 9th.pdf",
    file_size: 0,
    file_data: null,
    uploader_name: "教师",
    description: "Steven J. Leon 著第9版，系统讲授矩阵代数、向量空间、特征值与 SVD 等线性代数基础。",
  },
  {
    title: "常微分方程讲义 (ODE 2025)",
    course: "ODE",
    chapter: "全部",
    file_name: "ODE2025-9.25.pdf",
    file_size: 0,
    file_data: null,
    uploader_name: "教师",
    description: "2025年秋季 ODE 课程讲义，涵盖一阶方程、高阶线性方程、Laplace 变换与方程组稳定性。",
  },
  {
    title: "概率论教材 (Probability Theory)",
    course: "概率论",
    chapter: "全部",
    file_name: "Probability_Theory.pdf",
    file_size: 0,
    file_data: null,
    uploader_name: "教师",
    description: "概率论系统教材，涵盖概率公理、随机变量、期望方差、大数定律与中心极限定理。",
  },
];

// ── Questions per course ─────────────────────────────────────────────────────
const DB_QUESTIONS = [
  // 线性代数
  { chapter: "线性代数 Ch.1", course: "线性代数", type: "单选题", question: "若矩阵 A 的秩为 r，则 n 元齐次方程组 Ax=0 的解空间维数为：", options: ["r","n-r","m-r（m为行数）","n"], answer: "B", explanation: "由秩-零化度定理，nullity(A)=n-rank(A)=n-r。" },
  { chapter: "线性代数 Ch.1", course: "线性代数", type: "判断题", question: "若线性方程组 Ax=b 有两个不同的解，则它一定有无穷多个解。", options: null, answer: "正确", explanation: "两解之差是 Ax=0 的非零解，零空间非平凡，故解有无穷多。" },
  { chapter: "线性代数 Ch.2", course: "线性代数", type: "单选题", question: "n 阶方阵 A 可逆的充要条件是：", options: ["A 的所有元素非零","det(A)≠0","A 的所有特征值为正","A 是对称矩阵"], answer: "B", explanation: "A 可逆 ⟺ det(A)≠0，这是可逆性的基本充要条件。" },
  { chapter: "线性代数 Ch.2", course: "线性代数", type: "单选题", question: "det(kA) 与 det(A) 的关系（A 为 n×n）：", options: ["k·det(A)","k²·det(A)","kⁿ·det(A)","det(A)/k"], answer: "C", explanation: "每行提出公因子 k，共 n 行，故 det(kA)=kⁿdet(A)。" },
  { chapter: "线性代数 Ch.3", course: "线性代数", type: "单选题", question: "向量空间中，基的两个关键性质是：", options: ["正交且单位化","线性无关且张成整个空间","有限个且非零","对称且正定"], answer: "B", explanation: "基 = 线性无关 + 张成（Span）整个向量空间，二者缺一不可。" },
  { chapter: "线性代数 Ch.4", course: "线性代数", type: "单选题", question: "Gram-Schmidt 正交化将线性无关向量组变换为：", options: ["特征向量组","标准正交基","LU 分解","Hermite 矩阵"], answer: "B", explanation: "Gram-Schmidt 逐步消去各方向投影，最后单位化，得到标准正交基（ONB）。" },
  { chapter: "线性代数 Ch.5", course: "线性代数", type: "单选题", question: "实对称矩阵的特征值：", options: ["必须为正数","必须为实数","必须互不相同","必须为整数"], answer: "B", explanation: "谱定理：实对称矩阵特征值全为实数，不同特征值对应特征向量正交。" },
  { chapter: "线性代数 Ch.5", course: "线性代数", type: "单选题", question: "矩阵 A 的奇异值（SVD 中的 σᵢ）等于：", options: ["A 的特征值","AᵀA 特征值的平方根","A 的行列式","A 的迹"], answer: "B", explanation: "SVD：σᵢ=√λᵢ(AᵀA)，奇异值始终非负。" },
  { chapter: "线性代数 Ch.4", course: "线性代数", type: "判断题", question: "若 A 为 m×n 矩阵（m>n），则 AᵀA 一定是可逆矩阵。", options: null, answer: "错误", explanation: "AᵀA 可逆当且仅当 A 的列向量线性无关。若存在线性相关，AᵀA 奇异。" },
  { chapter: "线性代数 Ch.5", course: "线性代数", type: "判断题", question: "若 n 阶矩阵有 n 个不同特征值，则一定可以对角化。", options: null, answer: "正确", explanation: "不同特征值对应线性无关特征向量，n 个不同特征值 → n 个线性无关向量 → 可对角化。" },

  // 概率论
  { chapter: "概率论 Ch.1", course: "概率论", type: "单选题", question: "若 A 与 B 独立，则以下必然成立：", options: ["A 与 B 互斥","P(A∩B)=P(A)P(B)","P(A|B)=P(B|A)","P(A∪B)=1"], answer: "B", explanation: "独立性定义：P(A∩B)=P(A)P(B)，独立与互斥是不同概念。" },
  { chapter: "概率论 Ch.1", course: "概率论", type: "单选题", question: "全概率公式要求 {Bᵢ} 满足：", options: ["互斥","互斥且穷举（样本空间划分）","独立","等概率"], answer: "B", explanation: "{Bᵢ} 必须两两互斥且并集为 Ω，才能确保每种情况恰好被计算一次。" },
  { chapter: "概率论 Ch.2", course: "概率论", type: "单选题", question: "X~N(μ,σ²)，则 P(μ-2σ<X<μ+2σ) 约为：", options: ["68%","95%","99.7%","50%"], answer: "B", explanation: "正态分布 68-95-99.7 法则：±1σ≈68%，±2σ≈95%，±3σ≈99.7%。" },
  { chapter: "概率论 Ch.2", course: "概率论", type: "单选题", question: "X~Poisson(λ) 中，E[X] 和 Var(X) 分别为：", options: ["λ 和 λ²","λ 和 λ","λ² 和 λ","1/λ 和 1/λ²"], answer: "B", explanation: "Poisson 分布均值和方差均等于参数 λ。" },
  { chapter: "概率论 Ch.3", course: "概率论", type: "单选题", question: "若 X,Y 独立，则 Var(X+Y)=：", options: ["Var(X)+Var(Y)+2Cov(X,Y)","Var(X)+Var(Y)","Var(X)·Var(Y)","Var(X)-Var(Y)"], answer: "B", explanation: "独立时 Cov(X,Y)=0，所以 Var(X+Y)=Var(X)+Var(Y)。" },
  { chapter: "概率论 Ch.4", course: "概率论", type: "单选题", question: "CLT 标准化后，样本均值近似服从：", options: ["t 分布","χ² 分布","N(0,1)","均匀分布"], answer: "C", explanation: "(X̄-μ)/(σ/√n) 依分布收敛到 N(0,1)，是大样本推断基础。" },
  { chapter: "概率论 Ch.2", course: "概率论", type: "判断题", question: "指数分布具有无记忆性：P(X>s+t|X>s)=P(X>t)。", options: null, answer: "正确", explanation: "指数分布是连续分布中唯一具有无记忆性的分布。" },
  { chapter: "概率论 Ch.4", course: "概率论", type: "判断题", question: "弱大数定律说明：X̄ₙ 依概率收敛到 E[X]。", options: null, answer: "正确", explanation: "Khinchin 弱大数定律：i.i.d. 且 E[X]=μ < ∞，则 X̄ₙ →ᴾ μ。" },

  // 数理统计
  { chapter: "数理统计 Ch.1", course: "数理统计", type: "单选题", question: "正态总体样本方差 S² 满足：(n-1)S²/σ² 服从什么分布？", options: ["N(0,1)","t(n-1)","χ²(n-1)","F(1,n-1)"], answer: "C", explanation: "(n-1)S²/σ² ~ χ²(n-1)，这是正态总体的基本抽样定理。" },
  { chapter: "数理统计 Ch.1", course: "数理统计", type: "单选题", question: "t 分布与标准正态分布相比，t 分布的尾部：", options: ["更细","相同","更厚（重尾）","没有尾部"], answer: "C", explanation: "t(n) 有更厚的尾部，自由度 n→∞ 时趋向 N(0,1)。" },
  { chapter: "数理统计 Ch.2", course: "数理统计", type: "单选题", question: "无偏估计量 θ̂ 的定义是：", options: ["θ̂=θ 总成立","E[θ̂]=θ","θ̂ 方差最小","θ̂ 是样本函数"], answer: "B", explanation: "无偏性：E[θ̂]=θ，期望等于真实参数，无系统偏差。" },
  { chapter: "数理统计 Ch.2", course: "数理统计", type: "单选题", question: "正态总体 N(μ,σ²) 中，μ 的 MLE 是：", options: ["中位数","众数","样本均值 X̄","样本方差 S²"], answer: "C", explanation: "对正态分布对数似然求导置零，得 μ̂_MLE=X̄。" },
  { chapter: "数理统计 Ch.2", course: "数理统计", type: "单选题", question: "95% 置信区间的正确解释是：", options: ["θ 有 95% 概率在区间内","该方法重复构造时约 95% 的区间包含 θ","区间内有 95% 的观测值","拒绝 H₀ 的概率 95%"], answer: "B", explanation: "频率解释：θ 固定，区间随机；重复抽样构造的区间有 95% 覆盖 θ。" },
  { chapter: "数理统计 Ch.3", course: "数理统计", type: "单选题", question: "p 值的含义是：", options: ["H₀ 为真的概率","显著性水平 α","在 H₀ 下观测到至少如此极端结果的概率","H₁ 为真的概率"], answer: "C", explanation: "p=P(|T|≥t_obs|H₀)，p<α 则拒绝 H₀。" },
  { chapter: "数理统计 Ch.3", course: "数理统计", type: "判断题", question: "不拒绝 H₀ 意味着 H₀ 一定为真。", options: null, answer: "错误", explanation: "不拒绝 H₀ 只是样本证据不足以拒绝，并不证明 H₀ 为真。" },
  { chapter: "数理统计 Ch.3", course: "数理统计", type: "判断题", question: "增大显著性水平 α 会降低第二类错误概率 β。", options: null, answer: "正确", explanation: "α 增大则拒绝域扩大，β 减小；二者此消彼长。" },

  // ODE
  { chapter: "ODE Ch.1", course: "ODE", type: "单选题", question: "一阶线性 ODE y'+P(x)y=Q(x) 的积分因子为：", options: ["e^{∫P dx}","e^{-∫P dx}","∫P dx","P(x)"], answer: "A", explanation: "μ=e^{∫P dx}，乘后方程左边化为 (μy)'=μQ，可直接积分。" },
  { chapter: "ODE Ch.1", course: "ODE", type: "单选题", question: "初值问题 y'=y²，y(0)=1 的解存在于区间：", options: ["(-∞,+∞)","(-∞,1)","(0,+∞)","仅在 x=0"], answer: "B", explanation: "解 y=1/(1-x) 在 x=1 处爆破，仅在 x<1 时存在。" },
  { chapter: "ODE Ch.2", course: "ODE", type: "单选题", question: "特征根为二重根 r=2 时，y''-4y'+4y=0 的通解为：", options: ["C₁e^{2x}+C₂e^{-2x}","(C₁+C₂x)e^{2x}","C₁cos2x+C₂sin2x","C₁e^{4x}"], answer: "B", explanation: "二重特征根 r：通解为 (C₁+C₂x)e^{rx}。" },
  { chapter: "ODE Ch.2", course: "ODE", type: "单选题", question: "复特征根 α±βi 对应的两个实值线性无关解是：", options: ["e^{αx} 和 e^{βx}","e^{αx}cosβx 和 e^{αx}sinβx","cosαx 和 sinβx","e^{iβx}"], answer: "B", explanation: "由 Euler 公式：e^{(α+iβ)x}=e^{αx}(cosβx+isinβx)，实部虚部各得一解。" },
  { chapter: "ODE Ch.3", course: "ODE", type: "单选题", question: "L{e^{at}} = ？（Laplace 变换）", options: ["1/(s+a)","1/(s-a)","a/(s²+a²)","s/(s²+a²)"], answer: "B", explanation: "∫₀^∞ e^{-st}e^{at}dt=1/(s-a)，要求 s>a。" },
  { chapter: "ODE Ch.3", course: "ODE", type: "单选题", question: "用 Laplace 变换法，L{y''} = ？（y 有初始条件）", options: ["s²Y(s)","sY(s)-y(0)","s²Y(s)-sy(0)-y'(0)","s²Y(s)-y(0)"], answer: "C", explanation: "L{y''}=s²Y-sy(0)-y'(0)，初始条件自动代入。" },
  { chapter: "ODE Ch.4", course: "ODE", type: "判断题", question: "线性系统 x'=Ax 的矩阵 A 所有特征值实部均为负，则原点渐近稳定。", options: null, answer: "正确", explanation: "Re(λᵢ)<0 保证所有基本解 e^{λᵢt}→0，即原点是渐近稳定平衡点。" },
  { chapter: "ODE Ch.1", course: "ODE", type: "判断题", question: "可分离方程 dy/dx=f(x)g(y) 在 g(y₀)=0 处，y≡y₀ 是一个常数解。", options: null, answer: "正确", explanation: "代入验证：dy/dx=0=f(x)·0 恒成立，所以 y=y₀ 是奇解（常数解）。" },
];

async function seed() {
  console.log("🌱 开始写入教材记录...");

  // Insert materials
  const matResults = [];
  for (const m of MATERIALS) {
    const { data, error } = await supabase
      .from("materials")
      .insert([m])
      .select()
      .single();
    if (error) {
      console.error(`  ✗ ${m.title.slice(0, 40)}:`, error.message);
    } else {
      console.log(`  ✓ 教材入库: ${m.title.slice(0, 50)}`);
      matResults.push({ material: data, course: m.course });
    }
  }

  console.log(`\n📝 写入题目 (${DB_QUESTIONS.length} 道)...`);

  // Build material_id lookup by course
  const courseToMatId = {};
  matResults.forEach(({ material, course }) => {
    courseToMatId[course] = material.id;
  });

  // Insert questions with material_id when available
  const rows = DB_QUESTIONS.map(q => ({
    chapter: q.chapter,
    course: q.course,
    type: q.type,
    question: q.question,
    options: q.options,
    answer: q.answer,
    explanation: q.explanation,
    ...(courseToMatId[q.course] ? { material_id: courseToMatId[q.course] } : {}),
  }));

  const { error: qErr } = await supabase.from("questions").insert(rows);
  if (qErr) {
    // Try without material_id (in case column doesn't exist)
    const rowsNoMat = rows.map(({ material_id, ...r }) => r);
    const { error: qErr2 } = await supabase.from("questions").insert(rowsNoMat);
    if (qErr2) {
      console.error("  ✗ 题目写入失败:", qErr2.message);
    } else {
      console.log(`  ✓ ${rowsNoMat.length} 道题目写入成功（无 material_id）`);
    }
  } else {
    console.log(`  ✓ ${rows.length} 道题目写入成功`);
  }

  console.log("\n✅ Seed 完成！");
  process.exit(0);
}

seed().catch(e => { console.error(e); process.exit(1); });
