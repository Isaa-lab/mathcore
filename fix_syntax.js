const fs = require('fs');
let src = fs.readFileSync('src/App.js', 'utf8');

// Fix the duplicate "co  const" issue
const old1 = '  co  const regenerateWrongQuestions = async () => {';
const new1 = '  const regenerateWrongQuestions = async () => {';

if (src.includes(old1)) {
  src = src.replace(old1, new1);
  console.log('✓ Fixed duplicate co const');
} else { console.log('NOT FOUND: co const'); }

fs.writeFileSync('src/App.js', src, 'utf8');
console.log('✓ Written');
