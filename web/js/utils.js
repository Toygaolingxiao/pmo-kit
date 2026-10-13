/**
 * PMO-Kit ユーティリティモジュール
 * 日付計算、サニタイズ、ディープクローン等の純粋関数を提供します。
 */

export const DAY_MS = 86400000;

export const STATUS_LABELS = {
  todo: "未着手",
  in_progress: "進行中",
  done: "完了",
  deferred: "保留",
};

export const OVERALL_STATUS_LABELS = {
  GREEN: "順調",
  AMBER: "要注意",
  RED: "重大な懸念",
};

export const RAID_TYPE_LABELS = {
  Risk: "リスク",
  Issue: "課題",
  Assumption: "前提",
  Dependency: "依存関係",
};

export const $ = (selector) => document.querySelector(selector);
export const $$ = (selector) => [...document.querySelectorAll(selector)];

/**
 * 不可視文字や特定の禁止記号（em-dash等）を安全な標準ハイフンに正規化します。
 */
export function cleanText(value) {
  return String(value ?? "").replace(/[—–]/g, "-");
}

/**
 * 基準日（状態日: Status Date）を取得します。
 * プロジェクト設定に dataDate があればそれを優先し、なければ本日日付を返します。
 */
export function getStatusDate(plan) {
  if (plan?.meta?.dataDate) return plan.meta.dataDate;
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/**
 * YYYY-MM-DD 形式の日付文字列をエポック日数に変換します。
 */
export function dayNumber(dateStr) {
  const value = Date.parse(`${dateStr}T00:00:00Z`);
  if (!Number.isFinite(value)) throw new Error(`日付が不正です: ${dateStr}`);
  return Math.floor(value / DAY_MS);
}

/**
 * エポック日数を YYYY-MM-DD 形式の ISO 日付文字列に変換します。
 */
export function isoDate(dayNum) {
  return new Date(dayNum * DAY_MS).toISOString().slice(0, 10);
}

/**
 * 2つの日付間の経過日数を計算します（両端を含む）。
 */
export function daysBetween(startStr, endStr) {
  return Math.max(1, dayNumber(endStr) - dayNumber(startStr) + 1);
}

/**
 * オブジェクトのディープクローンを作成します。
 */
export function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * トースト通知を表示します。
 */
let toastTimer = null;
export function showToast(message) {
  const toast = $("#toast");
  if (!toast) return;
  toast.textContent = cleanText(message);
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 2400);
}
