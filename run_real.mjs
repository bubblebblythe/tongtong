#!/usr/bin/env node
/**
 * 致远OA合同申请 - 基于真实录制数据的自动化
 *
 * 关键点：
 * 1. 所有enumValue使用从真实填写中提取的ID（不是猜的1/2/3）
 * 2. 对方主体选择会自动联动带出：成立时间、联系人、银行账户等
 * 3. 我方主体选择会自动联动
 * 4. 一级分类设置后等待二级/三级的enums加载
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const sleep = ms => new Promise(r => setTimeout(r, ms));

// 从录制中提取的真实值
const REAL_VALUES = {
  // 主体信息（注意：对方主体不预填，让用户通过lookup选择）
  // oppositeEntity: lookup字段，跳过预填
  // 我方签约主体：根据币种自动判断
  //   - 人民币 → 3 = 广州豌豆思维科技有限公司
  //   - 外币 → 17 = HongKong MagicEars Technology Limited (香港魔力耳朵科技有限公司)
  ownEntityRMB: { id: 'field0062', value: '3', show: '广州豌豆思维科技有限公司' },
  ownEntityForeign: { id: 'field0062', value: '17', show: 'HongKong MagicEars Technology Limited (香港魔力耳朵科技有限公司)' },
  // 联动字段不预填（由lookup自动带出）

  // 合同基本
  contractName: { id: 'field0069', value: '闫枝&广西信华服务协议附件', show: '闫枝&广西信华服务协议附件' },
  oppositeEntityType: { id: 'field0070', value: '128003249521577741', show: '供应商' },
  category1: { id: 'field0072', value: '2809872982822569489', show: '付款类' },
  category2: { id: 'field0073', value: '3990220949752989099', show: '市场投放合同（非地推合同）' },
  category3: { id: 'field0074', value: '682175972134240475', show: '新媒体投放费' },
  isFramework: { id: 'field0077', value: '-2038691450617968819', show: '是' },
  requiresProject: { id: 'field0135', value: '917159206846349379', show: '否' },
  channelName: { id: 'field0205', value: '少禹妈妈', show: '少禹妈妈' },
  startDate: { id: 'field0080', value: '2026-05-01', show: '' },
  endDate: { id: 'field0081', value: '2027-05-01', show: '' },
  handler: { id: 'field0064', value: '2666791859185533532', show: '梁悦彤' },

  // 金额（依娃Yvonne合同：人民币，CPA+CPS阶梯）
  expectedAmount: { id: 'field0078', value: '50000', show: '50000.00' },
  baseAmount: { id: 'field0152', value: '50000.00', show: '50000.00' },
  // 币种规则：人民币对私→币种=人民币、汇率=1
  currency: { id: 'field0086', value: '1', show: '人民币' },
  exchangeRate: { id: 'field0154', value: '1', show: '1.0000' },
  financeAmount: { id: 'field0084', value: '50000.00', show: '50000.00' },
  financeAmountUpper: { id: 'field0085', value: '伍万元整', show: '伍万元整' },

  // 内容
  cooperationContent: { id: 'field0190', value: '合作推广海外豌豆思维VIPthink', show: '合作推广海外豌豆思维VIPthink' },
  settlementStandard: { id: 'field0191', value: 'CPS+CPA服务费结算：CPA按有效首次出席数×固定单价；CPS按有效订单成交实付金额阶梯比例（0<X<3:20%, 3≤X<6:30%, X≥6:35%）', show: 'CPS+CPA服务费结算' },
  paymentPlan: { id: 'field0192', value: '月结', show: '月结' },

  // 财务（根据币种动态选择）
  // 票据类型 field0137:
  //   - 人民币: 增值税电子普票（先用show值尝试，如失败需探查enumValue）
  //   - 外币: invoice (enumValue: 5989816554868788764)
  invoiceTypeRMB: { id: 'field0137', value: '增值税电子普票', show: '增值税电子普票' },
  invoiceTypeForeign: { id: 'field0137', value: '5989816554868788764', show: 'invoice' },

  // 开票形式 field0136:
  //   - 人民币对私: 先款后票
  //   - 人民币对公: 先票后款
  //   - 外币: 先票后款 (enumValue: 5909796482022392877)
  invoiceTimingRMBPrivate: { id: 'field0136', value: '先款后票', show: '先款后票' },
  invoiceTimingRMBPublic: { id: 'field0136', value: '先票后款', show: '先票后款' },
  invoiceTimingForeign: { id: 'field0136', value: '5909796482022392877', show: '先票后款' },

  // 发票税率 field0089:
  //   - 人民币对私: 6%
  //   - 人民币对公: 1%
  //   - 外币: 0%
  taxRateRMBPrivate: { id: 'field0089', value: '6', show: '6.00' },
  taxRateRMBPublic: { id: 'field0089', value: '1', show: '1.00' },
  taxRateForeign: { id: 'field0089', value: '0', show: '0.00' },
};

function parseArgs() {
  const args = process.argv.slice(2);
  const r = { contract: null, roi: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--contract') r.contract = args[i + 1];
    if (args[i] === '--roi') r.roi = args[i + 1];
  }
  return r;
}

// 从docx合同提取乙方收款账号（用来在lookup弹窗里匹配真正的供应商）
function extractBankAccountFromDocx(docxPath) {
  try {
    const { execSync } = require('node:child_process');
    let xml = '';
    try {
      xml = execSync(`unzip -p "${docxPath}" word/document.xml`, { encoding: 'utf8' });
    } catch {
      // Windows fallback
      const psCmd = `Add-Type -AssemblyName System.IO.Compression.FileSystem; $z=[System.IO.Compression.ZipFile]::OpenRead('${docxPath.replace(/'/g, "''")}'); $e=$z.Entries|Where-Object{$_.FullName -eq 'word/document.xml'}; $s=$e.Open(); $r=New-Object System.IO.StreamReader($s); $r.ReadToEnd(); $r.Close(); $s.Close(); $z.Dispose()`;
      xml = execSync(`powershell -NoProfile -Command "${psCmd}"`, { encoding: 'utf8' });
    }
    const text = xml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    // 提取邮箱（paypal account 形式）
    const emails = (text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) || []).filter(e => !e.includes('hltn.com') && !e.includes('happy-seed'));
    // 提取长数字串（银行卡号，10位以上）
    const numbers = (text.match(/\b\d{10,30}\b/g) || []).filter(n => !n.startsWith('370103') && !n.startsWith('120103') && !n.startsWith('150') && !n.match(/^1[3-9]\d{9}$/));
    return { emails, numbers };
  } catch (e) {
    return { emails: [], numbers: [] };
  }
}

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

async function main() {
  const args = parseArgs();
  console.log('[·] 合同:', path.basename(args.contract));

  // 从合同提取乙方账号信息（用于lookup匹配）
  const contractBankInfo = extractBankAccountFromDocx(args.contract);
  console.log('[·] 合同乙方账号信息:', JSON.stringify(contractBankInfo).slice(0, 200));

  const browser = await chromium.launch({
    headless: false,
    channel: 'msedge',
    slowMo: 30
  });

  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // 自动登录
  console.log('[·] 打开OA...');
  await page.goto('https://zhiyuan-oa.vipthink.cn/seeyon');
  await sleep(3000);

  const needLogin = await page.evaluate(() => !!document.querySelector('#login_username'));
  if (needLogin) {
    console.log('[·] 自动登录...');
    await page.evaluate(() => {
      const userInput = document.querySelector('#login_username');
      const pwdInput = document.querySelector('input[type=password]');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(userInput, 'H0029921');
      userInput.dispatchEvent(new Event('input', { bubbles: true }));
      setter.call(pwdInput, 'H0029921');
      pwdInput.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#submit_button').click();
    });

    for (let i = 0; i < 30; i++) {
      await sleep(2000);
      const stillOnLogin = await page.evaluate(() => !!document.querySelector('#login_username'));
      if (!stillOnLogin) break;
    }
    console.log('[✓] 登录成功');
    await sleep(3000);
  }

  // 打开表单
  console.log('[·] 打开合同申请表单...');
  await page.goto('https://zhiyuan-oa.vipthink.cn/seeyon/collaboration/collaboration.do?method=newColl&from=bizconfig&menuId=-5093629815471325104&templateId=-1301118134626202752');
  await sleep(8000);

  let frame = null;
  for (let i = 0; i < 10; i++) {
    frame = page.frame({ name: 'zwIframe' });
    if (frame) break;
    await sleep(1000);
  }
  if (!frame) { console.error('[✗] zwIframe未找到'); process.exit(1); }

  await frame.waitForSelector('section.cap4-formmain', { timeout: 15000 });
  console.log('[✓] 表单就绪');
  await sleep(3000);

  // 提取币种信息，供后续填表和lookup使用
  const currency = REAL_VALUES.currency?.show || '';
  const isRMB = currency === '人民币';
  const isPrivate = true; // 当前所有人民币合同都是对私

  // ===== 填写所有字段（使用真实的enumValue） =====
  console.log('[·] 开始填写表单（使用真实录制的enumValue）...');

  // 根据币种动态选择我方签约主体、票据类型、开票形式、税率

  const ownEntity = isRMB ? REAL_VALUES.ownEntityRMB : REAL_VALUES.ownEntityForeign;
  const invoiceType = isRMB ? REAL_VALUES.invoiceTypeRMB : REAL_VALUES.invoiceTypeForeign;

  // 开票形式：人民币对私=先款后票，人民币对公/外币=先票后款
  const invoiceTiming = (isRMB && isPrivate)
    ? REAL_VALUES.invoiceTimingRMBPrivate
    : (isRMB ? REAL_VALUES.invoiceTimingRMBPublic : REAL_VALUES.invoiceTimingForeign);

  // 税率：人民币对私=6%，人民币对公=1%，外币=0%
  const taxRate = isRMB
    ? (isPrivate ? REAL_VALUES.taxRateRMBPrivate : REAL_VALUES.taxRateRMBPublic)
    : REAL_VALUES.taxRateForeign;

  const fillValues = {
    ...REAL_VALUES,
    ownEntity,
    invoiceType,
    invoiceTiming,
    taxRate
  };

  // 删除多余的候选字段
  delete fillValues.ownEntityRMB;
  delete fillValues.ownEntityForeign;
  delete fillValues.invoiceTypeRMB;
  delete fillValues.invoiceTypeForeign;
  delete fillValues.invoiceTimingRMBPrivate;
  delete fillValues.invoiceTimingRMBPublic;
  delete fillValues.invoiceTimingForeign;
  delete fillValues.taxRateRMBPrivate;
  delete fillValues.taxRateRMBPublic;
  delete fillValues.taxRateForeign;

  const fillResult = await frame.evaluate((realValues) => {
    const vm = document.querySelector('section.cap4-formmain').__vue__;
    if (!vm || !vm.drawInitData) return { error: 'Vue实例未找到' };

    const main = Object.values(vm.drawInitData.currentFormData.formmains)[0];
    if (!main) return { error: 'formmain未找到' };

    // 通过DOM找到字段对应的input/textarea，设值并触发事件让UI更新
    function syncDOM(fieldId, displayValue) {
      // 致远CAP4字段DOM结构：通常在 [id$="${fieldId}_id"] 或 父容器内的input
      const candidates = [
        document.querySelector(`#${fieldId}`),
        document.querySelector(`[name="${fieldId}"]`),
        document.querySelector(`#${fieldId}_id`),
      ].filter(Boolean);

      // 也搜索整个DOM中包含fieldId的input
      const allInputs = document.querySelectorAll('input, textarea');
      for (const input of allInputs) {
        const id = input.id || '';
        const name = input.name || '';
        if (id.includes(fieldId) || name.includes(fieldId)) {
          candidates.push(input);
        }
      }

      let synced = 0;
      for (const input of candidates) {
        try {
          const proto = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
          setter.call(input, displayValue);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          input.dispatchEvent(new Event('blur', { bubbles: true }));
          synced++;
        } catch {}
      }
      return synced;
    }

    function set(field) {
      const f = main[field.id];
      if (!f) return false;
      f.value = String(field.value);
      f.showValue = String(field.show);
      if (f.showValue2 !== undefined) f.showValue2 = String(field.show);
      // 同步DOM以更新UI
      try { syncDOM(field.id, field.show || field.value); } catch {}
      return true;
    }

    const results = {};
    Object.entries(realValues).forEach(([key, field]) => {
      results[key] = set(field);
    });

    // 强制更新视图
    if (vm.$forceUpdate) vm.$forceUpdate();

    return { success: true, results };
  }, fillValues);

  if (fillResult.error) {
    console.log('[✗] 填写失败:', fillResult.error);
  } else {
    const success = Object.entries(fillResult.results).filter(([_, v]) => v).map(([k]) => k);
    const failed = Object.entries(fillResult.results).filter(([_, v]) => !v).map(([k]) => k);
    console.log(`[✓] 成功填写: ${success.length}/${Object.keys(fillResult.results).length} 个字段`);
    if (failed.length) console.log('[!] 未填写:', failed.join(', '));
  }

  await sleep(2000);

  // ===== 通过fieldId精确定位input做DOM补填 =====
  console.log('[·] 通过fieldId补填关键字段...');
  const domFillResult = await frame.evaluate(() => {
    // 直接通过field0XXX的容器找input
    function fillByFieldId(fieldId, value) {
      // 致远CAP4结构：每个字段都有一个 div.cap-field 容器，class包含 "field0XXX"
      // 容器内有真正的 input/textarea
      const containers = document.querySelectorAll(`.cap-field`);
      for (const container of containers) {
        const cls = container.className || '';
        // 严格匹配：类名以|field0078结尾，或包含 |field0078"  避免field0078匹配到field00781
        if (cls.match(new RegExp(`\\|${fieldId}(\\s|$|"|\\|)`))) {
          const input = container.querySelector('input:not([type=hidden]):not([type=button]):not([type=file]):not([readonly]), textarea:not([readonly])');
          if (input) {
            const proto = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
            input.focus();
            setter.call(input, String(value));
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            input.dispatchEvent(new Event('blur', { bubbles: true }));
            return { ok: true, inputId: input.id || input.name, containerCls: cls };
          }
          return { ok: false, reason: 'no input in container' };
        }
      }
      return { ok: false, reason: 'no container' };
    }

    const targets = [
      // field0069合同名称、field0205渠道名称由fillValues处理，不在此硬编码
      // field0080/field0081日期由fillValues处理，不在此硬编码
      ['field0078', '50000', '合同预计总金额'],
      ['field0152', '50000', '本币合同预计总金额'],
      ['field0084', '50000', '合同金额（含税）'],
      ['field0154', '1', '汇率'],
      ['field0190', '合作推广海外豌豆思维VIPthink', '主要合作内容'],
      ['field0191', 'CPS+CPA服务费结算：CPA按有效首次出席数×固定单价；CPS按有效订单成交实付金额×10%', '结算标准'],
      ['field0192', '月结', '付款计划'],
      // field0089发票税率由fillValues动态处理，不在此硬编码
    ];

    const results = {};
    targets.forEach(([id, val, name]) => {
      results[`${id} ${name}`] = fillByFieldId(id, val);
    });
    return results;
  });

  Object.entries(domFillResult).forEach(([k, v]) => {
    console.log(`  ${v.ok ? '✓' : '✗'} ${k}: ${v.ok ? v.inputId : v.reason}`);
  });
  console.log('[✓] DOM补填完成');
  await sleep(2000);

  // ===== 上传附件（合同 + ROI） =====
  console.log('[·] 上传合同附件...');

  // 默认ROI路径：与合同同目录的xlsx文件
  if (!args.roi && args.contract) {
    const contractDir = path.dirname(args.contract);
    try {
      const files = fs.readdirSync(contractDir);
      const roiFile = files.find(f => f.toLowerCase().includes('roi') && f.endsWith('.xlsx'));
      if (roiFile) {
        args.roi = path.join(contractDir, roiFile);
        console.log('[·] 自动检测到ROI:', path.basename(args.roi));
      }
    } catch {}
  }

  // 准备上传文件列表
  const uploadFiles = [args.contract];
  if (args.roi && fs.existsSync(args.roi)) {
    uploadFiles.push(args.roi);
  }

  try {
    // 致远OA合同正文字段允许多文件上传（同一个input）
    await page.locator('input[type=file]').first().setInputFiles(uploadFiles, { timeout: 10000 });
    uploadFiles.forEach(f => console.log('[✓] 已上传:', path.basename(f)));
    await sleep(3000);
  } catch (e) {
    console.log('[✗] 多文件上传失败，尝试单独上传:', e.message.slice(0, 60));
    // 备用：分别上传到第一个和第二个input
    try {
      const fileInputs = await page.locator('input[type=file]').all();
      console.log(`[·] 找到 ${fileInputs.length} 个文件上传框`);
      if (fileInputs.length >= 1) {
        await fileInputs[0].setInputFiles(args.contract);
        console.log('[✓] 合同已上传:', path.basename(args.contract));
        await sleep(2000);
      }
      if (args.roi && fileInputs.length >= 2) {
        await fileInputs[1].setInputFiles(args.roi);
        console.log('[✓] ROI已上传:', path.basename(args.roi));
        await sleep(2000);
      } else if (args.roi) {
        await fileInputs[0].setInputFiles([args.contract, args.roi]);
        console.log('[✓] ROI追加上传:', path.basename(args.roi));
        await sleep(2000);
      }
    } catch (e2) {
      console.log('[✗] 上传失败:', e2.message.slice(0, 60));
    }
  }

  // ===== 全自动对方签约主体lookup =====
  console.log('\n' + '='.repeat(60));
  console.log('[·] 全自动对方签约主体lookup流程...');

  // 从合同名称提取对方名字（"&"之前的部分）
  const contractName = REAL_VALUES.contractName.value;
  let oppositeName = contractName.split('&')[0].trim();

  // 特殊规则：人民币对私付款 → 统一搜"广西信华"（不是合同里的对方名字）
  if (currency === '人民币') {
    oppositeName = '广西信华';
    console.log('[·] 人民币对私 → 搜索对方主体: 广西信华');
  } else {
    console.log('[·] 对方名字:', oppositeName);
  }

  // Step 1: 点击铅笔图标打开lookup弹窗
  const triggered = await frame.evaluate(() => {
    const norm = (s) => String(s || '').replace(/\s+/g, '').replace(/[：:*]/g, '');
    const labels = Array.from(document.querySelectorAll('div, td, span, pre, label'));
    const label = labels.find(el => el.children.length < 5 && norm(el.innerText || '') === '对方签约主体');
    if (!label) return 'no label';
    const tr = label.closest('tr');
    const editIcon = tr?.querySelector('i.CAP.cap-icon-bianji, i[class*="cap-icon-bianji"]');
    if (editIcon) { editIcon.click(); return 'clicked'; }
    return 'no icon';
  });
  console.log('[·] 触发lookup弹窗:', triggered);
  await sleep(4000);

  // Step 2: 等lookup frame加载（layui-layer-iframe1）
  let lookupFrame = null;
  for (let i = 0; i < 10; i++) {
    lookupFrame = page.frames().find(f => f.name() === 'layui-layer-iframe1');
    if (lookupFrame && lookupFrame.url().includes('getdata')) break;
    await sleep(1000);
  }

  if (!lookupFrame) {
    console.log('[✗] lookup弹窗frame未找到');
  } else {
    console.log('[✓] lookup弹窗已加载');

    // Step 3: 在"供应商名称"搜索框输入对方名字
    // 探查发现：弹窗里 input.el-input__inner 文本框排序为
    //   [0]=隐藏的"暂无数据"附近 [1]=供应商编码 [2]=供应商名称 ← 用这个！
    const filledSearch = await lookupFrame.evaluate((searchName) => {
      // 列出所有可见的非readonly文本输入框
      const inputs = Array.from(document.querySelectorAll('input.el-input__inner'))
        .filter(i => !i.readOnly && i.type === 'text' && i.offsetWidth > 0 && i.offsetHeight > 0);

      if (inputs.length === 0) return { ok: false, reason: 'no inputs', count: 0 };

      // 直接用 inputs[2]（探查已确认是供应商名称）
      // 如果只有2个input，则用最后一个
      const idx = Math.min(2, inputs.length - 1);
      const nameInput = inputs[idx];

      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      nameInput.focus();
      setter.call(nameInput, searchName);
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
      nameInput.dispatchEvent(new Event('change', { bubbles: true }));

      return {
        ok: true,
        value: nameInput.value,
        usedIndex: idx,
        totalInputs: inputs.length,
        // 列出每个input所在父容器的最近文字（帮助调试）
        siblings: inputs.map((i, k) => {
          let cur = i.parentElement;
          let label = '';
          for (let lvl = 0; lvl < 4 && cur && !label; lvl++, cur = cur.parentElement) {
            const text = (cur.innerText || '').trim().split('\n')[0].slice(0, 30);
            if (text) label = text;
          }
          return { idx: k, label };
        })
      };
    }, oppositeName);
    console.log('[·] 在搜索框输入(用inputs[2]):', JSON.stringify(filledSearch).slice(0, 500));

    await sleep(1000);

    // Step 4: 点击查询按钮
    const queried = await lookupFrame.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const queryBtn = btns.find(b => (b.innerText || '').trim() === '查询');
      if (queryBtn) { queryBtn.click(); return 'clicked'; }
      return 'no btn';
    });
    console.log('[·] 点击查询:', queried);

    // 轮询等待搜索结果（最多10秒）
    let searchResults = { rowCount: 0, firstRowCells: [] };
    for (let waitI = 0; waitI < 10; waitI++) {
      await sleep(1000);
      searchResults = await lookupFrame.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('table.el-table__body tbody tr'));
        const rowCount = rows.length;
        const firstRowCells = rowCount > 0
          ? Array.from(rows[0].querySelectorAll('td')).map(td => (td.innerText || '').trim().slice(0, 30))
          : [];
        // 检查是否还在加载中（"暂无数据"提示）
        const emptyText = document.body.innerText.includes('暂无数据');
        return { rowCount, firstRowCells, emptyText };
      });
      if (searchResults.rowCount > 0 || searchResults.emptyText) break;
    }
    console.log('[·] 搜索结果行数:', searchResults.rowCount, '空数据:', searchResults.emptyText);
    if (searchResults.rowCount > 0) {
      console.log('[·] 第一行:', searchResults.firstRowCells.slice(0, 4).join(' | '));
    }

    // Step 6: 选中匹配的行
    //   优先级1：行内任意一列匹配合同里的银行账号/邮箱（最可靠）
    //   优先级2：供应商名称完全等于搜索词
    //   优先级3：供应商名称是单个名字且包含搜索词
    //   兜底：不选，让用户手动处理
    if (searchResults.rowCount > 0) {
      const selected = await lookupFrame.evaluate(({ searchName, bankEmails, bankNumbers }) => {
        const rows = Array.from(document.querySelectorAll('table.el-table__body tbody tr'));
        if (rows.length === 0) return { ok: false, reason: 'no rows' };

        // 收集每行的所有列文本
        const rowInfo = rows.map(r => {
          const tds = Array.from(r.querySelectorAll('td'));
          const cells = tds.map(td => (td.innerText || '').trim());
          // 表头: [checkbox, 供应商编码, 供应商名称, 户名, 子户账号, 银行名称, ...]
          return {
            code: cells[1] || '',
            name: cells[2] || '',
            account: cells[3] || '',  // 户名
            bankAccount: cells[4] || '', // 子户账号
            bankName: cells[5] || '',    // 银行名称
            allText: cells.join(' '),
            row: r
          };
        });

        // 优先级1：行的任意列包含合同里的银行邮箱/账号
        let target = null;
        let matchReason = '';
        const allAccountKeys = [...(bankEmails || []), ...(bankNumbers || [])];
        for (const key of allAccountKeys) {
          if (!key || key.length < 4) continue;
          target = rowInfo.find(r => r.allText.includes(key));
          if (target) { matchReason = `account match: ${key}`; break; }
        }

        // 优先级1.5：广西信华 + 包含"中国银行"
        if (!target && searchName === '广西信华') {
          target = rowInfo.find(r => r.name.includes('广西信华') && r.bankName.includes('中国银行'));
          if (target) matchReason = 'guangxi xinhua + BOC';
        }

        // 优先级2：名称完全等于搜索词
        if (!target) {
          target = rowInfo.find(r => r.name === searchName || r.name.replace(/\s+/g, '') === searchName.replace(/\s+/g, ''));
          if (target) matchReason = 'exact name';
        }

        // 优先级3：单个名字（不是多人复合）且包含搜索词
        if (!target) {
          target = rowInfo.find(r => {
            const parts = r.name.split(/\s+/).filter(Boolean);
            return parts.length <= 2 && r.name.includes(searchName);
          });
          if (target) matchReason = 'single-name include';
        }

        if (!target) {
          return {
            ok: false,
            reason: 'no match',
            candidates: rowInfo.map(r => ({ code: r.code, name: r.name.slice(0, 30), account: r.account.slice(0, 30), bankAccount: r.bankAccount.slice(0, 30), bankName: r.bankName.slice(0, 30) }))
          };
        }

        // 选中目标行的checkbox
        const inner = target.row.querySelector('.el-checkbox__inner');
        if (inner) { inner.click(); }
        else target.row.click();

        return {
          ok: true,
          matchReason,
          selectedCode: target.code,
          selectedName: target.name.slice(0, 50),
          selectedAccount: target.account.slice(0, 30),
          selectedBankAccount: target.bankAccount.slice(0, 30),
          selectedBankName: target.bankName.slice(0, 30),
          allCandidates: rowInfo.map(r => ({ code: r.code, name: r.name.slice(0, 30), account: r.account.slice(0, 30), bankName: r.bankName.slice(0, 30) }))
        };
      }, { searchName: oppositeName, bankEmails: contractBankInfo.emails, bankNumbers: contractBankInfo.numbers });
      console.log('[·] 选中行:', JSON.stringify(selected).slice(0, 700));
      await sleep(1500);

      // 没匹配上就不点确认，避免选错
      if (!selected.ok) {
        console.log('[!] 没匹配到正确的行，跳过点击确认');
      } else {
        // Step 7: 点击主page的"确认"按钮
        const confirmed = await page.evaluate(() => {
          const btn = document.querySelector('#layui-layer-btn-sure');
          if (btn) { btn.click(); return 'clicked sure'; }
          const btns = Array.from(document.querySelectorAll('a, button, span'));
          const conf = btns.find(b => (b.innerText || '').trim() === '确认');
          if (conf) { conf.click(); return 'clicked 确认'; }
          return 'no confirm btn';
        });
        console.log('[·] 点确认:', confirmed);
        await sleep(3000);
      }
    } else {
      console.log('[!] 搜索结果为空');
    }
  }

  // Step 8: 等待Vue model联动数据加载
  console.log('[·] 等待Vue model联动数据加载...');
  await sleep(3000);

  // 严格检测：对方主体的value必须是数字ID（真lookup选择的结果）
  let manualOk = false;
  for (let i = 0; i < 30; i++) {
    await sleep(2000);
    const status = await frame.evaluate(() => {
      const vm = document.querySelector('section.cap4-formmain').__vue__;
      const main = Object.values(vm.drawInitData.currentFormData.formmains)[0];

      const f0065 = main['field0065']; // 对方主体
      const f0067 = main['field0067']; // 成立时间（联动）
      const f0068 = main['field0068']; // 联系人（联动）
      const f0070 = main['field0070']; // 对方主体类型
      const f0078 = main['field0078']; // 合同预计总金额
      const f0084 = main['field0084']; // 合同金额（含税）
      const f0090 = main['field0090']; // 银行账户（联动）
      const f0091 = main['field0091']; // 银行账号（联动）
      const f0152 = main['field0152']; // 本币合同预计总金额
      const f0180 = main['field0180']; // 对方主体编码（联动）
      const f0192 = main['field0192']; // 付款计划

      // 真lookup选择的标志：value是长数字ID 或 联动字段(银行账号)有内容
      const oppositeRealLookup = !!(
        (f0065?.value && /^-?\d{10,}$/.test(String(f0065.value))) ||
        (f0091?.value && f0091.value.length >= 5 && !f0091.value.startsWith('field')) ||
        (f0180?.value && f0180.value.length > 0)
      );

      const paymentFilled = !!(f0192?.value && (f0192.value.includes('月') || f0192.value.includes('结')));
      const amountFilled = !!(f0078?.value && Number(f0078.value) >= 1000);
      const oppositeTypeFilled = !!(f0070?.value);

      return {
        oppositeRealLookup,
        paymentFilled,
        amountFilled,
        oppositeTypeFilled,
        oppositeValue: String(f0065?.value || ''),
        oppositeShow: String(f0065?.showValue || ''),
        oppositeType: String(f0070?.showValue || ''),
        oppositeFoundDate: String(f0067?.value || ''),
        bankAccount: String(f0090?.value || ''),
        bankNumber: String(f0091?.value || ''),
        oppositeCode: String(f0180?.value || ''),
        amountValue: String(f0078?.value || ''),
        baseAmountValue: String(f0152?.value || ''),
        financeAmountValue: String(f0084?.value || ''),
        paymentValue: String(f0192?.value || ''),
      };
    });

    process.stdout.write(`\r[·] 检测(${i+1}): 类型=${status.oppositeType||'空'} 主体=${status.oppositeValue.slice(0,15)||'空'} 金额=${status.amountValue||'空'} 付款=${status.paymentValue||'空'}    `);

    if (status.oppositeRealLookup && status.paymentFilled && status.amountFilled && status.oppositeTypeFilled) {
      console.log('\n[✓] 所有关键字段就绪:');
      console.log('    对方类型:', status.oppositeType);
      console.log('    对方主体value:', status.oppositeValue);
      console.log('    对方主体show:', status.oppositeShow);
      console.log('    对方编码:', status.oppositeCode);
      console.log('    成立时间:', status.oppositeFoundDate);
      console.log('    银行账户:', status.bankAccount);
      console.log('    银行账号:', status.bankNumber);
      console.log('    合同预计总金额:', status.amountValue);
      console.log('    本币金额:', status.baseAmountValue);
      console.log('    合同金额:', status.financeAmountValue);
      console.log('    付款计划:', status.paymentValue);
      manualOk = true;
      break;
    }
  }

  if (!manualOk) {
    console.log('\n[!] 等待超时，仍尝试保存');
  }

  // ===== 保存 =====
  console.log('[·] 保存待发...');
  await sleep(2000);

  let saveDone = false;
  let saveResult = null;

  page.on('response', async (resp) => {
    if (saveDone) return;
    try {
      const body = await resp.text();
      if (body.includes('"code":"200"') && body.includes('操作成功')) {
        saveDone = true;
        saveResult = '✓ 保存成功！';
      } else if (body.includes('操作异常')) {
        saveDone = true;
        const m = body.match(/"message":"([^"]+)"/);
        saveResult = '✗ ' + (m ? m[1] : body.slice(0, 200));
      }
    } catch {}
  });

  // 点击保存按钮（优先"保存待发"，其次"保存草稿"）
  try {
    const saved = await page.evaluate(() => {
      // 先找"保存待发"
      const links = Array.from(document.querySelectorAll('a, button'));
      const sendBtn = links.find(el => el.innerText?.includes('保存待发') && el.offsetHeight > 0);
      if (sendBtn) {
        sendBtn.click();
        return '保存待发';
      }
      // 找不到则找"保存草稿"
      const draftBtn = links.find(el => el.innerText?.includes('保存草稿') && el.offsetHeight > 0);
      if (draftBtn) {
        draftBtn.click();
        return '保存草稿';
      }
      // 最后尝试ID
      const idBtn = document.querySelector('#saveDraft_a');
      if (idBtn) {
        idBtn.click();
        return '保存草稿(ID)';
      }
      return null;
    });
    console.log(`[·] 点击了: ${saved || '未找到保存按钮'}`);
  } catch (e) {
    console.log('[!] 保存按钮点击失败:', e.message);
  }

  for (let i = 0; i < 15; i++) {
    if (saveDone) break;
    await sleep(1000);
  }

  console.log('\n' + '='.repeat(60));
  console.log(saveResult || '保存请求超时');
  console.log('='.repeat(60) + '\n');

  console.log('[·] 浏览器保持打开5分钟供检查...');
  await sleep(300000);

  await browser.close();
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
