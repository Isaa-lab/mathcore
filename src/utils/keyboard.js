// src/utils/keyboard.js
//
// 全局快捷键守卫工具。核心规则：当焦点在可编辑元素内时，全局快捷键一律让行。
//
// 为什么必须有这个文件：
//   1. 我们的全局快捷键都挂在 window.addEventListener("keydown", ...) 上；
//   2. React 17+ 的事件委托根是 document root —— React 合成事件里的
//      e.stopPropagation() / e.preventDefault() 不能阻止 window 层的 native listener；
//   3. 所以"用户在聊天输入框按 Enter 发送消息"时，事件同时会冒到 window 级的
//      `Enter → 下一题` 监听器，导致页面跳题。
//   4. 解决办法：在每个全局 keydown handler 的最前面调用 isEditableFocused(e)，
//      如果返回 true 就 return，让输入框自己消费这次按键。
//
// 这个文件刻意保持 zero-dep：只是 DOM 判定函数，不引入 React / 全局状态。

/** 浏览器里"可编辑焦点"的完整判定。命中任一即认为用户在打字。 */
export function isEditableFocused(event) {
  const target = (event && event.target) || (typeof document !== "undefined" ? document.activeElement : null);
  if (!target || !target.tagName) return false;

  const tag = String(target.tagName).toLowerCase();
  // 排除 disabled 的 input/textarea 也触发守卫 —— 虽然禁用状态不会收到 key 事件，
  // 但保守处理代价为零。
  if (tag === "input" || tag === "textarea" || tag === "select") return true;

  // contenteditable 元素（Slate / ProseMirror / plain [contenteditable] 都走这里）
  if (target.isContentEditable) return true;

  // 某些组件会把 input 包一层（label/span wrapping），保底再上溯一次
  if (typeof target.closest === "function") {
    if (target.closest('input, textarea, select, [contenteditable="true"], [data-editable="true"]')) {
      return true;
    }
  }

  return false;
}

/** 便捷快捷键匹配：支持 "Enter"、"ArrowRight"、"Ctrl+Enter" 等。 */
export function matchHotkey(event, spec) {
  if (!event || !spec) return false;
  const parts = String(spec).split("+").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (parts.length === 0) return false;
  const key = parts[parts.length - 1];
  const needCtrl = parts.includes("ctrl") || parts.includes("cmd") || parts.includes("meta");
  const needShift = parts.includes("shift");
  const needAlt = parts.includes("alt");

  if (needCtrl !== !!(event.ctrlKey || event.metaKey)) return false;
  if (needShift !== !!event.shiftKey) return false;
  if (needAlt !== !!event.altKey) return false;

  return String(event.key || "").toLowerCase() === key;
}
