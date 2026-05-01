# 教材细化思路 · 知识点 / 知识树 / 题库

> 适用对象：当前剩下的唯一一本教材  
> *An Introduction to Mathematical Statistics* (Bijma, 2016)，  
> 以及之后再上传的任何一本（例如 `Numerical Analysis, 2nd Edition, Timothy Sauer.pdf`）。

---

## 一句话立场

> 之前的抽取目标是"**有内容就行**"，  
> 现在的抽取目标是"**像一本带答案的考前手册**"。

旧版每章只抽 3~5 个粗粒度知识点；新版每个 **PDF 片段** 就要抽 8~14 个细粒度知识点，且每个节点都要带依赖、类型、来源锚点。这是教材沙盒能做"刻意练习"和"知识树推荐"的前提。

---

## 1. 细化知识点 —— 怎么"细"？

### 1.1 三个维度同时拆

每个知识点 **必须** 在以下三个维度都有定位：

| 维度 | 字段 | 取值 | 起的作用 |
|---|---|---|---|
| **类型** | `kind` | `definition` / `theorem` / `method` / `formula` / `example` / `pitfall` | 决定卡片图标与颜色 |
| **层级** | `depth` | 1 = 基础概念 / 2 = 方法技法 / 3 = 综合应用 | 决定在知识树上的纵向位置 |
| **依赖** | `prerequisites` | 其他 topic 的 name 数组 | 决定知识树上的边 |

> 举例（数值分析 · Sauer 第 2 章 LU 分解）：
> - 旧版只会抽：「LU 分解」一个粗节点。
> - 新版会拆成：
>   - `definition` / depth=1 「上三角矩阵 / 下三角矩阵」
>   - `definition` / depth=1 「主元（pivot）的定义」
>   - `theorem` / depth=2 「LU 存在性定理（无 0 主元前提）」prerequisites=[主元]
>   - `method` / depth=2 「Gauss 消去转 LU 的步骤」prerequisites=[LU 存在性定理]
>   - `formula` / depth=2 「PA = LU 中 P 是行交换矩阵」
>   - `pitfall` / depth=1 「不带 partial pivoting 的 LU 在 1e-20 主元下数值崩」
>   - `example` / depth=3 「用 LU 解线性方程组的回代过程」

这样做之后：
1. **知识点卡片** 上能用图标快速过滤（"我只想看 pitfall"）。
2. **知识树** 自动按 depth 上下分层；depth 1 的概念在树顶，depth 3 的应用在树底。
3. **错题本归因** 能落到具体 leaf（"你错的是 partial pivoting，不是整个 LU"）。

### 1.2 必带"原文锚点" `definition_anchor`

每个 topic 抽完后必须把"原文里能直接锚定它的那句话或公式"复制下来，最长 240 字。

为什么：
- 用户复习时点开节点，能看到 **教材原文里的真定义**，而不是 LLM 改写出的"近似说法"。
- 之后做"AI 助教"或"语义搜索"时，这就是检索召回的金标。

---

## 2. 细化知识树 —— 怎么"连边"？

### 2.1 数据来源

边由两路汇合：

1. **AI 抽取** 给的 `prerequisites: text[]`  
   → 仅当前置 topic 的 name 在同一 material 里也存在时才连边（避免悬空指向）。
2. **节点同 chapter / 同 kind 自动归簇**  
   → 同 chapter 的 definition 类节点会被聚到一起（前端 `placeAiTopicsToTree` 完成）。

### 2.2 边怎么画在 SQL 里

不要在前端傻乎乎地遍历嵌套数组。直接用 view：

```sql
-- 已经写在 sql/material_topics_v2_finer_grained.sql 里了
create view material_topic_edges as
select t.id as child_id, parent.id as parent_id, t.material_id
from material_topics t
cross join lateral unnest(t.prerequisites) as prereq_name
join material_topics parent
  on parent.material_id = t.material_id and parent.name = prereq_name;
```

之后前端只要 `select * from material_topic_edges where material_id = ?`，一次拉所有边，一刀切。

### 2.3 节点上色规则

| `kind` | 颜色 | 图标 |
|---|---|---|
| `definition` | 蓝 | 📘 |
| `theorem` | 紫 | 📐 |
| `method` | 绿 | 🛠 |
| `formula` | 灰 | ∑ |
| `example` | 黄 | 💡 |
| `pitfall` | 红 | ⚠️ |

> 用户瞄一眼知识树就能看出"这章主要是 method（绿一片）还是 theorem（紫一片）"。

### 2.4 沿依赖链高亮（已存在）

hover 节点时高亮整条 ancestor / descendant 链——这功能在 v1 就有，v2 不动它，  
只是因为 prerequisites 变密了，所以高亮路径会变得更"血脉相连"，用户会明显感觉到"哦这块知识真的有结构"。

---

## 3. 细化题库 —— 怎么"多样"？

### 3.1 四种题型 + 三档难度（refine 模式强制）

```
单选题 : 4 个干扰项必须是合理数学表达式，禁止"以上都不对"
判断题 : 必须含具体数学对象（公式/算子/条件）
填空题 : answer 是简短数学表达式（LaTeX 或标准符号）
简答题 : answer 是 1~3 句完整推理 + 关键中间式
```

```
easy   ~30%  直接套定义
medium ~50%  选择正确公式 + 一步推导
hard   ~20%  多步推理 / 反例 / 边界条件
```

### 3.2 每题挂"知识点反向索引"

每道题入库时带 `knowledge_points: text[]`。  
这一栏是错题本归因和"针对薄弱点出题"的命脉：

