// run.js —— 自动下载 BI 销售明细
// 用法：
//   node run.js              下载到最近周二
//   node run.js 2026-06-02   下载到指定结束日期
import { chromium } from 'playwright';
import { config } from './config.js';
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

function resolveEndDate(arg) {
  if (arg) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(arg)) throw new Error(`日期格式应为 YYYY-MM-DD，收到：${arg}`);
    return arg;
  }
  return fmtDate(mostRecentTuesday());
}

function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }

async function snap(page, name) {
  ensureDir(config.logDir);
  const file = path.join(config.logDir, `${Date.now()}_${name}.png`);
  try { await page.screenshot({ path: file, fullPage: true }); } catch {}
  console.log('[snap]', file);
}

async function openAnalysisPanel(page) {
  const sidebar = page.locator('li[qtp="LeftSidebar-Analysis"]');
  await sidebar.waitFor({ state: 'visible', timeout: 20_000 });
  await sidebar.click();
  await page.locator('.tree_textSpan a', { hasText: '分析报表' })
    .waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForTimeout(800);
}

async function clickMenuPath(page, names) {
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    const textNode = page.locator('.tree_textSpan a', { hasText: name }).first();
    await textNode.waitFor({ state: 'visible', timeout: 30_000 });
    if (i < names.length - 1) {
      const nodeRow = textNode.locator(
        'xpath=ancestor::div[contains(@class,"tree_nodepaneTitle")]'
      ).first();
      const expander = nodeRow.locator('span.tree_expander').first();
      const expanderClass = await expander.getAttribute('class');
      if (expanderClass && !expanderClass.includes('s-icon-arrow-down')) {
        await expander.click();
      } else {
        console.log(`[menu] "${name}" 已展开，跳过`);
      }
      await page.waitForTimeout(1500);
    } else {
      await textNode.dblclick();
      await page.waitForTimeout(1500);
    }
  }
}

async function setDateRange(page, startDate, endDate) {
  await page.locator('span.aliasSpan', { hasText: '末次渠道时间开始' })
    .waitFor({ state: 'visible', timeout: 60_000 });
  const startInput = page.locator(
    '//span[contains(text(),"末次渠道时间开始")]/ancestor::td[contains(@class,"cellAlias")]/following-sibling::td//input[contains(@class,"combobox-edit")]'
  );
  await startInput.waitFor({ state: 'visible', timeout: 10_000 });
  await startInput.evaluate((el, val) => {
    el.removeAttribute('readonly');
    el.value = val;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, startDate);
  const endInput = page.locator(
    '//span[contains(text(),"末次渠道时间结束")]/ancestor::td[contains(@class,"cellAlias")]/following-sibling::td//input[contains(@class,"combobox-edit")]'
  );
  await endInput.waitFor({ state: 'visible', timeout: 10_000 });
  await endInput.evaluate((el, val) => {
    el.removeAttribute('readonly');
    el.value = val;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, endDate);
}

async function clickRefresh(page) {
  const btn = page.locator('input[bofid="_btnRefresh"]');
  await btn.waitFor({ state: 'visible', timeout: 30_000 });
  await btn.click();
}

async function waitRefreshed(page) {
  await page.waitForTimeout(2000);
  try {
    await page.locator('input[bofid="_btnExport"]')
      .waitFor({ state: 'visible', timeout: 10 * 60_000 });
  } catch {
    console.warn('[warn] 等待刷新完成超时（10 分钟），尝试继续导出。');
  }
  await page.waitForTimeout(1000);
}

async function exportExcel(page, endDate) {
  const exportBtn = page.locator('input[bofid="_btnExport"]');
  await exportBtn.waitFor({ state: 'visible', timeout: 30_000 });
  await exportBtn.click();
  await page.waitForTimeout(800);
  const excelOption = page.locator('div#EXCEL2007[caption="EXCEL"]');
  await excelOption.waitFor({ state: 'visible', timeout: 10_000 });
  await excelOption.click();
  await page.waitForTimeout(800);
  const onlineExportBtn = page.locator('input[value="在线导出"]').first();
  await onlineExportBtn.waitFor({ state: 'visible', timeout: 30_000 });
  await snap(page, '05_export_dialog');
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 15 * 60_000 }),
    onlineExportBtn.click(),
  ]);
  ensureDir(config.downloadDir);
  const baseName = `销售明细_${endDate}`;
  const ext = path.extname(download.suggestedFilename()) || '.xlsx';
  let target = path.join(config.downloadDir, `${baseName}${ext}`);
  let i = 2;
  while (fs.existsSync(target)) {
    target = path.join(config.downloadDir, `${baseName}_${i}${ext}`);
    i++;
  }
  await download.saveAs(target);
  console.log('[ok] 已下载到：', target);
  return target;
}

