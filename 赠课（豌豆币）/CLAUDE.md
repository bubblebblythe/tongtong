# 赠课（豌豆币）自动化

每周三发放上周三到本周二的赠课（豌豆币）自动化流程。

## 核心逻辑

**筛选规则**：只有**有首签时间（P列）的人**才有赠课资格，因为首签=报名课程

## 使用流程

### 1. 从Smartbi导出销售明细

```bash
node run.js [YYYY-MM-DD]
```

- 不带参数：自动计算最近的周二作为结束日期
- 带日期参数：使用指定日期（格式YYYY-MM-DD）

**示例**：
```bash
node run.js              # 自动处理最近周二
node run.js 2026-06-24   # 处理2026-06-24（周二）
```

**脚本功能**：
1. 打开Smartbi登录（手动登录）
2. 等待30秒让你在筛选面板选好条件
3. 自动点"导出全部数据"下载Excel到 `downloads/销售明细_YYYY-MM-DD.xlsx`

### 2. 处理数据筛选

```bash
node process.js [YYYY-MM-DD]
```

**筛选条件**：
- **P列（新签时间）非空** 且 **在周期内**（startDate到endDate）
- 周期：上周三到本周二（7天）

**输出文件**（到`output/`）：
- `data_YYYY-MM-DD.json`：完整JSON数据
- `sixin_YYYY-MM-DD.tsv`：思维表TSV
- `meishu_YYYY-MM-DD.tsv`：美术表TSV

**销售明细表结构**：
- 表头在第5行，数据从第6行开始
- A列：学科
- C列：用户ID（豌豆ID）
- D列：画啦啦ID
- I列：渠道名
- O列：新签订单号
- P列：新签时间（首签时间）⭐筛选依据
- Q列：新签月份
- R列：新签金额

### 3. 填充飞书表格

```bash
node fill-feishu.js [--test]
```

- `--test`：测试模式，填到测试文档（zcn85u6z5vj8.feishu.cn）
- 不带参数：正式模式，填到正式文档（my.feishu.cn）

**功能**：
1. 自动找"思维...（本周）"和"美术...（本周）"sheet
2. 复制表头到目标sheet
3. 清空数据行（保留表头）
4. 填充数据

**思维表（12列）**：
- A列：负责人（按渠道名推断：洁颖/悦彤）
- B列：豌豆ID（用户ID）
- C列：`VIP_WanDou`（固定）
- D列：空（人工填发放虚拟币数量）
- E列：`市场活动赠送`（固定）
- F列：`市场活动赠送-`（固定）
- G列：`5672`（固定）
- H列：`5464`（固定）
- I列：`16`（固定）
- J列：新签订单号
- K列：`是`（固定）
- L列：渠道名

**美术表（7列）**：
- A列：负责人
- B列：画啦啦ID
- C列：渠道名
- D-G列：订单号/首签时间/月份/金额

## 配置文件

### config.js

```javascript
export default {
  smartbiUrl: 'https://smartbi.xxxxxx.com/vision/index.jsp...',
  smartbiReportId: 'I8a8a81b018e4f1f58c7017fd0f6f0072',
  feishuDocUrl: 'https://my.feishu.cn/sheets/GFu3sySCBhr62ntmKQQcNxv1n4f',
  feishuTestUrl: 'https://zcn85u6z5vj8.feishu.cn/wiki/O3YiwecvXiNgack43ObcDjw7nrf'
}
```

## 负责人识别规则

渠道名包含关键词映射：
- `悦彤`/`lyt` → 悦彤
- `洁颖`/`jy` → 洁颖
- 默认 → 洁颖

## 依赖

```bash
npm install playwright exceljs
```

## 常见问题

### 1. 为什么数据量少了？

之前错误地用K列（末次渠道更新时间）筛选，会拉很多没报名的人。现在改用**P列（新签时间）**筛选，只有真正报名的人才会被选中发赠课。

### 2. clearAll清不干净？

飞书Wiki表格的`Ctrl+Shift+End`选择不可靠，脚本已改用名称框选择`A2:Z2000`删除。如果还有问题，手动清空后重跑。

### 3. 表头为什么要复制？

新建的"思维（本周）"/"美术（本周）"sheet是空白的，必须从最新的带日期的sheet（如"思维5.28-6.16（本周）"）复制表头。

## 文件说明

- `run.js`：Smartbi导出自动化
- `process.js`：数据筛选和处理
- `fill-feishu.js`：飞书表格填充
- `config.js`：配置文件
- `README.md`：原项目说明
- `CLAUDE.md`：本说明文档

## 时间节点

- **每周三**发放上周三到本周二的赠课
- 例：2026-06-25（周三）发放 → 筛选2026-06-18到2026-06-24的数据
