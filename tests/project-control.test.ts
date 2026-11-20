import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveHealthReport, leafTasks, progressVariance, weightedProgress } from "../src/domain/project-control.ts";

const T = (id: string, extra: Record<string, unknown> = {}) => ({
  id, start: "2026-01-01", end: "2026-01-31", pct: 0, status: "todo", effortDays: 10, ...extra,
});

test("末端タスクは『子を持たないタスク』で判定する（level 固定値ではない）", () => {
  const tasks = [T("1"), T("1.1"), T("1.1.1"), T("2")];
  assert.deepEqual(leafTasks(tasks).map((t) => t.id), ["1.1.1", "2"]);
});

test("加重進捗は工数加重：1人日100% + 100人日0% は約1%", () => {
  const result = weightedProgress([
    T("1", { pct: 100, effortDays: 1 }),
    T("2", { pct: 0, effortDays: 100 }),
  ]);
  assert.equal(result, 1);
});

test("加重進捗は対象が空なら null（0% と偽らない）", () => {
  assert.equal(weightedProgress([]), null);
});

test("開始日を過ぎた todo は not_started にならず behind になる", () => {
  const v = progressVariance(T("1"), "2026-06-01");
  assert.equal(v.direction, "behind");
  assert.ok(v.plannedPct > 0);
});

test("開始日前の todo は not_started のまま", () => {
  const v = progressVariance(T("1", { start: "2026-07-01", end: "2026-07-31" }), "2026-06-01");
  assert.equal(v.direction, "not_started");
});

test("健康度：逾期未開工だけの集合は GREEN にならない", () => {
  const report = deriveHealthReport([T("1")], "2026-06-01");
  assert.notEqual(report.status, "GREEN");
  assert.ok(report.reasons.length > 0);
});

test("健康度：対象が空なら UNKNOWN で理由付き", () => {
  const report = deriveHealthReport([], "2026-06-01");
  assert.equal(report.status, "UNKNOWN");
  assert.ok(report.reasons.length > 0);
});

test("健康度：deferred は判定から外す", () => {
  const report = deriveHealthReport([T("1", { status: "deferred" })], "2026-06-01");
  assert.equal(report.status, "UNKNOWN");
});
