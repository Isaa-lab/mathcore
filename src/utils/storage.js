// src/utils/storage.js
//
// 统一的 localStorage 包装。所有 L3b 新加的持久化数据都走这一层。
// 与现有的 mc_sr（SM2）/ mc_exam_date 等旧键共存，不互相覆盖。
//
// 设计约束：
// · 每个 key 带 ns+version（mathcore:<name>:v1），后面 schema 升级时可平滑切换
// · 读失败 → fallback，不抛异常
// · 写失败 → 吞掉（用户禁用 localStorage 或配额满时不炸）
// · update 原子读-改-写，避免回调里忘了 set 的那种 bug

const NS = "mathcore";
const VERSION = "v1";

function k(name) {
  return `${NS}:${name}:${VERSION}`;
}

function safeGet(name, fallback) {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(k(name)) : null;
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function safeSet(name, value) {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(k(name), JSON.stringify(value));
    }
  } catch {
    // 静默失败：隐私模式 / 配额满 —— 不打断流程
  }
}

export const storage = {
  get(name, fallback = null) {
    return safeGet(name, fallback);
  },
  set(name, value) {
    safeSet(name, value);
  },
  update(name, updater, fallback = null) {
    const cur = safeGet(name, fallback);
    const next = updater(cur);
    safeSet(name, next);
    return next;
  },
  remove(name) {
    try { if (typeof localStorage !== "undefined") localStorage.removeItem(k(name)); } catch {}
  },
};

// 方便 dev console 手动清空的后门
if (typeof window !== "undefined") {
  window.__mathcoreStorage = storage;
}
