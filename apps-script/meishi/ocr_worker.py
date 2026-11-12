#!/usr/bin/env python3
"""名刺の精読ワーカー（GitHub Actions で実行）。

保存先（Apps Script）から名刺画像を受け取り、Claude CLI（Opus）で各項目を読み取って結果を返す。

⚠ このリポジトリは公開なので Actions のログも誰でも見られる。
  名刺の内容（氏名・電話番号など）は絶対にログへ出さないこと。出すのは成否だけ。

環境変数:
  JOB_ID                  … 処理するジョブ（UUID）
  MEISHI_API_URL          … 保存先のウェブアプリURL（ワークフローに直書き）
  MEISHI_API_TOKEN        … 保存先の合鍵（secret）
  CLAUDE_CODE_OAUTH_TOKEN … Claude CLI のログイン情報（secret、`claude setup-token` で作る）
"""
import base64
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.request

FIELDS = ["name", "kana", "company", "companyKana", "title", "phone", "email", "address", "website"]

PROMPT = """名刺画像 {path} を Read ツールで読み、次のキーだけを持つ JSON を1つだけ出力してください。説明文は不要です。

- name: 氏名（姓と名の間に半角スペース。英語名は表記どおり）
- kana: 氏名のふりがな（ひらがな、姓と名の間に半角スペース）。名刺に印字があればそれを使い、なければ一般的な読み方を考えて書く。英語名はカタカナ
- company: 会社・団体名（法人格も表記どおり）
- companyKana: 会社名のふりがな（ひらがな、「株式会社」などの法人格は除く）。印字があればそれを使い、なければ読み方を考えて書く。英字の社名はカタカナ
- title: 部署と役職（例: 営業部 部長）
- phone: 電話番号を1つ（携帯があれば携帯を優先、ハイフン区切り）
- email: メールアドレス
- address: 住所（郵便番号があれば先頭に「〒123-4567 」の形で）
- website: Webサイトの URL

kana・companyKana 以外で、読めない・載っていない項目は空文字にしてください（推測で埋めない）。"""


DOC_FIELDS = ["company", "title", "summary", "person"]

DOC_PROMPT = """資料ファイル {path} を Read ツールで読み、次のキーだけを持つ JSON を1つだけ出力してください。説明文は不要です。

- company: この資料を出している会社・団体の正式名（ロゴ・奥付・会社概要・URL などから判断。法人格も含める）。判断できなければ空文字
- title: 資料の内容が分かる短い名前（20文字以内。例: 「〇〇サービス紹介」「2026年 製品カタログ」）
- summary: 資料の要点を日本語で1〜2文（80文字以内）
- person: 資料に担当者名が書かれていればその氏名。なければ空文字"""


def api(payload):
    payload = dict(payload, token=os.environ["MEISHI_API_TOKEN"])
    req = urllib.request.Request(
        os.environ["MEISHI_API_URL"],
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "text/plain"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as r:  # Apps Script はリダイレクト先で応答を返す
        data = json.loads(r.read().decode())
    if not data.get("ok"):
        raise RuntimeError("保存先がエラーを返しました")
    return data


def run_claude(img_path, kind="card"):
    prompt, fields = (DOC_PROMPT, DOC_FIELDS) if kind == "doc" else (PROMPT, FIELDS)
    out = subprocess.run(
        ["claude", "-p", prompt.format(path=img_path),
         "--model", "opus",
         "--allowedTools", "Read",
         "--output-format", "json",
         "--max-turns", "6"],
        capture_output=True, text=True, timeout=300,
    )
    if out.returncode != 0:
        raise RuntimeError(f"Claude CLI が失敗しました（終了コード {out.returncode}）")
    result = json.loads(out.stdout).get("result", "")
    m = re.search(r"\{.*\}", result, re.S)
    if not m:
        raise RuntimeError("Claude の出力に JSON がありません")
    raw = json.loads(m.group(0))
    return {k: str(raw.get(k) or "").strip() for k in fields if str(raw.get(k) or "").strip()}


def main():
    job = os.environ.get("JOB_ID", "")
    if not re.fullmatch(r"[0-9a-fA-F-]{36}", job):
        print("不正なジョブIDです")
        return 1
    try:
        data = api({"action": "ocrJob", "id": job})
        kind = data.get("kind", "card")
        m = re.match(r"data:([a-z]+)/([a-z0-9.+-]+);base64,(.*)$", data["dataUrl"], re.S)
        if not m:
            raise RuntimeError("ファイルの形式が不正です")
        ext = "pdf" if m.group(2) == "pdf" else ("png" if m.group(2) == "png" else "jpg")
        # Claude CLI が追加の許可なしで読めるよう、作業フォルダの中に置く
        with tempfile.TemporaryDirectory(dir=os.getcwd()) as d:
            path = os.path.join(d, f"card.{ext}")
            with open(path, "wb") as f:
                f.write(base64.b64decode(m.group(3)))
            fields = run_claude(path, kind)
        api({"action": "ocrResult", "id": job, "fields": fields})
        print(f"完了（{len(fields)} 項目）")  # 項目数だけ。中身は出さない
        return 0
    except Exception as e:  # noqa: BLE001
        msg = type(e).__name__ if not isinstance(e, RuntimeError) else str(e)
        try:
            api({"action": "ocrResult", "id": job, "error": msg})
        except Exception:  # noqa: BLE001
            pass
        print("失敗: " + msg)
        return 1


if __name__ == "__main__":
    sys.exit(main())
