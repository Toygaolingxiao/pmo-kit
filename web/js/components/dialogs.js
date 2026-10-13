/**
 * ダイアログ制御モジュール
 * タスク編集、休日設定、定例会議・Outlook連携ダイアログを管理します。
 */

import { $, $$, cleanText, dayNumber, isoDate, daysBetween, showToast, clone } from "../utils.js";
import { canChangeWbsStatus } from "../ticket-fsm.js";
import { getJapanHolidays } from "../holidays.js";

/**
 * 次の推奨タスクIDを生成します。
 */
export function getNextTaskId(wbs) {
  const numbers = wbs.map((task) => Number(task.id)).filter(Number.isFinite);
  return String(Math.max(0, ...numbers) + 1);
}

/**
 * タスク追加・編集ダイアログを開きます。
 */
export function openTaskEditDialog(state, taskId = null, defaults = null) {
  const task = taskId ? state.plan.wbs.find((item) => item.id === taskId) : null;
  $("#dialogTitle").textContent = task ? "作業を編集" : "作業を追加";
  $("#taskId").value = task?.id || "";
  $("#taskIdInput").value = task?.id || defaults?.id || getNextTaskId(state.plan.wbs);
  $("#taskLevel").value = task?.level ?? defaults?.level ?? 3;
  $("#taskName").value = task?.name || defaults?.name || "";
  $("#taskType").value = task?.type || defaults?.type || "task";
  const status = task?.status || defaults?.status || "todo";
  $$("#taskStatus option").forEach((option) => {
    option.disabled = Boolean(task) && option.value !== status && !canChangeWbsStatus(status, option.value);
  });
  $("#taskStatus").value = status;
  $("#taskOwner").value = task?.owner || defaults?.owner || state.plan.meta.pm || "GAO";
  $("#taskSprint").value = task?.sprint || defaults?.sprint || "";
  $("#taskStart").value = task?.start || defaults?.start || state.plan.meta.planStart;
  $("#taskEnd").value = task?.end || defaults?.end || state.plan.meta.planStart;
  $("#taskEffort").value = task?.effortDays ?? defaults?.effortDays ?? 1;
  $("#taskPct").value = task?.pct ?? defaults?.pct ?? 0;
  $("#taskActualStart").value = task?.actualStart || defaults?.actualStart || "";
  $("#taskActualEnd").value = task?.actualEnd || defaults?.actualEnd || "";
  $("#taskActualEffort").value = task?.actualEffort ?? defaults?.actualEffort ?? 0;
  $("#taskDeliverable").value = task?.deliverable || defaults?.deliverable || "";
  $("#taskAcceptance").value = task?.acceptance || defaults?.acceptance || "";
  $("#taskRelations").value = task?.relations?.map((relation) => `${relation.predecessorId}:${relation.type}:${relation.lagDays}`).join(", ") || task?.dependsOn?.join(", ") || "";
  $("#taskFormError").textContent = "";
  $("#taskDialog").showModal();
}

/**
 * 定例会議ダイアログを開きます。
 */
export function openMeetingDialog(state) {
  const meeting = state.plan.calendar?.regularMeetings?.[0] || {};
  $("#meetingName").value = meeting.name || "PMO 週次進捗定例";
  $("#meetingDayOfWeek").value = meeting.dayOfWeek || "mon";
  $("#meetingFrequency").value = meeting.frequency || "weekly";
  $("#meetingInterval").value = meeting.interval || 1;
  $("#meetingStartDate").value = meeting.startDate || state.plan.meta.planStart;
  $("#meetingEndDate").value = meeting.endDate || state.plan.meta.planEnd;
  $("#meetingCount").value = meeting.count || 8;
  $("#meetingEndMode").value = meeting.endMode || "date";
  $("#meetingStartTime").value = meeting.startTime || "10:00";
  $("#meetingEndTime").value = meeting.endTime || "11:00";
  $("#meetingLocation").value = meeting.location || "Microsoft Teams / 会議室 A";
  $("#meetingAttendees").value = meeting.attendees || "PMO, 各チームリーダー";
  $("#meetingDescription").value = meeting.description || "進捗確認、課題・リスクの共有および意思決定の確認を行います。";

  const weekdays = new Set(meeting.weekdays || [meeting.dayOfWeek || "mon"]);
  $$('input[name="meetingWeekday"]').forEach((input) => {
    input.checked = weekdays.has(input.value);
  });

  $("#meetingEndDate").disabled = $("#meetingEndMode").value === "count";
  $("#meetingCount").disabled = $("#meetingEndMode").value !== "count";

  syncMeetingCalculation();
  $("#meetingDialog").showModal();
}

/**
 * 会議回数と終了日の連動計算
 */
export function syncMeetingCalculation() {
  const startDate = $("#meetingStartDate").value;
  const frequency = $("#meetingFrequency").value;
  const interval = Math.max(1, Number($("#meetingInterval").value) || 1);
  const endMode = $("#meetingEndMode").value;
  if (!startDate) return;

  const stepDays = frequency === "biweekly" ? 14 * interval : (frequency === "monthly" ? 28 * interval : 7 * interval);

  if (endMode === "count") {
    const count = Math.max(1, Number($("#meetingCount").value) || 1);
    const endDayNum = dayNumber(startDate) + (count - 1) * stepDays;
    $("#meetingEndDate").value = isoDate(endDayNum);
    $("#meetingCalcHint").textContent = `自動計算: 全 ${count} 回の開催（最終日: ${isoDate(endDayNum)}）`;
  } else {
    const endDate = $("#meetingEndDate").value;
    if (endDate && endDate >= startDate) {
      const diff = dayNumber(endDate) - dayNumber(startDate);
      const computedCount = Math.floor(diff / stepDays) + 1;
      $("#meetingCount").value = Math.max(1, computedCount);
      $("#meetingCalcHint").textContent = `自動計算: 期間内に ${computedCount} 回開催予定`;
    }
  }
}

/**
 * Outlook 会議設定（ローカルアプリ呼び出し）
 */
export function openOutlookLocalComposer(meetingData) {
  const subject = encodeURIComponent(meetingData.name || "プロジェクト定例会議");
  const body = encodeURIComponent(`${meetingData.description || ""}\n\n参加者: ${meetingData.attendees || ""}`);
  const location = encodeURIComponent(meetingData.location || "");
  const uri = `ms-outlook:compose?subject=${subject}&body=${body}&location=${location}`;

  const iframe = document.createElement("iframe");
  iframe.style.display = "none";
  document.body.appendChild(iframe);
  iframe.src = uri;
  setTimeout(() => iframe.remove(), 1000);
}

/**
 * Outlook Web 版 会議作成画面を開く
 */
export function openOutlookWebComposer(meetingData) {
  const subject = encodeURIComponent(meetingData.name || "プロジェクト定例会議");
  const body = encodeURIComponent(`${meetingData.description || ""}\n\n参加者: ${meetingData.attendees || ""}`);
  const location = encodeURIComponent(meetingData.location || "");
  const start = `${meetingData.startDate || ""}T${(meetingData.startTime || "10:00")}:00`;
  const end = `${meetingData.startDate || ""}T${(meetingData.endTime || "11:00")}:00`;
  const url = `https://outlook.office.com/calendar/0/deeplink/compose?subject=${subject}&body=${body}&location=${location}&startdt=${start}&enddt=${end}`;
  window.open(url, "_blank", "noopener,noreferrer");
}
