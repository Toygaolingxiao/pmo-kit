import type { ControlTask, ProjectCalendar } from "./project-control.ts";

export type PlanStatus =
  | "done"
  | "in_progress"
  | "todo"
  | "deferred"
  | "planned"
  | "open"
  | "mitigating"
  | "accepted"
  | "closed";

export type TicketStatus = "todo" | "in_progress" | "resolved" | "closed" | "cancelled";

export type TicketComment = {
  id: string;
  author: string;
  at: string;
  body: string;
  mentions: string[];
  reactions: Array<{ person: string; emoji: string }>;
};

export type DueChangeRequest = {
  requestedDue: string;
  reason: string;
  requestedBy: string;
  requestedAt: string;
  status: "pending" | "approved" | "rejected";
};

export type Ticket = {
  id: string;
  title: string;
  reporter: string;
  assignee: string;
  status: TicketStatus;
  dueDate: string;
  wbsId: string;
  ballUnknown: boolean;
  needsImprovement: boolean;
  dueChangeRequest: DueChangeRequest | null;
  comments: TicketComment[];
  lastUpdatedAt: string;
  history: Array<{ at: string; actor: string; type: string; from: string; to: string; note: string }>;
};

export type WbsTask = ControlTask & {
  id: string;
  name: string;
  nameJa?: string;
  level: number;
  type: string;
  status: PlanStatus;
  pct: number;
  owner: string;
  sprint: string;
  start: string;
  end: string;
  effortDays: number;
  actualStart?: string;
  actualEnd?: string;
  actualEffort?: number;
  dependsOn: string[];
  relations?: DependencyRelation[];
  deliverable: string;
  acceptance?: string;
  checklistRef: string;
};

export type DependencyRelation = {
  predecessorId: string;
  type: "FS" | "SS" | "FF" | "SF";
  lagDays: number;
};

export type ProjectPlan = {
  meta: Record<string, string | string[]>;
  calendar?: ProjectCalendar;
  org?: {
    sponsor: { name: string; title: string; duties: string[] };
    hats: Array<{ id: string; title: string; person: string; duties: string[] }>;
  };
  milestones: Array<{
    id: string;
    name: string;
    date: string;
    status: PlanStatus;
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
    status: PlanStatus;
  }>;
  tickets: Ticket[];
  wbs: WbsTask[];
  changeLog?: Array<{ version: string; date: string; author: string; note: string }>;
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const REQUIRED_META = ["projectName", "planStart", "planEnd", "dataDate"];

function fail(path: string, message: string): never {
  throw new Error(`Invalid project plan at ${path}: ${message}`);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(path, "expected an object");
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) fail(path, "expected a non-empty string");
  return value;
}

