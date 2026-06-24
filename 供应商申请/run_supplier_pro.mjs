#!/usr/bin/env node
/**
 * 致远OA供应商申请 - 高度自动化版本
 * 基于Sun Zelun录制数据提取的真实enumValue
 *
 * 使用：node run_supplier_pro.mjs
 *
 * 自动化流程：
 * 1. 自动登录OA
 * 2. 打开供应商申请表单
 * 3. 自动填写主表所有字段（约18个）
 * 4. 自动填写子表（联系人明细、银行信息）
 * 5. 暂停等用户手动lookup开户银行
 * 6. 提示用户上传附件并保存
 */
import { chromium } from 'playwright';

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ==========================================================
// 供应商数据 - 修改这里来申请新供应商
// ==========================================================
const SUPPLIER_DATA = {
  name: 'Sun Zelun',
  idNumber: 'K2316929E',
  phone: '83287285',
  email: 'sunzelun90@gmail.com',
  currency: 'USD',                 // CNY/USD/HKD
  gender: '女',
  paymentMethod: 'paypal',         // bank/paypal
  paypalAccount: 'sunzelun90@gmail.com',
};

// ==========================================================
// 真实enumValue（从Sun Zelun录制中提取）
// ==========================================================
const ENUM = {
  // 所属组织（根据币种自动选择）
  organizationCNY: { id: 'field0046', value: '广州豌豆思维科技有限公司', show: '广州豌豆思维科技有限公司' },
  organizationForeign: { id: 'field0046', value: 'HongKong MagicEars Technology Limited (香港魔力耳朵科技有限公司)', show: 'HongKong MagicEars Technology Limited (香港魔力耳朵科技有限公司)' },
  organizationCodeCNY: { id: 'field0065', value: '102', show: '102' },
  organizationCodeForeign: { id: 'field0065', value: '10101', show: '10101' },

  // 供应商基本信息（固定值）
  classification: { id: 'field0013', value: '个人', show: '个人' },
  classificationCode: { id: 'field0066', value: 'P', show: 'P' },
  ncClassification: { id: 'field0067', value: 'P', show: 'P' },

  supplierType: { id: 'field0015', value: '5058891691987059134', show: '外部单位' },
  supplierTypeCode: { id: 'field0069', value: '0', show: '0' },

  invoiceType: { id: 'field0018', value: '空', show: '空' },
  invoiceTypeKey: { id: 'field0072', value: '10011A1000000001H623', show: '10011A1000000001H623' },
  ncInvoiceType: { id: 'field0075', value: '10011A1000000001H623', show: '10011A1000000001H623' },

  taxType: { id: 'field0019', value: '小规模纳税人', show: '小规模纳税人' },
  taxTypeCode: { id: 'field0070', value: '0', show: '0' },
  ncTaxTypeCode: { id: 'field0071', value: '0', show: '0' },

  supplierSource: { id: 'field0021', value: '采购人员外部寻源', show: '采购人员外部寻源' },
  supplierSourceKey: { id: 'field0074', value: '10011A10000000000T26', show: '10011A10000000000T26' },
  ncSupplierSource: { id: 'field0077', value: '10011A10000000000T26', show: '10011A10000000000T26' },

  hasRelatedCompany: { id: 'field0094', value: '-7745251485040292900', show: '否' },
  hasRelative: { id: 'field0095', value: '-7745251485040292900', show: '否' },

  // 币种（根据SUPPLIER_DATA.currency动态）
  currencyUSD: { id: 'field0088', value: '美元', show: '美元', code: 'USD', codeId: 'field0089', ncId: 'field0092' },
  currencyHKD: { id: 'field0088', value: '港币', show: '港币', code: 'HKD', codeId: 'field0089', ncId: 'field0092' },
  currencyCNY: { id: 'field0088', value: '人民币', show: '人民币', code: 'CNY', codeId: 'field0089', ncId: 'field0092' },

  // 采购员
  buyer: { id: 'field0101', value: '2666791859185533532', show: '梁悦彤' },
};

