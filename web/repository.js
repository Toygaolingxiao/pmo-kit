const DEFAULT_KEY = "pmo-kit-wbs-project-v4";
const LEGACY_KEY = "pmo-kit-wbs-draft";
const DEMO_CODES = new Set(["DEMO-001"]);

/**
 * プロジェクト保存先を UI から分離する薄いリポジトリです。
 * 将来 SQLite/API adapter に差し替えても、画面の操作コードは変更しません。
 */
export function createProjectRepository({ storageKey = DEFAULT_KEY, seedUrl = "/examples/development/project-plan.json" } = {}) {
  return {
    load() {
      const saved = localStorage.getItem(storageKey);
      if (!saved) return null;
      try {
        const plan = JSON.parse(saved);
        if (DEMO_CODES.has(plan.meta?.projectCode) || plan.meta?.planStart !== "2026-09-14") {
          localStorage.removeItem(storageKey);
          return null;
        }
        return plan;
      } catch (error) {
        throw new Error(`保存済みプロジェクトを読み込めません: ${error.message}`);
      }
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
