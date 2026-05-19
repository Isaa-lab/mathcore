// ──────────────────────────────────────────────────────────────────────────
//  LaTeX rescue / normalization utilities
//
//  AI 模型返回的文本里，LaTeX 出错有三种典型姿势，都会直接泄漏到 UI：
//
//  1) JSON 反斜杠被吃：模型生成 "\frac" 写成单反斜杠时，JSON.parse 把 `\f`
//     解析成 form-feed (U+000C)，最终屏幕上看见 "♦rac{1}{s-a}" 这种鬼畜字符。
//     同类：`\b`→backspace, `\v`→vtab, `\r`→CR。我们把这些控制字符在
//     "后面紧跟 ASCII letter" 的上下文里还原为反斜杠 + 字母。
//
//  2) 非标准分隔符：`\( … \)` / `\[ … \]` 在我们的渲染器里不识别，
//     统一转成 `$…$` / `$$…$$`。
//
//  3) 裸 LaTeX 命令无 `$` 包裹：例如
//     "最终结论: \mathcal{L}\{e^{at}\} = \frac{1}{s-a}"
//     AI 懒得加分隔符就直接贴命令，这里用保守的正则把连续的 LaTeX 命令段
//     自动补上 `$…$`。保守 = 只吞数学符号 / {} / [] / _^ 修饰，不吞中文
//     或汉语标点，避免把整段话都包进公式里渲染失败。
// ──────────────────────────────────────────────────────────────────────────

// ── 1) JSON 反斜杠吞字符修复 ─────────────────────────────────────────────
// 已知的 JSON 解析吞掉反斜杠后会变成的单字符控制码（`\t`/`\n` 除外，那两个
// 在自然文本里也合法，不能动）。
const JSON_ESCAPE_REVIVE = [
  { ch: "\u0008", cmd: "\\b" }, // backspace ← \b
  { ch: "\u000b", cmd: "\\v" }, // vertical tab ← \v
  { ch: "\u000c", cmd: "\\f" }, // form feed ← \f   ← "♦rac" 的祸首
  { ch: "\u000d", cmd: "\\r" }, // carriage return ← \r（仅当后跟字母）
];

export function reviveLatexControlChars(s) {
  if (!s || typeof s !== "string") return s;
  let out = s;
  for (const { ch, cmd } of JSON_ESCAPE_REVIVE) {
    if (!out.includes(ch)) continue;
    // 只在后面紧跟 ASCII 字母时还原——普通换行/制表符保持原状。
    // 例子：form-feed + "rac"  →  "\frac"
    out = out.split(ch).map((seg, i, arr) => {
      if (i === arr.length - 1) return seg;
      const next = arr[i + 1];
      if (/^[a-zA-Z]/.test(next)) {
        return seg + cmd;
      }
      return seg + ch;
    }).join("");
  }
  return out;
}

// ── 2) 分隔符归一 ───────────────────────────────────────────────────────
//   \( ... \)  →  $...$
//   \[ ... \]  →  $$...$$
export function normalizeLatexDelimiters(s) {
  if (!s || typeof s !== "string") return s;
  let out = s;
  // 块级优先，否则会被行内吃掉
  out = out.replace(/\\\[([\s\S]+?)\\\]/g, (_m, body) => `$$${body}$$`);
  out = out.replace(/\\\(([\s\S]+?)\\\)/g, (_m, body) => `$${body}$`);
  return out;
}

// ── 3) 裸 LaTeX 命令自动包 $ ─────────────────────────────────────────────
// 保守匹配一段"完整的 LaTeX 数学表达式"：
//   * 必须以 \cmd 起头
//   * 允许后跟 { ... } / [ ... ] / _x / ^x / 数学运算符 / 字母数字 / 空格
//   * 碰到中文字符、中文标点、换行、冒号就停
// 说明：{ [ ] } 里如果还嵌反斜杠命令，JS 正则不容易写递归，我们用一个有限
// 的两层嵌套够日常 `\frac{\alpha}{x}` 这种。再深的就让 KaTeX 自己兜。
// `\\[a-zA-Z]+` = 命名命令（\frac, \mathcal）；
// `\\[^a-zA-Z]` = 单符号命令（\{ \} \, \; \! \| \ \_ \^ \\ 等）；
// 之后是 {…} [...] _x ^x 以及各种数学 ASCII / 空格。
const MATH_TOKEN = String.raw`(?:\\[a-zA-Z]+\*?|\\[^a-zA-Z\s]|\{(?:[^{}]|\{[^{}]*\})*\}|\[(?:[^\[\]]|\[[^\[\]]*\])*\]|[_^](?:\{(?:[^{}]|\{[^{}]*\})*\}|\\[a-zA-Z]+|\\[^a-zA-Z\s]|[a-zA-Z0-9])|[A-Za-z0-9()+\-*/=<>!|,.]|[ \t])`;
const BARE_LATEX_RE = new RegExp(
  // 至少一个 \cmd，然后贪婪吞后续 math token；末尾不能是纯空格
  String.raw`\\[a-zA-Z]+\*?(?:${MATH_TOKEN})*`,
  "g"
);

