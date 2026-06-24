#!/usr/bin/env node
/**
 * 录制用户填写操作 - 监听Vue model变化和DOM事件
 * 用户在浏览器中手动填写，脚本记录每一步
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const RECORD_FILE = path.join(process.cwd(), 'recording.json');

async function main() {
  console.log('[·] 启动Edge浏览器（录制模式）...');
  const browser = await chromium.launch({
    headless: false,
    channel: 'msedge'
  });

  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // 打开OA
  console.log('[·] 打开OA登录页面...');
  await page.goto('https://zhiyuan-oa.vipthink.cn/seeyon');
  await sleep(3000);

  // 自动登录
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
  }

  // 打开表单
  console.log('[·] 打开供应商申请表单...');
  await page.goto('https://zhiyuan-oa.vipthink.cn/seeyon/collaboration/collaboration.do?method=newColl&from=templateNewColl&templateId=-3547057830925483134&portalId=1');
  await sleep(8000);

  let frame = null;
  for (let i = 0; i < 10; i++) {
    frame = page.frame({ name: 'zwIframe' });
    if (frame) break;
    await sleep(1000);
  }
  await frame.waitForSelector('section.cap4-formmain', { timeout: 15000 });
  await sleep(2000);

  console.log('[✓] 表单就绪');
  console.log('\n========================================');
  console.log('[!] 录制已开始');
  console.log('[!] 请在浏览器中手动填写所有字段');
  console.log('[!] 脚本会监控所有变化');
  console.log('[!] 完成后请保存草稿');
  console.log('========================================\n');

  // 注入监控脚本到iframe
  await frame.evaluate(() => {
    window.__recording = [];
    window.__startTime = Date.now();

    function record(type, data) {
      window.__recording.push({
        time: Date.now() - window.__startTime,
        type,
        ...data
      });
    }

    // 监听所有input和textarea变化
    document.addEventListener('change', (e) => {
      const t = e.target;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') {
        record('change', {
          tag: t.tagName,
          type: t.type,
          id: t.id,
          name: t.name,
          value: t.value,
          // 找到所属的field
          fieldId: t.closest('[data-field-id]')?.getAttribute('data-field-id') ||
                   t.closest('[id^="field"]')?.id,
          label: (() => {
            const tr = t.closest('tr, .cap4-formitem');
            if (!tr) return '';
            const labelEl = tr.querySelector('.cap4-formitem__label, .formMain_label, td:first-child');
            return (labelEl?.innerText || '').replace(/[：:*\s]/g, '');
          })()
        });
      }
    }, true);

    // 监听所有点击
    document.addEventListener('click', (e) => {
      const t = e.target;
      const text = (t.innerText || t.value || '').trim().slice(0, 50);
      if (text) {
        record('click', {
          tag: t.tagName,
          text,
          className: t.className,
          fieldId: t.closest('[data-field-id]')?.getAttribute('data-field-id'),
          label: (() => {
            const tr = t.closest('tr, .cap4-formitem');
            if (!tr) return '';
            const labelEl = tr.querySelector('.cap4-formitem__label, .formMain_label, td:first-child');
            return (labelEl?.innerText || '').replace(/[：:*\s]/g, '');
          })()
        });
      }
    }, true);

    // 监控Vue model变化（每秒拍一次快照）
    setInterval(() => {
      try {
        const vm = document.querySelector('section.cap4-formmain').__vue__;
        const main = Object.values(vm.drawInitData.currentFormData.formmains)[0];
        const snapshot = {};
        Object.entries(main).forEach(([id, f]) => {
          if (f && typeof f === 'object' && f.display) {
            snapshot[id] = {
              display: f.display,
              value: f.value,
              showValue: f.showValue
            };
          }
        });
        // 只在有变化时记录
        const lastSnap = window.__lastSnapshot;
        if (!lastSnap || JSON.stringify(snapshot) !== JSON.stringify(lastSnap)) {
          // 找出变化的字段
          const changes = {};
          Object.entries(snapshot).forEach(([id, curr]) => {
            const prev = lastSnap?.[id];
            if (!prev || prev.value !== curr.value || prev.showValue !== curr.showValue) {
              changes[id] = { ...curr, prevValue: prev?.value, prevShowValue: prev?.showValue };
            }
          });
          if (Object.keys(changes).length) {
            record('modelChange', { changes });
          }
          window.__lastSnapshot = snapshot;
        }
      } catch (e) {}
    }, 1000);

    console.log('[Recording] 监控已启动');
  });

  console.log('[·] 监控已启动，开始记录...');

  // 每30秒保存一次录制内容
  let recordCount = 0;
  const saveInterval = setInterval(async () => {
    try {
      const recording = await frame.evaluate(() => window.__recording || []);
      if (recording.length !== recordCount) {
        recordCount = recording.length;
        fs.writeFileSync(RECORD_FILE, JSON.stringify(recording, null, 2), 'utf8');
        console.log(`[·] 已记录 ${recordCount} 个事件，保存到 ${RECORD_FILE}`);
      }
    } catch (e) {}
  }, 30000);

  // 监听保存按钮点击，触发保存录制
  page.on('response', async (resp) => {
    try {
      const body = await resp.text();
      if (body.includes('"code":"200"') && body.includes('操作成功')) {
        console.log('\n[✓] 检测到保存成功！');
        const recording = await frame.evaluate(() => window.__recording || []);
        fs.writeFileSync(RECORD_FILE, JSON.stringify(recording, null, 2), 'utf8');
        console.log(`[✓] 录制已保存到 ${RECORD_FILE}`);
        console.log(`[✓] 总共 ${recording.length} 个事件`);

        // 提取所有model变化为最终值
        const finalValues = {};
        recording.forEach(r => {
          if (r.type === 'modelChange') {
            Object.entries(r.changes).forEach(([id, change]) => {
              finalValues[id] = {
                display: change.display,
                value: change.value,
                showValue: change.showValue
              };
            });
          }
        });
        const finalFile = path.join(process.cwd(), 'final_values.json');
        fs.writeFileSync(finalFile, JSON.stringify(finalValues, null, 2), 'utf8');
        console.log(`[✓] 最终字段值保存到 ${finalFile}`);
      }
    } catch {}
  });

  // 保持运行
  console.log('[·] 浏览器保持打开30分钟，请手动填写...');
  await sleep(30 * 60 * 1000);

  clearInterval(saveInterval);

  // 最后保存一次
  const recording = await frame.evaluate(() => window.__recording || []);
  fs.writeFileSync(RECORD_FILE, JSON.stringify(recording, null, 2), 'utf8');
  console.log(`[✓] 最终录制保存到 ${RECORD_FILE}`);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
