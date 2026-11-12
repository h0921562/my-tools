# 名刺管理 — クラウド保存先（Apps Script）

名刺管理アプリ（`docs/meishi/`）のデータを Google ドライブに保存し、どの端末でも同じ一覧を見られるようにするための保存先です。

- 画面: GitHub Pages のアプリ（https://h0921562.github.io/my-tools/meishi/ ）。
- データ: このスクリプトの持ち主の Google ドライブ。
  - スプレッドシート「名刺管理データ」に、名刺1枚を1行で保存します。
  - フォルダ「名刺管理_画像」に、名刺画像を保存します。
- 読み書きできるのは、合鍵（`Config.gs` の `API_TOKEN`）を知っている端末だけです。
  Googleログイン方式は、スマホで複数アカウントにログインしていると開けなくなる既知の問題があるため使っていません。
- 端末への配り方: アプリのURLに `#cfg=<ウェブアプリのURL>&tok=<合鍵>` を付けたリンクを一度開くと、その端末に設定が保存されます（`#` 以降はサーバーに送られません）。以後はアプリを開くたびに自動で一覧を取り込みます。
- 合鍵入りリンクは実質パスワードです。他人に渡さないでください。漏れたときは合鍵を作り直して再デプロイし、各端末でリンクを開き直します。

## 設置済みの環境

- ウェブアプリ: https://script.google.com/macros/s/AKfycbyh9pvOsy-jnVvV2U37hXNgWq55Ye7AJtZqkO8x8oHqcleuLXLzHLEjOTb58SjmjsagJw/exec
- スクリプト: https://script.google.com/d/17OJOIqo3sSbZpJ5NkGJSWt4b39qFWZ7tB4Nfcdrp1NELT5-RXbdEb6bH/edit
- `Code.gs` を変えたときは、このフォルダに `Config.gs` を置いて次を実行すると、同じURLのまま更新されます（要 `clasp login`）。

```
clasp push -f
clasp update-deployment AKfycbyh9pvOsy-jnVvV2U37hXNgWq55Ye7AJtZqkO8x8oHqcleuLXLzHLEjOTb58SjmjsagJw -d "更新内容"
```

## 手で設置する場合（PCで約5分）

1. https://script.google.com で新しいプロジェクトを作ります。
2. 左の「サービス ＋」から **Drive API** を追加します（OCR用）。
3. ⚙「プロジェクトの設定」で「appsscript.json マニフェスト ファイルをエディタで表示する」をオンにし、`appsscript.json` をこのフォルダのもので置き換えます。
4. `コード.gs` をこのフォルダの `Code.gs` で置き換えます。
5. 「＋」→「スクリプト」で `Config` を作り、`Config.example.gs` を参考に合鍵を書きます。
6. `setup` を実行して権限を許可します。
7. 「デプロイ」→「新しいデプロイ」→「ウェブアプリ」で、次のユーザーとして実行「自分」、アクセスできるユーザー「全員」にしてデプロイします。
8. アプリの ☰ →「クラウド保存の設定」に、ウェブアプリのURLと合鍵を入れます。

## 今までのデータを移す

端末内に名刺がある場合は、合鍵入りリンクを開いた後に ☁「同期」を押すと、クラウドに送られます。
