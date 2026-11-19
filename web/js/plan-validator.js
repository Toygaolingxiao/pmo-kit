/**
 * project-plan.json の検証器（Web 版）。
 *
 * CLI 側 `src/domain/project-plan.ts` の validateProjectPlan と同一ルールの
 * JavaScript 実装です。二重管理を避けるため、ルール変更は両側へ同時に
 * 入れてください。検証を通らない計画は取り込まず、パス付きで理由を返します。
 */

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const REQUIRED_META = ["projectName", "planStart", "planEnd", "dataDate"];

const PLAN_STATUSES = new Set([
  "done",
  "in_progress",
  "todo",
  "deferred",
  "planned",
  "open",
  "mitigating",
  "accepted",
  "closed",
]);
const OVERALL_STATUSES = new Set(["GREEN", "AMBER", "RED"]);
const RAID_TYPES = new Set(["risk", "assumption", "issue", "dependency", "decision"]);
const RELATION_TYPES = new Set(["FS", "SS", "FF", "SF"]);
const TICKET_STATUSES = new Set(["todo", "in_progress", "resolved", "closed", "cancelled"]);
const DUE_REQUEST_STATUSES = new Set(["pending", "approved", "rejected"]);

function fail(path, message) {
  throw new Error(`Invalid project plan at ${path}: ${message}`);
}

function record(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(path, "expected an object");
  return value;
}

function stringValue(value, path) {
  if (typeof value !== "string" || value.length === 0) fail(path, "expected a non-empty string");
  return value;
}

function textValue(value, path) {
  if (typeof value !== "string") fail(path, "expected a string");
  return value;
}

function booleanValue(value, path, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") fail(path, "expected a boolean");
  return value;
}

function finiteNumber(value, path) {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(path, "expected a finite number");
  return value;
}

function dateValue(value, path) {
  const date = stringValue(value, path);
  if (!DATE_PATTERN.test(date)) fail(path, "expected an ISO date in YYYY-MM-DD format");
  const [year, month, day] = date.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    fail(path, "expected a real calendar date");
  }
  return date;
}

function statusValue(value, path) {
  const status = stringValue(value, path);
  if (!PLAN_STATUSES.has(status)) {
    fail(path, `expected one of: ${[...PLAN_STATUSES].join(", ")}`);
  }
  return status;
}

function arrayValue(value, path) {
  if (!Array.isArray(value)) fail(path, "expected an array");
  return value;
}

function stringList(value, path) {
  return arrayValue(value, path).map((entry, entryIndex) => stringValue(entry, `${path}[${entryIndex}]`));
}

