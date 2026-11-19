import ExcelJS from "exceljs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateProjectPlan, type ProjectPlan, type WbsTask } from "./domain/project-plan.ts";

const text = (value: unknown) => String(value ?? "").trim();
const dateText = (value: unknown) => {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number") {
    const date = new Date(Date.UTC(1899, 11, 30) + value * 86400000);
    return date.toISOString().slice(0, 10);
  }
  return text(value);
};

const cell = (row: ExcelJS.Row, column: number) => row.getCell(column).value;

function headerMap(sheet: ExcelJS.Worksheet): Map<string, number> {
  const headers = new Map<string, number>();
  sheet.getRow(1).eachCell((value, column) => headers.set(text(value).toLowerCase(), column));
  return headers;
}

function columnOf(headers: Map<string, number>, ...names: string[]): number | undefined {
  return names.map((name) => headers.get(name.toLowerCase())).find((value): value is number => Boolean(value));
}

function dataRows(sheet: ExcelJS.Worksheet): ExcelJS.Row[] {
  const rows: ExcelJS.Row[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1) rows.push(row);
  });
  return rows;
}

const jsonCell = (value: unknown) => (value === undefined ? "" : JSON.stringify(value));
const parseJsonCell = (value: unknown) => {
  const raw = text(value);
  return raw ? JSON.parse(raw) : undefined;
};

// ---------------------------------------------------------------------------
// Export: 計画の全セクションをシートとして書き出す（往返で失わない）。
// ---------------------------------------------------------------------------
export async function exportWorkbook(plan: ProjectPlan, outputFile: string) {
  const workbook = new ExcelJS.Workbook();

  const wbs = workbook.addWorksheet("WBS");
  wbs.columns = [
    { header: "ID", key: "id", width: 12 }, { header: "作業項目", key: "name", width: 32 },
    { header: "作業項目（日本語）", key: "nameJa", width: 32 },
    { header: "階層", key: "level", width: 8 }, { header: "種別", key: "type", width: 14 },
    { header: "ステータス", key: "status", width: 14 }, { header: "担当者", key: "owner", width: 18 }, { header: "スプリント", key: "sprint", width: 14 },
    { header: "計画開始日", key: "start", width: 14 }, { header: "計画終了日", key: "end", width: 14 },
    { header: "計画工数", key: "effortDays", width: 12 }, { header: "進捗率", key: "pct", width: 10 },
    { header: "実績開始日", key: "actualStart", width: 14 }, { header: "実績終了日", key: "actualEnd", width: 14 },
    { header: "実績工数", key: "actualEffort", width: 12 },
    { header: "成果物", key: "deliverable", width: 24 }, { header: "受入基準", key: "acceptance", width: 24 },
    { header: "チェックリスト", key: "checklistRef", width: 18 }, { header: "依存関係", key: "relations", width: 24 },
  ];
  plan.wbs.forEach((task) => wbs.addRow({
    ...task,
    relations: task.relations?.length
      ? task.relations.map((relation) => `${relation.predecessorId}:${relation.type}:${relation.lagDays}`).join(", ")
      : task.dependsOn?.join(", ") || "",
  }));
  wbs.getRow(1).font = { bold: true };

  const description = workbook.addWorksheet("説明");
  description.addRow(["項目", "値"]);
  for (const [key, value] of Object.entries(plan.meta)) {
    description.addRow([key, Array.isArray(value) ? JSON.stringify(value) : value]);
  }

  const milestones = workbook.addWorksheet("マイルストーン");
  milestones.addRow(["ID", "名称", "期日", "ステータス", "完了条件"]);
  plan.milestones.forEach((m) => milestones.addRow([m.id, m.name, m.date, m.status, m.exitCriteria]));

  const sprints = workbook.addWorksheet("スプリント");
  sprints.addRow(["ID", "名称", "開始日", "終了日", "ゴール"]);
  plan.sprints.forEach((s) => sprints.addRow([s.id, s.name, s.start, s.end, s.goal]));

  const roles = workbook.addWorksheet("役割");
  roles.addRow(["ID", "役割", "担当者", "フォーカス"]);
  plan.roles.forEach((r) => roles.addRow([r.id, r.title, r.person, r.focus]));

  const raci = workbook.addWorksheet("RACI");
  const raciKeys = [...new Set(plan.raci.flatMap((row) => Object.keys(row)))];
  if (raciKeys.length) {
    raci.addRow(raciKeys);
    plan.raci.forEach((row) => raci.addRow(raciKeys.map((key) => row[key] ?? "")));
  }

  const raid = workbook.addWorksheet("RAID");
  raid.addRow(["ID", "種別", "タイトル", "影響度", "発生確率", "担当者", "対策", "ステータス"]);
  plan.raid.forEach((r) => raid.addRow([r.id, r.type, r.title, r.impact, r.likelihood, r.owner, r.response, r.status]));

  const tickets = workbook.addWorksheet("課題");
  tickets.addRow(["ID", "タイトル", "起票者", "担当者", "ステータス", "期日", "WBS", "ボール不明", "改善要", "最終更新", "期日変更申請", "コメント", "履歴"]);
  plan.tickets.forEach((t) => tickets.addRow([
    t.id, t.title, t.reporter, t.assignee, t.status, t.dueDate, t.wbsId,
    t.ballUnknown, t.needsImprovement, t.lastUpdatedAt,
    jsonCell(t.dueChangeRequest ?? undefined), jsonCell(t.comments), jsonCell(t.history),
  ]));

  const history = workbook.addWorksheet("変更履歴");
  history.addRow(["版", "更新日", "更新者", "更新内容"]);
  (plan.changeLog || []).forEach((item) => history.addRow([item.version, item.date, item.author, item.note]));

  const settings = workbook.addWorksheet("設定JSON");
  settings.addRow(["項目", "JSON"]);
  settings.addRow(["org", jsonCell(plan.org)]);
  settings.addRow(["calendar", jsonCell(plan.calendar)]);

  const sample = workbook.addWorksheet("サンプル");
  sample.addRow(["ID", "作業項目", "階層", "種別"]);
  plan.wbs.filter((task) => task.type === "phase").forEach((task) => sample.addRow([task.id, task.name, task.level, task.type]));

  await workbook.xlsx.writeFile(outputFile);
}

