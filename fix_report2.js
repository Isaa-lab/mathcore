const fs = require('fs');
let src = fs.readFileSync('src/App.js', 'utf8');
const newReportPage = fs.readFileSync('report_content.txt', 'utf8');

const startMarker = 'function ReportPage({ setPage }) {';
const endMarker = '\n// \u2500\u2500 Upload Page';

const startIdx = src.indexOf(startMarker);
const endIdx = src.indexOf(endMarker, startIdx);

if (startIdx === -1 || endIdx === -1) {
  console.log('Markers not found:', startIdx, endIdx);
  process.exit(1);
}

console.log('Found ReportPage at:', startIdx, '-', endIdx);
src = src.slice(0, startIdx) + newReportPage + '\n' + src.slice(endIdx + 1);
fs.writeFileSync('src/App.js', src, 'utf8');
console.log('✓ ReportPage replaced, file size:', src.length);