function validateWbs(value, index) {
  const item = record(value, `wbs[${index}]`);
  const path = (field) => `wbs[${index}].${field}`;
  const id = stringValue(item.id, path("id"));
  const start = dateValue(item.start, path("start"));
  const end = dateValue(item.end, path("end"));
  if (Date.parse(`${end}T00:00:00Z`) < Date.parse(`${start}T00:00:00Z`)) {
    fail(path("end"), "must not be before start");
  }
  const level = finiteNumber(item.level, path("level"));
  if (!Number.isInteger(level) || level < 1 || level > 4) fail(path("level"), "expected an integer between 1 and 4");
  if (level !== id.split(".").length) fail(path("level"), "must match the depth of the dotted id");
  const pct = finiteNumber(item.pct, path("pct"));
  if (pct < 0 || pct > 100) fail(path("pct"), "expected 0-100");
  const effortDays = finiteNumber(item.effortDays, path("effortDays"));
  if (effortDays < 0) fail(path("effortDays"), "expected a non-negative number");
  const status = statusValue(item.status, path("status"));
  if (status === "done" && pct !== 100) fail(path("pct"), "a done task must be at 100");
  if (status !== "done" && pct === 100) fail(path("status"), "a task at 100 must be done");
  if (status === "todo" && pct !== 0) fail(path("pct"), "a todo task must be at 0");
  const actualStart = item.actualStart === undefined ? undefined : dateValue(item.actualStart, path("actualStart"));
  const actualEnd = item.actualEnd === undefined ? undefined : dateValue(item.actualEnd, path("actualEnd"));
  if (actualStart && actualEnd && Date.parse(`${actualEnd}T00:00:00Z`) < Date.parse(`${actualStart}T00:00:00Z`)) {
    fail(path("actualEnd"), "must not be before actualStart");
  }
  const actualEffort = item.actualEffort === undefined ? undefined : finiteNumber(item.actualEffort, path("actualEffort"));
  if (actualEffort !== undefined && actualEffort < 0) fail(path("actualEffort"), "expected a non-negative number");
  return {
    id,
    name: stringValue(item.name, path("name")),
    nameJa: typeof item.nameJa === "string" ? item.nameJa : undefined,
    level,
    type: stringValue(item.type, path("type")),
    status,
    pct,
    owner: stringValue(item.owner, path("owner")),
    sprint: typeof item.sprint === "string" ? item.sprint : "SP-1",
    start,
    end,
    effortDays,
    actualStart,
    actualEnd,
    actualEffort,
    dependsOn: arrayValue(item.dependsOn ?? [], path("dependsOn")).map((dependency, dependencyIndex) =>
      stringValue(dependency, `${path("dependsOn")}[${dependencyIndex}]`),
    ),
    relations: Array.isArray(item.relations)
      ? item.relations.map((relation, relationIndex) => {
        const entry = record(relation, `${path("relations")}[${relationIndex}]`);
        const relationType = stringValue(entry.type, `${path("relations")}[${relationIndex}].type`);
        if (!RELATION_TYPES.has(relationType)) fail(`${path("relations")}[${relationIndex}].type`, "expected FS, SS, FF, or SF");
        if (typeof entry.lagDays !== "number" || !Number.isInteger(entry.lagDays)) fail(`${path("relations")}[${relationIndex}].lagDays`, "expected an integer");
        return { predecessorId: stringValue(entry.predecessorId, `${path("relations")}[${relationIndex}].predecessorId`), type: relationType, lagDays: entry.lagDays };
      })
      : undefined,
    deliverable: stringValue(item.deliverable, path("deliverable")),
    acceptance: typeof item.acceptance === "string" ? item.acceptance : undefined,
    checklistRef: typeof item.checklistRef === "string" ? item.checklistRef : "",
  };
}

function validateMilestone(value, index) {
  const item = record(value, `milestones[${index}]`);
  const path = (field) => `milestones[${index}].${field}`;
  return {
    id: stringValue(item.id, path("id")),
    name: stringValue(item.name, path("name")),
    date: dateValue(item.date, path("date")),
    status: statusValue(item.status, path("status")),
    exitCriteria: textValue(item.exitCriteria ?? "", path("exitCriteria")),
  };
}

function validateSprint(value, index) {
  const item = record(value, `sprints[${index}]`);
  const path = (field) => `sprints[${index}].${field}`;
  const start = dateValue(item.start, path("start"));
  const end = dateValue(item.end, path("end"));
  if (Date.parse(`${end}T00:00:00Z`) < Date.parse(`${start}T00:00:00Z`)) {
    fail(path("end"), "must not be before start");
  }
  return {
    id: stringValue(item.id, path("id")),
    name: stringValue(item.name, path("name")),
    start,
    end,
    goal: textValue(item.goal ?? "", path("goal")),
  };
}

function validateRole(value, index) {
  const item = record(value, `roles[${index}]`);
  const path = (field) => `roles[${index}].${field}`;
  return {
    id: stringValue(item.id, path("id")),
    title: stringValue(item.title, path("title")),
    person: stringValue(item.person, path("person")),
    focus: textValue(item.focus ?? "", path("focus")),
  };
}

function validateRaciRow(value, index) {
  const item = record(value, `raci[${index}]`);
  const row = {};
  for (const [key, entry] of Object.entries(item)) {
    row[key] = textValue(entry, `raci[${index}].${key}`);
  }
  return row;
}

function validateRaid(value, index) {
  const item = record(value, `raid[${index}]`);
  const path = (field) => `raid[${index}].${field}`;
  const type = stringValue(item.type, path("type"));
  if (!RAID_TYPES.has(type.toLowerCase())) {
    fail(path("type"), "expected risk, assumption, issue, dependency, or decision");
  }
  return {
    id: stringValue(item.id, path("id")),
    type,
    title: stringValue(item.title, path("title")),
    impact: stringValue(item.impact, path("impact")),
    likelihood: stringValue(item.likelihood, path("likelihood")),
    owner: stringValue(item.owner, path("owner")),
    response: textValue(item.response ?? "", path("response")),
    status: statusValue(item.status, path("status")),
  };
}

