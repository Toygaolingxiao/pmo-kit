/**
 * pmo-kit - PMO プロジェクト管理ワークベンチ
 * A TAKAE PRODUCTION
 * 
 * エントリーポイント & 状態管理（State Machine）
 * 各 UI モジュール（WBSテーブル、カレンダー、ガントチャート、ダイアログ）を統合します。
 */

import { createProjectRepository } from "./repository.js";
import {
  $,
  $$,
  cleanText,
  dayNumber,
  isoDate,
  daysBetween,
  clone,
  getStatusDate,
  showToast,
  STATUS_LABELS,
  OVERALL_STATUS_LABELS,
  RAID_TYPE_LABELS,
} from "./js/utils.js";
import { getJapanHolidays } from "./js/holidays.js";
import {
  hasChildTasks,
  calculateTaskSummary,
  isTaskDelayed,
  getProgressLineDate,
} from "./js/gantt-calc.js";
import { initColumnResizers, renderLightningLine } from "./js/components/wbs-table.js";
import {
  openTaskEditDialog,
  openMeetingDialog,
  syncMeetingCalculation,
  openOutlookLocalComposer,
  openOutlookWebComposer,
  getNextTaskId,
} from "./js/components/dialogs.js";
import {
  renderHistoryList,
  renderSampleTree,
  renderRaidCards,
} from "./js/components/history.js";
import { collectPeople, renderTicketBoard } from "./js/components/tickets.js";
import { applyAction, canChangeWbsStatus, createTicket, wbsStatusForPct } from "./js/ticket-fsm.js";

// ==========================================
// 1. アプリケーション状態 (State)
// ==========================================
const repository = createProjectRepository();
const state = {
  plan: null,
  snapshots: [],
  future: [],
  rangeStart: null,
  rangeDays: null,
  filter: "all",
  search: "",
  collapsed: new Set(),
  selectedIds: new Set(),
  holidayDraft: null,
  actor: "",
  selectedTicketId: null,
  ticketQueue: null,
};

const ACTOR_KEY = "pmo-kit-actor";

let currentQuickStatusTaskId = null;
let currentContextMenuTaskId = null;

// ==========================================
// 2. 状態同期・Undo / Redo
// ==========================================
function persist() {
  if (state.plan) repository.save(state.plan);
}

function recordChange() {
  state.snapshots.push(clone(state.plan));
  if (state.snapshots.length > 40) state.snapshots.shift();
  state.future = [];
  persist();
  updateHistoryButtons();
}

function appendChange(note) {
  state.plan.changeLog = state.plan.changeLog || [];
  state.plan.changeLog.push({
    version: `1.0.${state.plan.changeLog.length + 1}`,
    date: new Date().toISOString().slice(0, 10),
    author: state.actor || state.plan.meta.updater || state.plan.meta.pm || "GAO",
    note,
  });
}

function undo() {
  if (!state.snapshots.length) return;
  state.future.push(clone(state.plan));
  state.plan = state.snapshots.pop();
  persist();
  renderAll();
  showToast("変更を元に戻しました");
}

function redo() {
  if (!state.future.length) return;
  state.snapshots.push(clone(state.plan));
  state.plan = state.future.pop();
  persist();
  renderAll();
  showToast("変更をやり直しました");
}

function updateHistoryButtons() {
  const undoBtn = $("#undoButton");
  if (undoBtn) undoBtn.disabled = state.snapshots.length === 0;
  const redoBtn = $("#redoButton");
  if (redoBtn) redoBtn.disabled = state.future.length === 0;
}

// ==========================================
// 3. 計画データの初期化・正規化
// ==========================================
function normalizePlan(plan) {
  const normalized = {
    ...plan,
    calendar: plan.calendar || { weekendAutoHoliday: true, holidays: [], weeklyMeetings: [] },
    milestones: Array.isArray(plan.milestones) ? plan.milestones : [],
    raid: Array.isArray(plan.raid) ? plan.raid : [],
    tickets: Array.isArray(plan.tickets) ? plan.tickets : [],
    decisions: Array.isArray(plan.decisions) ? plan.decisions : [],
    changeLog: Array.isArray(plan.changeLog) ? plan.changeLog : [],
  };
  if (normalized.meta?.projectCode === "PMO-KIT-DEV") {
    normalized.meta.pm = "GAO";
    normalized.wbs = normalized.wbs.map((task) => ({ ...task, owner: "GAO" }));
  }
  return normalized;
}

// ==========================================
// 4. ナビゲーション & ビュー切り替え
// ==========================================
function activateView(view) {
  $$(".nav-link").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  $$(".view-panel").forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === view));
}

