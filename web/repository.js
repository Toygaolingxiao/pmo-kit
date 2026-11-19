const DEFAULT_KEY = "pmo-kit-wbs-project-v4";
const LEGACY_KEY = "pmo-kit-wbs-draft";

/**
 * プロジェクト保存先を UI から分離する薄いリポジトリです。
 * 将来 SQLite/API adapter に差し替えても、画面の操作コードは変更しません。
 *
 * 保存済み計画はユーザーの正本です。内容（開始日・プロジェクトコード等）を
 * 理由に自動削除することはありません。読めないデータは隔離キーへ退避し、
 * 呼び出し側がシードへフォールバックできるよう null を返します。
 */
export function createProjectRepository({ storageKey = DEFAULT_KEY, seedUrl = "/examples/development/project-plan.json" } = {}) {
  const corruptKey = `${storageKey}.corrupt`;

  function quarantine(key, raw) {
    try {
      localStorage.setItem(corruptKey, raw);
    } catch {
      // 退避自体に失敗しても起動は止めない。
    }
    localStorage.removeItem(key);
  }

  function parseSaved(key, raw) {
    try {
      return JSON.parse(raw);
    } catch {
      quarantine(key, raw);
      return null;
    }
  }

  return {
    load() {
      const saved = localStorage.getItem(storageKey);
      if (saved) return parseSaved(storageKey, saved);

      // 旧キーの草稿が残っていれば新キーへ移行する。
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (!legacy) return null;
      const plan = parseSaved(LEGACY_KEY, legacy);
      if (!plan) return null;
      localStorage.setItem(storageKey, legacy);
      localStorage.removeItem(LEGACY_KEY);
      return plan;
    },
    async loadSeed() {
      const response = await fetch(seedUrl);
      if (!response.ok) throw new Error("プロジェクト計画を読み込めません。");
      return response.json();
    },
    save(plan) {
      localStorage.setItem(storageKey, JSON.stringify(plan));
    },
  };
}
