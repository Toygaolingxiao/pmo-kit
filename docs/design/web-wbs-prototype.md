# Web WBS 原型说明

## 结论

WBS 不需要以 Excel 作为核心实现。推荐采用：

- **Web 控制台**：日常编辑、计划、实绩、风险和治理会议的主工作面；
- **JSON**：项目计划的可读、可 diff、可版本管理的 source of truth；
- **Excel**：导入、导出、客户交换和与既有模板兼容的边界格式；
- **HTML/CSV/Mermaid/Markdown**：客户交付与会议材料输出。

Excel 仍然重要，但它更适合交换和兼容，不适合作为长期的交互核心。Web 可以提供冻结列、
动态日期轴、键盘编辑、撤销/重做、RAID 关联和状态报告生成，这些都是复制 Excel 后很难稳定维护的能力。

## 本地预览

```powershell
cd C:\code\pmo-kit
python -m http.server 4173
```

打开 `http://localhost:4173/web/`。

当前原型包含：

- Control tower 项目总览；
- 里程碑与管理关注事项；
- WBS / schedule 时间条；
- RAID 卡片；
- JSON 导出按钮；
- 响应式布局与减少动态效果支持。

这不是最终编辑器，而是用 pmo-kit 自身的 `examples/development/project-plan.json` 验证产品信息架构和视觉方向的第一版。
