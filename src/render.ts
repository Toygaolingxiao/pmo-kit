/**
 * project-plan.json から納品物を生成する。
 * → plan.html, wbs.csv, schedule.csv, milestones.csv, gantt.mmd,
 *   status-summary.json, reports/weekly-status-latest.md
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import {
  averageProgress,
  daysBetweenInclusive,
  deriveHealth,
  progressVariance,
} from "./domain/project-control.ts";
import { validateProjectPlan } from "./domain/project-plan.ts";

type Status =
  | "done"
  | "in_progress"
  | "todo"
  | "deferred"
  | "planned"
  | "open"
  | "mitigating"
  | "accepted"
  | "closed";

type WbsItem = {
  id: string;
  name: string;
  nameJa?: string;
  level: number;
  type: string;
  status: Status;
  pct: number;
  owner: string;
  sprint: string;
  start: string;
  end: string;
  effortDays: number;
  dependsOn: string[];
  deliverable: string;
  acceptance?: string;
  checklistRef: string;
};

type Plan = {
  meta: Record<string, string | string[]>;
  calendar?: {
    weekendAutoHoliday?: boolean;
    holidays?: Array<{ date: string; type?: string; note?: string }>;
  };
  org?: {
    sponsor: { name: string; title: string; duties: string[] };
    hats: Array<{ id: string; title: string; person: string; duties: string[] }>;
  };
  milestones: Array<{
    id: string;
    name: string;
    date: string;
    status: Status;
    exitCriteria: string;
  }>;
  sprints: Array<{ id: string; name: string; start: string; end: string; goal: string }>;
  roles: Array<{ id: string; title: string; person: string; focus: string }>;
  raci: Array<Record<string, string>>;
  raid: Array<{
    id: string;
    type: string;
    title: string;
    impact: string;
    likelihood: string;
    owner: string;
    response: string;
    status: Status;
  }>;
  wbs: WbsItem[];
};

function usage(): never {
  console.error(`Usage:
  npx tsx src/render.ts --in <project-plan.json> [--out <dir>]

Defaults:
  --out  <dirname(plan)>/out
`);
  process.exit(1);
}

function parseArgs(argv: string[]): { planPath: string; outDir: string } {
  let planPath = "";
  let outDir = "";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--in" || a === "-i") {
      planPath = argv[++i] ?? "";
    } else if (a === "--out" || a === "-o") {
      outDir = argv[++i] ?? "";
    } else if (a === "--help" || a === "-h") {
      usage();
    }
  }
  if (!planPath) usage();
  const resolvedPlan = isAbsolute(planPath) ? planPath : join(process.cwd(), planPath);
  const resolvedOut = outDir
    ? isAbsolute(outDir)
      ? outDir
      : join(process.cwd(), outDir)
    : join(dirname(resolvedPlan), "out");
  return { planPath: resolvedPlan, outDir: resolvedOut };
}

function csvEscape(value: string | number): string {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function daysBetween(a: string, b: string): number {
  return Math.max(1, daysBetweenInclusive(a, b));
}

function parseDay(iso: string): number {
  return Math.floor(Date.parse(iso) / 86_400_000);
}

function statusLabel(status: Status): string {
  const map: Record<string, string> = {
    done: "Done",
    in_progress: "In Progress",
    todo: "To Do",
    deferred: "Deferred",
    planned: "Planned",
    open: "Open",
    mitigating: "Mitigating",
    accepted: "Accepted",
    closed: "Closed",
  };
  return map[status] ?? status;
}

function statusTone(status: Status): string {
  if (status === "done" || status === "closed" || status === "accepted") return "ok";
  if (status === "in_progress" || status === "mitigating" || status === "planned") return "warn";
  if (status === "deferred") return "muted";
  return "risk";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function writeCsv(path: string, headers: string[], rows: Array<Array<string | number>>) {
  const body = [headers, ...rows]
    .map((row) => row.map(csvEscape).join(","))
    .join("\n");
  writeFileSync(path, `${body}\n`, "utf8");
}

function metaText(meta: Plan["meta"], key: string, fallback = "—"): string {
  const value = meta[key];
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value) && value.length > 0) return value.join(", ");
  return fallback;
}

function phaseSection(plan: Plan, id: string): string {
  const rootId = id.split(".")[0];
  const phase = plan.wbs.find((item) => item.id === rootId);
  return (phase?.name || `Phase ${rootId}`).replace(/[:#]/g, " ");
}

function renderMermaid(plan: Plan): string {
  const tasks = plan.wbs.filter((w) => w.level <= 2 && w.status !== "deferred");
  const title = metaText(plan.meta, "projectName", "Project").replace(/[:#]/g, " ");
  const lines = [
    "gantt",
    "    dateFormat  YYYY-MM-DD",
    "    title       " + title,
    "    excludes    weekends",
    "",
  ];

  const sections = new Map<string, WbsItem[]>();
  for (const task of tasks) {
    const section = phaseSection(plan, task.id);
    const list = sections.get(section) ?? [];
    list.push(task);
    sections.set(section, list);
  }

  for (const [section, items] of sections) {
    lines.push(`    section ${section}`);
    for (const item of items) {
      const tag =
        item.status === "done" ? "done" :
        item.status === "in_progress" ? "active" :
        "";
      const safe = item.name.replace(/[:#]/g, " ");
      const id = `t${item.id.replace(/\./g, "_")}`;
      const tagPart = tag ? `${tag}, ` : "";
      lines.push(`    ${safe} :${tagPart}${id}, ${item.start}, ${item.end}`);
    }
    lines.push("");
  }

  lines.push("    section Milestones");
  for (const m of plan.milestones) {
    lines.push(`    ${m.id} ${m.name.replace(/[:#]/g, " ")} :milestone, ${m.date}, 0d`);
  }

  return `${lines.join("\n")}\n`;
}

function renderWeekly(plan: Plan): string {
  const meta = plan.meta;
  const leaf = plan.wbs.filter((w) => w.level >= 3);
  const done = leaf.filter((w) => w.status === "done");
  const openWork = plan.wbs.filter((w) => w.status === "todo" || w.status === "in_progress");
  const next = openWork.slice(0, 8);
  const openRaid = plan.raid.filter((r) => r.status === "open" || r.status === "mitigating");
  const projectName = metaText(meta, "projectName", "プロジェクト");
  const preparedBy = metaText(meta, "preparedBy", metaText(meta, "pm"));
  const baseline = metaText(meta, "baselineVersion", metaText(meta, "baseline"));
  const note = metaText(meta, "overallStatusNote", "");
  const openLeaf = leaf.filter((w) => w.status === "todo" || w.status === "in_progress");
  const summary = note && note !== "—"
    ? note
    : leaf.length > 0
      ? `データ日 ${meta.dataDate} 時点で、レベル3以上のタスクは完了 ${done.length} 件、未完了 ${openLeaf.length} 件です。`
      : `データ日 ${meta.dataDate} 時点の未完了作業は ${openWork.length} 件です。`;

  const doneLines = done
    .slice(-8)
    .map((w) => `- [x] **${w.id} ${w.name}** — ${w.deliverable}`)
    .join("\n");

  const nextLines = next
    .map((w, i) => `${i + 1}. **WBS ${w.id}:** ${w.name}（担当: ${w.owner}）→ ${w.deliverable}`)
    .join("\n");

  const raidTable = openRaid
    .map(
      (r) =>
        `| ${r.id} | ${r.title} | ${r.impact} | ${r.owner} | ${r.response} |`,
    )
    .join("\n");

  const asks = openRaid.length
    ? openRaid.map((r) => `- [ ] **${r.id}** ${r.title}（担当: ${r.owner}）`).join("\n")
    : "- [ ] 現時点で起票された判断依頼はありません。";

  const traffic =
    String(meta.overallStatus) === "GREEN" ? "GREEN" :
    String(meta.overallStatus) === "AMBER" ? "AMBER" :
    String(meta.overallStatus) === "RED" ? "RED" :
    metaText(meta, "overallStatus");

  return `# ${projectName} 週次ステータス

**日付:** ${meta.dataDate} | **作成:** ${preparedBy}  
**全体ステータス:** ${traffic}  
**ベースライン:** ${baseline}

---

### 1. 概要

${summary}

### 2. マイルストーンと進捗

${doneLines || "- （完了タスクはありません）"}

**マイルストーン**

${plan.milestones.map((m) => `- **${m.id} ${m.name}** (${m.date}) — ${statusLabel(m.status)} · ${m.exitCriteria}`).join("\n")}

### 3. 次の焦点

${nextLines || "- （未完了タスクはありません）"}

### 4. RAID

| ID | 内容 | 影響 | 担当 | 対応 |
| :--- | :--- | :--- | :--- | :--- |
${raidTable || "| — | — | — | — | — |"}

### 5. 判断が必要な事項

${asks}

---

*project-plan.json から \`npm run render\` で生成。顧客向けの文章は生成後に整えてください。*
`;
}

function renderHtml(plan: Plan): string {
  const meta = plan.meta;
  const planStart = String(meta.planStart);
  const planEnd = String(meta.planEnd);
  const dataDate = String(meta.dataDate);
  const origin = parseDay(planStart);
  const totalDays = daysBetween(planStart, planEnd);
  const todayPct = Math.min(100, Math.max(0, ((parseDay(dataDate) - origin) / totalDays) * 100));

  const leafLike = plan.wbs.filter((w) => w.level >= 3);
  const done = leafLike.filter((w) => w.status === "done").length;
  const wip = leafLike.filter((w) => w.status === "in_progress").length;
  const todo = leafLike.filter((w) => w.status === "todo").length;
  const deferred = leafLike.filter((w) => w.status === "deferred").length;
  const weighted =
    leafLike.reduce((sum, w) => sum + w.pct, 0) / Math.max(1, leafLike.length);

  const overall = String(meta.overallStatus || "GREEN");
  const overallClass =
    overall === "GREEN" ? "ok" : overall === "AMBER" ? "warn" : "risk";

  const org = plan.org;
  const orgHtml = org
    ? `<div class="org">
        <div class="org-sponsor">
          <div class="org-title">${escapeHtml(org.sponsor.title)}</div>
          <div class="org-name">${escapeHtml(org.sponsor.name)}</div>
          <div class="org-duty">${org.sponsor.duties.map(escapeHtml).join(" · ")}</div>
        </div>
        <div class="org-hats">
          ${org.hats
            .map(
              (h) => `<div class="org-hat">
              <div class="org-title">${escapeHtml(h.title)}</div>
              <div class="org-name">${escapeHtml(h.person)}</div>
              <ul>${h.duties.map((d) => `<li>${escapeHtml(d)}</li>`).join("")}</ul>
            </div>`,
            )
            .join("")}
        </div>
      </div>`
    : "";

  const ganttRows = plan.wbs
    .filter((w) => w.level <= 2)
    .map((w) => {
      const startOff = Math.max(0, parseDay(w.start) - origin);
      const span = daysBetween(w.start, w.end);
      const left = (startOff / totalDays) * 100;
      const width = Math.max(1.2, (span / totalDays) * 100);
      return { ...w, left, width };
    });

  const ganttHtml = ganttRows
    .map((w) => {
      const tone = statusTone(w.status);
      return `<div class="gantt-row">
        <div class="gantt-label"><span class="mono">${w.id}</span> ${escapeHtml(w.name)}</div>
        <div class="gantt-track">
          <div class="gantt-bar ${tone}" style="left:${w.left}%;width:${w.width}%" title="${w.start} → ${w.end}"></div>
        </div>
      </div>`;
    })
    .join("\n");

  const wbsRows = plan.wbs
    .map((w) => {
      const indent = "&nbsp;".repeat(Math.max(0, (w.level - 1) * 3));
      const tone = statusTone(w.status);
      return `<tr class="lvl-${w.level}">
        <td class="mono">${w.id}</td>
        <td>${indent}<strong>${escapeHtml(w.name)}</strong>${w.nameJa ? `<div class="ja">${escapeHtml(w.nameJa)}</div>` : ""}</td>
        <td><span class="pill ${tone}">${statusLabel(w.status)}</span></td>
        <td class="num">${w.pct}%</td>
        <td>${escapeHtml(w.owner)}</td>
        <td class="mono">${w.start}<br/>${w.end}</td>
        <td class="num">${w.effortDays}</td>
        <td>${escapeHtml(w.deliverable)}${w.acceptance ? `<div class="ja">AC: ${escapeHtml(w.acceptance)}</div>` : ""}</td>
        <td class="mono">${escapeHtml(w.checklistRef)}</td>
      </tr>`;
    })
    .join("\n");

  const milestoneHtml = plan.milestones
    .map(
      (m) => `<div class="ms">
        <div class="ms-id">${m.id}</div>
        <div class="ms-date">${m.date}</div>
        <div class="ms-name">${escapeHtml(m.name)}</div>
        <div class="ms-exit">${escapeHtml(m.exitCriteria)}</div>
        <span class="pill ${statusTone(m.status)}">${statusLabel(m.status)}</span>
      </div>`,
    )
    .join("\n");

  const roleIds = plan.roles.map((r) => r.id);
  const raciHead = ["Activity", ...roleIds].map((h) => `<th>${h}</th>`).join("");
  const raciBody = plan.raci
    .map((row) => {
      const cells = [row.activity, ...roleIds.map((id) => row[id] ?? "—")]
        .map((c, i) => `<td class="${i === 0 ? "left" : "center mono"}">${escapeHtml(c)}</td>`)
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("\n");

  const raidBody = plan.raid
    .map(
      (r) => `<tr>
        <td class="mono">${r.id}</td>
        <td>${r.type}</td>
        <td>${escapeHtml(r.title)}</td>
        <td class="center">${r.impact}</td>
        <td class="center">${r.likelihood}</td>
        <td>${r.owner}</td>
        <td>${escapeHtml(r.response)}</td>
        <td><span class="pill ${statusTone(r.status)}">${statusLabel(r.status)}</span></td>
      </tr>`,
    )
    .join("\n");

  const sprintBody = plan.sprints
    .map(
      (s) => `<tr>
        <td class="mono">${s.id}</td>
        <td>${escapeHtml(s.name)}</td>
        <td class="mono">${s.start} → ${s.end}</td>
        <td>${escapeHtml(s.goal)}</td>
      </tr>`,
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(String(meta.projectName))} — Delivery Pack</title>
  <style>
    :root {
      --ink: #2a2118; --muted: #6f6256; --line: #e6dccf; --paper: #fffaf3;
      --card: #ffffff; --accent: #8a5a2b; --ok: #2f6b4f; --warn: #9a6b16;
      --risk: #9b3b32; --muted-pill: #8a8178; --track: #f1e8db;
      --serif: "Iowan Old Style", "Palatino Linotype", Palatino, "Songti SC", serif;
      --sans: "Segoe UI", "Helvetica Neue", Arial, "PingFang SC", "Noto Sans SC", sans-serif;
      --mono: ui-monospace, "Cascadia Mono", Consolas, monospace;
    }
    * { box-sizing: border-box; }
    body { margin: 0; color: var(--ink); background: #f7efe4; font-family: var(--sans); line-height: 1.5; }
    .page { max-width: 1100px; margin: 0 auto; padding: 40px 28px 80px; }
    .cover, section { background: var(--card); border: 1px solid var(--line); border-radius: 16px; }
    .cover { padding: 36px 40px; margin-bottom: 18px; }
    section { padding: 22px 24px 26px; margin-bottom: 16px; }
    .eyebrow { letter-spacing: 0.16em; text-transform: uppercase; font-size: 11px; color: var(--accent); margin: 0 0 10px; }
    h1 { font-family: var(--serif); font-size: 32px; line-height: 1.15; margin: 0 0 8px; font-weight: 600; }
    h2 { font-family: var(--serif); font-size: 22px; margin: 0 0 6px; font-weight: 600; }
    .sub, .section-lead { color: var(--muted); }
    .sub { margin: 0 0 18px; }
    .section-lead { font-size: 13px; margin: 0 0 16px; }
    .meta-grid, .stats { display: grid; gap: 12px; }
    .meta-grid { grid-template-columns: repeat(4, 1fr); }
    .stats { grid-template-columns: repeat(5, 1fr); margin-top: 18px; }
    .meta-item { border-top: 1px solid var(--line); padding-top: 10px; }
    .meta-item .k { font-size: 11px; color: var(--muted); }
    .meta-item .v { font-size: 14px; margin-top: 2px; }
    .stat { background: #fbf6ee; border-radius: 12px; padding: 14px 16px; }
    .stat .n { font-family: var(--serif); font-size: 28px; color: var(--accent); }
    .stat .l { font-size: 12px; color: var(--muted); }
    .banner { display: inline-flex; align-items: center; gap: 8px; margin: 0 0 14px; }
    table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
    th, td { border-bottom: 1px solid var(--line); padding: 8px; vertical-align: top; text-align: left; }
    th { font-size: 11px; color: var(--muted); letter-spacing: 0.04em; }
    tr.lvl-1 td { background: #fbf6ee; }
    tr.lvl-2 td { background: #fffdf9; }
    .ja { color: var(--muted); font-size: 11px; margin-top: 2px; }
    .mono { font-family: var(--mono); font-size: 11px; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    .center { text-align: center; }
    .pill { display: inline-block; border-radius: 999px; padding: 2px 8px; font-size: 10px; font-weight: 600; }
    .pill.ok { background: #e5f2eb; color: var(--ok); }
    .pill.warn { background: #f8efd8; color: var(--warn); }
    .pill.risk { background: #f8e6e3; color: var(--risk); }
    .pill.muted { background: #eeeae4; color: var(--muted-pill); }
    .org-sponsor { text-align: center; border: 1px solid var(--line); border-radius: 12px; padding: 14px; background: #fbf6ee; margin-bottom: 12px; }
    .org-hats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
    .org-hat { border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; background: #fffdf9; }
    .org-title { font-size: 11px; letter-spacing: 0.08em; color: var(--accent); text-transform: uppercase; }
    .org-name { font-family: var(--serif); font-size: 18px; margin: 4px 0 8px; }
    .org-duty, .org-hat ul { font-size: 12px; color: var(--muted); margin: 0; padding-left: 16px; }
    .ms-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
    .ms { border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; background: #fffdf9; }
    .ms-id { font-family: var(--mono); color: var(--accent); font-size: 12px; }
    .ms-date { font-family: var(--mono); font-size: 12px; color: var(--muted); }
    .ms-name { font-weight: 600; margin: 6px 0; }
    .ms-exit { font-size: 12px; color: var(--muted); margin-bottom: 8px; }
    .gantt-wrap { position: relative; }
    .gantt-axis { display: flex; justify-content: space-between; font-family: var(--mono); font-size: 10px; color: var(--muted); margin: 0 0 8px 220px; }
    .gantt-row { display: grid; grid-template-columns: 220px 1fr; gap: 10px; align-items: center; margin-bottom: 6px; }
    .gantt-label { font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .gantt-track { position: relative; height: 16px; background: var(--track); border-radius: 999px; overflow: hidden; }
    .gantt-bar { position: absolute; top: 2px; bottom: 2px; border-radius: 999px; }
    .gantt-bar.ok { background: #4f8f6f; }
    .gantt-bar.warn { background: #c4922d; }
    .gantt-bar.risk { background: #b4574d; }
    .gantt-bar.muted { background: #b0a79c; }
    .today-line { position: absolute; top: 22px; bottom: 0; width: 2px; background: var(--accent); left: calc(220px + 10px + (100% - 230px) * ${todayPct / 100}); opacity: 0.7; pointer-events: none; }
    .actions { display: flex; gap: 10px; margin: 0 0 18px; }
    .actions button { border: 1px solid var(--line); background: var(--card); border-radius: 999px; padding: 8px 14px; font-size: 12px; cursor: pointer; }
    .footer { margin-top: 8px; color: var(--muted); font-size: 11px; display: flex; justify-content: space-between; gap: 12px; }
    @media print {
      body { background: white; }
      .actions { display: none; }
      .page { padding: 12mm; }
      section, .cover { break-inside: avoid; }
    }
    @media (max-width: 900px) {
      .meta-grid, .stats, .ms-grid, .org-hats { grid-template-columns: 1fr 1fr; }
      .gantt-row { grid-template-columns: 1fr; }
      .gantt-axis, .today-line { display: none; }
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="actions"><button onclick="window.print()">Print / Save as PDF</button></div>
    <header class="cover">
      <p class="eyebrow">Tier-1 Style PMO Delivery Pack</p>
      <div class="banner"><span class="pill ${overallClass}">${escapeHtml(overall)}</span><span class="sub" style="margin:0">${escapeHtml(String(meta.overallStatusNote || ""))}</span></div>
      <h1>${escapeHtml(metaText(meta, "projectName"))}</h1>
      <p class="sub">${escapeHtml(metaText(meta, "projectNameJa", metaText(meta, "projectCode")))} · ${escapeHtml(metaText(meta, "baselineVersion", metaText(meta, "baseline")))} · Doc v${escapeHtml(metaText(meta, "documentVersion", "1"))}</p>
      <div class="meta-grid">
        <div class="meta-item"><div class="k">Sponsor</div><div class="v">${escapeHtml(metaText(meta, "sponsor"))}</div></div>
        <div class="meta-item"><div class="k">Prepared by</div><div class="v">${escapeHtml(metaText(meta, "preparedBy", metaText(meta, "pm")))}</div></div>
        <div class="meta-item"><div class="k">Data date</div><div class="v">${escapeHtml(dataDate)}</div></div>
        <div class="meta-item"><div class="k">Product</div><div class="v">${escapeHtml(metaText(meta, "productVersion"))}</div></div>
        <div class="meta-item"><div class="k">Client framing</div><div class="v">${escapeHtml(metaText(meta, "client"))}</div></div>
        <div class="meta-item"><div class="k">Methodology</div><div class="v">${escapeHtml(metaText(meta, "methodology"))}</div></div>
        <div class="meta-item"><div class="k">Plan window</div><div class="v">${planStart} → ${planEnd}</div></div>
        <div class="meta-item"><div class="k">Note</div><div class="v">${escapeHtml(metaText(meta, "currencyNote"))}</div></div>
      </div>
      <div class="stats">
        <div class="stat"><div class="n">${weighted.toFixed(0)}%</div><div class="l">Weighted L3+ progress</div></div>
        <div class="stat"><div class="n">${done}</div><div class="l">Done</div></div>
        <div class="stat"><div class="n">${wip}</div><div class="l">In progress</div></div>
        <div class="stat"><div class="n">${todo}</div><div class="l">To do</div></div>
        <div class="stat"><div class="n">${deferred}</div><div class="l">Deferred</div></div>
      </div>
    </header>

    <section>
      <h2>1. Operating model（一人多帽）</h2>
      <p class="section-lead">看板与签核按角色隔离；执行者同一人。客户叙事用左侧 Sponsor，交付用三顶执行帽。</p>
      ${orgHtml}
    </section>

    <section>
      <h2>2. Milestones（Stage-Gate）</h2>
      <div class="ms-grid">${milestoneHtml}</div>
    </section>

    <section>
      <h2>3. Sprint / Week calendar</h2>
      <table><thead><tr><th>ID</th><th>Window</th><th>Dates</th><th>Goal</th></tr></thead><tbody>${sprintBody}</tbody></table>
    </section>

    <section>
      <h2>4. Gantt（L1–L2 client view）</h2>
      <p class="section-lead">绿=Done / 琥珀=In Progress / 红=To Do。竖线=数据日期。详细 L3 见 WBS 表与 CSV。</p>
      <div class="gantt-wrap">
        <div class="gantt-axis"><span>${planStart}</span><span>Data date ${dataDate}</span><span>${planEnd}</span></div>
        <div class="today-line"></div>
        ${ganttHtml}
      </div>
    </section>

    <section>
      <h2>5. WBS dictionary（含交付物与验收）</h2>
      <p class="section-lead">客户向编码 1–6；checklistRef 追溯工程门禁（P0/P1）。</p>
      <table>
        <thead><tr><th>WBS</th><th>Name</th><th>Status</th><th>%</th><th>Owner</th><th>Dates</th><th>Effort</th><th>Deliverable / AC</th><th>Eng Ref</th></tr></thead>
        <tbody>${wbsRows}</tbody>
      </table>
    </section>

    <section>
      <h2>6. RACI</h2>
      <table><thead><tr>${raciHead}</tr></thead><tbody>${raciBody}</tbody></table>
    </section>

    <section>
      <h2>7. RAID</h2>
      <table>
        <thead><tr><th>ID</th><th>Type</th><th>Title</th><th>I</th><th>L</th><th>Owner</th><th>Response</th><th>Status</th></tr></thead>
        <tbody>${raidBody}</tbody>
      </table>
    </section>

    <div class="footer">
      <span>${escapeHtml(metaText(meta, "confidentiality", "Local project data"))}</span>
      <span>SSOT: project-plan.json · rendered by pmo-kit</span>
    </div>
  </div>
</body>
</html>`;
}

function main() {
  const { planPath, outDir } = parseArgs(process.argv.slice(2));
  mkdirSync(join(outDir, "reports"), { recursive: true });
  const plan = validateProjectPlan(JSON.parse(readFileSync(planPath, "utf8"))) as Plan;

  writeCsv(
    join(outDir, "wbs.csv"),
    [
      "wbs_id", "name", "name_ja", "level", "type", "status", "pct_complete", "owner",
      "sprint", "start", "end", "effort_days", "depends_on", "deliverable", "acceptance", "checklist_ref",
    ],
    plan.wbs.map((w) => [
      w.id, w.name, w.nameJa ?? "", w.level, w.type, w.status, w.pct, w.owner,
      w.sprint, w.start, w.end, w.effortDays, w.dependsOn.join("|"), w.deliverable,
      w.acceptance ?? "", w.checklistRef,
    ]),
  );

  writeCsv(
    join(outDir, "schedule.csv"),
    ["id", "name", "start", "end", "duration_days", "status", "pct", "owner", "sprint", "depends_on"],
    plan.wbs.map((w) => [
      w.id, w.name, w.start, w.end, daysBetween(w.start, w.end), w.status, w.pct, w.owner, w.sprint,
      w.dependsOn.join("|"),
    ]),
  );

  writeCsv(
    join(outDir, "milestones.csv"),
    ["id", "name", "date", "status", "exit_criteria"],
    plan.milestones.map((m) => [m.id, m.name, m.date, m.status, m.exitCriteria]),
  );

  writeFileSync(join(outDir, "gantt.mmd"), renderMermaid(plan), "utf8");
  writeFileSync(join(outDir, "plan.html"), renderHtml(plan), "utf8");
  writeFileSync(join(outDir, "reports", "weekly-status-latest.md"), renderWeekly(plan), "utf8");

  const leafLike = plan.wbs.filter((w) => w.level >= 3);
  const controlHealth = deriveHealth(leafLike, String(plan.meta.dataDate), plan.calendar);
  writeFileSync(
    join(outDir, "status-summary.json"),
    `${JSON.stringify(
      {
        dataDate: plan.meta.dataDate,
        overallStatus: plan.meta.overallStatus,
        productVersion: plan.meta.productVersion,
        baselineVersion: plan.meta.baselineVersion,
        weightedProgressPct: averageProgress(leafLike),
        derivedHealth: controlHealth,
        variances: leafLike.map((task) => ({
          id: task.id,
          ...progressVariance(task, String(plan.meta.dataDate)),
        })),
        counts: {
          done: leafLike.filter((w) => w.status === "done").length,
          in_progress: leafLike.filter((w) => w.status === "in_progress").length,
          todo: leafLike.filter((w) => w.status === "todo").length,
        },
        nextMilestones: plan.milestones.filter((m) => m.status !== "done"),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  console.log(`PMO pack rendered`);
  console.log(`  plan: ${planPath}`);
  console.log(`  out:  ${outDir}`);
  console.log(`  open: ${join(outDir, "plan.html")}`);
}

main();