function dateValue(value: unknown, path: string): string {
  const date = stringValue(value, path);
  if (!DATE_PATTERN.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`))) {
    fail(path, "expected an ISO date in YYYY-MM-DD format");
  }
  return date;
}

function arrayValue(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, "expected an array");
  return value;
}

function validateWbs(value: unknown, index: number): WbsTask {
  const item = record(value, `wbs[${index}]`);
  const path = (field: string) => `wbs[${index}].${field}`;
  const start = dateValue(item.start, path("start"));
  const end = dateValue(item.end, path("end"));
  if (Date.parse(`${end}T00:00:00Z`) < Date.parse(`${start}T00:00:00Z`)) {
    fail(path("end"), "must not be before start");
  }
  if (typeof item.level !== "number" || item.level < 1) fail(path("level"), "expected a positive number");
  if (typeof item.pct !== "number" || item.pct < 0 || item.pct > 100) fail(path("pct"), "expected 0-100");
  if (typeof item.effortDays !== "number" || item.effortDays < 0) {
    fail(path("effortDays"), "expected a non-negative number");
  }
  return {
    id: stringValue(item.id, path("id")),
    name: stringValue(item.name, path("name")),
    nameJa: typeof item.nameJa === "string" ? item.nameJa : undefined,
    level: item.level,
    type: stringValue(item.type, path("type")),
    status: stringValue(item.status, path("status")) as PlanStatus,
    pct: item.pct,
    owner: stringValue(item.owner, path("owner")),
    sprint: typeof item.sprint === "string" ? item.sprint : "SP-1",
    start,
    end,
    effortDays: item.effortDays,
    dependsOn: arrayValue(item.dependsOn ?? [], path("dependsOn")).map((dependency, dependencyIndex) =>
      stringValue(dependency, `${path("dependsOn")}[${dependencyIndex}]`),
    ),
    relations: Array.isArray(item.relations)
      ? item.relations.map((relation, relationIndex) => {
        const entry = record(relation, `${path("relations")}[${relationIndex}]`);
        const relationType = stringValue(entry.type, `${path("relations")}[${relationIndex}].type`);
        if (!["FS", "SS", "FF", "SF"].includes(relationType)) fail(`${path("relations")}[${relationIndex}].type`, "expected FS, SS, FF, or SF");
        if (typeof entry.lagDays !== "number" || !Number.isInteger(entry.lagDays)) fail(`${path("relations")}[${relationIndex}].lagDays`, "expected an integer");
        return { predecessorId: stringValue(entry.predecessorId, `${path("relations")}[${relationIndex}].predecessorId`), type: relationType as WbsTask["relations"] extends Array<infer R> ? R extends { type: infer T } ? T : never : never, lagDays: entry.lagDays };
      })
      : undefined,
    deliverable: stringValue(item.deliverable, path("deliverable")),
    acceptance: typeof item.acceptance === "string" ? item.acceptance : undefined,
    checklistRef: typeof item.checklistRef === "string" ? item.checklistRef : "",
  };
}

const TICKET_STATUSES = new Set(["todo", "in_progress", "resolved", "closed", "cancelled"]);
const DUE_REQUEST_STATUSES = new Set(["pending", "approved", "rejected"]);

function textValue(value: unknown, path: string): string {
  if (typeof value !== "string") fail(path, "expected a string");
  return value;
}

function booleanValue(value: unknown, path: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") fail(path, "expected a boolean");
  return value;
}

function validateTicket(value: unknown, index: number): Ticket {
  const item = record(value, `tickets[${index}]`);
  const path = (field: string) => `tickets[${index}].${field}`;
  const status = stringValue(item.status, path("status"));
  if (!TICKET_STATUSES.has(status)) fail(path("status"), "expected todo, in_progress, resolved, closed, or cancelled");
  const request = item.dueChangeRequest;
  let dueChangeRequest: Ticket["dueChangeRequest"] = null;
  if (request !== undefined && request !== null) {
    const entry = record(request, path("dueChangeRequest"));
    const requestStatus = stringValue(entry.status, `${path("dueChangeRequest")}.status`);
    if (!DUE_REQUEST_STATUSES.has(requestStatus)) fail(`${path("dueChangeRequest")}.status`, "expected pending, approved, or rejected");
    dueChangeRequest = {
      requestedDue: dateValue(entry.requestedDue, `${path("dueChangeRequest")}.requestedDue`),
      reason: stringValue(entry.reason, `${path("dueChangeRequest")}.reason`),
      requestedBy: stringValue(entry.requestedBy, `${path("dueChangeRequest")}.requestedBy`),
      requestedAt: stringValue(entry.requestedAt, `${path("dueChangeRequest")}.requestedAt`),
      status: requestStatus as DueChangeRequest["status"],
    };
  }
  const comments = arrayValue(item.comments ?? [], path("comments")).map((comment, commentIndex) => {
    const entry = record(comment, `${path("comments")}[${commentIndex}]`);
    const commentPath = `${path("comments")}[${commentIndex}]`;
    return {
      id: stringValue(entry.id, `${commentPath}.id`),
      author: stringValue(entry.author, `${commentPath}.author`),
      at: stringValue(entry.at, `${commentPath}.at`),
      body: stringValue(entry.body, `${commentPath}.body`),
      mentions: arrayValue(entry.mentions ?? [], `${commentPath}.mentions`).map((mention, mentionIndex) =>
        stringValue(mention, `${commentPath}.mentions[${mentionIndex}]`),
      ),
      reactions: arrayValue(entry.reactions ?? [], `${commentPath}.reactions`).map((reaction, reactionIndex) => {
        const reactionEntry = record(reaction, `${commentPath}.reactions[${reactionIndex}]`);
        return {
          person: stringValue(reactionEntry.person, `${commentPath}.reactions[${reactionIndex}].person`),
          emoji: stringValue(reactionEntry.emoji, `${commentPath}.reactions[${reactionIndex}].emoji`),
        };
      }),
    };
  });
  const history = arrayValue(item.history ?? [], path("history")).map((entry, historyIndex) => {
    const historyEntry = record(entry, `${path("history")}[${historyIndex}]`);
    const historyPath = `${path("history")}[${historyIndex}]`;
    return {
      at: stringValue(historyEntry.at, `${historyPath}.at`),
      actor: stringValue(historyEntry.actor, `${historyPath}.actor`),
      type: stringValue(historyEntry.type, `${historyPath}.type`),
      from: textValue(historyEntry.from, `${historyPath}.from`),
      to: textValue(historyEntry.to, `${historyPath}.to`),
      note: textValue(historyEntry.note, `${historyPath}.note`),
    };
  });
  return {
    id: stringValue(item.id, path("id")),
    title: stringValue(item.title, path("title")),
    reporter: stringValue(item.reporter, path("reporter")),
    assignee: stringValue(item.assignee, path("assignee")),
    status: status as TicketStatus,
    dueDate: dateValue(item.dueDate, path("dueDate")),
    wbsId: textValue(item.wbsId ?? "", path("wbsId")),
    ballUnknown: booleanValue(item.ballUnknown, path("ballUnknown"), false),
    needsImprovement: booleanValue(item.needsImprovement, path("needsImprovement"), false),
    dueChangeRequest,
    comments,
    lastUpdatedAt: dateValue(item.lastUpdatedAt, path("lastUpdatedAt")),
    history,
  };
}

export function validateProjectPlan(input: unknown): ProjectPlan {
  const root = record(input, "$");
  const meta = record(root.meta, "meta") as Record<string, string | string[]>;
  for (const field of REQUIRED_META) {
    const value = meta[field];
    if (typeof value !== "string" || value.length === 0) fail(`meta.${field}`, "expected a non-empty string");
  }
  dateValue(meta.planStart, "meta.planStart");
  dateValue(meta.planEnd, "meta.planEnd");
  dateValue(meta.dataDate, "meta.dataDate");
  if (Date.parse(`${meta.planEnd}T00:00:00Z`) < Date.parse(`${meta.planStart}T00:00:00Z`)) {
    fail("meta.planEnd", "must not be before meta.planStart");
  }

  const milestones = arrayValue(root.milestones, "milestones") as ProjectPlan["milestones"];
  const sprints = arrayValue(root.sprints, "sprints") as ProjectPlan["sprints"];
  const roles = arrayValue(root.roles, "roles") as ProjectPlan["roles"];
  const raci = arrayValue(root.raci, "raci") as ProjectPlan["raci"];
  const raid = arrayValue(root.raid, "raid") as ProjectPlan["raid"];
  const tickets = root.tickets === undefined ? [] : arrayValue(root.tickets, "tickets").map(validateTicket);
  const wbs = arrayValue(root.wbs, "wbs").map(validateWbs);

  for (const [index, milestone] of milestones.entries()) {
    const item = record(milestone, `milestones[${index}]`);
    dateValue(item.date, `milestones[${index}].date`);
  }
  for (const [index, sprint] of sprints.entries()) {
    const item = record(sprint, `sprints[${index}]`);
    dateValue(item.start, `sprints[${index}].start`);
    dateValue(item.end, `sprints[${index}].end`);
  }

  return {
    ...(root as unknown as ProjectPlan),
    meta,
    calendar: root.calendar as ProjectCalendar | undefined,
    milestones,
    sprints,
    roles,
    raci,
    raid,
    tickets,
    wbs,
  };
}
