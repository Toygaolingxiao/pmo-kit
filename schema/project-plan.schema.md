# project-plan.json 字段约定（v0.1）

最小可渲染集合：

| 路径 | 必填 | 说明 |
| --- | --- | --- |
| `meta.projectName` | ✓ | 封面标题 |
| `meta.planStart` / `planEnd` / `dataDate` | ✓ | 甘特轴 |
| `meta.overallStatus` | 推荐 | `GREEN` / `AMBER` / `RED` |
| `milestones[]` | ✓ | Stage-Gate |
| `sprints[]` | 推荐 | 周/迭代窗口 |
| `roles[]` + `raci[]` | 推荐 | 一人多帽也要写 |
| `raid[]` | 推荐 | Risk/Assumption/Issue/Decision |
| `org` | 推荐 | Sponsor + 3 hats |
| `wbs[]` | ✓ | 见下 |

## wbs[] 行

| 字段 | 说明 |
| --- | --- |
| `id` | `1` / `1.2` / `1.2.1` |
| `level` | 1–4；甘特默认画 ≤2 |
| `status` | `done` / `in_progress` / `todo` / `deferred` |
| `pct` | 0–100 |
| `owner` | 对齐 `roles.id`（如 `PMO`/`DEV`/`QA`） |
| `start` / `end` | `YYYY-MM-DD` |
| `deliverable` | 客户可验收物 |
| `acceptance` | 验收标准 |
| `checklistRef` | 工程轨 ID（可空） |
| `dependsOn` | 其他 `wbs.id` 数组 |

改完 JSON 后：

```bash
npm run render -- --in path/to/project-plan.json --out path/to/out
```