// ==========================================
// 5. プロジェクト概要 (Overview) レンダリング
// ==========================================
function renderOverview() {
  if (!state.plan || !state.plan.meta) return;
  const meta = state.plan.meta;
  const statusDateStr = getStatusDate(state.plan);

  const overallEl = $("#overallStatus");
  if (overallEl) overallEl.textContent = OVERALL_STATUS_LABELS[meta.overallStatus] || meta.overallStatus || "順調";

  const dateEl = $("#dataDate");
  if (dateEl) dateEl.textContent = statusDateStr;

  const projEl = $("#projectName");
  if (projEl) projEl.textContent = meta.projectName || "プロジェクト計画・進捗管理";

  const baseEl = $("#baseline");
  if (baseEl) baseEl.textContent = meta.baseline || "Ver 1.1.1";

  const appVerEl = $("#appVersion");
  if (appVerEl) appVerEl.textContent = meta.baseline ? (meta.baseline.startsWith("Ver") ? meta.baseline : `Ver ${meta.baseline}`) : "Ver 1.1.1";

  const ownerEl = $("#projectOwner");
  if (ownerEl) ownerEl.textContent = meta.pm || "GAO";

  const deliveryEl = $("#deliveryWindow");
  if (deliveryEl) deliveryEl.textContent = `${meta.planStart || "-"} 〜 ${meta.planEnd || "-"}`;

  const tasks = state.plan.wbs || [];
  const leafTasks = tasks.filter((t) => !hasChildTasks(tasks, t.id));
  const doneCount = leafTasks.filter((t) => t.status === "done" || Number(t.pct) === 100).length;
  const inProgressCount = leafTasks.filter((t) => t.status === "in_progress" || (Number(t.pct) > 0 && Number(t.pct) < 100)).length;
  const lateCount = leafTasks.filter((t, i) => isTaskDelayed(t, calculateTaskSummary(tasks, t, i), statusDateStr)).length;

  const totalEffort = leafTasks.reduce((sum, t) => sum + (Number(t.effortDays) || 1), 0);
  const earnedEffort = leafTasks.reduce((sum, t) => sum + ((Number(t.effortDays) || 1) * (Number(t.pct) || 0) / 100), 0);
  const progressPct = totalEffort > 0 ? Math.round((earnedEffort / totalEffort) * 100) : 0;

  const progressMetricEl = $("#progressMetric");
  if (progressMetricEl) progressMetricEl.textContent = `${progressPct}%`;

  const progressNoteEl = $("#progressNote");
  if (progressNoteEl) progressNoteEl.textContent = `末端タスク ${leafTasks.length}件（完了: ${doneCount} / 進行中: ${inProgressCount}）`;

  const milestones = state.plan.milestones || [];
  const openMilestones = milestones.filter((m) => m.status !== "done");
  const milestoneMetricEl = $("#milestoneMetric");
  if (milestoneMetricEl) milestoneMetricEl.textContent = String(openMilestones.length);

  const raid = state.plan.raid || [];
  const openRaid = raid.filter((r) => r.status !== "closed");
  const raidMetricEl = $("#raidMetric");
  if (raidMetricEl) raidMetricEl.textContent = String(openRaid.length);

  const decisions = state.plan.decisions || [];
  const decisionMetricEl = $("#decisionMetric");
  if (decisionMetricEl) decisionMetricEl.textContent = String(decisions.length);

  // マイルストーン描画
  const milestoneContainer = $("#milestones");
  if (milestoneContainer) {
    if (!milestones.length) {
      milestoneContainer.innerHTML = '<div class="empty-state">マイルストーンは登録されていません。</div>';
    } else {
      milestoneContainer.innerHTML = milestones.map((m) => `
        <div class="milestone-card">
          <div class="milestone-head">
            <strong>${cleanText(m.name)}</strong>
            <span class="status-chip status-${m.status}">${STATUS_LABELS[m.status] || m.status}</span>
          </div>
          <div class="milestone-date">期日: ${m.date}</div>
          ${m.exitCriteria ? `<div class="milestone-criteria">完了条件: ${cleanText(m.exitCriteria)}</div>` : ""}
        </div>
      `).join("");
    }
  }

  // 注視事項の描画
  const attentionContainer = $("#attentionList");
  if (attentionContainer) {
    const lateTasks = leafTasks.filter((t, i) => isTaskDelayed(t, calculateTaskSummary(tasks, t, i), statusDateStr));
    const highRisks = raid.filter((r) => (r.impact === "高" || r.impact === "high" || r.type === "issue") && r.status !== "closed");

    const items = [];
    lateTasks.forEach((t) => {
      items.push(`
        <div class="attention-row attention-late">
          <span class="status-chip status-late">遅延警告</span>
          <strong>${cleanText(t.name)}</strong>
          <span>担当: ${cleanText(t.owner)} / 予定終了: ${t.end}</span>
        </div>
      `);
    });
    highRisks.forEach((r) => {
      items.push(`
        <div class="attention-row attention-risk">
          <span class="status-chip status-deferred">${cleanText(RAID_TYPE_LABELS[r.type] || r.type)}</span>
          <strong>${cleanText(r.title)}</strong>
          <span>担当: ${cleanText(r.owner)} / 対策: ${cleanText(r.response)}</span>
        </div>
      `);
    });

    if (!items.length) {
      attentionContainer.innerHTML = '<div class="empty-state">現在、重大な遅延や未解決のリスクはありません。順調に推移しています。</div>';
    } else {
      attentionContainer.innerHTML = items.slice(0, 5).join("");
    }
  }
}

// ==========================================
// 6. WBS テーブル & ガントチャート描画
// ==========================================
function getVisibleTasks() {
  const searchLower = state.search.toLowerCase();
  const hiddenAncestors = new Set();
  const visible = [];

  state.plan.wbs.forEach((task) => {
    let isHidden = false;
    for (const ancestorId of hiddenAncestors) {
      if (task.id.startsWith(`${ancestorId}.`)) {
        isHidden = true;
        break;
      }
    }
    if (state.collapsed.has(task.id)) {
      hiddenAncestors.add(task.id);
    }
    if (isHidden) return;

    if (state.filter !== "all" && task.status !== state.filter) return;
    if (searchLower) {
      const matchName = task.name.toLowerCase().includes(searchLower);
      const matchOwner = (task.owner || "").toLowerCase().includes(searchLower);
      if (!matchName && !matchOwner) return;
    }

    visible.push(task);
  });

  return visible;
}

function renderCalendarHeader(startDay, totalDays) {
  const holidays = new Set((state.plan.calendar?.holidays || []).map((h) => h.date));
  const holidayNames = new Map((state.plan.calendar?.holidays || []).map((h) => [h.date, h.name]));
  const meetings = new Map((state.plan.calendar?.regularMeetings || []).flatMap((m) => {
    const list = [];
    const step = m.frequency === "biweekly" ? 14 : (m.frequency === "monthly" ? 28 : 7);
    const start = dayNumber(m.startDate);
    const end = m.endDate ? dayNumber(m.endDate) : start + (m.count || 8) * step;
    for (let cur = start; cur <= end; cur += step) {
      list.push([isoDate(cur), m]);
    }
    return list;
  }));

  const dayCells = (kind) => {
    const cells = [];
    let lastMonth = "";

    for (let d = 0; d < totalDays; d += 1) {
      const curDateStr = isoDate(startDay + d);
      const dateObj = new Date(`${curDateStr}T00:00:00Z`);
      const dayOfWeek = dateObj.getUTCDay();
      const monthStr = `${dateObj.getUTCFullYear()}-${String(dateObj.getUTCMonth() + 1).padStart(2, "0")}`;
      const dayOfMonth = dateObj.getUTCDate();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      const isHoliday = holidays.has(curDateStr);

      let holidayClass = isHoliday ? "holiday" : (isWeekend ? "weekend" : "");

      if (kind === "month") {
        let label = "";
        if (monthStr !== lastMonth || d === 0) {
          label = `${dateObj.getUTCMonth() + 1}月`;
          lastMonth = monthStr;
        }
        cells.push(`<span class="${holidayClass}">${label}</span>`);
      } else if (kind === "meeting") {
        const meeting = meetings.get(curDateStr);
        const detail = meeting ? `${cleanText(meeting.name || "定例会議")}` : "";
        cells.push(`<span class="${meeting ? "meeting-day" : ""}" title="${detail}">${meeting ? "●" : ""}</span>`);
      } else {
        const holidayTitle = isHoliday ? cleanText(holidayNames.get(curDateStr)) : "";
        cells.push(`<span class="${holidayClass}" title="${holidayTitle}">${dayOfMonth}<small>${["日", "月", "火", "水", "木", "金", "土"][dayOfWeek]}</small></span>`);
      }
    }
    return cells.join("");
  };

  return `
    <div class="calendar-axis calendar-month"><span class="axis-label">月</span><span></span><span></span><span></span><div class="axis-days">${dayCells("month")}</div><span></span></div>
    <div class="calendar-axis calendar-date"><span class="axis-label">日付</span><span></span><span></span><span></span><div class="axis-days">${dayCells("date")}</div><span></span></div>
    <div class="calendar-axis calendar-meeting"><span class="axis-label">定例会議</span><span></span><span></span><span></span><div class="axis-days">${dayCells("meeting")}</div><span></span></div>
  `;
}

