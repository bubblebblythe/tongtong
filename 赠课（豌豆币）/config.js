import path from 'node:path';

export const config = {
  loginUrl: 'https://bi.61info.cn/smartbi/vision/index.jsp',
  authFile: path.join(process.cwd(), 'auth.json'),
  monthlyAuthFile: path.join(process.cwd(), '..', '月度账单自动生成', 'auth.json'),
  downloadDir: path.join(process.cwd(), 'downloads'),
  outputDir: path.join(process.cwd(), 'output'),
  logDir: path.join(process.cwd(), 'logs'),
  loginSuccessSelector: 'text=分析展现',
  menuPath: ['海外直播业务线', '海外商务', '非港澳商务', '销售明细_商务专用'],
  startDate: '2020-01-01',
};
