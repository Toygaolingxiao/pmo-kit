import assert from "node:assert/strict";
import test from "node:test";
import {
  applyAction,
  canChangeWbsStatus,
  canTransition,
  createTicket,
  hasOpenMention,
  ticketQueues,
  wbsStatusForPct,
} from "./ticket-fsm.js";

const NOW = "2026-09-30T03:00:00.000Z";

function ticket(overrides = {}) {
  return {
    ...createTicket({
      id: "T-1",
      title: "確認",
      reporter: "GAO",
      assignee: "開発担当",
      dueDate: "2026-10-02",
      today: "2026-09-30",
    }),
    ...overrides,
  };
}

test("担当者だけが未着手を受領できる", () => {
  const source = ticket();
  assert.equal(canTransition(source, "receive", "GAO").ok, false);
  const received = applyAction(source, "receive", "開発担当", {}, NOW);
  assert.equal(received.ticket.status, "in_progress");
  assert.equal(source.status, "todo");
  assert.equal(canTransition(received.ticket, "resolve", "開発担当").ok, true);
  const resolved = applyAction(received.ticket, "resolve", "開発担当", {}, NOW);
  assert.equal(resolved.ticket.status, "resolved");
  assert.equal(canTransition(source, "resolve", "開発担当").ok, false);
});

test("未着手から解決やクローズへは直接進めない", () => {
  const source = ticket();
  assert.equal(canTransition(source, "resolve", "開発担当").ok, false);
  assert.equal(canTransition(source, "close", "GAO").ok, false);
  assert.throws(() => applyAction(source, "resolve", "開発担当", {}, NOW), /進行中/);
});

test("確認依頼は担当者を渡し、未着手へ戻す", () => {
  const received = applyAction(ticket(), "receive", "開発担当", {}, NOW).ticket;
  const handed = applyAction(received, "handoff", "開発担当", { nextAssignee: "Aさん", note: "@Aさん 確認をお願いします" }, NOW);
  assert.equal(handed.ticket.assignee, "Aさん");
  assert.equal(handed.ticket.status, "todo");
  assert.equal(handed.ticket.ballUnknown, false);
  assert.equal(hasOpenMention(handed.ticket, "Aさん"), true);
  assert.equal(canTransition(handed.ticket, "receive", "Aさん").ok, true);
});

test("担当者は自分でクローズできず、起票者だけが閉じる", () => {
  let current = applyAction(ticket(), "receive", "開発担当", {}, NOW).ticket;
  current = applyAction(current, "resolve", "開発担当", {}, NOW).ticket;
  assert.equal(canTransition(current, "close", "開発担当").ok, false);
  const closed = applyAction(current, "close", "GAO", {}, NOW);
  assert.equal(closed.ticket.status, "closed");
  const reopened = applyAction(current, "reopen", "GAO", {}, NOW);
  assert.equal(reopened.ticket.status, "in_progress");
});

test("期日の直接変更は起票者だけ。他人の延伸は承認まで反映されない", () => {
  const source = ticket();
  assert.equal(canTransition(source, "setDueDate", "開発担当", { dueDate: "2026-10-10" }).ok, false);
  const requested = applyAction(source, "requestDueChange", "開発担当", {
    requestedDue: "2026-10-10",
    reason: "確認に時間が必要",
  }, NOW);
  assert.equal(requested.ticket.dueDate, "2026-10-02");
  assert.equal(requested.ticket.dueChangeRequest.status, "pending");
  assert.equal(requested.warning, "");
  const approved = applyAction(requested.ticket, "approveDueChange", "GAO", {}, NOW);
  assert.equal(approved.ticket.dueDate, "2026-10-10");
  assert.equal(canTransition(approved.ticket, "approveDueChange", "GAO").ok, false);
});

test("期日を過ぎた延伸申請は警告し、期日そのものは変えない", () => {
  const source = ticket({ dueDate: "2026-09-20" });
  const requested = applyAction(source, "requestDueChange", "開発担当", {
    requestedDue: "2026-10-03",
    reason: "期限後の調整",
  }, NOW);
  assert.match(requested.warning, /期日を過ぎて/);
  assert.equal(requested.ticket.dueDate, "2026-09-20");
});