function renderWbs() {
  const tasks = getVisibleTasks();
  const statusDateStr = getStatusDate(state.plan);
  const start = state.rangeStart ?? dayNumber(state.plan.meta.planStart);
  const total = state.rangeDays;
  state.rangeStart = start;

  $("#taskCount").textContent = state.plan.wbs.length;
  $("#visibleTaskCount").textContent = tasks.length;
  $("#selectedTaskCount").textContent = state.selectedIds.size;

  ["moveTaskUp", "moveTaskDown", "indentTask", "outdentTask", "duplicateTask", "deleteSelectedTasks", "clearTaskSelection"]
    .forEach((id) => { $(`#${id}`).disabled = state.selectedIds.size === 0; });

  $("#calendarRange").textContent = `${isoDate(start)} - ${isoDate(start + total - 1)}`;

  const rows = tasks.map((task) => {
    const taskIndex = state.plan.wbs.findIndex((item) => item.id === task.id);
    const summary = calculateTaskSummary(state.plan.wbs, task, taskIndex);
    const delayed = isTaskDelayed(task, summary, statusDateStr);

    const windowEnd = start + total;
    const taskStart = dayNumber(summary.start);
    const taskEnd = dayNumber(summary.end) + 1;
    const visibleStart = Math.max(start, taskStart);
    const visibleEnd = Math.min(windowEnd, taskEnd);
    const left = Math.max(0, Math.min(100, ((visibleStart - start) / total) * 100));
    const width = Math.max(0, Math.min(100 - left, ((visibleEnd - visibleStart) / total) * 100));

    const actualStart = summary.actualStart ? dayNumber(summary.actualStart) : 0;
    const actualEnd = summary.actualStart ? dayNumber(summary.actualEnd || statusDateStr) + 1 : 0;
    const actualVisibleStart = Math.max(start, actualStart);
    const actualVisibleEnd = Math.min(windowEnd, actualEnd);
    const actualLeft = summary.actualStart ? Math.max(0, Math.min(100, ((actualVisibleStart - start) / total) * 100)) : 0;
    const actualWidth = summary.actualStart ? Math.max(0, Math.min(100 - actualLeft, ((actualVisibleEnd - actualVisibleStart) / total) * 100)) : 0;

    const todayLeft = Math.max(0, Math.min(100, ((dayNumber(statusDateStr) - start) / total) * 100));
    const progressDay = taskStart + (taskEnd - taskStart) * (Number(summary.pct) || 0) / 100;
    const progressLeft = Math.max(0, Math.min(100, ((progressDay - start) / total) * 100));

    const lateBar = summary.actualEnd && dayNumber(summary.actualEnd) > dayNumber(summary.end);
    const actual = summary.actualStart ? `<i class="actual-bar${lateBar ? " late" : ""}" style="left:${actualLeft}%;width:${actualWidth}%"></i>` : "";

    const relationList = task.relations?.length ? task.relations.map((r) => `${r.predecessorId}:${r.type}:${r.lagDays}`).join(", ") : task.dependsOn?.join(", ");
    const dependencies = relationList ? `<span class="dependency-mark" title="依存関係: ${cleanText(relationList)}">依存関係: ${task.relations?.length || task.dependsOn?.length || 0}件</span>` : "";
    const selected = state.selectedIds.has(task.id) ? " selected" : "";

    const isParent = summary.isParent;
    const barClasses = [
      "schedule-bar",
      `level-${Math.min(task.level, 4)}`,
      isParent ? "is-parent" : "",
      task.type === "phase" ? "phase" : "",
      `status-${summary.status}`,
      delayed ? "is-delayed" : "",
    ].filter(Boolean).join(" ");

    const chipClass = `status-chip status-${summary.status} ${delayed ? "is-delayed" : ""}`;
    const statusText = delayed ? "遅延" : STATUS_LABELS[summary.status];

    return `
      <div class="wbs-row${selected}" data-task-id="${task.id}" tabindex="0">
        <span class="wbs-id">${task.id}</span>
        <span class="wbs-name level-${Math.min(task.level, 4)}">
          <button class="collapse-toggle" data-toggle-task="${task.id}" aria-label="階層を開閉">
            ${hasChildTasks(state.plan.wbs, task.id) ? (state.collapsed.has(task.id) ? "＋" : "−") : ""}
          </button>
          <button class="task-button" data-edit-task="${task.id}">
            <i class="task-type ${task.type === "phase" ? "phase" : ""}"></i>
            <strong class="inline-cell" data-inline-field="name" data-inline-id="${task.id}" title="ダブルクリックで直接編集">${cleanText(task.name)}</strong>
            ${dependencies}
          </button>
        </span>
        <span class="wbs-status-cell">
          <span class="${chipClass}" data-quick-status="${task.id}" title="クリックして状態を変更">${statusText}</span>
        </span>
        <span class="wbs-owner owner-editable" data-owner-task="${task.id}" title="クリックして担当者を変更">${cleanText(task.owner)}</span>
        <span class="schedule" data-progress="${progressLeft}" title="計画 ${summary.start} - ${summary.end} / 実績 ${summary.actualStart || "-"} - ${summary.actualEnd || "-"} / 進捗 ${summary.pct}%">
          <i class="today-line" style="left:${todayLeft}%"></i>
          ${actual}
          <i class="${barClasses}" style="left:${left}%;width:${width}%"></i>
        </span>
        <button class="row-menu" data-delete-task="${task.id}" aria-label="削除">削除</button>
      </div>
    `;
  }).join("");

  $("#wbsTable").style.setProperty("--timeline-days", total);
  $("#wbsTable").innerHTML = `
    <div class="wbs-row header">
      <span>番号<span class="col-resizer" data-col="0"></span></span>
      <span>作業項目<span class="col-resizer" data-col="1"></span></span>
      <span>状態<span class="col-resizer" data-col="2"></span></span>
      <span>担当者<span class="col-resizer" data-col="3"></span></span>
      <span>スケジュール<span class="col-resizer" data-col="4"></span></span>
      <span></span>
    </div>
    ${renderCalendarHeader(start, total)}
    ${rows || '<div class="empty-state">条件に一致する作業はありません。</div>'}
  `;

  initColumnResizers(() => renderLightningLine(state));
  renderLightningLine(state);
  bindWbsRowEvents();
}

