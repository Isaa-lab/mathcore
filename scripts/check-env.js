const fs = require("fs");
const path = require("path");

const envPath = path.resolve(__dirname, "..", ".env.local");
const text = fs.readFileSync(envPath, "utf8");
console.log("totalBytes=" + text.length);

const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0 && !l.trim().startsWith("#"));
const map = {};
for (const l of lines) {
  const m = l.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m) {
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    map[m[1]] = v;
  }
}

const mask = (v) => {
  if (!v) return "<missing>";
  if (v.length < 10) return "<too short len=" + v.length + ">";
  return v.slice(0, 6) + "..." + v.slice(-4) + " (len=" + v.length + ")";
};

console.log(
  "SUPABASE_URL:",
  map.SUPABASE_URL ? map.SUPABASE_URL.slice(0, 40) + " (len=" + map.SUPABASE_URL.length + ")" : "<missing>"
);
console.log("SUPABASE_SERVICE_ROLE_KEY:", mask(map.SUPABASE_SERVICE_ROLE_KEY));
console.log("GROQ_KEY:", mask(map.GROQ_KEY));
console.log("all keys found:", Object.keys(map).join(", ") || "(none)");
