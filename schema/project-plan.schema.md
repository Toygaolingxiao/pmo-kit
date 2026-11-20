# project-plan.json 字段约定（v0.2）

正本验证器是 `src/domain/project-plan.ts` 的 `validateProjectPlan`（CLI 与 Excel 进出口共用），Web 侧有同规则的 `web/js/plan-validator.js`。本文与实现不一致时，以验证器为准并请修本文。

## 顶层

| 路径 | 必填 | 说明 |
| --- | --- | --- |
| `meta.projectName` | ✓ | 封面标题 |
| `meta.planStart` / `planEnd` / `dataDate` | ✓ | 真实日历日期 `YYYY-MM-DD`（2026-02-30 这类不存在的日期会被拒） |
| `meta.overallStatus` | 推荐 | `GREEN` / `AMBER` / `RED`（手填值；与自动判定不一致时成果物会标注冲突） |
| `meta.*` 其余键 | 任意 | 字符串或字符串数组，渲染时按需取用 |
| `milestones[]` | ✓ | `{id, name, date, status, exitCriteria}`，id 唯一、date 为真实日期 |
| `sprints[]` | ✓（可空数组） | `{id, name, start, end, goal}`，end ≥ start |
| `roles[]` | ✓（可空数组） | `{id, title, person, focus}` |
| `raci[]` | ✓（可空数组） | 每行含 `activity` 与各 role id 的取值 |
| `raid[]` | ✓（可空数组） | `{id, type, title, impact, likelihood, owner, response, status}`，字段均为非空字符串 |
| `tickets[]` | 可选 | 课题（状态机见 `web/js/ticket-fsm.js`）；`wbsId` 非空时必须指向存在的 wbs.id |
| `wbs[]` | ✓ | 见下 |
| `org` / `calendar` / `changeLog[]` | 可选 | org 为 sponsor + hats；calendar 为假日与定例会议；changeLog 为 `{version, date, author, note}` |

状态枚举（wbs / milestones / raid 共用）：`done / in_progress / todo / deferred / planned / open / mitigating / accepted / closed`。tickets 状态：`todo / in_progress / resolved / closed / cancelled`。

## wbs[] 行

| 字段 | 说明 |
| --- | --- |
| `id` | 点分层级 id（`1` / `1.2` / `1.2.1`），全局唯一；父 id 必须存在 |
| `level` | 1–4 的整数，必须与 id 深度一致 |
| `status` | 上表枚举；与 pct 一致性会被验：`done` ⇔ pct=100、`todo` ⇒ pct=0 |
| `pct` | 0–100 的有限数 |
| `owner` | 负责人（字符串） |
| `sprint` | 迭代 id（可空，不再自动编造默认值） |
| `start` / `end` | 真实日期，end ≥ start |
| `effortDays` | 非负数；加重进度的权重 |
| `actualStart` / `actualEnd` / `actualEffort` | 实绩（可选）；actualEnd ≥ actualStart；验证后保留，不会被丢弃 |
| `dependsOn` | 其他 `wbs.id` 数组；不得悬空、自依赖或成环 |
| `relations` | `{predecessorId, type: FS/SS/FF/SF, lagDays}`，predecessorId 必须存在 |
| `deliverable` / `acceptance` / `checklistRef` | 交付物 / 验收标准 / 工程轨 ID |

## 指标口径（CLI 与 Web 统一）

- **末端任务**：不被任何任务当作父级的任务（按 id 前缀判定），不用 level 固定值。
- **加重进度**：末端任务按 effortDays 加权（权重缺失或非正时按 1），`Σ(权重×pct) / Σ权重`。末端为空时为 null，成果物显示 N/A，不显示 0%。
- **进度差异**：计划进度按工作日历线性计算；开始日已过的 todo 不再被当作未开始，照常算 behind。
- **健康度**：在末端集合上判定，deferred 不计入；返回状态附理由（任务 id 与计划/实绩差）；末端为空时为 `UNKNOWN`。手填 `overallStatus` 与自动判定不一致时，`status-summary.json` 输出 `healthConflict: true`，HTML 显式标注。

改完 JSON 后：

```bash
npm run render -- --in path/to/project-plan.json --out path/to/out
```
