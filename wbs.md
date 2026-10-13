# WBS 工作入口

本文件保留为后续 WBS 分解、开发任务拆解和验收记录的工作入口。

## 规范来源

- [WBS Excel 源分析](docs/design/wbs-excel-source-analysis.md)
- [WBS 功能设计](docs/design/wbs-feature-design.md)
- [PMO 产品蓝图](docs/design/pmo-kit-product-blueprint.md)
- [WBS 原始模板](inputs/reference/WBS_Templete1.xlsx)

## 当前工作顺序

1. 完成原始 Excel 的结构、样式、公式和规则快照。
2. 建立共享领域模型、schema 版本和迁移策略。
3. 实现 WBS 编辑网格、日期轴和甘特图。
4. 用真实 Excel 样例完成导入、导出和 round-trip 验收。
5. 在 WBS 闭环稳定后接入 RAID、决定、行动和周报。

详细任务应拆解到代码、测试和验收证据，而不是只记录为页面名称。
