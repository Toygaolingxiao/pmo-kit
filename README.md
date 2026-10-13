# pmo-kit

面向项目负责人、PMO 和咨询顾问的**本地优先**项目控制台。用一份可读、可 diff 的 `project-plan.json` 管理 WBS、进度、日历、RAID 和课题，并导出会议与客户材料。

当前版本 **1.1.1**。它不是 Jira 或 MS Project 的替代品，也不提供账号、云同步或实时协作。

## 能做什么

在浏览器里打开工作台：

- 分层 WBS：增删改、缩进、复制、列宽、行内编辑、撤销/重做
- 计划条、实绩条、里程碑和依赖关系
- 以状态日为基准的稲妻线（进度折线）
- 日本祝日与定例会议，并可把会议交给 Outlook 本地或 Outlook Web
- 项目概览、RAID、变更履历
- 课题的状态流转：交接、受领、期限变更申请、要更新队列
- JSON 导入导出，以及简化的 Excel 往返

在命令行生成交付包：

- `plan.html`：浏览器打开后可打印为 PDF
- `wbs.csv` / `schedule.csv` / `milestones.csv`
- `gantt.mmd`：Mermaid 甘特图
- `reports/weekly-status-latest.md`：周报草稿
- `status-summary.json`：加权进度和偏差摘要

## 不包含什么

这些是明确放在后面、或不进入核心范围的能力：

- 账号、权限、实时协作、云端同步
- 自动排程引擎
- 多项目组合视图
- 与参考 Excel 模板的像素级、公式级复刻
- 标准 WBS 模板库
- 用 JSON Schema（`ajv`）做的独立校验文件。运行时边界校验已经在 `src/domain/project-plan.ts`

`examples/development/project-plan.json` 是工作台的示例计划。里面的任务状态用来演示画面，不代表本仓库的发行完成度。

## 环境

- Node.js 20 或更高
- 现代浏览器

## 快速开始

```bash
npm install
npm run serve
```

浏览器打开 [http://localhost:4173/web/](http://localhost:4173/web/)。第一次会载入开发示例计划，之后的编辑保存在本机 `localStorage`。

生成交付包：

```bash
npm run render:development
# 输出在 examples/development/out/ ，该目录不入库
```

渲染自己的计划：

```bash
npm run render -- --in path/to/project-plan.json --out path/to/out
```

字段约定见 [`schema/project-plan.schema.md`](./schema/project-plan.schema.md)。

检查：

```bash
npm test
npm run typecheck
```

## 仓库结构

```text
pmo-kit/
├─ web/                 # 浏览器工作台
├─ src/                 # 计划校验、交付物渲染、Excel 往返
├─ schema/              # project-plan 字段约定
├─ examples/development/# 可公开的示例计划
├─ inputs/              # 参考模板。inputs/private/ 只留在本机
├─ docs/                # 版本规则、变更记录和设计说明
├─ server.js            # 本地静态服务
└─ VERSION              # 版本正本
```

客户计划、未脱敏的 Excel 和其他私有输入放在 `inputs/private/`。这个目录已被 `.gitignore` 排除，不要提交。

## 语言

工作台、命令行提示和代码注释使用日语。设计说明以中文为主，变更记录以日语为主。对话语言不影响仓库里的界面文案。

## 许可

仓库公开，便于阅读和运行。目前没有附加开源许可证，不授予再分发或商用许可。若需要使用、修改或再分发，请先与作者确认。
