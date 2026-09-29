# my-tools

自作ツールをスマホから使うための公開ハブ（GitHub Pages）。

- 公開URL: https://h0921562.github.io/my-tools/
- 収録ツール:
  - **名刺管理**（`docs/meishi/`）— 名刺の登録・画像添付・検索・タグ・書き出し/読み込み。画像からのOCR自動入力（ブラウザ内OCR＝Google設定不要／Google連携時は高精度OCR）に対応。データは各端末のブラウザ内(IndexedDB)、任意で自分のGoogle(スプレッドシート/Drive)に同期。
  - **請求書作成**（`docs/seikyusho/`）— 請求書を発行するランチャー。本体はGoogle Apps Scriptのウェブアプリ側にあり、ここに置くのは接続先URLを端末に覚えさせて開くだけの入口。品目名から税率(8%/10%)を自動判定、PDFはDriveへ、履歴は台帳シートへ。
  - **AIタスク**（`docs/tasks/`）— Claude（Claude Code）とCodexに頼むタスクを一か所で管理。「GitHubで実行」でタスクをIssue化して `@claude` / `@codex` に依頼し、画面内のやりとり欄から追加の指示を送ったり、進み具合・結果コメント・PRを確認してマージまでできる。担当・状態（やること/実行中/確認待ち/完了）・リポジトリ・タグで整理。データは端末のブラウザ内(localStorage)、JSONで書き出し/読み込み。
    - 仕組み: 対象リポジトリの GitHub Actions（`.github/workflows/claude.yml` = anthropics/claude-code-action、`codex.yml` = openai/codex-action）がIssueコメントの `@claude` / `@codex` に反応して作業する。ワークフローは画面の「GitHub設定」から対象リポジトリへ入れられる（原本は `docs/tasks/workflows/`）。
    - 準備: Fine-grained トークン（Issues・Pull requests・Contents・Workflows を Read and write、Actions を Read）を画面で登録。リポジトリのシークレットに `CLAUDE_CODE_OAUTH_TOKEN`（または `ANTHROPIC_API_KEY`）と `OPENAI_API_KEY` を登録。
  - **電子契約**（外部サービス）— SecretBase電子契約の管理画面への入口。署名リンク発行、オンライン押印、締結済みPDFとタイムスタンプの保管に対応。

公開しているのはアプリのHTML/アイコンのみ。名刺データや認証情報（Apps ScriptのURL等）は含みません。

サイト実体は `docs/` 配下。GitHub Pages の「Deploy from a branch」で `main` / `/docs` を配信元にすると公開されます（push で自動更新）。
