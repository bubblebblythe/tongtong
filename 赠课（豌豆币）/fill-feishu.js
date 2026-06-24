// fill-feishu.js —— 简化版：只填数据，不创建 sheet
// 用法：
//   node fill-feishu.js                自动取最近周二
//   node fill-feishu.js 2026-05-26     指定结束日期
//
// 前提：你已经手动在飞书创建了本周的"思维 X.X-X.X（本周）"和"美术 X.X-X.X（本周）"两个 sheet
// 脚本会找到这两个 sheet，清空数据行，填入新数据
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const FEISHU_URL = 'https://my.feishu.cn/sheets/GFu3sySCBhr62ntmKQQcNxv1n4f?sheet=MfNnEH';
const TEST_FEISHU_URL = 'https://zcn85u6z5vj8.feishu.cn/wiki/O3YiwecvXiNgack43ObcDjw7nrf';
const authFile = path.join(process.cwd(), 'feishu-auth.json');
const outDir = path.join(process.cwd(), 'output');
const logDir = path.join(process.cwd(), 'logs');

function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }
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

const arg = process.argv[2];
const isTest = process.argv.includes('--test');
const useUrl = isTest ? TEST_FEISHU_URL : FEISHU_URL;
const matchKeyword = isTest ? '测试' : '本周';

console.log(`[fill] ${isTest ? '🧪 测试模式' : '正式模式'}`);
console.log(`[fill] 目标URL: ${useUrl}`);
console.log(`[fill] 匹配sheet关键词: ${matchKeyword}`);

const endDateObj = arg && /^\d{4}-\d{2}-\d{2}$/.test(arg)
  ? new Date(+arg.slice(0, 4), +arg.slice(5, 7) - 1, +arg.slice(8, 10))
  : mostRecentTuesday();
const endDate = fmtDate(endDateObj);
const startObj = new Date(endDateObj); startObj.setDate(startObj.getDate() - 6);
const startDate = fmtDate(startObj);

console.log(`[fill] 周期 ${startDate} ~ ${endDate}`);

const dataFile = path.join(outDir, `data_${endDate}.json`);
if (!fs.existsSync(dataFile)) {
  console.error(`找不到 ${dataFile}，请先 node process.js ${endDate}`);
  process.exit(1);
}
const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
console.log(`[fill] 思维 ${data.sixin.length} 条，美术 ${data.meishu.length} 条`);

async function snap(page, name) {
  ensureDir(logDir);
  const file = path.join(logDir, `${Date.now()}_ff_${name}.png`);
  try { await page.screenshot({ path: file }); } catch {}
  console.log('[snap]', file);
}

function getOwner(channelName) {
  if (!channelName) return '';
  const s = String(channelName);
  if (/HJY|【XZ】|【XHZ】|海外推|独立站/i.test(s)) return '洁颖';
  if (/lyt/i.test(s)) return '悦彤';
  return '';
}

async function clickTabByText(page, text) {
  const tab = page.locator('div.tab.light', { hasText: text }).first();
  await tab.waitFor({ state: 'visible', timeout: 10_000 });
  await tab.click();
  await page.waitForTimeout(1500);
}

async function gotoA1(page) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  await page.keyboard.press('Control+Home');
  await page.waitForTimeout(400);
}

async function moveDown(page, n) {
  for (let i = 0; i < n; i++) {
    await page.keyboard.press('ArrowDown');
  }
  await page.waitForTimeout(200);
}

async function moveRight(page, n) {
  for (let i = 0; i < n; i++) {
    await page.keyboard.press('ArrowRight');
  }
  await page.waitForTimeout(200);
}

async function gotoCellByNameBox(page, addr) {
  // 飞书的"名称框"选择器：底部状态栏的输入框（class包含name-box或类似）
  const nameBox = page.locator('input.name-box, input[class*="name-box"], input[class*="cellInput"]').first();
  const exists = await nameBox.count();
  if (exists > 0) {
    await nameBox.click({ timeout: 3000 });
    await page.waitForTimeout(200);
    await nameBox.fill(addr);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    return true;
  }
  return false;
}

async function clearAll(page) {
  // 方式1：用名称框选 A2:Z2000
  const ok = await gotoCellByNameBox(page, 'A2:Z2000').catch(() => false);
  if (ok) {
    await page.waitForTimeout(400);
    await page.keyboard.press('Delete');
    await page.waitForTimeout(1500);
    await page.keyboard.press('Escape');
    return;
  }

  // 方式2备用：A2 + 多次Shift+PageDown + Shift+End
  await gotoA1(page);
  await page.keyboard.press('ArrowDown'); // A2
  await page.waitForTimeout(150);
  await page.keyboard.down('Shift');
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press('PageDown');
  }
  await page.keyboard.press('End');
  await page.keyboard.up('Shift');
  await page.waitForTimeout(500);
  await page.keyboard.press('Delete');
  await page.waitForTimeout(1500);
  await page.keyboard.press('Escape');
}