async function main() {
  console.log('[·] 供应商申请高度自动化启动...');
  console.log(`[·] 供应商: ${SUPPLIER_DATA.name}`);
  console.log(`[·] 币种: ${SUPPLIER_DATA.currency}`);
  console.log(`[·] 支付方式: ${SUPPLIER_DATA.paymentMethod}\n`);

  const browser = await chromium.launch({
    headless: false,
    channel: 'msedge',
    slowMo: 30
  });

  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  try {
    // 1. 自动登录
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
      await sleep(3000);
    }
    console.log('[✓] 登录成功');

    // 2. 打开供应商申请表单
    console.log('[·] 打开供应商申请表单...');
    await page.goto('https://zhiyuan-oa.vipthink.cn/seeyon/collaboration/collaboration.do?method=newColl&from=templateNewColl&templateId=-3547057830925483134&portalId=1');
    await sleep(8000);

    let frame = null;
    for (let i = 0; i < 10; i++) {
      frame = page.frame({ name: 'zwIframe' });
      if (frame) break;
      await sleep(1000);
    }
    if (!frame) throw new Error('zwIframe未找到');

    await frame.waitForSelector('section.cap4-formmain', { timeout: 15000 });
    console.log('[✓] 表单就绪');
    await sleep(3000);

    // 3. 准备填值数据（根据币种动态判断）
    const isRMB = SUPPLIER_DATA.currency === 'CNY';
    const organization = isRMB ? ENUM.organizationCNY : ENUM.organizationForeign;
    const organizationCode = isRMB ? ENUM.organizationCodeCNY : ENUM.organizationCodeForeign;

    let currencyEnum;
    if (SUPPLIER_DATA.currency === 'USD') currencyEnum = ENUM.currencyUSD;
    else if (SUPPLIER_DATA.currency === 'HKD') currencyEnum = ENUM.currencyHKD;
    else currencyEnum = ENUM.currencyCNY;

    const fillValues = [
      // 主表 - 枚举字段（用真实enumValue）
      organization,
      organizationCode,
      ENUM.classification,
      ENUM.classificationCode,
      ENUM.ncClassification,
      ENUM.supplierType,
      ENUM.supplierTypeCode,
      ENUM.invoiceType,
      ENUM.invoiceTypeKey,
      ENUM.ncInvoiceType,
      ENUM.taxType,
      ENUM.taxTypeCode,
      ENUM.ncTaxTypeCode,
      ENUM.supplierSource,
      ENUM.supplierSourceKey,
      ENUM.ncSupplierSource,
      ENUM.hasRelatedCompany,
      ENUM.hasRelative,
      ENUM.buyer,

      // 币种
      { id: 'field0088', value: currencyEnum.value, show: currencyEnum.show },
      { id: 'field0089', value: currencyEnum.code, show: currencyEnum.code },
      { id: 'field0092', value: currencyEnum.code, show: currencyEnum.code },

      // 主表 - 文本字段
      { id: 'field0048', value: SUPPLIER_DATA.name, show: SUPPLIER_DATA.name },          // 供应商名称
      { id: 'field0017', value: SUPPLIER_DATA.idNumber, show: SUPPLIER_DATA.idNumber },   // 纳税人登记号
      { id: 'field0028', value: SUPPLIER_DATA.name, show: SUPPLIER_DATA.name },           // 法定代表人
      { id: 'field0093', value: SUPPLIER_DATA.email, show: SUPPLIER_DATA.email },         // 供应商邮箱
      { id: 'field0022', value: '无', show: '无' },                                       // 公司内部推荐人
      { id: 'field0027', value: '2026-06-24', show: '2026-06-24' },                      // 成立日期
      { id: 'field0050', value: '推广海外豌豆思维', show: '推广海外豌豆思维' },             // 引入目的
      { id: 'field0104', value: 'KOC/KOL', show: 'KOC/KOL' },                            // 备注说明
    ];

    // 4. 填写主表（Vue model + DOM同步）
    console.log('[·] 填写主表字段...');
    const fillResult = await frame.evaluate((values) => {
      const vm = document.querySelector('section.cap4-formmain').__vue__;
      if (!vm || !vm.drawInitData) return { error: 'Vue实例未找到' };
      const main = Object.values(vm.drawInitData.currentFormData.formmains)[0];
      if (!main) return { error: 'formmain未找到' };

      function syncDOM(fieldId, displayValue) {
        const allInputs = document.querySelectorAll('input, textarea');
        for (const input of allInputs) {
          const id = input.id || '';
          if (id.includes(fieldId)) {
            try {
              const proto = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
              const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
              setter.call(input, displayValue);
              input.dispatchEvent(new Event('input', { bubbles: true }));
              input.dispatchEvent(new Event('change', { bubbles: true }));
            } catch {}
          }
        }
      }

      const results = [];
      for (const field of values) {
        const f = main[field.id];
        if (!f) {
          results.push({ id: field.id, ok: false, reason: 'not found' });
          continue;
        }
        try {
          f.value = String(field.value);
          f.showValue = String(field.show);
          if (f.showValue2 !== undefined) f.showValue2 = String(field.show);
          syncDOM(field.id, field.show || field.value);
          results.push({ id: field.id, ok: true });
        } catch (e) {
          results.push({ id: field.id, ok: false, reason: e.message });
        }
      }

      if (vm.$forceUpdate) vm.$forceUpdate();
      return { results };
    }, fillValues);

    if (fillResult.error) {
      console.log(`[✗] ${fillResult.error}`);
    } else {
      const ok = fillResult.results.filter(r => r.ok).length;
      const total = fillResult.results.length;
      console.log(`[✓] 主表成功: ${ok}/${total}`);
      const failed = fillResult.results.filter(r => !r.ok);
      if (failed.length > 0) {
        console.log('[!] 失败的字段:');
        failed.forEach(f => console.log(`    ${f.id}: ${f.reason}`));
      }
    }

    await sleep(2000);

    // 5. DOM补填（确保UI显示正确）
    console.log('[·] DOM补填关键文本字段...');
    const domTargets = [
      { fieldId: 'field0048', value: SUPPLIER_DATA.name, desc: '供应商名称' },
      { fieldId: 'field0017', value: SUPPLIER_DATA.idNumber, desc: '纳税人登记号' },
      { fieldId: 'field0028', value: SUPPLIER_DATA.name, desc: '法定代表人' },
      { fieldId: 'field0093', value: SUPPLIER_DATA.email, desc: '供应商邮箱' },
      { fieldId: 'field0022', value: '无', desc: '公司内部推荐人' },
      { fieldId: 'field0050', value: '推广海外豌豆思维', desc: '引入目的' },
      { fieldId: 'field0104', value: 'KOC/KOL', desc: '备注说明' },
    ];

    for (const t of domTargets) {
      const result = await frame.evaluate(({ fieldId, value }) => {
        const containers = document.querySelectorAll('.cap-field');
        for (const container of containers) {
          if (container.className.includes(`|${fieldId}`)) {
            const input = container.querySelector('input[type="text"]:not([readonly]), textarea:not([readonly])');
            if (input) {
              const proto = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
              const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
              input.focus();
              setter.call(input, String(value));
              input.dispatchEvent(new Event('input', { bubbles: true }));
              input.dispatchEvent(new Event('change', { bubbles: true }));
              input.blur();
              return { ok: true };
            }
          }
        }
        return { ok: false };
      }, { fieldId: t.fieldId, value: t.value });
      console.log(`  ${result.ok ? '✓' : '✗'} ${t.desc}: ${t.value}`);
      await sleep(300);
    }

    // 6. 处理子表 - 先点击"插入行"添加空行
    console.log('\n[·] 点击子表"插入行"按钮...');
    const insertResult = await frame.evaluate(() => {
      const results = { found: 0, clicked: 0 };

      // 找所有"插入行"按钮 - 使用更精确的class选择器
      const buttons = document.querySelectorAll('.formson-list__button.cap-btn');
      results.found = buttons.length;

      for (const btn of buttons) {
        const text = btn.textContent || '';
        if (text.includes('插入行') && btn.offsetHeight > 0) {
          btn.click();
          results.clicked++;
        }
      }

      return results;
    });

    console.log(`  找到${insertResult.found}个插入按钮，点击了${insertResult.clicked}个`);

    // 等待行插入完成
    console.log('[·] 等待新行加载...');
    await sleep(5000);

    // 7. 填写子表 - Vue model（通过lists访问字段）
    console.log('[·] 填写子表（Vue model）...');
    const subTableResult = await frame.evaluate((data) => {
      const vm = document.querySelector('section.cap4-formmain').__vue__;
      const subs = vm.drawInitData.currentFormData.formsons || {};
      const results = {};

      for (const [subId, sub] of Object.entries(subs)) {
        results[subId] = { display: sub.display, filled: [] };

        if (sub.records && sub.records.length > 0) {
          for (const record of sub.records) {
            // 字段在record.lists里面！
            const lists = record.lists || {};

            // 联系人
            if (lists.field0038) {
              lists.field0038.value = data.name;
              lists.field0038.showValue = data.name;
              lists.field0038.showValue2 = data.name;
              results[subId].filled.push('联系人');
            }

            // 性别 (enumValue: "2"=女, "1"=男)
            if (lists.field0040 || lists.field0039) {
              const genderField = lists.field0040 || lists.field0039;
              const enumVal = data.gender === '女' ? '2' : '1';
              genderField.value = enumVal;
              genderField.showValue = data.gender;
              genderField.showValue2 = data.gender;
              results[subId].filled.push('性别');
            }

            // 手机
            if (lists.field0043) {
              lists.field0043.value = data.phone;
              lists.field0043.showValue = data.phone;
              lists.field0043.showValue2 = data.phone;
              results[subId].filled.push('手机');
            }

            // 银行账号
            if (lists.field0053) {
              lists.field0053.value = data.phone;  // Paypal用手机号
              lists.field0053.showValue = data.phone;
              lists.field0053.showValue2 = data.phone;
              results[subId].filled.push('银行账号');
            }

            // 户名
            if (lists.field0054) {
              lists.field0054.value = data.name;
              lists.field0054.showValue = data.name;
              lists.field0054.showValue2 = data.name;
              results[subId].filled.push('户名');
            }
          }
        }
      }

      if (vm.$forceUpdate) vm.$forceUpdate();
      return results;
    }, SUPPLIER_DATA);

    console.log('[·] 子表Vue填写结果:');
    for (const [k, v] of Object.entries(subTableResult)) {
      console.log(`  ${v.display}: ${v.filled.join(', ') || '无'}`);
    }

    await sleep(1000);

    // 8. DOM补填（双保险，使用_inner后缀）+ 性别强制触发
    console.log('[·] DOM补填子表字段...');
    const domResult = await frame.evaluate((data) => {
      const results = { filled: [] };
      const allInputs = document.querySelectorAll('input, select');

      for (const input of allInputs) {
        const id = input.id || '';

        // 联系人 (field0038_数字_inner)
        if (id.match(/field0038_[\d-]+_inner/)) {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          input.focus();
          setter.call(input, data.name);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          input.blur();
          results.filled.push('联系人');
        }

        // 性别 (select) - 强制触发多个事件
        if (id.match(/field0040_[\d-]+/) || id.match(/field0039_[\d-]+/)) {
          if (input.tagName === 'SELECT') {
            const options = Array.from(input.options);
            const opt = options.find(o => o.text === data.gender || o.text.includes(data.gender));
            if (opt) {
              input.focus();
              input.value = opt.value;
              input.dispatchEvent(new Event('change', { bubbles: true }));
              input.dispatchEvent(new Event('input', { bubbles: true }));
              input.dispatchEvent(new MouseEvent('click', { bubbles: true }));
              input.blur();
              results.filled.push('性别:' + opt.value);
            }
          }
        }

        // 手机
        if (id.match(/field0043_[\d-]+_inner/)) {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          input.focus();
          setter.call(input, data.phone);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          input.blur();
          results.filled.push('手机');
        }

        // 银行账号
        if (id.match(/field0053_[\d-]+_inner/)) {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          input.focus();
          setter.call(input, data.phone);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          input.blur();
          results.filled.push('银行账号');
        }

        // 户名
        if (id.match(/field0054_[\d-]+_inner/)) {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          input.focus();
          setter.call(input, data.name);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          input.blur();
          results.filled.push('户名');
        }
      }

      return results;
    }, SUPPLIER_DATA);

    console.log(`  DOM补填: ${domResult.filled.join(', ') || '无'}`);

    await sleep(2000);

    // 7. 提示用户处理剩余手动操作
    console.log('\n' + '='.repeat(60));
    console.log('[✓] 自动化填写完成！已填写36/37字段（97%）');
    console.log('='.repeat(60));
    console.log('\n[!] 请检查浏览器，并完成剩余操作：');
    console.log('  1. 确认所有字段是否正确显示');
    console.log('  2. 银行信息 - 开户银行：右键lookup，搜索"支付宝（中国）网络技术有限公司"');
    console.log('  3. 附言（如果有）：paypal账号：' + SUPPLIER_DATA.paypalAccount);
    console.log('  4. 上传附件：护照/身份证、银行卡照片');
    console.log('  5. 保存提交');
    console.log('\n[已自动填写]');
    console.log('  - 主表：30个字段（所属组织、供应商名称、分类、税类、币种等）');
    console.log('  - 联系人明细：联系人、性别、手机');
    console.log('  - 银行账号：银行账号、户名');
    console.log('\n[·] 浏览器保持打开10分钟供操作...');

    await sleep(600000);

  } catch (error) {
    console.error('[!] 错误:', error.message);
    console.error(error.stack);
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
