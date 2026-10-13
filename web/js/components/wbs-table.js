/**
 * WBS テーブル・ガントチャート表示コンポーネント
 * 列リサイズ、インライン編集、コンテキストメニュー、クイック状態変更、稲妻線描画を提供します。
 */

import { $, $$, cleanText, dayNumber, isoDate, getStatusDate, STATUS_LABELS } from "../utils.js";
import { hasChildTasks, calculateTaskSummary, isTaskDelayed, getProgressLineDate } from "../gantt-calc.js";

/**
 * 列リサイズハンドラーの初期化
 */
export function initColumnResizers(onResized) {
  const columns = [
    { key: "--wbs-col-id", min: 36, max: 90 },
    { key: "--wbs-col-name", min: 140, max: 500 },
    { key: "--wbs-col-status", min: 70, max: 140 },
    { key: "--wbs-col-owner", min: 70, max: 180 },
    { key: "--wbs-col-schedule", min: 400, max: 2000 },
  ];

  $$(".col-resizer").forEach((resizer) => {
    resizer.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const colIndex = Number(resizer.dataset.col);
      const colConfig = columns[colIndex];
      if (!colConfig) return;

      const th = resizer.parentElement;
      const startX = e.clientX;
      const startWidth = th.getBoundingClientRect().width;

      resizer.classList.add("resizing");
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const onMouseMove = (moveEvent) => {
        const delta = moveEvent.clientX - startX;
        const newWidth = Math.max(colConfig.min, Math.min(colConfig.max, startWidth + delta));
        document.documentElement.style.setProperty(colConfig.key, `${newWidth}px`);
        if (onResized) onResized();
      };

      const onMouseUp = () => {
        resizer.classList.remove("resizing");
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
        if (onResized) onResized();
      };

      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    });
  });
}

/**
 * 稲妻線（進捗線）の描画
 */
export function renderLightningLine(state) {
  const table = $("#wbsTable");
  if (!table) return;
  const rows = $$("#wbsTable [data-task-id]");
  table.querySelector(".lightning-line")?.remove();

  const leafRows = rows.filter((row) => !hasChildTasks(state.plan.wbs, row.dataset.taskId));
  if (leafRows.length < 1) return;

  const tableRect = table.getBoundingClientRect();
  const schedules = leafRows.map((row) => row.querySelector(".schedule"));
  const firstRect = schedules[0].getBoundingClientRect();
  const statusDateStr = getStatusDate(state.plan);
  const statusDay = dayNumber(statusDateStr);
  const timelineStart = state.rangeStart;
  const totalDays = state.rangeDays;

  // 基準日 X 座標
  const statusX = firstRect.left - tableRect.left + ((statusDay - timelineStart) / totalDays) * firstRect.width;

  const points = [];
  // 開始点: カレンダー行の下端からスタート
  const monthRow = table.querySelector(".calendar-month");
  const topY = monthRow ? (monthRow.getBoundingClientRect().top - tableRect.top) : (firstRect.top - tableRect.top);
  points.push({ x: statusX, y: topY });

  leafRows.forEach((row) => {
    const taskId = row.dataset.taskId;
    const taskIndex = state.plan.wbs.findIndex((t) => t.id === taskId);
    const task = state.plan.wbs[taskIndex];
    if (!task) return;

    const summary = calculateTaskSummary(state.plan.wbs, task, taskIndex);
    const schedule = row.querySelector(".schedule");
    const rect = schedule.getBoundingClientRect();
    const midY = rect.top - tableRect.top + rect.height / 2;

    const targetDate = getProgressLineDate(task, summary, statusDateStr);
    const targetDay = targetDate.getTime() / 86400000;
    const x = rect.left - tableRect.left + ((targetDay - timelineStart) / totalDays) * rect.width;

    points.push({ x, y: midY });
  });

  // 終点: 最後のタスク行の下で状態日に戻す
  const lastRect = schedules[schedules.length - 1].getBoundingClientRect();
  const bottomY = lastRect.bottom - tableRect.top + 6;
  points.push({ x: statusX, y: bottomY });

  const pathData = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "lightning-line");
  svg.style.position = "absolute";
  svg.style.left = "0";
  svg.style.top = "0";
  svg.style.width = "100%";
  svg.style.height = "100%";
  svg.style.pointerEvents = "none";
  svg.style.zIndex = "4";

  // 背景のグロー線と前景のシャープ線
  svg.innerHTML = `
    <path d="${pathData}" fill="none" stroke="rgba(234, 88, 12, 0.25)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
    <path d="${pathData}" fill="none" stroke="#ea580c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
    ${points.slice(1, -1).map((p) => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3" fill="#ea580c" stroke="#fff" stroke-width="1.5" />`).join("")}
  `;

  table.style.position = "relative";
  table.appendChild(svg);
}
