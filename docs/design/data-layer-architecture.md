# 数据层与存储演进

## 当前判断

WBS 画面不应直接依赖某一种存储。当前 Web 是无后端的原生页面，因此先采用 `ProjectRepository` 接口和浏览器 LocalStorage adapter。这样可以保证离线打开、JSON 导入导出和现有用户数据不受影响。

这不是把 LocalStorage 当成最终数据库，而是把它限制在 adapter 内。画面只调用 `load`、`loadSeed` 和 `save`，不再直接操作 `localStorage` 或 fixture。

## SQLite 是否合适

SQLite 适合作为下一阶段的持久化实现，但不建议直接把 SQLite WASM 放入当前页面：

- 多项目、任务、休日、会议和变更履历需要事务。
- 批量导入、删除父任务、日期平移和审计写入需要原子性。
- SQLite WASM 会增加下载、Worker、数据库文件保存和升级迁移的复杂度。
- 如果只有单机离线使用，可采用 SQLite WASM adapter。
- 如果要多人协作，建议使用 API 服务端的 SQLite 或 PostgreSQL adapter，浏览器继续只依赖 repository。

## 目标模型

数据表按源 Excel 的业务边界拆分：

`projects`、`tasks`、`project_calendars`、`project_holidays`、`weekly_meetings`、`change_logs`、`wbs_templates`、`wbs_template_tasks`、`users`、`project_members`。

对应的 repository 方法应逐步扩展为：

- 项目读取、创建、更新
- 任务 CRUD、批量操作、排序
- 日历、休日、定例会议
- WBS 模板导入预览与提交
- 变更履历追加和查询
- Excel 导入、导出

## 为什么现在不直接建 SQLite

数据层解耦和数据库选型是两个决策。先完成接口隔离，可以立即降低耦合并保留现有功能；待项目切换、权限、事务和多人协作需求确定后，再选择 SQLite WASM 或服务端数据库，避免为未确定的运行形态引入重量级依赖。