// ==========================================
// 7. WBS 行イベントバインド & クイック編集
// ==========================================
function bindWbsRowEvents() {
  $$("[data-edit-task]").forEach((button) => button.addEventListener("click", () => openTaskEditDialog(state, button.dataset.editTask)));
  $$("[data-delete-task]").forEach((button) => button.addEventListener("click", () => deleteTask(button.dataset.deleteTask)));
  $$("[data-toggle-task]").forEach((button) => button.addEventListener("click", () => {
    const id = button.dataset.toggleTask;
    if (state.collapsed.has(id)) state.collapsed.delete(id); else state.collapsed.add(id);
    renderWbs();
  }));

  $$("[data-quick-status]").forEach((chip) => chip.addEventListener("click", (event) => {
    event.stopPropagation();
    openQuickStatusMenu(chip.dataset.quickStatus, chip);
  }));

  $$("[data-owner-task]").forEach((cell) => cell.addEventListener("click", (event) => {
    event.stopPropagation();
    startOwnerInlineEdit(cell, cell.dataset.ownerTask);
  }));

  $$("[data-task-id]").forEach((row) => {
    row.addEventListener("click", (event) => {
      if (event.target.closest("button, input, select, .status-chip")) return;
      const id = row.dataset.taskId;
      if (event.ctrlKey || event.metaKey) {
        state.selectedIds.has(id) ? state.selectedIds.delete(id) : state.selectedIds.add(id);
      } else {
        state.selectedIds = new Set([id]);
      }
      renderWbs();
    });

    row.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openContextMenu(row.dataset.taskId, event.clientX, event.clientY);
    });
  });

  $$("[data-inline-field]").forEach((cell) => cell.addEventListener("dblclick", (event) => {
    event.stopPropagation();
    startInlineCellEdit(cell);
  }));
}

function startOwnerInlineEdit(cell, taskId) {
  if (cell.querySelector("input")) return;
  const task = state.plan.wbs.find((t) => t.id === taskId);
  if (!task) return;

  const input = document.createElement("input");
  input.className = "owner-inline-input";
  input.value = task.owner || "";
  input.placeholder = "担当者名";
  cell.replaceChildren(input);
  input.focus();
  input.select();

  let committed = false;
  const commit = () => {
    if (committed) return;
    committed = true;
    const value = input.value.trim();
    if (value && value !== (task.owner || "")) {
      recordChange();
      task.owner = value;
      appendChange(`WBS ${taskId} の担当者を「${value}」に更新`);
      persist();
      renderAll();
      showToast(`担当者を「${value}」に更新しました`);
    } else {
      renderWbs();
    }
  };

  input.addEventListener("blur", commit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); input.blur(); }
    if (e.key === "Escape") { committed = true; renderWbs(); }
  });
}

function startInlineCellEdit(cell) {
  if (cell.querySelector("input")) return;
  const id = cell.dataset.inlineId;
  const fieldName = cell.dataset.inlineField;
  const task = state.plan.wbs.find((t) => t.id === id);
  if (!task) return;

  const input = document.createElement("input");
  input.className = "inline-editor";
  input.value = task[fieldName] || "";
  cell.replaceChildren(input);
  input.focus();
  input.select();

  let committed = false;
  const commit = () => {
    if (committed) return;
    committed = true;
    const value = input.value.trim();
    if (value && value !== String(task[fieldName] || "")) {
      recordChange();
      task[fieldName] = value;
      appendChange(`WBS ${id} の${fieldName === "name" ? "作業名" : "項目"}を更新`);
      persist();
      renderAll();
      showToast("作業名を更新しました");
    } else {
      renderWbs();
    }
  };

  input.addEventListener("blur", commit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); input.blur(); }
    if (e.key === "Escape") { committed = true; renderWbs(); }
  });
}

function localToday() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function localTimestamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${localToday()}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

function syncWbsTransitionMenus(task) {
  $$("#statusQuickMenu [data-status]").forEach((button) => {
    button.hidden = button.dataset.status === task.status || !canChangeWbsStatus(task.status, button.dataset.status);
  });
  $$("#taskContextMenu [data-action='setStatus']").forEach((button) => {
    button.hidden = button.dataset.val === task.status || !canChangeWbsStatus(task.status, button.dataset.val);
  });
  $$("#taskContextMenu [data-action='setPct']").forEach((button) => {
    button.hidden = !wbsStatusForPct(task.status, Number(task.pct) || 0, Number(button.dataset.val)).ok;
  });
}

function openQuickStatusMenu(taskId, anchorElement) {
  const task = state.plan.wbs.find((item) => item.id === taskId);
  if (!task) return;
  syncWbsTransitionMenus(task);
  if (!$$("#statusQuickMenu [data-status]").some((button) => !button.hidden)) {
    showToast("この状態から直接変更できる遷移はありません。");
    return;
  }
  closeAllMenus();
  const menu = $("#statusQuickMenu");
  if (!menu) return;
  currentQuickStatusTaskId = taskId;

  menu.style.visibility = "hidden";
  menu.hidden = false;

  const rect = anchorElement.getBoundingClientRect();
  const menuWidth = menu.offsetWidth || 140;
  const menuHeight = menu.offsetHeight || 160;

  let left = rect.left;
  if (left + menuWidth > window.innerWidth - 12) {
    left = Math.max(12, window.innerWidth - menuWidth - 12);
  }

  let top = rect.bottom + 4;
  if (top + menuHeight > window.innerHeight - 12) {
    top = Math.max(12, rect.top - menuHeight - 4);
  }

  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  menu.style.visibility = "visible";
}

function updateTaskStatusQuick(taskId, newStatus) {
  const task = state.plan.wbs.find((item) => item.id === taskId);
  if (!task) return;
  if (task.status === newStatus || !canChangeWbsStatus(task.status, newStatus)) {
    showToast("この状態へは直接変更できません。");
    return;
  }
  recordChange();
  task.status = newStatus;
  const today = getStatusDate(state.plan);

  if (newStatus === "done") {
    task.pct = 100;
    task.actualEnd = today;
    if (!task.actualStart) task.actualStart = task.start || today;
  } else if (newStatus === "in_progress") {
    if (task.pct === 0 || task.pct >= 100) task.pct = 50;
    if (!task.actualStart) task.actualStart = today;
    task.actualEnd = undefined;
  } else if (newStatus === "todo") {
    task.pct = 0;
    task.actualStart = undefined;
    task.actualEnd = undefined;
  }

  appendChange(`WBS ${taskId} の状態を「${STATUS_LABELS[newStatus]}」に更新`);
  persist();
  renderAll();
  showToast(`「${task.name}」の状態を更新しました`);
}

function openContextMenu(taskId, clientX, clientY) {
  const task = state.plan.wbs.find((item) => item.id === taskId);
  if (task) syncWbsTransitionMenus(task);
  closeAllMenus();
  const menu = $("#taskContextMenu");
  if (!menu) return;
  currentContextMenuTaskId = taskId;

  menu.style.visibility = "hidden";
  menu.hidden = false;

  const menuWidth = menu.offsetWidth || 220;
  const menuHeight = menu.offsetHeight || 380;

  // X軸：右端をはみ出る場合は左側に反転
  let posX = clientX;
  if (posX + menuWidth > window.innerWidth - 12) {
    posX = Math.max(12, clientX - menuWidth);
    if (posX + menuWidth > window.innerWidth - 12) {
      posX = Math.max(12, window.innerWidth - menuWidth - 12);
    }
  }

  // Y軸：下端をはみ出る場合は上側に反転
  let posY = clientY;
  if (posY + menuHeight > window.innerHeight - 12) {
    posY = Math.max(12, clientY - menuHeight);
    if (posY + menuHeight > window.innerHeight - 12) {
      posY = Math.max(12, window.innerHeight - menuHeight - 12);
    }
  }

  menu.style.left = `${posX}px`;
  menu.style.top = `${posY}px`;
  menu.style.visibility = "visible";
}