export function autoWrapBareLatex(s) {
  if (!s || typeof s !== "string") return s;
  if (!/\\[a-zA-Z]/.test(s)) return s;
  // 先把已经在 $/$$ 内的片段隔离出来，不去动它们
  const parts = s.split(/(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/g);
  return parts.map((p) => {
    if (!p || p.startsWith("$")) return p;
    return p.replace(BARE_LATEX_RE, (m) => {
      // 去掉尾部空白让包裹紧凑；内部空格保留
      const body = m.replace(/\s+$/, "");
      if (!body) return m;
      // 单个字母命令如 "\t" 意外匹配概率低但兜一下
      if (!/[a-zA-Z]/.test(body.replace(/\\/g, ""))) return m;
      const tail = m.slice(body.length);
      return `$${body}$${tail}`;
    });
  }).join("");
}

// ── 3.5) 碎片 LaTeX 合并：AI 把同一个 \frac / \sqrt / \binom 拆到多个 $...$ 里 ──
// 典型 bug 例子（用户实测）：
//   x_{n+1} = x_n - $\frac{f(x_n)}${$\frac{f(x_n) - f(x_{n-1})}{x_n - x_{n-1}}$}
//   ─────────────────  ─┬─    └─── 分母被 {} 包着塞在第二对 $..$ 里
//                       │
//                       └── \frac{X}  缺分母（只有一对花括号）
// 渲染结果：第一对 $..$ 报错（\frac 缺第二参数），第二对正常 → 显示成两段碎公式。
// 正确写法：把整个表达式放在一对 $..$ 内：
//   $x_{n+1} = x_n - \frac{f(x_n)}{\frac{f(x_n) - f(x_{n-1})}{x_n - x_{n-1}}}$
//
// 这里覆盖几种最常见的 AI 拆分模式：
export function mergeFragmentedLatex(s) {
  if (!s || typeof s !== "string") return s;
  let out = s;
  // 反复跑几轮直到收敛（嵌套碎片可能要多次合并）
  for (let i = 0; i < 4; i++) {
    const before = out;

    // 模式 A：$...\frac{X}$ { $Y$ }   →   $...\frac{X}{Y}$
    // 第一对 $..$ 以 \frac{X} 收尾（缺分母），紧跟 {$Y$} 想做分母——合并。
    out = out.replace(
      /\$([^$\n]*\\(?:d?frac|t?frac|binom|stackrel|overset|underset)\{[^{}\n]+\})\$\s*\{\s*\$([^$\n]+)\$\s*\}/g,
      "$$$1{$2}$$"
    );

    // 模式 B：$...\frac{X}{$Y$}   →   $...\frac{X}{Y}$
    // 第一对 $..$ 在第二个 { 开口后就被 $ 截断了，下一段 $Y$ 应该是分母。
    out = out.replace(
      /\$([^$\n]*\\(?:d?frac|t?frac|binom)\{[^{}\n]+\}\{)\$([^$\n]+)\$\s*\}?/g,
      "$$$1$2}$$"
    );

    // 模式 C：$X$\s*{$Y$}   通用："第一段 $..$"紧跟"{$..$}" 且第一段大括号失衡
    // 仅在 X 末尾确实有未闭合 { 的迹象时合并（保守，避免误伤）。
    out = out.replace(
      /\$([^$\n]+)\$\s*\{\s*\$([^$\n]+)\$\s*\}/g,
      (m, a, b) => {
        // 数 a 里的 { 和 } 数量
        const open = (a.match(/\{/g) || []).length;
        const close = (a.match(/\}/g) || []).length;
        // 只有 a 包含 \frac / \binom 等"需要 2 参数的命令"且 } > {（即 } 多一个收尾）
        // 才认为 a 是缺一个参数的状态，把 b 当那个参数。
        const hasTwoArgCmd = /\\(?:d?frac|t?frac|binom|stackrel|overset|underset)\{[^{}\n]*\}/.test(a);
        if (hasTwoArgCmd && open === close) {
          // a 自闭合，但命令本身只给了 1 个参数 —— 把 b 接上当第 2 参数
          return `$${a}{${b}}$`;
        }
        return m;
      }
    );

    // 模式 D：$X$$Y$ 两段紧邻 + 第一段大括号未闭合 → 合并成一段
    // 例："$\sqrt{1+x$\$y^2}$" 这种 $ 错位插入。
    out = out.replace(
      /\$([^$\n]+)\$\$([^$\n]+)\$/g,
      (m, a, b) => {
        const open = (a.match(/\{/g) || []).length;
        const close = (a.match(/\}/g) || []).length;
        if (open > close) return `$${a}${b}$`;
        return m;
      }
    );

    if (out === before) break;
  }
  return out;
}

// ── 4) 一站式入口：给渲染器前调用 ───────────────────────────────────────
// 顺序很重要：先 revive（把控制字符变回 \x），再 normalize（替换分隔符），
// 最后 autoWrap（补 $）。
export function sanitizeLatexText(s) {
  if (s == null) return s;
  if (typeof s !== "string") return s;
  let out = reviveLatexControlChars(s);
  out = normalizeLatexDelimiters(out);
  out = autoWrapBareLatex(out);
  return out;
}
