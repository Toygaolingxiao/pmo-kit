/**
 * 課題ボード。キュー、一覧、詳細を描画します。
 * 状態遷移そのものは ticket-fsm.js に委譲します。
 */

import { $, cleanText } from "../utils.js";
import {
  QUEUE_LABELS,
  TICKET_STATUS_LABELS,
  canTransition,
  dueChangeWarning,
  ticketQueues,
} from "../ticket-fsm.js";

const QUEUE_NOTES = {
  receive: "受け取ったら未着手から進行中へ",
  stale: "今週末まで、7日以上更新なし",
  mentions: "リアクションまたは返信が必要",
  dueApproval: "起票者の承認が必要",
  ballUnknown: "木曜の横断定例で担当を決める",
  improvement: "横断定例またはPM定例で拾う",
};

function esc(value) {
  return cleanText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function statusChip(status) {
  const label = TICKET_STATUS_LABELS[status] || status;
  return `<span class="status-chip status-${esc(status)}">${esc(label)}</span>`;
}

export function collectPeople(plan, actor) {
  const names = new Set();
  if (actor) names.add(actor);
  if (plan?.meta?.pm) names.add(plan.meta.pm);
  (plan?.roles || []).forEach((role) => {
    if (role.person) names.add(role.person);
  });
  (plan?.tickets || []).forEach((ticket) => {
    if (ticket.reporter) names.add(ticket.reporter);
    if (ticket.assignee) names.add(ticket.assignee);
    (ticket.comments || []).forEach((comment) => {
      if (comment.author) names.add(comment.author);
      (comment.mentions || []).forEach((name) => names.add(name));
    });
  });
  return [...names].filter(Boolean).sort((a, b) => a.localeCompare(b, "ja"));
}

function actionButton(action, label) {
  return `<button type="button" class="mini-button" data-ticket-action="${action}">${label}</button>`;
}

function detailActions(ticket, actor) {
  const buttons = [
    ["receive", "受領する"],
    ["resolve", "解決する"],
    ["close", "クローズする"],
    ["reopen", "差し戻す"],
    ["returnToReporter", "起票者に戻す"],
    ["markBallUnknown", "玉持ち不明にする"],
    ["cancel", "取り消す"],
  ].filter(([action]) => canTransition(ticket, action, actor).ok);
  return buttons.map(([action, label]) => actionButton(action, label)).join("");
}

function handoffForm(ticket, actor, people) {
  const probe = ticket.assignee === "別担当" ? "別の担当" : "別担当";
  if (!canTransition(ticket, "handoff", actor, { nextAssignee: probe }).ok) return "";
  const options = people.map((name) => `<option value="${esc(name)}"></option>`).join("");
  return `
    <form class="ticket-form" data-ticket-form="handoff">
      <h3>確認を依頼する</h3>
      <label>次の担当者<input name="nextAssignee" list="ticketPeople" required placeholder="確認先の名前" /></label>
      <label>依頼内容<textarea name="note" rows="2" placeholder="@名前 を付けるとメンションになります"></textarea></label>
      <button type="submit" class="button button-dark">担当者を渡す</button>
      <datalist id="ticketPeople">${options}</datalist>
    </form>
  `;
}

function dueForm(ticket, actor, today) {
  const warning = dueChangeWarning(ticket, today);
  const pending = ticket.dueChangeRequest?.status === "pending" ? ticket.dueChangeRequest : null;
  const pendingBlock = pending ? `
    <p class="ticket-pending">延伸申請: ${esc(pending.requestedDue)} / ${esc(pending.requestedBy)} / ${esc(pending.reason)}</p>
    ${canTransition(ticket, "approveDueChange", actor).ok ? `<div class="ticket-inline-actions">${actionButton("approveDueChange", "延伸を承認")}${actionButton("rejectDueChange", "延伸を却下")}</div>` : ""}
  ` : "";
  if (canTransition(ticket, "setDueDate", actor, { dueDate: ticket.dueDate || today }).ok) {
    return `
      <form class="ticket-form" data-ticket-form="due-direct">
        <h3>期日を変更</h3>
        ${pendingBlock}
        <label>期日<input name="dueDate" type="date" value="${esc(ticket.dueDate)}" required /></label>
        <button type="submit" class="button button-dark">期日を保存</button>
      </form>
    `;
  }
  if (!canTransition(ticket, "requestDueChange", actor, { requestedDue: "2099-01-01", reason: "確認" }).ok) return pendingBlock;
  return `
    <form class="ticket-form" data-ticket-form="due-request">
      <h3>期日延伸を申請</h3>
      <p class="ticket-note">担当者は期日を直接変更できません。起票者と調整してください。</p>
      ${warning ? `<p class="ticket-warning">${esc(warning)}</p>` : ""}
      ${pendingBlock}
      <label>希望期日<input name="requestedDue" type="date" required /></label>
      <label>理由<textarea name="reason" rows="2" required></textarea></label>
      <button type="submit" class="button button-dark">延伸を申請</button>
    </form>
  `;
}

function commentForm(ticket, actor) {
  if (!canTransition(ticket, "comment", actor, { body: "メモ" }).ok) return "";
  return `
    <form class="ticket-form" data-ticket-form="comment">
      <h3>コメント</h3>
      <label>本文<textarea name="body" rows="3" required placeholder="@名前 でメンション"></textarea></label>
      <button type="submit" class="button button-dark">コメントする</button>
    </form>
  `;
}

function improvementForm(ticket, actor) {
  if (!canTransition(ticket, "flagImprovement", actor).ok) return "";
  return `
    <form class="ticket-form" data-ticket-form="improve">
      <h3>PMO に上げる</h3>
      <label>補足<textarea name="note" rows="2" placeholder="改善が必要な点"></textarea></label>
      <button type="submit" class="button button-dark">PMO にメンション</button>
    </form>
  `;
}

function commentsHtml(ticket, actor) {
  const comments = ticket.comments || [];
  if (!comments.length) return `<p class="ticket-note">コメントはまだありません。</p>`;
  return comments.map((comment) => {
    const canReact = canTransition(ticket, "react", actor, { commentId: comment.id }).ok;
    const reactions = (comment.reactions || []).map((reaction) => `${esc(reaction.emoji)} ${esc(reaction.person)}`).join(" ");
    return `
      <article class="ticket-comment">
        <header><strong>${esc(comment.author)}</strong><time>${esc(String(comment.at).slice(0, 16).replace("T", " "))}</time></header>
        <p>${esc(comment.body)}</p>
        <footer>
          ${reactions ? `<span>${reactions}</span>` : ""}
          ${canReact ? `<button type="button" class="mini-button" data-ticket-action="react" data-comment-id="${esc(comment.id)}">リアクション</button>` : ""}
        </footer>
      </article>
    `;
  }).join("");
}

function historyHtml(ticket) {
  const history = [...(ticket.history || [])].reverse().slice(0, 8);
  if (!history.length) return "";
  return `
    <ol class="ticket-history">
      ${history.map((entry) => `<li><time>${esc(String(entry.at).slice(0, 10))}</time> ${esc(entry.actor)} ${esc(entry.note || entry.type)}</li>`).join("")}
    </ol>
  `;
}

function detailHtml(ticket, actor, today, people) {
  if (!ticket) return `<div class="empty-state">課題を選択してください。</div>`;
  const flags = [
    ticket.ballUnknown ? "玉持ち不明" : "",
    ticket.needsImprovement ? "PMO 改善" : "",
    ticket.wbsId ? `WBS ${ticket.wbsId}` : "",
  ].filter(Boolean);
  return `
    <header class="ticket-detail-head">
      <div>
        <p class="kicker">${esc(ticket.id)}</p>
        <h3>${esc(ticket.title)}</h3>
      </div>
      ${statusChip(ticket.status)}
    </header>
    <dl class="ticket-facts">
      <div><dt>起票者</dt><dd>${esc(ticket.reporter)}</dd></div>
      <div><dt>担当者</dt><dd>${esc(ticket.assignee)}</dd></div>
      <div><dt>期日</dt><dd>${esc(ticket.dueDate)}</dd></div>
      <div><dt>最終更新</dt><dd>${esc(ticket.lastUpdatedAt || "-")}</dd></div>
    </dl>
    ${flags.length ? `<p class="ticket-flags">${flags.map((flag) => `<span>${esc(flag)}</span>`).join("")}</p>` : ""}
    <div class="ticket-inline-actions">${detailActions(ticket, actor)}</div>
    ${handoffForm(ticket, actor, people)}
    ${dueForm(ticket, actor, today)}
    ${improvementForm(ticket, actor)}
    <section class="ticket-thread">
      <h3>やり取り</h3>
      ${commentsHtml(ticket, actor)}
      ${commentForm(ticket, actor)}
    </section>
    ${historyHtml(ticket)}
  `;
}

export function renderTicketBoard({ tickets, actor, today, selectedId, queue, people }) {
  const list = tickets || [];
  const queues = ticketQueues(list, actor, today);
  const queueHost = $("#ticketQueues");
  const listHost = $("#ticketList");
  const detailHost = $("#ticketDetail");
  const options = $("#actorOptions");
  if (!queueHost || !listHost || !detailHost) return;

  if (options) {
    options.innerHTML = people.map((name) => `<option value="${esc(name)}"></option>`).join("");
  }

  queueHost.innerHTML = Object.keys(QUEUE_LABELS).map((key) => `
    <button type="button" class="ticket-queue${queue === key ? " is-active" : ""}" data-ticket-queue="${key}">
      <span>${QUEUE_LABELS[key]}</span>
      <strong>${queues[key].length}</strong>
      <small>${QUEUE_NOTES[key]}</small>
    </button>
  `).join("");

  const visible = queue && queues[queue] ? queues[queue] : list;
  listHost.innerHTML = visible.length ? visible.map((ticket) => `
    <button type="button" class="ticket-row${ticket.id === selectedId ? " is-selected" : ""}" data-ticket-id="${esc(ticket.id)}">
      <span class="ticket-row-id">${esc(ticket.id)}</span>
      <strong>${esc(ticket.title)}</strong>
      ${statusChip(ticket.status)}
      <span>${esc(ticket.assignee)}</span>
      <span>${esc(ticket.dueDate)}</span>
    </button>
  `).join("") : `<div class="empty-state">表示する課題はありません。</div>`;

  const selected = list.find((ticket) => ticket.id === selectedId) || null;
  detailHost.innerHTML = detailHtml(selected, actor, today, people);
}