async function pasteAtRC(page, row, col, rows) {
  await gotoA1(page);
  if (row > 1) await moveDown(page, row - 1);
  if (col > 1) await moveRight(page, col - 1);
  const tsv = rows.map(r => r.map(c => c == null ? '' : String(c)).join('\t')).join('\n');
  await page.evaluate(async (text) => {
    await navigator.clipboard.writeText(text);
  }, tsv);
  await page.waitForTimeout(300);
  await page.keyboard.press('Control+V');
  await page.waitForTimeout(1800);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
}

async function copyFixedColumnsFromTemplate(page, templateTab, targetTab, columns, rowCount) {
  // columns: ['C', 'E:I', 'K'] 需要复制的列
  // rowCount: 数据行数（不含表头）
  console.log(`[copy-fixed] 从"${templateTab}"复制固定列 ${columns.join(',')} 到"${targetTab}"（${rowCount}行）`);

  await clickTabByText(page, templateTab);
  await page.waitForTimeout(2500);

  for (const colSpec of columns) {
    const isRange = colSpec.includes(':');
    const addr = isRange
      ? `${colSpec.split(':')[0]}2:${colSpec.split(':')[1]}${rowCount + 1}` // 如 E2:I18
      : `${colSpec}2:${colSpec}${rowCount + 1}`; // 如 C2:C18

    console.log(`[copy-fixed] 复制 ${addr}`);

    // 选中区域
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await page.keyboard.press('Control+Home');
    await page.waitForTimeout(500);

    // 尝试用名称框
    const ok = await gotoCellByNameBox(page, addr).catch(() => false);
    if (!ok) {
      // fallback: 手动导航
      const startCol = colSpec.split(':')[0];
      await gotoA1(page);
      await page.keyboard.press('ArrowDown'); // A2
      // 移到起始列
      for (let i = 0; i < startCol.charCodeAt(0) - 65; i++) {
        await page.keyboard.press('ArrowRight');
      }
      await page.waitForTimeout(300);
      // 选到目标行
      await page.keyboard.down('Shift');
      for (let i = 0; i < rowCount - 1; i++) {
        await page.keyboard.press('ArrowDown');
      }
      if (isRange) {
        const endCol = colSpec.split(':')[1];
        for (let i = 0; i < endCol.charCodeAt(0) - startCol.charCodeAt(0); i++) {
          await page.keyboard.press('ArrowRight');
        }
      }
      await page.keyboard.up('Shift');
      await page.waitForTimeout(500);
    }

    // 复制
    await page.keyboard.press('Control+C');
    await page.waitForTimeout(800);

    // 切到目标sheet
    await clickTabByText(page, targetTab);
    await page.waitForTimeout(2500);

    // 定位到起始单元格
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const startCol = colSpec.split(':')[0];
    const targetAddr = `${startCol}2`;
    const ok2 = await gotoCellByNameBox(page, targetAddr).catch(() => false);
    if (!ok2) {
      await gotoA1(page);
      await page.keyboard.press('ArrowDown');
      for (let i = 0; i < startCol.charCodeAt(0) - 65; i++) {
        await page.keyboard.press('ArrowRight');
      }
      await page.waitForTimeout(300);
    }

    // 粘贴
    await page.keyboard.press('Control+V');
    await page.waitForTimeout(1800);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }

  console.log(`[copy-fixed] 固定列复制完成`);
}

async function copyHeaderFromTemplate(page, templateTab, targetTab) {
  console.log(`[copy-header] 从"${templateTab}"复制表头到"${targetTab}"`);

  // 1. 切到模板sheet
  await clickTabByText(page, templateTab);
  await page.waitForTimeout(2500);

  // 2. 选中第一行：Ctrl+Home到A1，再Ctrl+Shift+→到行末
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page.keyboard.press('Control+Home');
  await page.waitForTimeout(500);
  await page.keyboard.down('Control');
  await page.keyboard.down('Shift');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.up('Shift');
  await page.keyboard.up('Control');
  await page.waitForTimeout(600);

  // 3. 复制
  await page.keyboard.press('Control+C');
  await page.waitForTimeout(800);

  // 4. 切到目标sheet
  await clickTabByText(page, targetTab);
  await page.waitForTimeout(2500);

  // 5. A1，粘贴
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page.keyboard.press('Control+Home');
  await page.waitForTimeout(500);
  await page.keyboard.press('Control+V');
  await page.waitForTimeout(1800);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
}