test("メンションはリアクションまたは返信で解消する", () => {
  const source = ticket({ status: "in_progress" });
  const commented = applyAction(source, "comment", "開発担当", { body: "@GAO 確認です" }, NOW).ticket;
  assert.equal(hasOpenMention(commented, "GAO"), true);
  const commentId = commented.comments[0].id;
  const reacted = applyAction(commented, "react", "GAO", { commentId }, "2026-09-30T04:00:00.000Z").ticket;
  assert.equal(hasOpenMention(reacted, "GAO"), false);

  const again = applyAction(source, "comment", "開発担当", { body: "@GAO もう一度" }, NOW).ticket;
  const replied = applyAction(again, "comment", "GAO", { body: "回答します" }, "2026-09-30T05:00:00.000Z").ticket;
  assert.equal(hasOpenMention(replied, "GAO"), false);
});

test("今週末までの課題は 7 日更新がなければ要更新になる", () => {
  const fresh = ticket({ assignee: "開発担当", lastUpdatedAt: "2026-09-30" });
  const stale = ticket({ assignee: "開発担当", lastUpdatedAt: "2026-09-20", dueDate: "2026-09-28" });
  const later = ticket({ assignee: "開発担当", lastUpdatedAt: "2026-09-01", dueDate: "2026-10-20" });
  const queues = ticketQueues([fresh, stale, later], "開発担当", "2026-09-30");
  assert.deepEqual(queues.stale.map((item) => item.dueDate), ["2026-09-28"]);
  assert.equal(queues.receive.length, 3);
});

test("玉持ち不明は担当者を起票者に戻し、木曜定例の列に残す", () => {
  const marked = applyAction(ticket(), "markBallUnknown", "開発担当", {}, NOW).ticket;
  assert.equal(marked.assignee, "GAO");
  assert.equal(marked.status, "todo");
  assert.equal(marked.ballUnknown, true);
  const queues = ticketQueues([marked], "GAO", "2026-09-30");
  assert.equal(queues.ballUnknown.length, 1);
  assert.equal(queues.receive.length, 1);
});

test("PMO への引き上げは計画の PMO にメンションし、改善フラグを残す", () => {
  const raised = applyAction(ticket({ status: "in_progress" }), "flagImprovement", "開発担当", { note: "横断で見てください", pmo: "GAO" }, NOW).ticket;
  assert.equal(raised.needsImprovement, true);
  assert.equal(hasOpenMention(raised, "GAO"), true);
  assert.match(raised.comments[0].body, /@GAO/);
  assert.equal(ticketQueues([raised], "GAO", "2026-09-30").improvement.length, 1);
});

test("疑問点はまず起票者を担当者に戻す", () => {
  const returned = applyAction(ticket({ status: "in_progress" }), "returnToReporter", "開発担当", {}, NOW).ticket;
  assert.equal(returned.assignee, "GAO");
  assert.equal(returned.status, "todo");
});

test("WBS は合法な遷移だけを許し、進捗率 0 から 100 へは飛べない", () => {
  assert.equal(canChangeWbsStatus("todo", "done"), false);
  assert.equal(canChangeWbsStatus("todo", "in_progress"), true);
  assert.equal(canChangeWbsStatus("in_progress", "done"), true);
  assert.equal(canChangeWbsStatus("done", "todo"), false);
  assert.equal(canChangeWbsStatus("deferred", "in_progress"), true);
  assert.equal(wbsStatusForPct("todo", 0, 100).ok, false);
  assert.equal(wbsStatusForPct("in_progress", 0, 100).ok, false);
  assert.equal(wbsStatusForPct("in_progress", 40, 100).status, "done");
  assert.equal(wbsStatusForPct("todo", 0, 50).status, "in_progress");
  assert.equal(wbsStatusForPct("deferred", 20, 100).ok, false);
});
