#!/usr/bin/env node

/**
 * OA合同申请自动化 Skill 执行脚本
 *
 * 用法：
 *   /contract contract="合同路径" [roi="ROI路径"]
 */

const { spawn } = require('child_process');
const path = require('path');

// 解析命令行参数
const args = process.argv.slice(2);
let contractPath = '';
let roiPath = '';

args.forEach(arg => {
  if (arg.startsWith('contract=')) {
    contractPath = arg.substring('contract='.length).replace(/^["']|["']$/g, '');
  } else if (arg.startsWith('roi=')) {
    roiPath = arg.substring('roi='.length).replace(/^["']|["']$/g, '');
  }
});

if (!contractPath) {
  console.error('❌ 错误：必须提供合同路径');
  console.error('用法: /contract contract="合同路径" [roi="ROI路径"]');
  process.exit(1);
}

// 构建命令
const scriptDir = path.dirname(__filename);
const runRealPath = path.join(scriptDir, 'run_real.mjs');

const cmd = 'node';
const cmdArgs = [runRealPath, '--contract', contractPath];
if (roiPath) {
  cmdArgs.push('--roi', roiPath);
}

console.log(`[·] 启动OA合同申请自动化...`);
console.log(`[·] 合同: ${path.basename(contractPath)}`);
if (roiPath) {
  console.log(`[·] ROI: ${path.basename(roiPath)}`);
}
console.log('');

// 执行脚本
const child = spawn(cmd, cmdArgs, {
  cwd: scriptDir,
  stdio: 'inherit',
  shell: true
});

child.on('close', (code) => {
  if (code === 0) {
    console.log('\n✅ 脚本执行完成！请在OA待发箱中检查并提交。');
  } else {
    console.error(`\n❌ 脚本执行失败，退出码: ${code}`);
    process.exit(code);
  }
});
