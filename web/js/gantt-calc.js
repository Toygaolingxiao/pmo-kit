/**
 * ガントチャート計算・稲妻線（進捗線）アルゴリズムモジュール
 * 
 * 【稲妻線（進捗折線）の看図ロジックと計算規則】
 * 1. 基準線（赤破線）: 状態日（Status Date / 今日）。
 * 2. 完了タスク (100%): 状態日に垂直整合（リスクなしとしてノイズを抑制）。
 * 3. 進行中タスク (1~99%): 実績進捗日 = 開始日 + (終了日 - 開始日) * (進捗率 / 100)
 *    - 状態日より左に凹む = 遅延（要対策）
 *    - 状態日より右に突起 = 進捗前倒し（好調）
 * 4. 未着手タスク (0%):
 *    - 未来着手 (開始日 > 状態日): 状態日に垂直整合（正常守候）
 *    - 着手遅延 (開始日 <= 状態日): 開始日に打点（左に凹んで着手遅延警告）
 * 5. 親タスク（サマリー）は折線の打点をスキップし、リーフタスク（最下層作業）のみを串刺し接続。
 */

import { dayNumber, isoDate, getStatusDate } from "./utils.js";

/**
 * タスクが親タスク（子階層を持つか）を判定します。
 */
export function hasChildTasks(wbs, taskId) {
  const index = wbs.findIndex((t) => t.id === taskId);
  if (index === -1) return false;
  const current = wbs[index];
  const next = wbs[index + 1];
  return Boolean(next && next.level > current.level);
}

/**
 * 親タスクの期間・進捗率を子タスクから集計します。
 */
export function calculateTaskSummary(wbs, task, taskIndex) {
  const next = wbs[taskIndex + 1];
  const isParent = Boolean(next && next.level > task.level);
  if (!isParent) {
    return {
      start: task.start,
      end: task.end,
      pct: task.pct ?? (task.status === "done" ? 100 : 0),
      status: task.status,
      actualStart: task.actualStart,
      actualEnd: task.actualEnd,
      isParent: false,
    };
  }

  // 直下および配下の子タスクを収集
  const children = [];
  for (let i = taskIndex + 1; i < wbs.length; i += 1) {
    if (wbs[i].level <= task.level) break;
    children.push(wbs[i]);
  }

  if (!children.length) {
    return {
      start: task.start,
      end: task.end,
      pct: task.pct ?? 0,
      status: task.status,
      actualStart: task.actualStart,
      actualEnd: task.actualEnd,
      isParent: true,
    };
  }

  const validStarts = children.map((c) => c.start).filter(Boolean).sort();
  const validEnds = children.map((c) => c.end).filter(Boolean).sort();
  const childPcts = children.map((c) => c.pct ?? (c.status === "done" ? 100 : 0));
  const avgPct = Math.round(childPcts.reduce((sum, v) => sum + v, 0) / childPcts.length);

  let computedStatus = "todo";
  if (childPcts.every((p) => p === 100)) computedStatus = "done";
  else if (childPcts.some((p) => p > 0)) computedStatus = "in_progress";

  return {
    start: validStarts[0] || task.start,
    end: validEnds[validEnds.length - 1] || task.end,
    pct: avgPct,
    status: computedStatus,
    actualStart: task.actualStart || children.find((c) => c.actualStart)?.actualStart,
    actualEnd: computedStatus === "done" ? (task.actualEnd || children[children.length - 1]?.actualEnd) : undefined,
    isParent: true,
  };
}

/**
 * タスクが遅延状態にあるかを精密に判定します。
 * @returns {boolean} 遅延している場合 true
 */
export function isTaskDelayed(task, summary, statusDateStr) {
  if (summary.status === "done") return false;
  const statusDay = dayNumber(statusDateStr);
  const taskStartDay = dayNumber(summary.start);
  const taskEndDay = dayNumber(summary.end);

  // 1. 完了予定日を過ぎているのに未完了
  if (taskEndDay < statusDay) return true;

  // 2. 未着手だが着手予定日を過ぎている
  if ((Number(summary.pct) || 0) === 0 && taskStartDay < statusDay) return true;

  // 3. 進行中だが、経過期間に対して進捗率が計画より下回っている
  if (statusDay >= taskStartDay && statusDay <= taskEndDay) {
    const plannedDuration = Math.max(1, taskEndDay - taskStartDay + 1);
    const elapsedDuration = statusDay - taskStartDay + 1;
    const expectedPct = (elapsedDuration / plannedDuration) * 100;
    // 10%以上の乖離で遅延警告
    if ((Number(summary.pct) || 0) < expectedPct - 10) return true;
  }

  return false;
}

/**
 * 稲妻線（進捗線）の打点日付を算出します。
 */
export function getProgressLineDate(task, summary, statusDateStr) {
  const statusDate = new Date(`${statusDateStr}T00:00:00Z`);
  const pct = Number(summary.pct) || 0;
  const startDate = new Date(`${summary.start}T00:00:00Z`);
  const endDate = new Date(`${summary.end}T00:00:00Z`);

  // 1. 完了タスク: 状態日に垂直整合（リスクなし・ノイズ防止）
  if (pct === 100 || summary.status === "done") {
    return statusDate;
  }

  // 2. 進行中タスク: 実績進捗の物理位置
  if (pct > 0 && pct < 100) {
    const totalDuration = endDate.getTime() - startDate.getTime();
    const progressDuration = totalDuration * (pct / 100);
    return new Date(startDate.getTime() + progressDuration);
  }

  // 3. 未着手タスク (pct === 0)
  if (startDate.getTime() > statusDate.getTime()) {
    // 未来タスク: 状態日に垂直整合
    return statusDate;
  }
  // 過去着手予定の未着手: 開始日に打点（左凹み警告）
  return startDate;
}
