const fs = require("fs");
const path = require("path");
(function loadDotEnv() {
  const p = path.resolve(__dirname, "..", ".env.local");
  if (!fs.existsSync(p)) return;
  for (const l of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = l.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
})();

const { createClient } = require("@supabase/supabase-js");
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

(async () => {
  // 探 type 约束允许哪些值
  const cands = [
    "单选题", "判断题", "填空题", "简答题",
    "multiple_choice", "true_false", "fill_blank", "essay",
    "single", "true-false", "fill", "short",
    "mc", "tf", "fb", "sa",
    "单选", "判断", "填空", "简答",
    null,
  ];
  for (const v of cands) {
    const row = {
      chapter: "_probe", course: "_probe", type: v,
      question: "_probe q", options: null, answer: "正确", explanation: "",
      difficulty: null,
    };
    const r = await supa.from("questions").insert(row).select("id").single();
    if (r.error) {
      console.log(`type=${JSON.stringify(v)} → ❌ ${r.error.message.slice(0, 100)}`);
    } else {
      console.log(`type=${JSON.stringify(v)} → ✅ 接受 (id=${r.data.id.slice(0,8)}…)`);
      await supa.from("questions").delete().eq("id", r.data.id);
    }
  }
})();
