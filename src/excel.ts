import ExcelJS from "exceljs";
import fs from "node:fs/promises";
import path from "node:path";
import type { ProjectPlan, WbsTask } from "./domain/project-plan.ts";

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

export async function exportWorkbook(plan: ProjectPlan, outputFile: string) {
  const workbook = new ExcelJS.Workbook();
  const wbs = workbook.addWorksheet("WBS");
  wbs.columns = [
    { header: "ID", key: "id", width: 12 }, { header: "作業項目", key: "name", width: 32 },
    { header: "階層", key: "level", width: 8 }, { header: "種別", key: "type", width: 14 },
    { header: "ステータス", key: "status", width: 14 }, { header: "担当者", key: "owner", width: 18 }, { header: "スプリント", key: "sprint", width: 14 },
    { header: "計画開始日", key: "start", width: 14 }, { header: "計画終了日", key: "end", width: 14 },
    { header: "計画工数", key: "effortDays", width: 12 }, { header: "進捗率", key: "pct", width: 10 },
    { header: "実績開始日", key: "actualStart", width: 14 }, { header: "実績終了日", key: "actualEnd", width: 14 },
    { header: "成果物", key: "deliverable", width: 24 }, { header: "依存関係", key: "relations", width: 24 },
  ];
  plan.wbs.forEach((task) => wbs.addRow({ ...task, relations: task.relations?.map((relation) => `${relation.predecessorId}:${relation.type}:${relation.lagDays}`).join(", ") || task.dependsOn?.join(", ") || "" }));
  wbs.getRow(1).font = { bold: true };
  const description = workbook.addWorksheet("説明");
  description.addRows([["項目", "値"], ["プロジェクト", plan.meta.projectName], ["基準日", plan.meta.dataDate], ["責任者", plan.meta.pm]]);
  const history = workbook.addWorksheet("変更履歴");
  history.addRow(["版", "更新日", "更新者", "更新内容"]);
  (plan.changeLog || []).forEach((item) => history.addRow([item.version, item.date, item.author, item.note]));
  const sample = workbook.addWorksheet("サンプル");
  sample.addRow(["ID", "作業項目", "階層", "種別"]);
  plan.wbs.filter((task) => task.type === "phase").forEach((task) => sample.addRow([task.id, task.name, task.level, task.type]));
  await workbook.xlsx.writeFile(outputFile);
}

export async function importWorkbook(inputFile: string): Promise<ProjectPlan> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(inputFile);
  const sheet = workbook.getWorksheet("WBS") || workbook.worksheets[0];
  if (!sheet) throw new Error("WBS ワークシートが見つかりません。");
  const headers = new Map<string, number>();
  sheet.getRow(1).eachCell((value, column) => headers.set(text(value).toLowerCase(), column));
  const column = (...names: string[]) => names.map((name) => headers.get(name.toLowerCase())).find((value): value is number => Boolean(value));
  const required = (name: string) => column(name) || (() => { throw new Error(`WBS 列が見つかりません: ${name}`); })();
  const idColumn = required("id");
  const nameColumn = required("作業項目");
  const wbs: WbsTask[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const id = text(cell(row, idColumn));
    const name = text(cell(row, nameColumn));
    if (!id && !name) return;
    wbs.push({
      id, name, level: Number(cell(row, column("階層") || 3)) || 3, type: text(cell(row, column("種別") || 4)) || "task",
      status: (text(cell(row, column("ステータス") || 5)) || "todo") as WbsTask["status"], owner: text(cell(row, column("担当者") || 6)) || "未設定",
      sprint: text(cell(row, column("スプリント") || 7)) || "未設定",
      start: dateText(cell(row, column("計画開始日") || 8)), end: dateText(cell(row, column("計画終了日") || 9)),
      effortDays: Number(cell(row, column("計画工数") || 10)) || 0, pct: Number(cell(row, column("進捗率") || 11)) || 0,
      actualStart: dateText(cell(row, column("実績開始日") || 12)) || undefined, actualEnd: dateText(cell(row, column("実績終了日") || 13)) || undefined,
      actualEffort: 0, deliverable: text(cell(row, column("成果物") || 14)) || "未設定", acceptance: "", checklistRef: "未設定",
      dependsOn: text(cell(row, column("依存関係") || 15)).split(",").map((item) => item.trim()).filter(Boolean).map((item) => item.split(":")[0]),
      relations: text(cell(row, column("依存関係") || 15)).split(",").map((item) => item.trim()).filter(Boolean).map((item) => {
        const [predecessorId, type = "FS", lagText = "0"] = item.split(":").map((part) => part.trim());
        return { predecessorId, type: ["FS", "SS", "FF", "SF"].includes(type) ? type as "FS" | "SS" | "FF" | "SF" : "FS", lagDays: Number.parseInt(lagText, 10) || 0 };
      }),
    });
  });
  return {
    meta: { projectName: "Excel 取込プロジェクト", projectCode: "excel-import", planStart: wbs[0]?.start || "", planEnd: wbs.at(-1)?.end || "", dataDate: new Date().toISOString().slice(0, 10), pm: "" },
    milestones: [], sprints: [], roles: [], raci: [], raid: [], tickets: [], wbs, changeLog: [], calendar: { weekendAutoHoliday: true, holidays: [], weeklyMeetings: [] },
  };
}

async function main() {
  const args = process.argv.slice(2);
  const input = args[args.indexOf("--in") + 1];
  const output = args[args.indexOf("--out") + 1];
  if (!input || !output) throw new Error("使い方: tsx src/excel.ts --in input.json|input.xlsx --out output.xlsx|output.json");
  if (path.extname(input).toLowerCase() === ".xlsx") {
    await fs.writeFile(output, JSON.stringify(await importWorkbook(input), null, 2));
  } else {
    await exportWorkbook(JSON.parse(await fs.readFile(input, "utf8")) as ProjectPlan, output);
  }
}

main();
