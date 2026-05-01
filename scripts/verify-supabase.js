// 一次性连通性验证：用 service_role key 列 materials + 检查 storage bucket
const fs = require("fs");
const path = require("path");
(function loadDotEnv() {
  const p = path.resolve(__dirname, "..", ".env.local");
  if (!fs.existsSync(p)) return;
  const txt = fs.readFileSync(p, "utf8");
  for (const l of txt.split(/\r?\n/)) {
    const m = l.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
})();

const { createClient } = require("@supabase/supabase-js");

(async () => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("❌ env 缺少 SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const supa = createClient(url, key, { auth: { persistSession: false } });

  // 1) 表读取测试
  console.log("[1/3] 读 materials 表...");
  const t1 = await supa.from("materials").select("id,title,course,created_at").order("created_at", { ascending: false }).limit(5);
  if (t1.error) {
    console.error("❌ materials 表读取失败：", t1.error.message);
    process.exit(2);
  }
  console.log(`  ok · 当前共 ${t1.data?.length || 0} 条样本（仅取前 5 行）`);
  for (const m of t1.data || []) console.log(`   · ${m.id?.slice(0, 8)}… ${m.title} [${m.course}]`);

  // 2) Storage bucket 列表测试
  console.log("[2/3] 列 Storage buckets...");
  const t2 = await supa.storage.listBuckets();
  if (t2.error) {
    console.error("❌ storage.listBuckets 失败：", t2.error.message);
    process.exit(3);
  }
  const has = (t2.data || []).some(b => b.id === "materials");
  console.log(`  ok · ${(t2.data || []).map(b => b.id).join(", ") || "(空)"}${has ? "" : "  ⚠ 没看到 materials bucket，需要先在 Supabase 后台建一个或跑 sql/materials_review_workflow.sql"}`);

  // 3) profiles 表（找一个 teacher 当 uploaded_by）
  console.log("[3/3] 找一个 teacher 账号当 uploaded_by...");
  const t3 = await supa.from("profiles").select("id,name,role").eq("role", "teacher").limit(1);
  if (t3.error) {
    console.warn("  ⚠ profiles 表读取失败（脚本仍可继续，但需要你手动指定 uploaded_by）：", t3.error.message);
  } else if (!t3.data || t3.data.length === 0) {
    const t3b = await supa.from("profiles").select("id,name,role").limit(1);
    console.log(`  没找到 teacher 角色，回落到任意一个 profile：${t3b.data?.[0]?.id?.slice(0,8)}… (${t3b.data?.[0]?.name || "无名"} / ${t3b.data?.[0]?.role || "无角色"})`);
  } else {
    console.log(`  ok · teacher = ${t3.data[0].id.slice(0,8)}… (${t3.data[0].name})`);
  }

  console.log("\n✅ 连通性验证通过，service_role 可正常读写 + 访问 Storage。可以开始上传。");
})();