function closeAllMenus() {
  const contextMenu = $("#taskContextMenu");
  if (contextMenu) contextMenu.hidden = true;
  const statusMenu = $("#statusQuickMenu");
  if (statusMenu) statusMenu.hidden = true;
}

function handleContextMenuAction(action, val) {
  const taskId = currentContextMenuTaskId;
  closeAllMenus();
  if (!taskId) return;
  const task = state.plan.wbs.find((t) => t.id === taskId);
  if (!task) return;

  if (action === "addChild") {
    const newId = `${taskId}.${(state.plan.wbs.filter((t) => t.id.startsWith(`${taskId}.`)).length + 1)}`;
    openTaskEditDialog(state, null, {
      id: newId,
      level: Math.min(9, task.level + 1),
      start: task.start,
      end: task.end,
      owner: task.owner || "GAO",
      status: "todo",
      pct: 0,
    });
  } else if (action === "insertBelow") {
    const newId = getNextTaskId(state.plan.wbs);
    openTaskEditDialog(state, null, {
      id: newId,
      level: task.level,
      start: task.start,
      end: task.end,
      owner: task.owner || "GAO",
      status: "todo",
      pct: 0,
    });
  } else if (action === "editDetails") {
    openTaskEditDialog(state, taskId);
  } else if (action === "setPct") {
    const pct = Number(val);
    const result = wbsStatusForPct(task.status, Number(task.pct) || 0, pct);
    if (!result.ok) {
      showToast(result.reason);
      return;
    }
    recordChange();
    task.pct = pct;
    task.status = result.status;
    const today = getStatusDate(state.plan);
    if (result.status === "done") {
      task.pct = 100;
      task.actualEnd = today;
      if (!task.actualStart) task.actualStart = task.start || today;
    } else if (result.status === "in_progress") {
      if (!task.actualStart) task.actualStart = today;
      task.actualEnd = undefined;
    } else if (result.status === "todo") {
      task.actualStart = undefined;
      task.actualEnd = undefined;
    }
    appendChange(`WBS ${taskId} の進捗率を ${pct}% に更新`);
    persist();
    renderAll();
    showToast(`「${task.name}」の進捗率を ${pct}% に更新しました`);
  } else if (action === "setStatus") {
    updateTaskStatusQuick(taskId, val);
  } else if (action === "duplicate") {
    state.selectedIds = new Set([taskId]);
    duplicateSelected();
  } else if (action === "delete") {
    deleteTask(taskId);
  }
}

// ==========================================
// 8. 複数行操作 (Move, Indent, Duplicate, Delete)
// ==========================================
function getSelectedIndexes() {
  return state.plan.wbs.map((task, index) => state.selectedIds.has(task.id) ? index : -1).filter((index) => index >= 0);
}

function mutateSelected(action, note) {
  const indexes = getSelectedIndexes();
  if (!indexes.length) return;
  recordChange();
  action(indexes);
  appendChange(note);
  persist();
  renderAll();
}

function moveSelected(direction) {
  const indexes = getSelectedIndexes();
  if (!indexes.length) return;
  recordChange();
  const ordered = direction < 0 ? indexes : [...indexes].reverse();
  ordered.forEach((index) => {
    const target = index + direction;
    if (target < 0 || target >= state.plan.wbs.length || state.selectedIds.has(state.plan.wbs[target].id)) return;
    [state.plan.wbs[index], state.plan.wbs[target]] = [state.plan.wbs[target], state.plan.wbs[index]];
  });
  appendChange(`選択した WBS を${direction < 0 ? "上" : "下"}へ移動`);
  persist();
  renderAll();
}

function duplicateSelected() {
  const indexes = getSelectedIndexes();
  if (!indexes.length) return;
  recordChange();
  const usedIds = new Set(state.plan.wbs.map((task) => task.id));
  let nextId = Math.max(0, ...state.plan.wbs.map((task) => Number(task.id)).filter(Number.isFinite)) + 1;
  const copies = indexes.map((index) => {
    while (usedIds.has(String(nextId))) nextId += 1;
    const copy = { ...clone(state.plan.wbs[index]), id: String(nextId), name: `${state.plan.wbs[index].name}（複製）` };
    usedIds.add(copy.id);
    nextId += 1;
    return copy;
  });
  state.plan.wbs.splice(indexes[indexes.length - 1] + 1, 0, ...copies);
  state.selectedIds = new Set(copies.map((task) => task.id));
  appendChange("選択した WBS を複製");
  persist();
  renderAll();
}

function deleteSelected() {
  const ids = [...state.selectedIds];
  if (!ids.length || !confirm(`${ids.length} 件の WBS を削除しますか？`)) return;
  recordChange();
  state.plan.wbs = state.plan.wbs.filter((task) => !state.selectedIds.has(task.id));
  state.plan.wbs.forEach((task) => { task.dependsOn = (task.dependsOn || []).filter((id) => !state.selectedIds.has(id)); });
  state.selectedIds.clear();
  appendChange(`${ids.length} 件の WBS を削除`);
  persist();
  renderAll();
  showToast("選択した作業を削除しました");
}

function deleteTask(taskId) {
  const task = state.plan.wbs.find((item) => item.id === taskId);
  if (!task || !confirm(`「${task.name}」を削除しますか？`)) return;
  recordChange();
  state.plan.wbs = state.plan.wbs.filter((item) => item.id !== taskId);
  state.plan.wbs.forEach((item) => { item.dependsOn = (item.dependsOn || []).filter((id) => id !== taskId); });
  state.selectedIds.delete(taskId);
  appendChange(`WBS「${task.name}」を削除`);
  persist();
  renderAll();
  showToast("作業を削除しました");
}

