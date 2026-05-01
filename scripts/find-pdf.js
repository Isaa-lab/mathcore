const fs = require("fs");
const path = require("path");

console.log("Listing all PDFs in workspace root:");
const root = path.resolve(__dirname, "..");
for (const f of fs.readdirSync(root)) {
  if (f.toLowerCase().endsWith(".pdf")) {
    const full = path.join(root, f);
    const st = fs.statSync(full);
    console.log(`  · ${f}  [${(st.size / 1024 / 1024).toFixed(2)} MB]`);
  }
}