function pickAuthFile() {
  if (fs.existsSync(config.authFile)) return config.authFile;
  if (fs.existsSync(config.monthlyAuthFile)) {
    console.log('[auth] 复用月度账单的 auth.json');
    return config.monthlyAuthFile;
  }
  return null;
}

async function autoLogin(page) {
  const username = process.env.BI_USERNAME;
  const password = process.env.BI_PASSWORD;

  if (!username || !password) {
    console.log('[login] 未设置环境变量 BI_USERNAME/BI_PASSWORD，跳过自动登录');
    return false;
  }

  try {
    console.log('[login] 尝试自动登录...');

    // 填写账号
    const usernameInput = page.locator('input.item-textinput[type="text"]');
    await usernameInput.waitFor({ state: 'visible', timeout: 5000 });
    await usernameInput.fill(username);
    await page.waitForTimeout(300);

    // 填写密码
    const passwordInput = page.locator('input.item-textinput[type="password"]');
    await passwordInput.fill(password);
    await page.waitForTimeout(300);

    // 点击登录按钮
    const loginBtn = page.locator('input.item-submit');
    await loginBtn.click();
    console.log('[login] 已点击登录按钮，等待跳转...');

    return true;
  } catch (e) {
    console.log('[login] 自动登录失败:', e.message);
    return false;
  }
}

(async () => {
  const arg = process.argv[2];
  const endDate = resolveEndDate(arg);
  console.log(`[run] 结束日期：${endDate}，时间范围：${config.startDate} ~ ${endDate}`);

  const authFile = pickAuthFile();
  if (!authFile) {
    console.warn('[run] 没找到 auth.json，进入手动登录模式（5 分钟内完成登录）。');
  }

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    storageState: authFile || undefined,
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
  });
  const page = await context.newPage();

  try {
    await page.goto(config.loginUrl);
    let loggedIn = false;
    try {
      await page.waitForSelector(config.loginSuccessSelector, { timeout: 20_000 });
      loggedIn = true;
      console.log('[run] 登录态有效。');
    } catch {
      console.log('[run] 登录态过期/不存在，尝试自动登录...');
      // 尝试自动登录
      const autoLoginSuccess = await autoLogin(page);
      if (autoLoginSuccess) {
        // 等待登录成功
        try {
          await page.waitForSelector(config.loginSuccessSelector, { timeout: 30_000 });
          loggedIn = true;
          console.log('[run] 自动登录成功！');
        } catch {
          console.log('[run] 自动登录后仍未检测到登录成功标识，可能有验证码或登录失败');
        }
      }
    }
    if (!loggedIn) {
      console.log('[run] 请在浏览器手动完成登录（5 分钟内）。');
      try {
        await page.waitForSelector(config.loginSuccessSelector, { timeout: 5 * 60 * 1000 });
        console.log('[run] 登录成功，保存登录态。');
        await context.storageState({ path: config.authFile });
      } catch {
        console.error('[run] 5 分钟内未登录，退出。');
        await snap(page, 'auth_expired');
        process.exit(2);
      }
    } else {
      // 登录成功，保存auth
      await context.storageState({ path: config.authFile });
      console.log('[run] 已保存登录态到', config.authFile);
    }

    await openAnalysisPanel(page);
    await snap(page, '01_analysis_panel');
    await clickMenuPath(page, config.menuPath);
    await snap(page, '02_after_menu');
    await setDateRange(page, config.startDate, endDate);
    await snap(page, '03_after_date');
    await clickRefresh(page);
    console.log('[run] 已点击刷新，等待报表加载...');
    await waitRefreshed(page);
    await snap(page, '04_after_refresh');
    await exportExcel(page, endDate);
    await snap(page, '06_done');
    console.log('[run] 完成！');
  } catch (err) {
    console.error('[error]', err.message);
    await snap(page, 'error');
    process.exit(3);
  } finally {
    await browser.close();
  }
})();
