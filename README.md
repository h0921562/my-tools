# my-tools

自作ツールをスマホから使うための公開ハブ（GitHub Pages）。

- 公開URL: https://h0921562.github.io/my-tools/
- 収録ツール:
  - **名刺管理**（`site/meishi/`）— 名刺の登録・画像添付・検索・タグ・書き出し/読み込み。画像からのOCR自動入力（ブラウザ内OCR＝Google設定不要／Google連携時は高精度OCR）に対応。データは各端末のブラウザ内(IndexedDB)、任意で自分のGoogle(スプレッドシート/Drive)に同期。

公開しているのはアプリのHTML/アイコンのみ。名刺データや認証情報（Apps ScriptのURL等）は含みません。

サイト実体は `site/` 配下。`.github/workflows/deploy-pages.yml` が push 時に GitHub Pages へ自動デプロイします。
