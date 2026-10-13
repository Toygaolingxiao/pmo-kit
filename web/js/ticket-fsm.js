/**
 * 課題の有限状態機械。
 * 画面と node:test の両方から使う純粋関数です。アカウントは持たず、操作者は人名です。
 */

export const TICKET_STATUS_LABELS = {
  todo: "未着手",
  in_progress: "進行中",
  resolved: "解決済み",
  closed: "クローズ",
  cancelled: "取消",
};

export const QUEUE_LABELS = {
  receive: "受領待ち",
  stale: "要更新",
  mentions: "メンション未対応",
  dueApproval: "期日延伸の承認待ち",
  ballUnknown: "玉持ち不明",
  improvement: "PMO 改善",
};

export const WBS_STATUS_TRANSITIONS = {
  todo: ["in_progress", "deferred"],
  in_progress: ["done", "deferred", "todo"],
  deferred: ["todo", "in_progress"],
  done: ["in_progress"],
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86400000;

export function canChangeWbsStatus(from, to) {
  if (from === to) return true;
  return (WBS_STATUS_TRANSITIONS[from] || []).includes(to);
}

/**
 * 進捗率の変更が引き起こす WBS 状態。0% から 100% への直行は拒否します。
 */
export function wbsStatusForPct(status, currentPct, nextPct) {
  if (currentPct === 0 && nextPct === 100) {
    return { ok: false, reason: "未着手の進捗率を 100% に直接変更することはできません。まず進行中にしてください。" };
  }
  let target = status;
  if (nextPct === 100) target = "done";
  else if (nextPct === 0) target = "todo";
  else if (nextPct > 0 && nextPct < 100) target = "in_progress";
  if (!canChangeWbsStatus(status, target)) {
    return { ok: false, reason: "この進捗率では現在の状態から遷移できません。" };
  }
  return { ok: true, status: target, reason: "" };
}

function deny(reason) {
  return { ok: false, reason };
}

function allow() {
  return { ok: true, reason: "" };
}

function isTerminal(status) {
  return status === "closed" || status === "cancelled";
}

function named(actor) {
  return typeof actor === "string" && actor.trim().length > 0;
}

export function parseMentions(body) {
  const found = new Set();
  const pattern = /@([^\s@,、。]+)/g;
  let match = pattern.exec(body || "");
  while (match) {
    found.add(match[1]);
    match = pattern.exec(body || "");
  }
  return [...found];
}

export function endOfWeek(dateStr) {
  const date = new Date(`${dateStr}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return dateStr;
  const add = date.getUTCDay() === 0 ? 0 : 7 - date.getUTCDay();
  date.setUTCDate(date.getUTCDate() + add);
  return date.toISOString().slice(0, 10);
}

function dayNumber(dateStr) {
  return Math.floor(Date.parse(`${String(dateStr).slice(0, 10)}T00:00:00Z`) / DAY_MS);
}

export function needsWeeklyUpdate(ticket, today) {
  if (!ticket?.dueDate || isTerminal(ticket.status)) return false;
  if (ticket.dueDate > endOfWeek(today)) return false;
  if (!ticket.lastUpdatedAt) return true;
  return dayNumber(today) - dayNumber(ticket.lastUpdatedAt) >= 7;
}

export function hasOpenMention(ticket, person) {
  if (!person) return false;
  const comments = ticket.comments || [];
  return comments.some((comment) => {
    if (!(comment.mentions || []).includes(person)) return false;
    if (comment.author === person) return false;
    if ((comment.reactions || []).some((reaction) => reaction.person === person)) return false;
    return !comments.some((later) => later.id !== comment.id && later.author === person && later.at > comment.at);
  });
}

export function ticketQueues(tickets, actor, today) {
  const list = tickets || [];
  return {
    receive: list.filter((ticket) => ticket.assignee === actor && ticket.status === "todo"),
    stale: list.filter((ticket) => ticket.assignee === actor && needsWeeklyUpdate(ticket, today)),
    mentions: list.filter((ticket) => hasOpenMention(ticket, actor)),
    dueApproval: list.filter((ticket) => ticket.reporter === actor && ticket.dueChangeRequest?.status === "pending"),
    ballUnknown: list.filter((ticket) => ticket.ballUnknown && !isTerminal(ticket.status)),
    improvement: list.filter((ticket) => ticket.needsImprovement && !isTerminal(ticket.status)),
  };
}

export function dueChangeWarning(ticket, today) {
  if (!ticket?.dueDate || today <= ticket.dueDate) return "";
  return "期日を過ぎてからの延伸です。次回は期日前に起票者へ連絡してください。";
}

export function canTransition(ticket, action, actor, payload = {}) {
  if (!ticket) return deny("課題が見つかりません。");
  if (!named(actor)) return deny("操作者を選択してください。");
  const status = ticket.status;
  const isAssignee = actor === ticket.assignee;
  const isReporter = actor === ticket.reporter;

  switch (action) {
    case "receive":
      if (!isAssignee) return deny("受領できるのは現在の担当者だけです。");
      if (status !== "todo") return deny("未着手の課題だけ受領できます。");
      return allow();
    case "handoff": {
      if (!isAssignee) return deny("確認依頼できるのは現在の担当者だけです。");
      if (status !== "in_progress") return deny("進行中の課題だけ担当者を渡せます。先に受領してください。");
      const nextAssignee = String(payload.nextAssignee || "").trim();
      if (!nextAssignee) return deny("次の担当者を指定してください。");
      if (nextAssignee === ticket.assignee) return deny("別の担当者を指定してください。");
      return allow();
    }
    case "returnToReporter":
      if (!isAssignee) return deny("起票者へ戻せるのは現在の担当者だけです。");
      if (status !== "todo" && status !== "in_progress") return deny("未着手または進行中の課題だけ起票者へ戻せます。");
      if (ticket.assignee === ticket.reporter) return deny("すでに起票者が担当者です。");
      return allow();
    case "markBallUnknown":
      if (!isAssignee && !isReporter) return deny("玉持ち不明にできるのは担当者または起票者です。");
      if (status !== "todo" && status !== "in_progress") return deny("未着手または進行中の課題だけ玉持ち不明にできます。");
      return allow();
    case "resolve":
      if (!isAssignee) return deny("解決できるのは現在の担当者だけです。");
      if (status !== "in_progress") return deny("進行中の課題だけ解決できます。");
      return allow();
    case "close":
      if (!isReporter) return deny("クローズできるのは起票者だけです。");
      if (status !== "resolved") return deny("解決済みの課題だけクローズできます。");
      return allow();
    case "reopen":
      if (!isReporter) return deny("差し戻せるのは起票者だけです。");
      if (status !== "resolved") return deny("解決済みの課題だけ差し戻せます。");
      return allow();
    case "cancel":
      if (!isReporter) return deny("取り消せるのは起票者だけです。");
      if (status !== "todo" && status !== "in_progress") return deny("未着手または進行中の課題だけ取り消せます。");
      return allow();
    case "setDueDate":
      if (!isReporter) return deny("期日を直接変更できるのは起票者だけです。延伸は申請してください。");
      if (!DATE_PATTERN.test(payload.dueDate || "")) return deny("期日は YYYY-MM-DD で指定してください。");
      return allow();
    case "requestDueChange":
      if (isReporter) return deny("起票者は期日を直接変更してください。");
      if (isTerminal(status)) return deny("終了した課題の期日は変更できません。");
      if (ticket.dueChangeRequest?.status === "pending") return deny("期日延伸の申請がすでに待っています。");
      if (!DATE_PATTERN.test(payload.requestedDue || "")) return deny("希望期日は YYYY-MM-DD で指定してください。");
      if (!String(payload.reason || "").trim()) return deny("延伸理由を入力してください。");
      return allow();
    case "approveDueChange":
      if (!isReporter) return deny("期日延伸を承認できるのは起票者だけです。");
      if (ticket.dueChangeRequest?.status !== "pending") return deny("承認待ちの期日延伸はありません。");
      return allow();
    case "rejectDueChange":
      if (!isReporter) return deny("期日延伸を却下できるのは起票者だけです。");
      if (ticket.dueChangeRequest?.status !== "pending") return deny("却下できる期日延伸はありません。");
      return allow();
    case "comment":
      if (isTerminal(status)) return deny("終了した課題にはコメントできません。");
      if (!String(payload.body || "").trim()) return deny("コメントを入力してください。");
      return allow();
    case "react": {
      const comment = (ticket.comments || []).find((item) => item.id === payload.commentId);
      if (!comment) return deny("対象のコメントがありません。");
      if ((comment.reactions || []).some((reaction) => reaction.person === actor)) return deny("すでにリアクション済みです。");
      return allow();
    }
    case "flagImprovement":
      if (isTerminal(status)) return deny("終了した課題は PMO に上げられません。");
      return allow();
    default:
      return deny("未対応の操作です。");
  }
}

function cloneTicket(ticket) {
  return JSON.parse(JSON.stringify(ticket));
}

function pushHistory(ticket, actor, type, from, to, note, at) {
  ticket.history = ticket.history || [];
  ticket.history.push({ at, actor, type, from, to, note: note || "" });
  ticket.lastUpdatedAt = String(at).slice(0, 10);
}

function addComment(ticket, author, body, at) {
  ticket.comments = ticket.comments || [];
  ticket.comments.push({
    id: `c-${ticket.comments.length + 1}-${String(at).replace(/\W/g, "")}`,
    author,
    at,
    body,
    mentions: parseMentions(body),
    reactions: [],
  });
}

/**
 * 合法な操作だけを適用し、新しい課題を返します。元のオブジェクトは変更しません。
 */
export function applyAction(ticket, action, actor, payload = {}, now = new Date().toISOString()) {
  const check = canTransition(ticket, action, actor, payload);
  if (!check.ok) {
    const error = new Error(check.reason);
    error.code = "ILLEGAL_TRANSITION";
    throw error;
  }

  const next = cloneTicket(ticket);
  const from = next.status;
  let warning = "";

  switch (action) {
    case "receive":
      next.status = "in_progress";
      pushHistory(next, actor, action, from, next.status, "受領", now);
      break;
    case "handoff": {
      const name = String(payload.nextAssignee).trim();
      const note = String(payload.note || "").trim();
      next.assignee = name;
      next.status = "todo";
      next.ballUnknown = false;
      if (note) addComment(next, actor, note, now);
      pushHistory(next, actor, action, from, next.status, note || `${name} へ確認依頼`, now);
      break;
    }
    case "returnToReporter":
      next.assignee = next.reporter;
      next.status = "todo";
      next.ballUnknown = false;
      pushHistory(next, actor, action, from, next.status, "起票者へ差し戻し", now);
      break;
    case "markBallUnknown":
      next.assignee = next.reporter;
      next.status = "todo";
      next.ballUnknown = true;
      pushHistory(next, actor, action, from, next.status, "玉持ち不明。木曜の横断定例で決定する", now);
      break;
    case "resolve":
      next.status = "resolved";
      next.ballUnknown = false;
      pushHistory(next, actor, action, from, next.status, "解決", now);
      break;
    case "close":
      next.status = "closed";
      next.ballUnknown = false;
      pushHistory(next, actor, action, from, next.status, "起票者がクローズ", now);
      break;
    case "reopen":
      next.status = "in_progress";
      pushHistory(next, actor, action, from, next.status, "起票者が差し戻し", now);
      break;
    case "cancel":
      next.status = "cancelled";
      next.ballUnknown = false;
      pushHistory(next, actor, action, from, next.status, "起票者が取消", now);
      break;
    case "setDueDate":
      next.dueDate = payload.dueDate;
      if (next.dueChangeRequest?.status === "pending") {
        next.dueChangeRequest = { ...next.dueChangeRequest, status: "rejected" };
      }
      pushHistory(next, actor, action, from, from, `期日を ${payload.dueDate} に変更`, now);
      break;
    case "requestDueChange":
      warning = dueChangeWarning(next, String(now).slice(0, 10));
      next.dueChangeRequest = {
        requestedDue: payload.requestedDue,
        reason: String(payload.reason).trim(),
        requestedBy: actor,
        requestedAt: now,
        status: "pending",
      };
      pushHistory(next, actor, action, from, from, `期日延伸を申請: ${payload.requestedDue}`, now);
      break;
    case "approveDueChange":
      next.dueDate = next.dueChangeRequest.requestedDue;
      next.dueChangeRequest = { ...next.dueChangeRequest, status: "approved" };
      pushHistory(next, actor, action, from, from, `期日延伸を承認: ${next.dueDate}`, now);
      break;
    case "rejectDueChange":
      next.dueChangeRequest = { ...next.dueChangeRequest, status: "rejected" };
      pushHistory(next, actor, action, from, from, "期日延伸を却下", now);
      break;
    case "comment":
      addComment(next, actor, String(payload.body).trim(), now);
      pushHistory(next, actor, action, from, from, "コメント", now);
      break;
    case "react": {
      const comment = next.comments.find((item) => item.id === payload.commentId);
      comment.reactions = comment.reactions || [];
      comment.reactions.push({ person: actor, emoji: payload.emoji || "👍" });
      pushHistory(next, actor, action, from, from, "リアクション", now);
      break;
    }
    case "flagImprovement": {
      next.needsImprovement = true;
      const pmo = String(payload.pmo || "").trim();
      const body = String(payload.note || "").trim();
      const note = body || "改善が必要な課題です。横断定例またはPM定例で拾ってください。";
      const text = pmo && !note.includes(`@${pmo}`) ? `@${pmo} ${note}` : note;
      addComment(next, actor, text, now);
      pushHistory(next, actor, action, from, from, "PMO に上げた", now);
      break;
    }
    default:
      break;
  }

  return { ticket: next, warning };
}

export function createTicket({ id, title, reporter, assignee, dueDate, wbsId = "", today }) {
  const at = `${today}T00:00:00.000Z`;
  return {
    id,
    title,
    reporter,
    assignee: assignee || reporter,
    status: "todo",
    dueDate,
    wbsId: wbsId || "",
    ballUnknown: false,
    needsImprovement: false,
    dueChangeRequest: null,
    comments: [],
    lastUpdatedAt: today,
    history: [{ at, actor: reporter, type: "create", from: "", to: "todo", note: "起票" }],
  };
}