async function processSubject(page, subject, startRow, startCol, rows, options = {}) {
  console.log(`\n[${subject}] === 开始处理 ===`);

  const tabs = await page.$$eval('div.tab.light', els =>
    els.map(e => (e.innerText || '').trim())
  );
  const target = tabs.find(t => t.startsWith(subject) && t.includes(matchKeyword));
  if (!target) {
    console.error(`[${subject}] 找不到"${subject} *${matchKeyword}*"的 sheet，请先手动创建。`);
    console.error(`当前 tabs：`, tabs.filter(t => t.startsWith(subject)).slice(0, 5));
    throw new Error(`找不到 ${subject}${matchKeyword} sheet`);
  }
  console.log(`[${subject}] 找到目标 sheet：${target}`);

  // 找模板sheet（用于复制表头和固定列）：找另一个带数字（日期）的同学科旧sheet
  const template = tabs.find(t =>
    t.startsWith(subject) &&
    t !== target &&
    /\d/.test(t) // 含数字（说明是日期命名的旧sheet）
  );
  if (template) {
    console.log(`[${subject}] 模板 sheet：${template}`);
    await copyHeaderFromTemplate(page, template, target);
    await snap(page, `${subject}_00_header_copied`);

    // 思维表需要复制固定列（C, E:I, K）
    if (options.fixedColumns) {
      await copyFixedColumnsFromTemplate(page, template, target, options.fixedColumns, rows.length);
      await snap(page, `${subject}_00b_fixed_copied`);
    }
  } else {
    console.warn(`[${subject}] 未找到模板sheet，跳过表头复制`);
  }

  await clickTabByText(page, target);
  await snap(page, `${subject}_01_switched`);

  await clearAll(page);
  await snap(page, `${subject}_02_cleared`);

  await pasteAtRC(page, startRow, startCol, rows);
  await snap(page, `${subject}_03_pasted`);

  console.log(`[${subject}] 完成 ✓`);
}

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    storageState: fs.existsSync(authFile) ? authFile : undefined,
    viewport: { width: 1600, height: 900 },
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await context.newPage();

  try {
    console.log('[fill] 打开飞书主页让你登录...');
    await page.goto('https://my.feishu.cn/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    // 登录判断：URL 不在 login/passport，且页面 cookie 有 session_*
    async function isLoggedIn() {
      const cookies = await context.cookies();
      const hasSession = cookies.some(c =>
        /session/i.test(c.name) && c.value && c.value.length > 10
      );
      const url = page.url();
      const onLogin = /passport|login|sso/i.test(url);
      return hasSession && !onLogin;
    }

    if (!(await isLoggedIn())) {
      console.log('[fill] 请在浏览器里完成飞书登录（5 分钟内），登录到 my.feishu.cn 主页就行...');
      const deadline = Date.now() + 5 * 60_000;
      while (Date.now() < deadline) {
        await page.waitForTimeout(3000);
        if (await isLoggedIn()) break;
      }
      if (!(await isLoggedIn())) {
        console.error('[fill] 5 分钟内未检测到登录，退出。');
        process.exit(2);
      }
      console.log('[fill] 检测到登录成功！');
    } else {
      console.log('[fill] 已登录');
    }
    await context.storageState({ path: authFile });

    // 登录后跳转到目标表格
    console.log('[fill] 跳转到目标表格...');
    await page.goto(useUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);

    // 二次验证：表格页面不能是只读
    const readonly = await page.locator('text=只能阅读').count();
    if (readonly > 0) {
      console.error('[fill] 表格仍是只读，可能账号没有该表格的编辑权限。请确认账号权限后重试。');
      await snap(page, 'still_readonly');
      process.exit(2);
    }

    console.log('[fill] 等待表格加载...');
    await page.waitForTimeout(10_000);

    // 思维：A=负责人, B=豌豆ID, C=VIP_WanDou(固定), D=空(人工填), E=市场活动赠送(固定),
    //      F=市场活动赠送-(固定), G=5672(固定), H=5464(固定), I=16(固定), J=订单号, K=是(固定), L=渠道名
    const sxRows = data.sixin.map(x => [
      getOwner(x.I),           // A: 负责人
      x.C,                      // B: 豌豆ID
      'VIP_WanDou',            // C: 固定
      '',                       // D: 空，人工填虚拟币数量
      '市场活动赠送',          // E: 固定
      '市场活动赠送-',         // F: 固定
      '5672',                   // G: 固定
      '5464',                   // H: 固定
      '16',                     // I: 固定
      x.O,                      // J: 订单号
      '是',                     // K: 固定
      x.I                       // L: 渠道名
    ]);
    await processSubject(page, '思维', 2, 1, sxRows);

    // 美术：A=负责人(按渠道名), B=画啦啦ID, C=渠道名, D-G=订单号/首签时间/月份/金额
    const msRows = data.meishu.map(x => [getOwner(x.I), x.D, x.I, x.O, x.P, x.Q, x.R]);
    await processSubject(page, '美术', 2, 1, msRows);

    console.log('\n[fill] 全部完成 ✓ 浏览器保持 30 秒供你检查...');
    await page.waitForTimeout(30_000);

  } catch (err) {
    console.error('[error]', err.message);
    console.error(err.stack);
    await snap(page, 'error');
    process.exit(3);
  } finally {
    await browser.close();
  }
})();
