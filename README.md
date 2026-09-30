# my-tools

自作ツールをスマホから使うための公開ハブ（GitHub Pages）。

- 公開URL: https://h0921562.github.io/my-tools/
- 収録ツール:
  - **名刺管理**（`docs/meishi/`）— 名刺の登録・画像添付・検索・タグ・書き出し/読み込み。画像からのOCR自動入力（ブラウザ内OCR＝Google設定不要／Google連携時は高精度OCR）に対応。データは各端末のブラウザ内(IndexedDB)、任意で自分のGoogle(スプレッドシート/Drive)に同期。
  - **請求書作成**（`docs/seikyusho/`）— 請求書を発行するランチャー。本体はGoogle Apps Scriptのウェブアプリ側にあり、ここに置くのは接続先URLを端末に覚えさせて開くだけの入口。品目名から税率(8%/10%)を自動判定、PDFはDriveへ、履歴は台帳シートへ。
  - **AIタスク**（`docs/tasks/`）— Claude（Claude Code）とCodexに頼むタスクを一か所で管理。「GitHubで実行」でタスクをIssue化して `@claude` / `@codex` に依頼し、画面内のやりとり欄から追加の指示を送ったり、進み具合・結果コメント・PRを確認してマージまでできる。担当・状態（やること/実行中/確認待ち/完了）・リポジトリ・タグで整理。データは端末のブラウザ内(localStorage)、JSONで書き出し/読み込み。 PCでは左に操作パネル、中央に状態ごとのボード（一覧表示にも切替）、広い画面ではやりとりを右側パネルで表示。キーボード操作: N=新規、/=検索、Esc=閉じる、⌘/Ctrl+Enter=送信。
    - 仕組み: 対象リポジトリの GitHub Actions（`.github/workflows/claude.yml` = anthropics/claude-code-action、`codex.yml` = openai/codex-action）がIssueコメントの `@claude` / `/codex` に反応して作業する。ワークフローは画面の「GitHub設定」から対象リポジトリへ入れられる（原本は `docs/tasks/workflows/`）。
    - 複数アカウント: 個人用・仕事用など複数のGitHubアカウント（トークン）を登録でき、タスクごとに使うアカウントを自動（リポジトリの持ち主やOrganizationから判定）または手動で選ぶ。アカウントで絞り込み、開いたときに自動で（3分おき）全アカウントから既存のタスクを取り込む: @claude / @codex 宛てのIssueと、Claude Code（`claude/…`）・Codex（`codex/…`）のブランチから出たPR（未完了すべて＋30日以内に更新されたもの）。PRタスクのやりとり画面から @claude / /codex で続きを頼める。Claude / OpenAI のアカウントはリポジトリごとのシークレットで使い分け。
    - プロジェクト: タスクをプロジェクト単位で整理（色・リポジトリ・アカウント・既定の担当/モデル・毎回の依頼に添える「前提」を設定）。既存タスクはリポジトリごとに自動でプロジェクト化。
    - モデル選択: タスク・プロジェクト・追加の指示ごとにモデルを選べる（Claude: Opus 5.5 / Sonnet 5.5 / Haiku 4.5 / Fable 5.1、Codex: 任意のモデル名＋推論の強さ）。本文末尾の `<!-- ai-model: ... -->` をワークフローが読み取り、Claude は `--model`、Codex は `model` / `effort` に渡す。
    - ダッシュボード: 進み具合・未回答の質問・確認待ち・失敗・AIの実行回数/成功率/実行時間（GitHub Actions、直近7日）をタイル表示。AIからの質問にその場で返信、失敗はワンタップで再実行。タスク表には「次のアクション」（返答待ち／PRを確認など）を表示。スマホでも切替可。
    - Codexの実行先: 「GitHub Actions」（codex.yml）か「Codex本体」（ChatGPTのCodexクラウド・公式GitHub連携。作業は chatgpt.com/codex にも出る）を設定で選べる。GitHub Actions では `/codex`、本体では `@codex` で呼ぶので二重に動かない（公式のCodex連携アプリは `@codex` に反応するため）。
    - 準備: 画面の「GitHub設定」だけで完結。①権限入りのトークン作成画面を開いて発行→貼る ②「リポジトリのセットアップ」で状況を確認し、ワークフロー導入・Claude/OpenAIのキー登録（ブラウザ内で暗号化してGitHubのシークレットに保存）・動作テストまでその場で行える。暗号化は `docs/tasks/vendor/sealedbox.js`（tweetnacl + blakejs、libsodium の crypto_box_seal 互換）。
  - **電子契約**（外部サービス）— SecretBase電子契約の管理画面への入口。署名リンク発行、オンライン押印、締結済みPDFとタイムスタンプの保管に対応。

公開しているのはアプリのHTML/アイコンのみ。名刺データや認証情報（Apps ScriptのURL等）は含みません。

サイト実体は `docs/` 配下。GitHub Pages の「Deploy from a branch」で `main` / `/docs` を配信元にすると公開されます（push で自動更新）。
