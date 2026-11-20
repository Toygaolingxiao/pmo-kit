import { test } from "node:test";
import assert from "node:assert/strict";
import { csvEscape, mdCell, renderHtml, renderMermaid, renderWeekly } from "../src/render.ts";

const plan: any = {
  meta: { projectName: "P", planStart: "2026-01-01", planEnd: "2026-03-31", dataDate: "2026-02-01", overallStatus: "GREEN" },
  milestones: [{ id: "M1", name: "Gate, One", date: "2026-02-01", status: "todo", exitCriteria: "ok" }],
  sprints: [], roles: [], raci: [],
  raid: [{ id: "R1", type: "Risk", title: "a|b", impact: "高", likelihood: "中", owner: "X", response: "c|d", status: "open" }],
  tickets: [],
  wbs: [
    { id: "1", name: "Phase; One", level: 1, type: "phase", status: "in_progress", pct: 50, owner: "GAO", sprint: "", start: "2026-01-01", end: "2026-02-28", effortDays: 10, dependsOn: [], deliverable: "D", checklistRef: "" },
    { id: "1.1", name: "=2+5+cmd", level: 2, type: "task", status: "todo", pct: 0, owner: "GAO", sprint: "", start: "2026-02-01", end: "2026-02-28", effortDays: 10, dependsOn: ["1"], deliverable: "D", checklistRef: "" },
    { id: "2", name: "<script>alert(1)</script>", level: 1, type: "task", status: "todo", pct: 0, owner: "GAO", sprint: "", start: "2026-03-01", end: "2026-03-31", effortDays: 5, dependsOn: [], deliverable: "D", checklistRef: "" },
  ],
};

test("CSV：数式インジェクションになる先頭文字を無害化する", () => {
  assert.ok(csvEscape("=2+5+cmd").startsWith("'"));
  assert.ok(csvEscape("  @SUM(A1)").startsWith("'"));
  assert.equal(csvEscape("通常テキスト"), "通常テキスト");
});

test("Mermaid：依存関係が after で出力され、カンマ・セミコロンで構文が壊れない", () => {
  const out = renderMermaid(plan);
  assert.match(out, /after t1,/);
  assert.ok(!out.includes("Phase; One"));
  assert.ok(!out.includes("Gate, One"));
});

test("HTML：計画データのスクリプト文字列はエスケープされる", () => {
  const html = renderHtml(plan);
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.match(html, /lang="ja"/);
});

test("週次：RAID 表の | はエスケープされ、集計は末端口径で矛盾しない", () => {
  const md = renderWeekly(plan);
  assert.ok(md.includes("a\\|b"));
  assert.ok(md.includes("末端タスクは完了 0 件、未完了 2 件"));
});

test("mdCell：改行と | を処理する", () => {
  assert.equal(mdCell("a\nb|c"), "a b\\|c");
});
