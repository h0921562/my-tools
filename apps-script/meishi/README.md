# 名刺管理 — Apps Script 版（許可したGoogleアカウントだけが使えるウェブアプリ）

許可したGoogleアカウント（個人用・仕事用など複数可）だけが開けるURLで名刺管理を使うための設定です。
どの端末で開いても同じ名刺一覧が表示されます（開いたとき・画面に戻ったときに自動で取り込みます）。

- 画面: GitHub Pages の `docs/meishi/index.html` をそのまま配信します。アプリを更新すると Apps Script 版にも反映されます（最大10分）。
- データ: 1つのスプレッドシートと画像フォルダにまとめ、許可したアカウント全員に共有します。どのアカウントで開いても同じ一覧です。
  - スプレッドシート「名刺管理データ」に、名刺1枚を1行で保存します。
  - フォルダ「名刺管理_画像」に、名刺画像を保存します。
- 開いた人のアカウントで動きます。許可していないアカウントでは「使えません」と表示され、データにも触れません。
- 許可するアカウントは `Config.gs` に書きます（メールアドレスを公開しないため Git には入れず、Apps Script 側にだけ置きます。書式は `Config.example.gs`）。アカウントを足したら、エディタで `setup` を実行すると共有がやり直されます。

## 設置済みの環境

- ウェブアプリ: https://script.google.com/macros/s/AKfycbyh9pvOsy-jnVvV2U37hXNgWq55Ye7AJtZqkO8x8oHqcleuLXLzHLEjOTb58SjmjsagJw/exec
- スクリプト: https://script.google.com/d/17OJOIqo3sSbZpJ5NkGJSWt4b39qFWZ7tB4Nfcdrp1NELT5-RXbdEb6bH/edit
- `Code.gs` を変えたときは、このフォルダに `Config.gs` を置いて次を実行すると、同じURLのまま更新されます（要 `clasp login`）。

```
clasp push -f
clasp update-deployment AKfycbyh9pvOsy-jnVvV2U37hXNgWq55Ye7AJtZqkO8x8oHqcleuLXLzHLEjOTb58SjmjsagJw -d "更新内容"
```

画面（`docs/meishi/index.html`）だけの変更なら、GitHub Pages に反映されれば自動で届くので、再デプロイは要りません。

## 手で設置する場合（PCで約5分）

1. https://script.google.com を開き、「新しいプロジェクト」を作ります。名前は「名刺管理」などにします。
2. 左の「サービス ＋」から **Drive API** を追加します。OCR（画像から読み取り）に使います。
3. 左の ⚙「プロジェクトの設定」で「appsscript.json マニフェスト ファイルをエディタで表示する」をオンにします。
   エディタに出てきた `appsscript.json` の中身を、このフォルダの `appsscript.json` で置き換えます。
4. `コード.gs` の中身をすべて消して、このフォルダの `Code.gs` を貼り付け、保存します。
5. 関数のプルダウンで `setup` を選んで「実行」します。
   権限の許可画面が出るので、自分のアカウントで許可します。
   「このアプリは Google で確認されていません」と出たら、「詳細」→「名刺管理（安全ではないページ）に移動」を押します。自分で作ったスクリプトなので問題ありません。
6. 「＋」→「スクリプト」で `Config` を作り、`Config.example.gs` を参考に使うアカウントを書きます。
7. 右上の「デプロイ」→「新しいデプロイ」→ 種類「ウェブアプリ」を選び、次のとおり設定します。
   - 次のユーザーとして実行: **ウェブアプリにアクセスしているユーザー**
   - アクセスできるユーザー: **Google アカウントを持つ全員**（実際に使えるのは Config.gs の人だけ）
8. 「デプロイ」を押すと、`https://script.google.com/macros/s/…/exec` のURLが出ます。これが名刺管理のURLです。各アカウントで最初に開いたときに、権限の許可画面が出ます。
   スマホでは、Safari や Chrome で開いて「ホーム画面に追加」しておくと便利です。

## 今までのデータを移す

github.io 版に名刺がある場合は、次の手順で移します。

1. 今までの画面で ☰ →「バックアップを書き出し」を押します。
2. Apps Script 版の画面で ☰ →「バックアップから読み込み」を押します。
3. ☁ の「同期」を押すと、Google ドライブに保存されます。

## 補足

- github.io のURLは今までどおり使えますが、そちらはデータが端末内だけに保存されます。
- アプリを更新してすぐ反映したいときは、エディタで `clearPageCache` を実行します。
- まだマージしていないブランチで試したいときは、⚙「プロジェクトの設定」→「スクリプト プロパティ」に
  `PAGE_URL` を追加して、プレビューのURLを入れます。
  例: `https://raw.githack.com/h0921562/my-tools/meishi-brushup/docs/meishi/index.html`