```sql
-- 给定 user 最近 30 天错题，求最弱的 5 个知识点
select kp, count(*) as wrong_cnt
from wrong_drill_logs w
join questions q on q.id = w.question_id
cross join lateral unnest(q.knowledge_points) as kp
where w.user_id = ? and w.created_at > now() - interval '30 days'
group by kp
order by wrong_cnt desc
limit 5;
```

### 3.3 题型分布在前端的呈现

`小测` 页将来要做的事（这次还没实现，留作下一步）：

1. **顶部滑块** —— "本次出题难度"：纯 easy / 混合 / 纯 hard。
2. **类型切换** —— 默认四类混出，可手动只练某一类（"今天我只想刷判断题"）。
3. **薄弱点优先** —— "复习" tab 已经存在，把上面那个 SQL 接进去就行。

---

## 4. 整体管线（细化前 vs 细化后）

```
┌──────────────────────────────────────────────────────────────┐
│  细化前 (v1)                                                  │
│  PDF → pdf.js 抽文 → 单次 /api/extract → topics(3-5) +        │
│        questions(单选+判断) → questions/material_topics 入库   │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│  细化后 (v2)                                                  │
│  PDF → pdf.js 抽文 → buildSemanticChunks 切 2~4 块 →          │
│  每块带 refContext + refine=true 调 /api/extract →            │
│    topics(8-14) {kind, depth, prerequisites, anchor}          │
│    questions(4 题型, easy/medium/hard, knowledge_points[])    │
│  → 渐进降级写库 (新列缺失 → 自动 strip 列重试)                  │
│  → 触发 mc:material-topics-updated 事件                        │
│  → 知识树即时重渲染（按 prerequisites 画边）                    │
└──────────────────────────────────────────────────────────────┘
```

---

## 5. 这次本地交付了什么

### 5.1 新增

| 文件 | 作用 |
|---|---|
| `sql/material_topics_v2_finer_grained.sql` | DB 加列 + 边视图（**需要在 Supabase 后台跑一次**） |
| `docs/refinement_strategy.md` | 本文 |

### 5.2 改动

| 文件 | 改动 |
|---|---|
| `api/extract.js` | 新增 `refine` 模式，prompt 拆成"细化"与"标准"两档；topics 新增 `kind/depth/prerequisites/definition_anchor`；questions 新增 `difficulty/knowledge_points`，题型从 2 类扩到 4 类 |
| `src/App.js` | `processMaterialWithAI` 接受 `refine` 参数；写库时渐进降级（新列缺失自动 strip）；知识树拉 v2 字段失败时 fallback v1；`placeAiTopicsToTree` 用 `prerequisites` 真画边、`kind` 决定图标；新增 `PdfPreviewModal` 组件并在画廊卡 hover、沙盒横幅都能唤出；沙盒横幅多一颗 `🔬 细化分析` 按钮，点一下就把当前教材重新喂给 refine 模式 |
| `src/layouts/StudyWorkspace.jsx` | `MaterialBanner` 加 PDF 预览 / 细化分析按钮的入口 |
| `src/index.css` | 卡片 hover 显现操作按钮区 |

### 5.3 用户操作动线（用户视角的"我下一步要做什么"）

1. 在 Supabase SQL Editor 跑 `sql/material_topics_v2_finer_grained.sql`，让 DB 认这些新列  
   *（不跑也能用，前端会自动 fallback 到 v1 列，只是知识树画不出依赖边）*
2. 在画廊点 *An Introduction to Mathematical Statistics* 进入沙盒
3. 点顶部 `📖 查看 PDF` —— 就能在浏览器里直接读这本教材  
   *（即"看到上传资料的电子书"这个诉求）*
4. 点顶部 `🔬 细化分析` —— 等 30~60 秒，  
   提示"新增知识点 X · 新增题目 Y"  
   *切到 `知识点` / `知识树` / `小测` 看效果*
5. 上传 *Sauer Numerical Analysis* PDF  
   *（在画廊里点"➕ 上传新教材"，新版上传时会自动走 refine 抽取，不需要再点一次"细化分析"）*

> 如果你想让"上传时默认就走 refine 模式"，把 `src/App.js` 上传调用 `processMaterialWithAI` 的地方加 `refine: true` 就行。  
> 我**没**默认开，原因是 refine 会把 LLM 的 token 消耗和耗时都翻 ~2x，  
> 当前默认对所有上传保持快速通道，仅在用户明确点"细化"时才切换。

---

## 6. 之后还能继续做的（按价值排序）

1. **薄弱点反查 → 自动出题**  
   `复习` tab 用 `q.knowledge_points` ∩ 错题最近 30 天 → 反向喂给 LLM 让它针对这些点专门出题。
2. **知识树 → 推荐下一节点**  
   有了 `prerequisites` 之后可以做 topo sort，给 "下一步该学什么" 加一条理由："因为你已经会 A 和 B，所以可以学 C"。
3. **节点级 mastery**  
   `topic_mastery` 表已经在 schema 里了，但 v1 没真正利用 depth；v2 之后可以做"叶子节点 mastery → 反推父节点 mastery"。
4. **AI 助教**  
   有了 `definition_anchor`，做 RAG 时召回质量会显著好（因为 anchor 已经是 cleaned ground truth），  
   不再会出现"AI 把乱码的偏微分符号原样抄出来"。
5. **多本教材的"知识图谱归并"**  
   两本不同教材里抽出来的同名 topic（比如两本都讲"中心极限定理"），可以靠 `definition_anchor` 的相似度做软合并，  
   让知识树在用户视角是 *一棵* 而不是"每本一棵"。
