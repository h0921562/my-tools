# my-tools

自作ツールをスマホから使うための公開ハブ（GitHub Pages）。

- 公開URL: https://h0921562.github.io/my-tools/
- 収録ツール:
  - **名刺管理**（`docs/meishi/`）— 名刺の登録・画像添付・検索・タグ・書き出し/読み込み。画像からのOCR自動入力（ブラウザ内OCR＝Google設定不要／Google連携時は高精度OCR）に対応。データは各端末のブラウザ内(IndexedDB)、任意で自分のGoogle(スプレッドシート/Drive)に同期。
  - **請求書作成**（`docs/seikyusho/`）— 請求書を発行するランチャー。本体はGoogle Apps Scriptのウェブアプリ側にあり、ここに置くのは接続先URLを端末に覚えさせて開くだけの入口。品目名から税率(8%/10%)を自動判定、PDFはDriveへ、履歴は台帳シートへ。
  - **AIタスク**（`docs/tasks/`）— Claude（Claude Code）とCodexに頼むタスクを一か所で管理。「GitHubで実行」でタスクをIssue化して `@claude` / `@codex` に依頼し、画面内のやりとり欄から追加の指示を送ったり、進み具合・結果コメント・PRを確認してマージまでできる。担当・状態（やること/実行中/確認待ち/完了）・リポジトリ・タグで整理。データは端末のブラウザ内(localStorage)、JSONで書き出し/読み込み。
    - 仕組み: 対象リポジトリの GitHub Actions（`.github/workflows/claude.yml` = anthropics/claude-code-action、`codex.yml` = openai/codex-action）がIssueコメントの `@claude` / `/codex` に反応して作業する。ワークフローは画面の「GitHub設定」から対象リポジトリへ入れられる（原本は `docs/tasks/workflows/`）。
    - 複数アカウント: 個人用・仕事用など複数のGitHubアカウント（トークン）を登録でき、タスクごとに使うアカウントを自動（リポジトリの持ち主やOrganizationから判定）または手動で選ぶ。アカウントで絞り込み、「GitHubから取り込み」で全アカウントの @claude / @codex 宛てIssueを一覧に集約。Claude / OpenAI のアカウントはリポジトリごとのシークレットで使い分け。
    - Codexの実行先: 「GitHub Actions」（codex.yml）か「Codex本体」（ChatGPTのCodexクラウド・公式GitHub連携。作業は chatgpt.com/codex にも出る）を設定で選べる。GitHub Actions では `/codex`、本体では `@codex` で呼ぶので二重に動かない（公式のCodex連携アプリは `@codex` に反応するため）。
    - 準備: 画面の「GitHub設定」だけで完結。①権限入りのトークン作成画面を開いて発行→貼る ②「リポジトリのセットアップ」で状況を確認し、ワークフロー導入・Claude/OpenAIのキー登録（ブラウザ内で暗号化してGitHubのシークレットに保存）・動作テストまでその場で行える。暗号化は `docs/tasks/vendor/sealedbox.js`（tweetnacl + blakejs、libsodium の crypto_box_seal 互換）。
  - **電子契約**（外部サービス）— SecretBase電子契約の管理画面への入口。署名リンク発行、オンライン押印、締結済みPDFとタイムスタンプの保管に対応。

公開しているのはアプリのHTML/アイコンのみ。名刺データや認証情報（Apps ScriptのURL等）は含みません。

サイト実体は `docs/` 配下。GitHub Pages の「Deploy from a branch」で `main` / `/docs` を配信元にすると公開されます（push で自動更新）。
