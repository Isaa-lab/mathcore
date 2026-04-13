const fs = require("fs");
let s = fs.readFileSync("src/App.js", "utf8");
const orig = s;

// Add AI reset in handleNext - target the specific line
const oldLine = "setCurrent(c => c + 1); setSelected(null); setAnswered(false); setShowHint(false);";
const newLine = "setCurrent(c => c + 1); setSelected(null); setAnswered(false); setShowHint(false); setShowAIHelp(false); setAIHelpReply(\"\"); setAIHelpInput(\"\");";

if (s.includes(oldLine)) {
  s = s.replace(oldLine, newLine);
  console.log("✅ AI reset added to handleNext");
} else {
  console.log("❌ Pattern not found");
  const idx = s.indexOf("setCurrent(c => c + 1);");
  console.log("setCurrent idx:", idx);
  console.log("context:", JSON.stringify(s.substring(idx, idx + 100)));
}

if (s !== orig) {
  fs.writeFileSync("src/App.js", s, "utf8");
  console.log("✅ Written");
}
