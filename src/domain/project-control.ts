export type ProjectStatus = "GREEN" | "AMBER" | "RED";

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
};

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
  if (!task.start || !task.end || task.status === "todo" && actualPct === 0) {
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

export function deriveHealth(
  tasks: ControlTask[],
  dataDate: string,
  calendar: ProjectCalendar = {},
): ProjectStatus {
  const variances = tasks
    .filter((task) => task.level === undefined || task.level >= 3)
    .map((task) => progressVariance(task, dataDate, calendar));
  if (variances.some((item) => item.direction === "behind" && item.variancePct <= -20)) return "RED";
  if (variances.some((item) => item.direction === "behind")) return "AMBER";
  return "GREEN";
}