// ==========================================
// 9. ダイアログ保存ハンドラー
// ==========================================
function saveTaskForm(event) {
  event.preventDefault();
  const id = $("#taskIdInput").value.trim();
  const name = $("#taskName").value.trim();
  const start = $("#taskStart").value;
  const end = $("#taskEnd").value;
  if (!id || !name || !start || !end) return;

  if (end < start) {
    $("#taskFormError").textContent = "計画終了日は計画開始日以降に設定してください。";
    return;
  }

  const existingId = $("#taskId").value;
  const previous = existingId ? state.plan.wbs.find((item) => item.id === existingId) : null;
  let nextStatus = $("#taskStatus").value;
  let nextPct = Number($("#taskPct").value);
  if (previous && nextStatus !== previous.status && !canChangeWbsStatus(previous.status, nextStatus)) {
    $("#taskFormError").textContent = "この状態へは直接変更できません。";
    return;
  }
  if (previous && nextPct !== Number(previous.pct) && nextStatus === previous.status) {
    const derived = wbsStatusForPct(previous.status, Number(previous.pct) || 0, nextPct);
    if (!derived.ok) {
      $("#taskFormError").textContent = derived.reason;
      return;
    }
    nextStatus = derived.status;
  }
  if (previous && (Number(previous.pct) || 0) === 0 && nextPct === 100 && !canChangeWbsStatus(previous.status, "done")) {
    $("#taskFormError").textContent = "未着手の進捗率を 100% に直接変更することはできません。まず進行中にしてください。";
    return;
  }
  if (previous && nextStatus !== previous.status) {
    if (nextStatus === "done") nextPct = 100;
    else if (nextStatus === "todo") nextPct = 0;
    else if (nextStatus === "in_progress" && (nextPct === 0 || nextPct >= 100)) nextPct = 50;
  }

  recordChange();
  const relationsRaw = $("#taskRelations").value.trim();
  const relations = relationsRaw ? relationsRaw.split(",").map((s) => {
    const parts = s.trim().split(":");
    return { predecessorId: parts[0], type: parts[1] || "FS", lagDays: Number(parts[2]) || 0 };
  }) : [];

  const taskData = {
    id,
    level: Number($("#taskLevel").value),
    name,
    type: $("#taskType").value,
    status: nextStatus,
    owner: $("#taskOwner").value.trim() || "GAO",
    sprint: $("#taskSprint").value.trim(),
    start,
    end,
    effortDays: Number($("#taskEffort").value),
    pct: nextPct,
    actualStart: $("#taskActualStart").value || undefined,
    actualEnd: $("#taskActualEnd").value || undefined,
    actualEffort: Number($("#taskActualEffort").value) || 0,
    deliverable: $("#taskDeliverable").value.trim(),
    acceptance: $("#taskAcceptance").value.trim(),
    relations,
  };

  if (existingId) {
    const index = state.plan.wbs.findIndex((item) => item.id === existingId);
    if (index >= 0) state.plan.wbs[index] = taskData;
    appendChange(`WBS「${name}」を編集`);
  } else {
    state.plan.wbs.push(taskData);
    appendChange(`WBS「${name}」を追加`);
  }

  persist();
  $("#taskDialog").close();
  renderAll();
  showToast("作業を保存しました");
}

function saveRaidForm(event) {
  event.preventDefault();
  const title = $("#raidTitle").value.trim();
  const response = $("#raidResponse").value.trim();
  if (!title || !response) return showToast("タイトルと対応方針を入力してください");
  recordChange();
  state.plan.raid.push({
    id: `raid-${Date.now()}`,
    type: $("#raidType").value,
    title,
    impact: "未評価",
    likelihood: "未評価",
    owner: $("#raidOwner").value.trim() || "GAO",
    response,
    status: "open",
  });
  appendChange(`RAID「${title}」を追加`);
  persist();
  $("#raidDialog").close();
  renderAll();
  showToast("管理項目を追加しました");
}

function renderHolidayList() {
  const container = $("#holidayList");
  if (!container) return;
  const holidays = state.holidayDraft || state.plan.calendar?.holidays || [];
  if (!holidays.length) {
    container.innerHTML = '<div class="empty-state">登録されている休日はありません。</div>';
    return;
  }
  container.innerHTML = holidays.map((h, i) => `
    <div class="holiday-list-item">
      <strong>${h.date}</strong>
      <span>${cleanText(h.name)}</span>
      <button type="button" data-remove-holiday="${i}">削除</button>
    </div>
  `).join("");

  $$("[data-remove-holiday]").forEach((btn) => btn.addEventListener("click", () => {
    const idx = Number(btn.dataset.removeHoliday);
    state.holidayDraft.splice(idx, 1);
    renderHolidayList();
  }));
}

function saveHolidays(event) {
  event.preventDefault();
  recordChange();
  state.plan.calendar = state.plan.calendar || {};
  state.plan.calendar.weekendAutoHoliday = $("#weekendHoliday").checked;
  state.plan.calendar.holidays = state.holidayDraft || state.plan.calendar.holidays || [];
  state.holidayDraft = null;
  appendChange("休日設定を更新");
  persist();
  $("#holidayDialog").close();
  renderAll();
  showToast("休日設定を保存しました");
}

function saveMeetingForm(event) {
  event.preventDefault();
  recordChange();
  const meeting = {
    name: $("#meetingName").value.trim(),
    dayOfWeek: $("#meetingDayOfWeek").value,
    frequency: $("#meetingFrequency").value,
    interval: Number($("#meetingInterval").value) || 1,
    startDate: $("#meetingStartDate").value,
    endDate: $("#meetingEndDate").value,
    endMode: $("#meetingEndMode").value,
    count: Number($("#meetingCount").value) || 8,
    startTime: $("#meetingStartTime").value,
    endTime: $("#meetingEndTime").value,
    location: $("#meetingLocation").value.trim(),
    attendees: $("#meetingAttendees").value.trim(),
    description: $("#meetingDescription").value.trim(),
    weekdays: $$('input[name="meetingWeekday"]:checked').map((el) => el.value),
  };
  state.plan.calendar = state.plan.calendar || {};
  state.plan.calendar.regularMeetings = [meeting];
  appendChange("定例会議設定を更新");
  persist();
  $("#meetingDialog").close();
  renderAll();
  showToast("定例会議を保存しました");
}

// ==========================================
// 10. 全体描画 & 初期化 (Boot)
// ==========================================
function renderAll() {
  renderOverview();
  renderWbs();
  renderTickets();
  renderRaidCards(state.plan.raid);
  renderHistoryList(state.plan.changeLog);
  renderSampleTree();
  updateHistoryButtons();
}

function renderTickets() {
  if (!state.plan) return;
  renderTicketBoard({
    tickets: state.plan.tickets || [],
    actor: state.actor,
    today: localToday(),
    selectedId: state.selectedTicketId,
    queue: state.ticketQueue,
    people: collectPeople(state.plan, state.actor),
  });
}

function runTicketAction(id, action, payload) {
  const index = (state.plan.tickets || []).findIndex((item) => item.id === id);
  if (index < 0) return;
  try {
    const result = applyAction(state.plan.tickets[index], action, state.actor, payload, localTimestamp());
    recordChange();
    state.plan.tickets[index] = result.ticket;
    const note = result.ticket.history?.[result.ticket.history.length - 1]?.note || action;
    appendChange(`課題 ${id}: ${note}`);
    persist();
    renderAll();
    showToast(result.warning || "課題を更新しました");
  } catch (error) {
    showToast(error.message);
  }
}

function saveTicketForm(event) {
  event.preventDefault();
  const title = $("#ticketTitle").value.trim();
  const dueDate = $("#ticketDue").value;
  if (!state.actor) {
    showToast("操作者を選択してください。");
    return;
  }
  if (!title || !dueDate) return;
  const unknown = $("#ticketBallUnknown").checked;
  let created = createTicket({
    id: `T-${Date.now()}`,
    title,
    reporter: state.actor,
    assignee: unknown ? state.actor : ($("#ticketAssignee").value.trim() || state.actor),
    dueDate,
    wbsId: $("#ticketWbs").value.trim(),
    today: localToday(),
  });
  if (unknown) created = applyAction(created, "markBallUnknown", state.actor, {}, localTimestamp()).ticket;
  recordChange();
  state.plan.tickets = state.plan.tickets || [];
  state.plan.tickets.push(created);
  state.selectedTicketId = created.id;
  state.ticketQueue = null;
  appendChange(`課題「${title}」を起票`);
  persist();
  $("#ticketDialog").close();
  renderAll();
  showToast("課題を起票しました");
}

