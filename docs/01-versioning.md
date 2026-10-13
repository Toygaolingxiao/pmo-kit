# バージョン管理規約 (Versioning Policy)

本プロジェクト（`pmo-kit`）は、**Semantic Versioning 2.0.0 (SemVer)** に準拠してバージョンを管理します。

---

## 1. バージョン形式

```
MAJOR.MINOR.PATCH
例: 1.0.0
```

- **MAJOR (主バージョン)**: 互換性のない大きな仕様変更、データ構造（`project-plan.json` / Excel スキーマ）の破壊的変更
- **MINOR (機能バージョン)**: 後方互換性のある新機能の追加（新規ガントチャート機能、カレンダー連携、新しいUIモジュールなど）
- **PATCH (修正バージョン)**: 後方互換性のあるバグ修正、UI微調整、パフォーマンス改善、軽微なリファクタリング

---

## 2. 正本（Single Source of Truth）管理

1. **`VERSION` ファイル**:
   - プロジェクトルート直下の `VERSION` ファイルが最上位のバージョン正本です。
2. **`package.json`**:
   - `package.json` 内の `"version"` フィールドは常に `VERSION` ファイルと完全一致させます。
3. **Web UI / Baseline**:
   - Web アプリケーション上の表示（`#appVersion`, `#baseline`）および計画データの `meta.baseline` は `VERSION` に準拠して連携します。
4. **変更履歴の更新**:
   - バージョン変更時は `docs/10-changelog.md` に発版日、変更内容（Added, Changed, Fixed, Removed）を記録します。

---

## 3. バージョンアップ手順

```bash
# 1. VERSION ファイルの更新（例: 1.0.0 → 1.1.0）
echo "1.1.0" > VERSION

# 2. package.json の version フィールドを同期
npm version 1.1.0 --no-git-tag-version

# 3. docs/10-changelog.md に更新内容を追記

# 4. Git コミットとプッシュ
git add VERSION package.json docs/10-changelog.md
git commit -m "release: v1.1.0 [概要]"
```

---

## 4. プロダクトクレジット

- **プロダクト名**: `pmo-kit`
- **デザイン＆エンジニアリング**: `A TAKAE PRODUCTION`
- **プロジェクトオーナー**: `GAO` (`Toygaolingxiao`)