// ---------------------------------------------------------------------------
// Import: 全シートを読み戻し、最後に必ず検証器を通す。値が無いセルは
// 「未設定」のような見せかけの値で埋めず、空のまま検証器に判断させる。
// ---------------------------------------------------------------------------
export async function importWorkbook(inputFile: string): Promise<ProjectPlan> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(inputFile);
  const sheet = workbook.getWorksheet("WBS") || workbook.worksheets[0];
  if (!sheet) throw new Error("WBS ワークシートが見つかりません。");
  const headers = headerMap(sheet);
  const column = (...names: string[]) => columnOf(headers, ...names);
  const required = (name: string) => column(name) || (() => { throw new Error(`WBS 列が見つかりません: ${name}`); })();
  const idColumn = required("id");
  const nameColumn = required("作業項目");

  const wbs: WbsTask[] = [];
  for (const row of dataRows(sheet)) {
    const id = text(cell(row, idColumn));
    const name = text(cell(row, nameColumn));
    if (!id && !name) continue;
    const levelCell = column("階層") ? Number(cell(row, column("階層")!)) : NaN;
    const dependencyTokens = text(column("依存関係") ? cell(row, column("依存関係")!) : "")
      .split(",").map((item) => item.trim()).filter(Boolean);
    const dependsOn = dependencyTokens.filter((token) => !token.includes(":"));
    const relations = dependencyTokens.filter((token) => token.includes(":")).map((token) => {
      const [predecessorId, type = "FS", lagText = "0"] = token.split(":").map((part) => part.trim());
      return { predecessorId, type: ["FS", "SS", "FF", "SF"].includes(type) ? type as "FS" | "SS" | "FF" | "SF" : "FS", lagDays: Number.parseInt(lagText, 10) || 0 };
    });
    const sprint = column("スプリント") ? text(cell(row, column("スプリント")!)) : "";
    const actualEffortCell = column("実績工数") ? cell(row, column("実績工数")!) : undefined;
    wbs.push({
      id, name,
      nameJa: column("作業項目（日本語）") ? text(cell(row, column("作業項目（日本語）")!)) || undefined : undefined,
      level: Number.isFinite(levelCell) && levelCell > 0 ? levelCell : id.split(".").length,
      type: (column("種別") ? text(cell(row, column("種別")!)) : "") || "task",
      status: ((column("ステータス") ? text(cell(row, column("ステータス")!)) : "") || "todo") as WbsTask["status"],
      owner: column("担当者") ? text(cell(row, column("担当者")!)) : "",
      sprint: sprint || undefined,
      start: dateText(column("計画開始日") ? cell(row, column("計画開始日")!) : ""),
      end: dateText(column("計画終了日") ? cell(row, column("計画終了日")!) : ""),
      effortDays: Number(column("計画工数") ? cell(row, column("計画工数")!) : 0) || 0,
      pct: Number(column("進捗率") ? cell(row, column("進捗率")!) : 0) || 0,
      actualStart: (column("実績開始日") ? dateText(cell(row, column("実績開始日")!)) : "") || undefined,
      actualEnd: (column("実績終了日") ? dateText(cell(row, column("実績終了日")!)) : "") || undefined,
      actualEffort: actualEffortCell === undefined || actualEffortCell === null || actualEffortCell === "" ? undefined : Number(actualEffortCell) || 0,
      deliverable: column("成果物") ? text(cell(row, column("成果物")!)) : "",
      acceptance: column("受入基準") ? text(cell(row, column("受入基準")!)) || undefined : undefined,
      checklistRef: column("チェックリスト") ? text(cell(row, column("チェックリスト")!)) : "",
      dependsOn,
      relations: relations.length ? relations : undefined,
    } as WbsTask);
  }

  const meta: Record<string, string | string[]> = {};
  const description = workbook.getWorksheet("説明");
  if (description) {
    for (const row of dataRows(description)) {
      const key = text(row.getCell(1).value);
      const raw = text(row.getCell(2).value);
      if (!key) continue;
      meta[key] = raw.startsWith("[") ? JSON.parse(raw) : raw;
    }
  }

  const readSheet = (name: string) => {
    const target = workbook.getWorksheet(name);
    if (!target) return { headers: new Map<string, number>(), rows: [] as ExcelJS.Row[] };
    return { headers: headerMap(target), rows: dataRows(target) };
  };
  const pick = (headers: Map<string, number>, row: ExcelJS.Row, name: string) => {
    const col = columnOf(headers, name);
    return col ? text(cell(row, col)) : "";
  };

  const msSheet = readSheet("マイルストーン");
  const milestones = msSheet.rows.map((row) => ({
    id: pick(msSheet.headers, row, "ID"), name: pick(msSheet.headers, row, "名称"),
    date: dateText(pick(msSheet.headers, row, "期日")), status: pick(msSheet.headers, row, "ステータス") as ProjectPlan["milestones"][number]["status"],
    exitCriteria: pick(msSheet.headers, row, "完了条件"),
  })).filter((m) => m.id || m.name);

  const spSheet = readSheet("スプリント");
  const sprints = spSheet.rows.map((row) => ({
    id: pick(spSheet.headers, row, "ID"), name: pick(spSheet.headers, row, "名称"),
    start: dateText(pick(spSheet.headers, row, "開始日")), end: dateText(pick(spSheet.headers, row, "終了日")),
    goal: pick(spSheet.headers, row, "ゴール"),
  })).filter((s) => s.id || s.name);

  const roleSheet = readSheet("役割");
  const roles = roleSheet.rows.map((row) => ({
    id: pick(roleSheet.headers, row, "ID"), title: pick(roleSheet.headers, row, "役割"),
    person: pick(roleSheet.headers, row, "担当者"), focus: pick(roleSheet.headers, row, "フォーカス"),
  })).filter((r) => r.id || r.title);

  const raciSheet = readSheet("RACI");
  const raciKeys: string[] = [];
  if (raciSheet.rows.length || workbook.getWorksheet("RACI")) {
    workbook.getWorksheet("RACI")?.getRow(1).eachCell((value) => raciKeys.push(text(value)));
  }
  const raci = raciSheet.rows.map((row) => {
    const entry: Record<string, string> = {};
    raciKeys.forEach((key, keyIndex) => { entry[key] = text(row.getCell(keyIndex + 1).value); });
    return entry;
  }).filter((row) => Object.values(row).some(Boolean));

  const raidSheet = readSheet("RAID");
  const raid = raidSheet.rows.map((row) => ({
    id: pick(raidSheet.headers, row, "ID"), type: pick(raidSheet.headers, row, "種別"),
    title: pick(raidSheet.headers, row, "タイトル"), impact: pick(raidSheet.headers, row, "影響度"),
    likelihood: pick(raidSheet.headers, row, "発生確率"), owner: pick(raidSheet.headers, row, "担当者"),
    response: pick(raidSheet.headers, row, "対策"), status: pick(raidSheet.headers, row, "ステータス") as ProjectPlan["raid"][number]["status"],
  })).filter((r) => r.id || r.title);

  const ticketSheet = readSheet("課題");
  const tickets = ticketSheet.rows.map((row) => ({
    id: pick(ticketSheet.headers, row, "ID"), title: pick(ticketSheet.headers, row, "タイトル"),
    reporter: pick(ticketSheet.headers, row, "起票者"), assignee: pick(ticketSheet.headers, row, "担当者"),
    status: pick(ticketSheet.headers, row, "ステータス") as ProjectPlan["tickets"][number]["status"],
    dueDate: dateText(pick(ticketSheet.headers, row, "期日")), wbsId: pick(ticketSheet.headers, row, "WBS"),
    ballUnknown: pick(ticketSheet.headers, row, "ボール不明") === "true",
    needsImprovement: pick(ticketSheet.headers, row, "改善要") === "true",
    lastUpdatedAt: dateText(pick(ticketSheet.headers, row, "最終更新")),
    dueChangeRequest: parseJsonCell(pick(ticketSheet.headers, row, "期日変更申請")) ?? null,
    comments: parseJsonCell(pick(ticketSheet.headers, row, "コメント")) ?? [],
    history: parseJsonCell(pick(ticketSheet.headers, row, "履歴")) ?? [],
  })).filter((t) => t.id || t.title);

  const historySheet = readSheet("変更履歴");
  const changeLog = historySheet.rows.map((row) => ({
    version: pick(historySheet.headers, row, "版"), date: dateText(pick(historySheet.headers, row, "更新日")),
    author: pick(historySheet.headers, row, "更新者"), note: pick(historySheet.headers, row, "更新内容"),
  })).filter((item) => item.version || item.note);

  let org: ProjectPlan["org"];
  let calendar: ProjectPlan["calendar"];
  const settings = workbook.getWorksheet("設定JSON");
  if (settings) {
    for (const row of dataRows(settings)) {
      const key = text(row.getCell(1).value);
      if (key === "org") org = parseJsonCell(row.getCell(2).value);
      if (key === "calendar") calendar = parseJsonCell(row.getCell(2).value);
    }
  }

  return validateProjectPlan({
    meta, milestones, sprints, roles, raci, raid, tickets, wbs,
    changeLog, org, calendar,
  });
}

async function main() {
  const args = process.argv.slice(2);
  const input = args[args.indexOf("--in") + 1];
  const output = args[args.indexOf("--out") + 1];
  if (!input || !output) throw new Error("使い方: tsx src/excel.ts --in input.json|input.xlsx --out output.xlsx|output.json");
  if (path.extname(input).toLowerCase() === ".xlsx") {
    await fs.writeFile(output, JSON.stringify(await importWorkbook(input), null, 2));
  } else {
    await exportWorkbook(validateProjectPlan(JSON.parse(await fs.readFile(input, "utf8"))), output);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