function setRange(mode) {
  if (mode === "project") {
    state.rangeDays = daysBetween(state.plan.meta.planStart, state.plan.meta.planEnd);
    state.rangeStart = dayNumber(state.plan.meta.planStart);
  } else {
    state.rangeDays = Number(mode);
    state.rangeStart = dayNumber(getStatusDate(state.plan)) - Math.floor(state.rangeDays / 3);
  }
  $("#rangeStartInput").value = isoDate(state.rangeStart);
  $("#rangeEndInput").value = isoDate(state.rangeStart + state.rangeDays - 1);
  renderWbs();
}

function applyManualRange() {
  const start = $("#rangeStartInput").value;
  const end = $("#rangeEndInput").value;
  if (!start || !end || end < start) return showToast("開始日と終了日を正しく設定してください");
  state.rangeStart = dayNumber(start);
  state.rangeDays = daysBetween(start, end);
  renderWbs();
}

function changeRange(offset) {
  state.rangeStart += offset;
  $("#rangeStartInput").value = isoDate(state.rangeStart);
  $("#rangeEndInput").value = isoDate(state.rangeStart + state.rangeDays - 1);
  renderWbs();
}

function exportPlan() {
  const blob = new Blob([JSON.stringify(state.plan, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${state.plan.meta.projectCode || "project-plan"}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
  showToast("計画データを出力しました");
}

async function importPlan(file) {
  try {
    const imported = JSON.parse(await file.text());
    if (!imported.meta || !Array.isArray(imported.wbs)) throw new Error("meta と wbs が必要です。");
    recordChange();
    state.plan = normalizePlan(imported);
    appendChange("計画データを取り込み");
    persist();
    renderAll();
    showToast("計画データを取り込みました");
  } catch (error) {
    showToast(`計画データの取り込みに失敗しました: ${error.message}`);
  }
}

async function boot() {
  state.plan = repository.load();
  if (!state.plan) state.plan = await repository.loadSeed();
  state.plan = normalizePlan(state.plan);
  state.actor = localStorage.getItem(ACTOR_KEY) || state.plan.meta.pm || "";
  const actorInput = $("#actorInput");
  if (actorInput) actorInput.value = state.actor;
  if (state.actor) localStorage.setItem(ACTOR_KEY, state.actor);
  state.rangeDays = daysBetween(state.plan.meta.planStart, state.plan.meta.planEnd);
  state.rangeStart = dayNumber(state.plan.meta.planStart);
  $("#rangeSelect").value = "project";
  $("#rangeStartInput").value = state.plan.meta.planStart;
  $("#rangeEndInput").value = state.plan.meta.planEnd;
  renderAll();
  activateView("wbs");
  setTimeout(renderWbs, 0);
}

// ==========================================
// 11. グローバルイベントリスナー
// ==========================================
$$(".nav-link").forEach((button) => button.addEventListener("click", () => {
  activateView(button.dataset.view);
  if (button.dataset.view === "wbs") setTimeout(renderWbs, 0);
}));

$$("[data-view-target]").forEach((button) => button.addEventListener("click", () => {
  activateView(button.dataset.viewTarget);
  if (button.dataset.viewTarget === "wbs") setTimeout(renderWbs, 0);
}));

$("#exportButton").addEventListener("click", exportPlan);
$("#undoButton").addEventListener("click", undo);
$("#redoButton").addEventListener("click", redo);
$("#newTaskButton").addEventListener("click", () => openTaskEditDialog(state));
$("#taskForm").addEventListener("submit", saveTaskForm);
$("#importButton").addEventListener("click", () => $("#importFile").click());
$("#importFile").addEventListener("change", (event) => event.target.files[0] && importPlan(event.target.files[0]));
$("#taskFilter").addEventListener("change", (event) => { state.filter = event.target.value; renderWbs(); });
$("#rangeSelect").addEventListener("change", (event) => setRange(event.target.value));
$("#applyRangeButton").addEventListener("click", applyManualRange);
$("#taskSearch").addEventListener("input", (event) => { state.search = event.target.value; renderWbs(); });
$("#prevMonthBtn").addEventListener("click", () => changeRange(-30));
$("#prevWeekBtn").addEventListener("click", () => changeRange(-7));
$("#todayPeriod").addEventListener("click", () => {
  state.rangeStart = dayNumber(getStatusDate(state.plan)) - Math.floor(state.rangeDays / 2);
  $("#rangeStartInput").value = isoDate(state.rangeStart);
  $("#rangeEndInput").value = isoDate(state.rangeStart + state.rangeDays - 1);
  renderWbs();
});
$("#nextWeekBtn").addEventListener("click", () => changeRange(7));
$("#nextMonthBtn").addEventListener("click", () => changeRange(30));

$("#moveTaskUp").addEventListener("click", () => moveSelected(-1));
$("#moveTaskDown").addEventListener("click", () => moveSelected(1));
$("#indentTask").addEventListener("click", () => mutateSelected((indexes) => indexes.forEach((idx) => { state.plan.wbs[idx].level = Math.min(9, state.plan.wbs[idx].level + 1); }), "選択した WBS をインデント"));
$("#outdentTask").addEventListener("click", () => mutateSelected((indexes) => indexes.forEach((idx) => { state.plan.wbs[idx].level = Math.max(1, state.plan.wbs[idx].level - 1); }), "選択した WBS を反インデント"));
$("#duplicateTask").addEventListener("click", duplicateSelected);
$("#deleteSelectedTasks").addEventListener("click", deleteSelected);
$("#clearTaskSelection").addEventListener("click", () => { state.selectedIds.clear(); renderWbs(); });

$("#setHolidayButton").addEventListener("click", () => {
  state.holidayDraft = clone(state.plan.calendar?.holidays || []);
  $("#weekendHoliday").checked = state.plan.calendar?.weekendAutoHoliday ?? true;
  renderHolidayList();
  $("#holidayDialog").showModal();
});
$("#holidayForm").addEventListener("submit", saveHolidays);
$("#addJapanHolidaysButton").addEventListener("click", () => {
  const startYear = Number(state.plan.meta.planStart.slice(0, 4));
  const endYear = Number(state.plan.meta.planEnd.slice(0, 4));
  const items = [];
  for (let year = startYear; year <= endYear; year += 1) items.push(...getJapanHolidays(year));
  state.holidayDraft = state.holidayDraft || [];
  const existing = new Set(state.holidayDraft.map((h) => h.date));
  items.forEach((item) => {
    if (!existing.has(item.date)) {
      existing.add(item.date);
      state.holidayDraft.push(item);
    }
  });
  renderHolidayList();
  showToast(`${items.length} 件の日本の祝日候補を追加しました`);
});

$("#setMeetingButton").addEventListener("click", () => openMeetingDialog(state));
$("#meetingForm").addEventListener("submit", saveMeetingForm);
$("#openOutlookButton").addEventListener("click", () => {
  const meeting = state.plan.calendar?.regularMeetings?.[0] || {};
  openOutlookLocalComposer(meeting);
});
$("#openOutlookWebButton").addEventListener("click", () => {
  const meeting = state.plan.calendar?.regularMeetings?.[0] || {};
  openOutlookWebComposer(meeting);
});
$("#meetingEndMode").addEventListener("change", (event) => {
  $("#meetingEndDate").disabled = event.target.value === "count";
  $("#meetingCount").disabled = event.target.value !== "count";
  syncMeetingCalculation();
});
["meetingStartDate", "meetingEndDate", "meetingFrequency", "meetingInterval", "meetingCount"].forEach((id) => {
  $(`#${id}`).addEventListener("input", syncMeetingCalculation);
  $(`#${id}`).addEventListener("change", syncMeetingCalculation);
});
$$('input[name="meetingWeekday"]').forEach((input) => input.addEventListener("change", syncMeetingCalculation));

window.addEventListener("resize", () => {
  if ($("#wbsTable .schedule")) renderLightningLine(state);
});

$$("[data-close-dialog]").forEach((button) => {
  button.addEventListener("click", () => {
    document.getElementById(button.dataset.closeDialog).close();
    if (button.dataset.closeDialog === "holidayDialog") state.holidayDraft = null;
  });
});

$("#actorInput").addEventListener("change", () => {
  state.actor = $("#actorInput").value.trim();
  localStorage.setItem(ACTOR_KEY, state.actor);
  renderTickets();
});
$("#addTicketButton").addEventListener("click", () => {
  if (!state.actor) showToast("先に操作者を入力してください。");
  $("#ticketTitle").value = "";
  $("#ticketAssignee").value = state.actor || "";
  $("#ticketDue").value = localToday();
  $("#ticketWbs").value = "";
  $("#ticketBallUnknown").checked = false;
  $("#ticketDialog").showModal();
});
$("#ticketForm").addEventListener("submit", saveTicketForm);
$("#ticketPanel").addEventListener("click", (event) => {
  const queueButton = event.target.closest("[data-ticket-queue]");
  if (queueButton) {
    const key = queueButton.dataset.ticketQueue;
    state.ticketQueue = state.ticketQueue === key ? null : key;
    renderTickets();
    return;
  }
  const actionButton = event.target.closest("[data-ticket-action]");
  if (actionButton && state.selectedTicketId) {
    runTicketAction(state.selectedTicketId, actionButton.dataset.ticketAction, {
      commentId: actionButton.dataset.commentId,
    });
    return;
  }
  const row = event.target.closest("[data-ticket-id]");
  if (row) {
    state.selectedTicketId = row.dataset.ticketId;
    renderTickets();
  }
});
$("#ticketPanel").addEventListener("submit", (event) => {
  const form = event.target.closest("[data-ticket-form]");
  if (!form || !state.selectedTicketId) return;
  event.preventDefault();
  const data = new FormData(form);
  const kind = form.dataset.ticketForm;
  if (kind === "handoff") {
    runTicketAction(state.selectedTicketId, "handoff", {
      nextAssignee: String(data.get("nextAssignee") || ""),
      note: String(data.get("note") || ""),
    });
  } else if (kind === "due-direct") {
    runTicketAction(state.selectedTicketId, "setDueDate", { dueDate: String(data.get("dueDate") || "") });
  } else if (kind === "due-request") {
    runTicketAction(state.selectedTicketId, "requestDueChange", {
      requestedDue: String(data.get("requestedDue") || ""),
      reason: String(data.get("reason") || ""),
    });
  } else if (kind === "comment") {
    runTicketAction(state.selectedTicketId, "comment", { body: String(data.get("body") || "") });
  } else if (kind === "improve") {
    runTicketAction(state.selectedTicketId, "flagImprovement", {
      note: String(data.get("note") || ""),
      pmo: state.plan.meta?.pm || "",
    });
  }
});

$("#addRaidButton").addEventListener("click", () => {
  $("#raidOwner").value = state.plan.meta.pm || "GAO";
  $("#raidTitle").value = "";
  $("#raidResponse").value = "";
  $("#raidDialog").showModal();
});
$("#raidForm").addEventListener("submit", saveRaidForm);

// コンテキストメニューのアクション接続
$$("#taskContextMenu .menu-item, #taskContextMenu button").forEach((btn) => {
  btn.addEventListener("click", () => {
    const action = btn.dataset.action;
    const value = btn.dataset.val;
    handleContextMenuAction(action, value);
  });
});

// 状態クイック変更メニューの接続
$$("#statusQuickMenu .status-menu-item").forEach((btn) => {
  btn.addEventListener("click", () => {
    const status = btn.dataset.status;
    if (currentQuickStatusTaskId) {
      updateTaskStatusQuick(currentQuickStatusTaskId, status);
      closeAllMenus();
    }
  });
});

// 画面外操作・スクロール・キー入力によるコンテキストメニュー自動終了制御（Windows & Web 開発標準準拠）
// 1. マウスホイール回転時（wheel）: メニュー外でのホイール操作で即座に閉じる
window.addEventListener("wheel", (e) => {
  const contextMenu = $("#taskContextMenu");
  const statusMenu = $("#statusQuickMenu");
  const isInsideMenu = e.target.closest("#taskContextMenu, #statusQuickMenu");
  if (!isInsideMenu && ((contextMenu && !contextMenu.hidden) || (statusMenu && !statusMenu.hidden))) {
    closeAllMenus();
  }
}, { passive: true });

// 2. ページおよびテーブル（.wbs-surface）等のスクロール時: 即座に閉じる
window.addEventListener("scroll", (e) => {
  const isInsideMenu = e.target.closest && e.target.closest("#taskContextMenu, #statusQuickMenu");
  if (!isInsideMenu) {
    closeAllMenus();
  }
}, { capture: true, passive: true });

// 3. ウィンドウリサイズ・フォーカス喪失（blur）時: 即座に閉じる
window.addEventListener("blur", closeAllMenus);
window.addEventListener("resize", closeAllMenus);

// 4. マウスダウン（pointerdown）: メニュー外をクリックした瞬間に素早く閉じる
document.addEventListener("pointerdown", (e) => {
  if (!e.target.closest("#taskContextMenu") && !e.target.closest("#statusQuickMenu") && !e.target.closest("[data-quick-status]")) {
    closeAllMenus();
  }
});

// 5. キーボード操作（Escape）/ Undo・Redo ショートカット
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeAllMenus();
  if (!(e.ctrlKey || e.metaKey)) return;
  if (e.key.toLowerCase() === "z") {
    e.preventDefault();
    e.shiftKey ? redo() : undo();
  } else if (e.key.toLowerCase() === "y") {
    e.preventDefault();
    redo();
  }
});

// 起動
boot().catch((error) => {
  document.body.innerHTML = `<main class="fatal-error"><h1>プロジェクトを読み込めません</h1><p>${error.message}</p></main>`;
});
