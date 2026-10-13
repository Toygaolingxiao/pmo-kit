# pmo-kit

プロジェクト責任者、PMO、コンサルタント向けの**ローカル優先**プロジェクト作業台です。人が読めて差分を取れる `project-plan.json` 一式で、WBS、進捗、カレンダー、RAID、課題を管理し、会議資料と顧客向け成果物を出力します。

現在のバージョンは **1.1.1** です。Jira や MS Project の代替ではなく、アカウント、クラウド同期、リアルタイム共同編集はありません。

## できること

ブラウザの作業台:

- 階層つき WBS。追加、編集、削除、インデント、複製、列幅調整、インライン編集、元に戻す / やり直す
- 計画バー、実績バー、マイルストーン、依存関係
- 状態日を基準にした稲妻線（進捗折線）
- 日本の祝日と定例会議。Outlook ローカルと Outlook Web へ予定を渡せる
- プロジェクト概要、RAID、変更履歴
- 課題の状態遷移。引き渡し、受領、期日変更の申請、要更新キュー
- JSON の入出力と、簡略化した Excel 往復

コマンドラインで作る成果物:

- `plan.html`。ブラウザで開き、PDF として印刷できる
- `wbs.csv` / `schedule.csv` / `milestones.csv`
- `gantt.mmd`。Mermaid のガントチャート
- `reports/weekly-status-latest.md`。週次ステータスの下書き
- `status-summary.json`。加重進捗と差異の要約

## 含まれないもの

次の機能は後回しにするか、中核の範囲に入れていません。

- アカウント、権限、リアルタイム共同編集、クラウド同期
- 自動スケジューリングエンジン
- 複数プロジェクトのポートフォリオビュー
- 参照 Excel テンプレートのピクセル単位、数式単位の再現
- 標準 WBS テンプレートライブラリ
- JSON Schema（`ajv`）による独立した検証ファイル。実行時の境界検証は `src/domain/project-plan.ts` にあります

`examples/development/project-plan.json` は作業台のサンプル計画です。記載されているタスク状態は画面確認用であり、このリポジトリのリリース完了度を表しません。

## 環境

- Node.js 20 以上
- モダンブラウザ

## はじめに

```bash
npm install
npm run serve
```

ブラウザで [http://localhost:4173/web/](http://localhost:4173/web/) を開きます。初回は開発用サンプル計画を読み込み、その後の編集はこのブラウザの `localStorage` に保存されます。

成果物を生成する:

```bash
npm run render:development
# 出力先は examples/development/out/ 。このディレクトリはコミットしない
```

自分の計画から成果物を作る:

```bash
npm run render -- --in path/to/project-plan.json --out path/to/out
```

フィールドの取り決めは [`schema/project-plan.schema.md`](./schema/project-plan.schema.md) を参照してください。

確認:

```bash
npm test
npm run typecheck
```

## リポジトリ構成

```text
pmo-kit/
├─ web/                 # ブラウザ作業台
├─ src/                 # 計画検証、成果物生成、Excel 往復
├─ schema/              # project-plan のフィールド取り決め
├─ examples/development/# 公開できるサンプル計画
├─ inputs/              # 参照テンプレート。inputs/private/ はローカルのみ
├─ docs/                # バージョン規則、変更履歴、設計説明
├─ server.js            # ローカル静的サーバ
└─ VERSION              # バージョンの正本
```

顧客の計画、個人情報や顧客情報を含む Excel、その他の非公開入力は `inputs/private/` に置きます。このディレクトリは `.gitignore` 済みなので、コミットしないでください。

## 言語

作業台、コマンドラインの表示、ソースコード内のコメントは日本語です。設計文書は主に中国語、変更履歴は日本語です。会話の言語は、リポジトリ内の画面文言には影響しません。

## ライセンス

リポジトリは閲覧と実行ができるよう公開しています。オープンソースライセンスは付与しておらず、再配布や商用利用を許諾していません。利用、改変、再配布が必要な場合は、事前に作者へ確認してください。
