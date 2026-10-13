# WBS 功能开发设计方案（v0.1）

> 来源：本方案基于 [`wbs-excel-source-analysis.md`](./wbs-excel-source-analysis.md)（原 Excel 版 WBS 模板的解析笔记）整理而成，
> 目标是把「Excel 风格 WBS / 甘特图」能力整合进 [pmo-kit](../../README.md) 现有的
> `project-plan.json → HTML/CSV/Mermaid/周报` 渲染管线，而不是另起一个产品。
>
> 与现有 schema 的关系见 [第 9 节](#9-与现有-project-planjson-schema-的对齐)。
>
> 关于“行为 1:1”与“视觉 1:1”的验收边界，以及 Web 技术栈和本地优先架构，见
> [`architecture-decision-wbs-web.md`](./architecture-decision-wbs-web.md)。
>
> WBS 在完整 PMO 产品中的定位、与 RAID/决定/变更/状态报告等能力的关系，见
> [`pmo-kit-product-blueprint.md`](./pmo-kit-product-blueprint.md)。

## 目录

1. [背景与定位](#1-背景与定位)
2. [业务能力清单](#2-业务能力清单)
3. [数据模型设计](#3-数据模型设计)
4. [项目头部 / 日历设置](#4-项目头部--日历设置)
5. [任务表（WBS 主体）](#5-任务表wbs-主体)
6. [日期轴与甘特图](#6-日期轴与甘特图)
7. [“更新”与稲妻线（进度偏差线）](#7-更新与稲妻线进度偏差线)
8. [变更履历 / 样例模板](#8-变更履历--样例模板)
9. [与现有 project-plan.json schema 的对齐](#9-与现有-project-planjson-schema-的对齐)
10. [MVP 分期计划](#10-mvp-分期计划)
11. [异常与校验规则汇总](#11-异常与校验规则汇总)

---

## 1. 背景与定位

- 原始素材：一份日文 Excel WBS 模板，具备「项目头部信息 + 休日设置 + 周次会议 + WBS 任务分解 +
  计划/实绩/进度 + 日别 schedule（甘特图）+ 稲妻线偏差提示 + 变更履历 + WBS 样例」等能力。
- **不是**要做 Jira / MS Project 替代品，延续 pmo-kit 的产品哲学：本地优先、可版本管理、可直接
  生成客户可读交付物（`plan.html` / CSV / Mermaid gantt）。
- 因此本方案把 Excel 模板里"Web 应用"形态的建议，收敛为**对 `project-plan.json` 的字段扩展 +
  对 `src/render.ts` 渲染逻辑的增强**，而非独立的前端 CRUD 系统。是否在未来引入可编辑的 Web UI
  作为第二期，见 [第 10 节](#10-mvp-分期计划)。

## 2. 业务能力清单

| 能力 | 说明 | 对应原模板章节 |
| --- | --- | --- |
| 项目基础信息 | 项目名、阶段、开始日、创建者/更新者、更新时间 | 源分析 §3.1 |
| 日历 / 休日设置 | 周末自动休日 + 手动追加祝日/公司休日 | 源分析 §3.2 |
| 周次会议标记 | 日期轴上标记固定周会日 | 源分析 §3.3 |
| WBS 任务分解 | 大项目/中项目/小项目三级 + 项番 | 源分析 §4 |
| 计划字段 | 计划开始/结束日、计划工数 | 源分析 §5.1 |
| 实绩字段 | 实际开始/结束日、实际工数、进度率 | 源分析 §5.2 |
| 甘特图 / 日别 schedule | 按日期展开的横向时间轴 + 计划条/实际条 | 源分析 §3.4、§8 |
| 今日高亮 + 稲妻线 | 进度相对计划的偏差可视化（提前/延迟） | 源分析 §7 |
| 变更履历 | 版本、更新日、更新者、更新内容 | 源分析 §10 |
| WBS 样例模板 | 标准任务库，供新项目复制 | 源分析 §9 |
| 导入 / 导出 Excel | 双向兼容，需处理日期序列值转换 | 源分析 §18、§19 |

## 3. 数据模型设计

沿用 pmo-kit 现有的 `wbs[]` 结构（见
[`project-plan.schema.md`](../../schema/project-plan.schema.md)），并按以下方式**扩展字段**（新增字段均为可选，向后兼容旧
`project-plan.json`）：

```jsonc
{
  "meta": {
    "projectName": "示例项目",
    "phase": "设计",              // 新增：项目阶段
    "planStart": "2026-01-05",
    "planEnd": "2026-06-30",
    "dataDate": "2026-02-10",     // 今日线基准
    "overallStatus": "GREEN",
    "creator": "san",             // 新增
    "updater": "san",             // 新增
    "updatedAt": "2026-02-10T09:00:00+09:00" // 新增
  },
  "calendar": {                    // 新增：休日 / 周会设置
    "weekendAutoHoliday": true,
    "holidays": [
      { "date": "2026-01-01", "type": "祝日", "note": "元旦" }
    ],
    "weeklyMeetings": [
      { "weekday": "MON", "note": "周例会" }
    ]
  },
  "wbs": [
    {
      "id": "1.2",
      "level": 2,
      "majorItem": "需求定义",       // 新增：大项目
      "middleItem": "现状调研",     // 新增：中项目
      "minorItem": "访谈记录整理",  // 新增：小项目/作业详细
      "status": "in_progress",
      "pct": 40,
      "owner": "PMO",
      "start": "2026-01-10",         // 计划开始日 plannedStartDate
      "end": "2026-01-20",           // 计划结束日 plannedEndDate
      "plannedEffort": 5,            // 新增：计划工数（人日）
      "actualStart": "2026-01-11",   // 新增
      "actualEnd": null,             // 新增
      "actualEffort": 3,             // 新增
      "deliverable": "需求访谈纪要",
      "acceptance": "客户确认无异议",
      "checklistRef": null,
      "dependsOn": ["1.1"]
    }
  ],
  "changeLog": [                    // 新增：变更履历
    {
      "version": "0.2",
      "date": "2026-02-10",
      "author": "san",
      "note": "调整需求定义阶段任务拆分"
    }
  ]
}
```

字段与原 Excel 术语的映射详见 [第 9 节](#9-与现有-project-planjson-schema-的对齐)。

## 4. 项目头部 / 日历设置

- `meta.phase` / `meta.creator` / `meta.updater` / `meta.updatedAt`：渲染在 `plan.html` 封面区。
- `calendar.holidays[]`：周末默认按休日处理（`weekendAutoHoliday`），额外祝日/公司休日需显式列出，
  避免把 Excel serial number 带入 JSON —— **一律使用 ISO 8601 日期字符串**。
- `calendar.weeklyMeetings[]`：仅做标记展示，不参与工数计算。
- 甘特图渲染时，休日列应有区别底色；任务落在休日不阻断排期，但会在计算「计划进度率」时可选择
  跳过休日（see [第 7 节](#7-更新与稲妻线进度偏差线)）。

## 5. 任务表（WBS 主体）

- 三级任务名沿用 `majorItem` / `middleItem` / `minorItem`，与既有 `wbs[].id` 的层级（`1` /
  `1.2` / `1.2.1`）一一对应，`level` 字段保持不变用于渲染缩进与甘特默认折叠深度。
- 计划态字段（项目计划时录入）：`start` / `end` / `plannedEffort`。
- 实绩态字段（项目进行时录入）：`actualStart` / `actualEnd` / `actualEffort` / `pct`。
- `deliverable`（成果物）/ `acceptance`（验收标准）/ `checklistRef`（工程轨关联）保持不变，
  是 pmo-kit 区别于纯 Excel 模板的"客户可验收物"设计，予以保留并强化。

## 6. 日期轴与甘特图

- 复用 `meta.planStart` / `planEnd` 作为整体日期轴范围，`meta.dataDate` 作为"今日线"。
- `src/render.ts` 生成 `gantt.mmd`（Mermaid）与 `plan.html` 内嵌甘特条时：
  - 计划条：由 `start` → `end` 绘制。
  - 实绩条：由 `actualStart` → `actualEnd`（若 `actualEnd` 为空，则画到 `dataDate` 为止）绘制在
    计划条下方或叠加显示进度百分比。
  - 休日列使用浅灰底色标出（`calendar.holidays` ∪ 周末）。
- 不采用 Excel「复制列延长」的方式，日期轴按 `planStart`/`planEnd` 自动生成，未来如需自定义显示
  窗口，可在渲染参数中加 `--from` / `--to`。

## 7. "更新"与稲妻线（进度偏差线）

- pmo-kit 是**静态渲染**工具（`npm run render` 生成一次性 `plan.html`），因此不需要 Excel 里
  "点击更新按钮重绘"的交互态；渲染脚本每次运行即等价于一次"更新"。
- 稲妻线（偏差线）计算规则移植如下：

```text
计划总天数 = end - start + 1
计划进度率 = clamp((dataDate - start + 1) / 计划总天数, 0, 1) * 100
偏差 = pct - 计划进度率
偏差 > 0  → 提前（绿色 / 右侧）
偏差 < 0  → 落后（红色 / 左侧）
偏差 = 0  → 正常
```

- 渲染时在每个任务条上叠加一个偏差标记（如 `+2d` / `-3d`），今日线用红色竖线高亮，与原 Excel 的
  视觉约定保持一致。

## 8. 变更履历 / 样例模板

- `changeLog[]` 直接体现在 `plan.html` 底部或独立 `changelog.csv`，字段：`version` / `date` /
  `author` / `note`，对应 Excel 的版本、更新日、更新者、更新内容。
- `examples/development/project-plan.json` 作为开发 WBS 的复用起点（等同 Excel 里的「WBS サンプル」
  sheet），后续可在 `examples/` 下补充一份 `examples/template-standard/`，覆盖项目管理 / 需求定义 /
  设计 / 制造 / 测试 / 移行 / 运维保守等标准任务，供新项目复制。

## 9. 与现有 project-plan.json schema 的对齐

| Excel 术语 | pmo-kit 现有字段 | 本方案新增字段 |
| --- | --- | --- |
| 項番 | `wbs[].id` | — |
| 大項目 / 中項目 / 小項目 | — | `majorItem` / `middleItem` / `minorItem` |
| 作業予定：開始日/終了日/工数 | `start` / `end` | `plannedEffort` |
| 作業実績：開始日/終了日/工数 | — | `actualStart` / `actualEnd` / `actualEffort` |
| 進捗率 | `pct` | — |
| 休日設定 | — | `calendar.holidays[]` |
| 週次Mtg. | — | `calendar.weeklyMeetings[]` |
| 変更履歴 | — | `changeLog[]` |
| WBS サンプル | `examples/*/project-plan.json` | （建议新增标准模板示例） |

> 结论：现有 schema 的 `id`/`level`/`status`/`pct`/`owner`/`start`/`end`/`deliverable`/
> `acceptance`/`checklistRef`/`dependsOn` 全部保留，无破坏性改动；新增字段均可选，旧
> `project-plan.json` 无需迁移即可继续渲染。

## 10. MVP 分期计划

### 第一期（渲染增强，贴合 pmo-kit 当前静态渲染模式）
- [ ] `wbs[]` 扩展字段（`majorItem`/`middleItem`/`minorItem`/`plannedEffort`/`actualStart`/
      `actualEnd`/`actualEffort`）
- [ ] `calendar` 休日/周会数据结构 + 渲染时的休日底色
- [ ] `changeLog[]` 渲染进 `plan.html` / 导出 `changelog.csv`
- [ ] 甘特图新增实绩条 + 偏差标记（稲妻线简化版）
- [ ] `schema/project-plan.schema.md` 文档同步更新

### 第二期（贴近 Excel 体验）
- [ ] 标准 WBS 样例模板（`examples/template-standard/`）
- [ ] `ajv` JSON Schema 校验（README 路线图已列出）
- [ ] Excel 导入脚本（处理日期序列值 → ISO 日期）
- [ ] Excel 导出脚本

### 第三期（产品化，视需求再评估）
- [ ] 可选的本地 Web 编辑界面（替代直接改 JSON）
- [ ] 多项目 `projects/` 索引页（README 路线图已列出）
- [ ] 权限 / 审计日志（若引入协作场景）

## 11. 异常与校验规则汇总

| 字段 | 规则 |
| --- | --- |
| `end` | 不得早于 `start` |
| `actualEnd` | 不得早于 `actualStart` |
| `plannedEffort` / `actualEffort` | ≥ 0 |
| `pct` | 0–100 |
| `pct = 100` | 建议 `actualEnd` 非空 |
| `actualEnd` 非空 | 建议 `pct` 自动置 100，允许手动覆盖 |
| `actualStart` 非空且 `pct = 0` | 渲染时提示"进度未更新" |
| `start`/`end` 缺失 | 不绘制计划甘特条 |
| `actualStart`/`actualEnd` 缺失 | 不绘制实绩条，或仅绘制进度百分比 |
