const fs = require("fs");
const s = fs.readFileSync("src/App.js", "utf8");
const i = s.indexOf('className="quiz-stage"');
const j = s.indexOf("{opts.map((opt, i) => {", i);
const sub = s.slice(j, j + 1200);
const closeIdx = sub.indexOf("})}");
console.log("first })} at", closeIdx);
console.log(JSON.stringify(sub.slice(closeIdx, closeIdx + 80)));
