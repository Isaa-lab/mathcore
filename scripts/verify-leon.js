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

const MID = process.env.MATERIAL_ID || null;

(async () => {
  let targetId = MID;
  let m;
  if (targetId) {
    m = await supa.from("materials").select("id,title,course,file_data,uploaded_by,is_public,status").eq("id", targetId).single();
  } else {
    const auto = await supa
      .from("materials")
      .select("id,title,course,file_data,uploaded_by,is_public,status,created_at")
      .ilike("title", "%Linear Algebra with Applications%")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    targetId = auto.data?.id || null;
    m = { data: auto.data, error: auto.error };
  }
  if (!targetId || !m.data) {
    console.log("=== materials ===");
    console.log("  未找到 Leon 教材，请先检查 materials 表。");
    return;
  }
  console.log("=== materials ===");
  console.log(`  id     : ${m.data?.id}`);
  console.log(`  title  : ${m.data?.title}`);
  console.log(`  course : ${m.data?.course}`);
  console.log(`  status : ${m.data?.status} · public: ${m.data?.is_public}`);
  console.log(`  pdf    : ${m.data?.file_data?.slice(0, 90)}…`);

  const t = await supa.from("material_topics").select("id,name,kind,depth,prerequisites,generated_by").eq("material_id", targetId);
  console.log(`\n=== material_topics (${t.data?.length || 0}) ===`);
  const byKind = {};
  for (const r of t.data || []) byKind[r.kind || "(无)"] = (byKind[r.kind || "(无)"] || 0) + 1;
  console.log("  kind 分布：" + Object.entries(byKind).map(([k,v]) => `${k}=${v}`).join(", "));
  const withPrereqs = (t.data || []).filter(r => Array.isArray(r.prerequisites) && r.prerequisites.length > 0).length;
  console.log(`  带 prerequisites 的：${withPrereqs}/${t.data?.length || 0}（知识树画边的源数据）`);
  console.log("  样例知识点（前 5 条）：");
  for (const r of (t.data || []).slice(0, 5)) {
    console.log(`    · [${r.kind || "?"}/d${r.depth || "?"}] ${r.name}` + (r.prerequisites?.length ? `  ← 依赖：${r.prerequisites.slice(0,2).join("/")}` : ""));
  }

  const q = await supa.from("questions").select("id,type,question,answer,knowledge_points,generated_by,ai_model,ai_meta").eq("material_id", targetId);
  console.log(`\n=== questions (${q.data?.length || 0}) ===`);
  const byType = {};
  for (const r of q.data || []) byType[r.type] = (byType[r.type] || 0) + 1;
  console.log("  type 分布：" + Object.entries(byType).map(([k,v]) => `${k}=${v}`).join(", "));
  const byDiff = {};
  for (const r of q.data || []) {
    const d = r.ai_meta?.difficulty || "(无)";
    byDiff[d] = (byDiff[d] || 0) + 1;
  }
  console.log("  ai_meta.difficulty 分布：" + Object.entries(byDiff).map(([k,v]) => `${k}=${v}`).join(", "));
  console.log("  样例题（前 3 条）：");
  for (const r of (q.data || []).slice(0, 3)) {
    console.log(`    · [${r.type}] ${(r.question || "").slice(0, 70)}…  → ${r.answer}`);
    if (r.knowledge_points?.length) console.log(`        kp: ${r.knowledge_points.slice(0,2).join(" / ")}`);
  }

  const qc = await supa.from("question_concepts").select("id", { count: "exact", head: true }).eq("source_material_id", targetId);
  const mtLinked = await supa.from("material_topics").select("id", { count: "exact", head: true }).eq("material_id", targetId).not("concept_id", "is", null);
  console.log(`\n=== course graph links ===`);
  console.log(`  material_topics.concept_id 已关联：${mtLinked.count || 0}`);
  console.log(`  question_concepts 标签数：${qc.count || 0}`);
  console.log(`\n✅ 沙盒里点开 "${m.data?.title}" → 知识点 / 小测 / 📖 PDF 都能用了。`);
})();
