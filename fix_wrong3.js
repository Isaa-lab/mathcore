const fs = require('fs');
let src = fs.readFileSync('src/App.js', 'utf8');

// Use exact CRLF bytes
const old1 = 'const [aiWrongQs, setAiWrongQs] = useState([]);\r\n  const [regenLoading, setRegenLoading] = useState(false);\r\n  const [regenMsg, setRegenMsg] = useState("");\r\n  const mergedWrong = [...WRONG_QS, ...aiWrongQs];';
const new1 = 'const [aiWrongQs, setAiWrongQs] = useState([]);\r\n  const [regenLoading, setRegenLoading] = useState(false);\r\n  const [regenMsg, setRegenMsg] = useState("");\r\n  const [aiDrillMode, setAiDrillMode] = useState(false);\r\n  const mergedWrong = [...WRONG_QS, ...aiWrongQs];';

if (src.includes(old1)) {
  src = src.replace(old1, new1);
  console.log('✓ aiDrillMode state added');
} else {
  console.log('NOT FOUND');
  // Debug
  const idx = src.indexOf('aiWrongQs, setAiWrongQs');
  console.log(JSON.stringify(src.substring(idx - 7, idx + 10)));
}

fs.writeFileSync('src/App.js', src, 'utf8');
console.log('✓ done');
