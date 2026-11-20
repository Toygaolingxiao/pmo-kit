export type ProjectStatus = "GREEN" | "AMBER" | "RED" | "UNKNOWN";

export type CalendarHoliday = {
  date: string;
  type?: string;
  note?: string;
};

export type ProjectCalendar = {
  weekendAutoHoliday?: boolean;
  holidays?: CalendarHoliday[];
  weeklyMeetings?: Array<{ date: string; name?: string; startTime?: string; endTime?: string }>;
  weeklyMeetingRule?: {
    name: string;
    frequency?: "daily" | "weekly" | "monthly" | "yearly";
    interval?: number;
    weekday?: number;
    weekdays?: number[];
    start?: string;
    end?: string;
    startTime?: string;
    endTime?: string;
    startDate?: string;
    endDate?: string;
    endMode?: "date" | "count";
    count?: number;
  };
};

export type ControlTask = {
  id: string;
  start?: string;
  end?: string;
  pct?: number;
  status?: string;
  level?: number;
  effortDays?: number;
};

/**
 * 末端タスクの統一定義：他のタスクの親になっていないタスク。
 * CLI と Web（web/app.js の hasChildTasks 判定）で同じ定義を使う。
 * level の固定値（>=3 等）では判定しない。
 */
export function leafTasks<T extends { id: string }>(tasks: T[]): T[] {
  const parentIds = new Set<string>();
  for (const task of tasks) {
    const parts = task.id.split(".");
    for (let i = 1; i < parts.length; i++) {
      parentIds.add(parts.slice(0, i).join("."));
    }
  }
  return tasks.filter((task) => !parentIds.has(task.id));
}

export type ProgressVariance = {
  plannedPct: number;
  actualPct: number;
  variancePct: number;
  direction: "ahead" | "behind" | "on_track" | "not_started";
};

const DAY_MS = 86_400_000;

function dayNumber(isoDate: string): number {
  const timestamp = Date.parse(`${isoDate}T00:00:00Z`);
  if (!Number.isFinite(timestamp)) throw new Error(`Invalid ISO date: ${isoDate}`);
  return Math.floor(timestamp / DAY_MS);
}

function isoDate(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetweenInclusive(start: string, end: string): number {
  return Math.max(0, dayNumber(end) - dayNumber(start) + 1);
}

export function dateRange(start: string, end: string): string[] {
  const first = dayNumber(start);
  const last = dayNumber(end);
  if (last < first) throw new Error(`End date ${end} is before start date ${start}`);
  return Array.from({ length: last - first + 1 }, (_, index) => isoDate(first + index));
}

export function isWorkingDay(date: string, calendar: ProjectCalendar = {}): boolean {
  const weekday = new Date(dayNumber(date) * DAY_MS).getUTCDay();
  const weekend = weekday === 0 || weekday === 6;
  const holiday = (calendar.holidays ?? []).some((item) => item.date === date);
  return !(holiday || (calendar.weekendAutoHoliday ?? true) && weekend);
}

export function workingDaysBetween(
  start: string,
  end: string,
  calendar: ProjectCalendar = {},
): number {
  return dateRange(start, end).filter((date) => isWorkingDay(date, calendar)).length;
}

export function plannedProgress(
  start: string,
  end: string,
  dataDate: string,
  calendar: ProjectCalendar = {},
): number {
  const total = workingDaysBetween(start, end, calendar);
  if (total === 0) return 0;
  const elapsed = dateRange(start, end)
    .filter((date) => date <= dataDate && isWorkingDay(date, calendar))
    .length;
  return Math.min(100, Math.max(0, (elapsed / total) * 100));
}

export function progressVariance(
  task: Pick<ControlTask, "start" | "end" | "pct" | "status">,
  dataDate: string,
  calendar: ProjectCalendar = {},
): ProgressVariance {
  const actualPct = Math.min(100, Math.max(0, task.pct ?? 0));
  // 未着手とみなすのは「まだ開始日が来ていない」場合だけ。開始日を過ぎた
  // todo は計画進捗との差で behind になる（逾期未開工を隠さない）。
  if (!task.start || !task.end || (actualPct === 0 && dataDate < task.start)) {
    return { plannedPct: 0, actualPct, variancePct: 0, direction: "not_started" };
  }
  const plannedPct = plannedProgress(task.start, task.end, dataDate, calendar);
  const variancePct = Number((actualPct - plannedPct).toFixed(1));
  const direction = variancePct > 0.5 ? "ahead" : variancePct < -0.5 ? "behind" : "on_track";
  return { plannedPct: Number(plannedPct.toFixed(1)), actualPct, variancePct, direction };
}

export function averageProgress(tasks: ControlTask[]): number {
  if (tasks.length === 0) return 0;
  return Number((tasks.reduce((sum, task) => sum + (task.pct ?? 0), 0) / tasks.length).toFixed(1));
}

/**
 * 工数加重進捗。重みは effortDays（正でない場合は 1）で、Web 側
 * （web/app.js）の計算と同一口径。対象が空なら null（0% と表示しない）。
 */
export function weightedProgress(tasks: ControlTask[]): number | null {
  if (tasks.length === 0) return null;
  let totalWeight = 0;
  let earned = 0;
  for (const task of tasks) {
    const weight = typeof task.effortDays === "number" && task.effortDays > 0 ? task.effortDays : 1;
    totalWeight += weight;
    earned += weight * Math.min(100, Math.max(0, task.pct ?? 0)) / 100;
  }
  if (totalWeight === 0) return null;
  return Number(((earned / totalWeight) * 100).toFixed(1));
}

export type HealthReport = {
  status: ProjectStatus;
  reasons: string[];
  evaluatedCount: number;
};

/**
 * 健康度は呼び出し側が渡した末端タスク集合でのみ判定する。
 * deferred は判定から外す（保留は遅延ではない）。対象が空なら
 * UNKNOWN を返し、理由を必ず付ける。
 */
export function deriveHealthReport(
  tasks: ControlTask[],
  dataDate: string,
  calendar: ProjectCalendar = {},
): HealthReport {
  const eligible = tasks.filter((task) => task.status !== "deferred");
  if (eligible.length === 0) {
    return { status: "UNKNOWN", reasons: ["判定対象の末端タスクがありません"], evaluatedCount: 0 };
  }
  const behind = eligible
    .map((task) => ({ id: task.id, variance: progressVariance(task, dataDate, calendar) }))
    .filter((item) => item.variance.direction === "behind");
  const reasons = behind.map(
    (item) => `${item.id}: 計画 ${item.variance.plannedPct}% / 実績 ${item.variance.actualPct}%（差 ${item.variance.variancePct}pt）`,
  );
  if (behind.some((item) => item.variance.variancePct <= -20)) {
    return { status: "RED", reasons, evaluatedCount: eligible.length };
  }
  if (behind.length > 0) {
    return { status: "AMBER", reasons, evaluatedCount: eligible.length };
  }
  return { status: "GREEN", reasons: [], evaluatedCount: eligible.length };
}

export function deriveHealth(
  tasks: ControlTask[],
  dataDate: string,
  calendar: ProjectCalendar = {},
): ProjectStatus {
  return deriveHealthReport(tasks, dataDate, calendar).status;
}
