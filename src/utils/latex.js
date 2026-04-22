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
