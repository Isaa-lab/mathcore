const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

function loadDotEnv() {
  const p = path.resolve(__dirname, "..", ".env.local");
  if (!fs.existsSync(p)) return;
  const txt = fs.readFileSync(p, "utf8");
  for (const l of txt.split(/\r?\n/)) {
    const m = l.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith("\"") && v.endsWith("\"")) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}

async function main() {
  loadDotEnv();
  const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const r = await s.from("materials").select("id,title,course,created_at").order("created_at", { ascending: false }).limit(20);
  if (r.error) throw new Error(r.error.message);
  for (const m of r.data || []) {
    console.log(`${m.id} | ${m.title} | ${m.course}`);
  }
}

main().catch((e) => {
  console.error("failed:", e.message || e);
  process.exit(1);
});