function validateOrg(value) {
  if (value === undefined) return undefined;
  const org = record(value, "org");
  const sponsor = record(org.sponsor, "org.sponsor");
  return {
    sponsor: {
      name: stringValue(sponsor.name, "org.sponsor.name"),
      title: stringValue(sponsor.title, "org.sponsor.title"),
      duties: stringList(sponsor.duties ?? [], "org.sponsor.duties"),
    },
    hats: arrayValue(org.hats ?? [], "org.hats").map((hat, hatIndex) => {
      const entry = record(hat, `org.hats[${hatIndex}]`);
      const hatPath = (field) => `org.hats[${hatIndex}].${field}`;
      return {
        id: stringValue(entry.id, hatPath("id")),
        title: stringValue(entry.title, hatPath("title")),
        person: stringValue(entry.person, hatPath("person")),
        duties: stringList(entry.duties ?? [], hatPath("duties")),
      };
    }),
  };
}

function validateCalendar(value) {
  if (value === undefined) return undefined;
  const calendar = record(value, "calendar");
  if (calendar.weekendAutoHoliday !== undefined && typeof calendar.weekendAutoHoliday !== "boolean") {
    fail("calendar.weekendAutoHoliday", "expected a boolean");
  }
  if (calendar.holidays !== undefined) {
    arrayValue(calendar.holidays, "calendar.holidays").forEach((holiday, holidayIndex) => {
      const entry = record(holiday, `calendar.holidays[${holidayIndex}]`);
      dateValue(entry.date, `calendar.holidays[${holidayIndex}].date`);
    });
  }
  return value;
}

function validateChangeLog(value) {
  if (value === undefined) return undefined;
  return arrayValue(value, "changeLog").map((entry, entryIndex) => {
    const item = record(entry, `changeLog[${entryIndex}]`);
    const path = (field) => `changeLog[${entryIndex}].${field}`;
    return {
      version: stringValue(item.version, path("version")),
      date: dateValue(item.date, path("date")),
      author: stringValue(item.author, path("author")),
      note: textValue(item.note ?? "", path("note")),
    };
  });
}

