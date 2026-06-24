// process.js —— 读销售明细 Excel，按 P 列（首签时间）筛选当周 7 天，分思维/美术输出 JSON
// 用法：
//   node process.js              处理最近周二对应文件
//   node process.js 2026-06-02   处理指定结束日期
import ExcelJS from 'exceljs';
import fs from 'node:fs';
import path from 'node:path';

function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function mostRecentTuesday(today = new Date()) {
  const d = new Date(today);
  d.setHours(0, 0, 0, 0);
  const daysBack = (d.getDay() - 2 + 7) % 7;
  d.setDate(d.getDate() - daysBack);
  return d;
}
function parseYMD(s) {
  return new Date(+s.slice(0,4), +s.slice(5,7)-1, +s.slice(8,10));
}

const arg = process.argv[2];
const endDateObj = arg ? parseYMD(arg) : mostRecentTuesday();
const endDate = fmtDate(endDateObj);
const startObj = new Date(endDateObj); startObj.setDate(startObj.getDate() - 6);
const startDate = fmtDate(startObj);

const cwd = process.cwd();
const downloadDir = path.join(cwd, 'downloads');
const outputDir = path.join(cwd, 'output');
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

const xlsxFile = path.join(downloadDir, `销售明细_${endDate}.xlsx`);
if (!fs.existsSync(xlsxFile)) {
  console.error(`找不到 ${xlsxFile}，请先 node run.js ${endDate}`);
  process.exit(1);
}
console.log(`[process] 周期 ${startDate} ~ ${endDate}`);
console.log(`[process] 读取 ${xlsxFile}`);

// 把 cell.value 取成"显示文本"
function cellText(cell) {
  if (cell == null) return '';
  const v = cell.value;
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v instanceof Date) return fmtDate(v);
  if (typeof v === 'object') {
    if (v.text) return String(v.text);
    if (v.richText) return v.richText.map(r => r.text).join('');
    if (v.result != null) return String(v.result);
    if (v.formula) return ''; // 没结果的公式
  }
  return String(v);
}

// 把 P 列首签时间转成 "YYYY-MM-DD"，支持 Date 对象 / "YYYY-MM-DD" / "YYYY/M/D" / "YYYY-MM-DD HH:mm:ss"
function normalizeDate(raw) {
  if (raw == null || raw === '') return '';
  if (raw instanceof Date) return fmtDate(raw);
  const s = String(raw).trim();
  // 取前 10 字符尝试
  const head = s.slice(0, 10);
  let m = head.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  m = head.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  // 尝试 Date 解析
  const d = new Date(s);
  if (!isNaN(d.getTime())) return fmtDate(d);
  return s;
}

(async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(xlsxFile);
  const ws = wb.worksheets[0];
  console.log(`[process] sheet: "${ws.name}", 总行数: ${ws.rowCount}`);

  // 表头在第 5 行，数据从第 6 行开始
  const headerRow = ws.getRow(5);
  const headers = [];
  for (let c = 1; c <= headerRow.cellCount; c++) {
    headers.push(cellText(headerRow.getCell(c)));
  }
  console.log('[process] 表头（前 20 列）:', headers.slice(0, 20));

  const sixin = []; // 思维
  const meishu = []; // 美术
  let total = 0, inRange = 0;

  for (let r = 6; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const A = cellText(row.getCell(1));   // 学科
    if (!A) continue;
    total++;
    // P 列(16) 首签时间——只有报名课程（首签）的人才有赠课资格
    const P = normalizeDate(row.getCell(16).value);
    if (!P || P < startDate || P > endDate) continue;
    inRange++;
    const rec = {
      A,
      C: cellText(row.getCell(3)),
      D: cellText(row.getCell(4)),
      I: cellText(row.getCell(9)),
      K: normalizeDate(row.getCell(11).value),
      O: cellText(row.getCell(15)),
      P,
      Q: cellText(row.getCell(17)),
      R: cellText(row.getCell(18)),
    };
    if (A.includes('思维')) sixin.push(rec);
    else if (A.includes('美术')) meishu.push(rec);
  }

  console.log(`[process] 数据行: ${total}, 周期内: ${inRange}`);
  console.log(`[process] 思维: ${sixin.length} 条，美术: ${meishu.length} 条`);

  const outFile = path.join(outputDir, `data_${endDate}.json`);
  fs.writeFileSync(outFile, JSON.stringify({ startDate, endDate, sixin, meishu }, null, 2), 'utf8');
  console.log('[ok] 已写入', outFile);

  // 同时输出 TSV 便于手动粘贴到飞书
  const sxTsv = sixin.map(x => [x.C, x.O, x.I].join('\t')).join('\n');
  fs.writeFileSync(path.join(outputDir, `sixin_${endDate}.tsv`), sxTsv, 'utf8');
  const msTsv = meishu.map(x => [x.D, x.I, x.O, x.P, x.Q, x.R].join('\t')).join('\n');
  fs.writeFileSync(path.join(outputDir, `meishu_${endDate}.tsv`), msTsv, 'utf8');
  console.log('[ok] TSV 也已写入 output/');
})().catch(e => {
  console.error('[error]', e);
  process.exit(2);
});
