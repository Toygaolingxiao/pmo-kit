/**
 * 変更履歴・RAID管理モジュール
 */

import { $, $$, cleanText, STATUS_LABELS, RAID_TYPE_LABELS } from "../utils.js";

/**
 * 変更履歴リストのレンダリング
 */
export function renderHistoryList(changeLog) {
  const container = $("#historyList");
  if (!container) return;
  const history = changeLog || [];
  if (!history.length) {
    container.innerHTML = '<div class="empty-state">変更履歴はまだありません。</div>';
    return;
  }

  container.innerHTML = `
    <div class="history-header">
      <span>版</span>
      <span>更新日</span>
      <span>更新者</span>
      <span>更新内容</span>
    </div>
    ${history.map((item) => `
      <div class="history-row">
        <strong>${cleanText(item.version)}</strong>
        <span>${item.date || item.updatedAt || "-"}</span>
        <span>${cleanText(item.author || item.updatedBy || "-")}</span>
        <span>${cleanText(item.note || item.content || "-")}</span>
      </div>
    `).join("")}
  `;
}

/**
 * サンプル階層ツリーのレンダリング
 */
export function renderSampleTree() {
  const container = $("#sampleTree");
  if (!container) return;
  const groups = ["プロジェクト管理", "要件定義", "設計", "製造・構築", "テスト", "導入・移行", "運用・保守"];
  container.innerHTML = groups.map((name, index) => `
    <div class="sample-row">
      <span>${index + 1}</span>
      <strong>${name}</strong>
      <span>標準タスクを含む</span>
    </div>
  `).join("");
}

/**
 * RAID（リスク・課題・前提・依存）カードのレンダリング
 */
export function renderRaidCards(raidList) {
  const container = $("#raidGrid");
  if (!container) return;
  const list = raidList || [];
  if (!list.length) {
    container.innerHTML = '<div class="empty-state">管理項目はまだ登録されていません。</div>';
    return;
  }

  container.innerHTML = list.map((item) => `
    <article class="raid-card">
      <header>
        <span class="raid-type">${RAID_TYPE_LABELS[item.type] || item.type}</span>
        <span class="wbs-status">${STATUS_LABELS[item.status] || item.status}</span>
      </header>
      <h3>${cleanText(item.title)}</h3>
      <p>${cleanText(item.response)}</p>
      <div class="raid-meta">
        <span>担当: ${cleanText(item.owner)}</span>
        <span>影響度 ${cleanText(item.impact)} / 発生確率 ${cleanText(item.likelihood)}</span>
      </div>
    </article>
  `).join("");
}