function validateTicket(value, index) {
  const item = record(value, `tickets[${index}]`);
  const path = (field) => `tickets[${index}].${field}`;
  const status = stringValue(item.status, path("status"));
  if (!TICKET_STATUSES.has(status)) fail(path("status"), "expected todo, in_progress, resolved, closed, or cancelled");
  const request = item.dueChangeRequest;
  let dueChangeRequest = null;
  if (request !== undefined && request !== null) {
    const entry = record(request, path("dueChangeRequest"));
    const requestStatus = stringValue(entry.status, `${path("dueChangeRequest")}.status`);
    if (!DUE_REQUEST_STATUSES.has(requestStatus)) fail(`${path("dueChangeRequest")}.status`, "expected pending, approved, or rejected");
    dueChangeRequest = {
      requestedDue: dateValue(entry.requestedDue, `${path("dueChangeRequest")}.requestedDue`),
      reason: stringValue(entry.reason, `${path("dueChangeRequest")}.reason`),
      requestedBy: stringValue(entry.requestedBy, `${path("dueChangeRequest")}.requestedBy`),
      requestedAt: stringValue(entry.requestedAt, `${path("dueChangeRequest")}.requestedAt`),
      status: requestStatus,
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
    status,
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

function assertUniqueIds(ids, section) {
  const seen = new Set();
  ids.forEach((id, index) => {
    if (seen.has(id)) fail(`${section}[${index}].id`, `duplicate id "${id}"`);
    seen.add(id);
  });
}

export function validateProjectPlan(input) {
  const root = record(input, "$");
  const meta = record(root.meta, "meta");
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
  if (meta.overallStatus !== undefined) {
    const overall = meta.overallStatus;
    if (typeof overall !== "string" || !OVERALL_STATUSES.has(overall)) {
      fail("meta.overallStatus", "expected GREEN, AMBER, or RED");
    }
  }

  const milestones = arrayValue(root.milestones, "milestones").map(validateMilestone);
  const sprints = arrayValue(root.sprints, "sprints").map(validateSprint);
  const roles = arrayValue(root.roles, "roles").map(validateRole);
  const raci = arrayValue(root.raci, "raci").map(validateRaciRow);
  const raid = arrayValue(root.raid, "raid").map(validateRaid);
  const tickets = root.tickets === undefined ? [] : arrayValue(root.tickets, "tickets").map(validateTicket);
  const wbs = arrayValue(root.wbs, "wbs").map(validateWbs);
  const org = validateOrg(root.org);
  const calendar = validateCalendar(root.calendar);
  const changeLog = validateChangeLog(root.changeLog);

  assertUniqueIds(wbs.map((task) => task.id), "wbs");
  assertUniqueIds(milestones.map((milestone) => milestone.id), "milestones");
  assertUniqueIds(sprints.map((sprint) => sprint.id), "sprints");
  assertUniqueIds(roles.map((role) => role.id), "roles");
  assertUniqueIds(raid.map((entry) => entry.id), "raid");
  assertUniqueIds(tickets.map((ticket) => ticket.id), "tickets");

  const wbsIds = new Set(wbs.map((task) => task.id));
  const sprintIds = new Set(sprints.map((sprint) => sprint.id));
  const people = new Set([
    ...roles.map((role) => role.person),
    ...(org ? [org.sponsor.name, ...org.hats.map((hat) => hat.person)] : []),
  ]);
  const rawWbs = arrayValue(root.wbs, "wbs");

  wbs.forEach((task, index) => {
    const parentId = task.id.split(".").slice(0, -1).join(".");
    if (parentId && !wbsIds.has(parentId)) {
      fail(`wbs[${index}].id`, `parent task "${parentId}" does not exist`);
    }
    task.dependsOn.forEach((dependency, dependencyIndex) => {
      if (dependency === task.id) fail(`wbs[${index}].dependsOn[${dependencyIndex}]`, "a task cannot depend on itself");
      if (!wbsIds.has(dependency)) fail(`wbs[${index}].dependsOn[${dependencyIndex}]`, `unknown task id "${dependency}"`);
    });
    (task.relations ?? []).forEach((relation, relationIndex) => {
      if (relation.predecessorId === task.id) fail(`wbs[${index}].relations[${relationIndex}].predecessorId`, "a task cannot depend on itself");
      if (!wbsIds.has(relation.predecessorId)) {
        fail(`wbs[${index}].relations[${relationIndex}].predecessorId`, `unknown task id "${relation.predecessorId}"`);
      }
    });
    const rawSprint = record(rawWbs[index], `wbs[${index}]`).sprint;
    if (typeof rawSprint === "string" && rawSprint.length > 0 && sprintIds.size > 0 && !sprintIds.has(rawSprint)) {
      fail(`wbs[${index}].sprint`, `unknown sprint id "${rawSprint}"`);
    }
    if (people.size > 0 && !people.has(task.owner)) {
      fail(`wbs[${index}].owner`, `owner "${task.owner}" is not listed in roles or org`);
    }
  });

  tickets.forEach((ticket, index) => {
    if (ticket.wbsId && !wbsIds.has(ticket.wbsId)) {
      fail(`tickets[${index}].wbsId`, `unknown task id "${ticket.wbsId}"`);
    }
  });

  const edges = new Map();
  for (const task of wbs) {
    edges.set(task.id, [
      ...task.dependsOn,
      ...(task.relations ?? []).map((relation) => relation.predecessorId),
    ]);
  }
  const marks = new Map();
  const visit = (id, trail) => {
    const mark = marks.get(id);
    if (mark === "done") return;
    if (mark === "visiting") fail("wbs", `dependency cycle detected: ${[...trail, id].join(" -> ")}`);
    marks.set(id, "visiting");
    for (const next of edges.get(id) ?? []) visit(next, [...trail, id]);
    marks.set(id, "done");
  };
  for (const task of wbs) visit(task.id, []);

  return {
    ...root,
    meta,
    calendar,
    org,
    milestones,
    sprints,
    roles,
    raci,
    raid,
    tickets,
    wbs,
    changeLog,
  };
}
