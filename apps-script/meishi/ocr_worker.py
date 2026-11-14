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

FIELDS = ["name", "kana", "company", "companyKana", "title", "phone", "email", "address", "website", "industry", "corners", "text"]

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
- industry: 会社の業態を次から1つ（会社名・役職・ロゴ・URLから判断）: 抹茶・茶葉の生産／卸, カフェ・喫茶, 飲食店・レストラン, 和菓子・洋菓子, 食品・飲料メーカー, 商社・卸売, 小売・EC, ホテル・旅館, 輸出入・海外バイヤー, 歯科医院, 医療・クリニック, 美容・サロン, IT・ソフトウェア, 広告・マーケティング, 士業・コンサル, その他

- corners: 画像の中の名刺（紙そのもの）の四隅の位置。画像は横{w}×縦{h}ピクセルで、左上が0,0。
  名刺の向きに関係なく、画面上の 左上;右上;右下;左下 の順に "x,y;x,y;x,y;x,y" の形で整数で書く。
  机・手・影・背景は含めず、紙の角そのものに合わせる。角が指などで隠れていれば、見えている辺をのばした交点で答える。
  名刺が見つからない・画像がすでに名刺だけでほぼ埋まっているときは空文字。

- text: 名刺に書かれている文字をすべて、上から順に改行で区切って書き起こしたもの（ロゴの文字・英語表記・事業内容も含む。800文字以内）

kana・companyKana・industry・corners・text 以外で、読めない・載っていない項目は空文字にしてください（推測で埋めない）。"""


DOC_FIELDS = ["company", "title", "summary", "person", "kind", "detail"]

DOC_PROMPT = """資料ファイル {path} を Read ツールで読み、次のキーだけを持つ JSON を1つだけ出力してください。説明文は不要です。

- company: この資料を出している会社・団体の正式名（ロゴ・奥付・会社概要・URL などから判断。法人格も含める）。判断できなければ空文字
- title: 資料の内容が分かる短い名前（20文字以内。例: 「〇〇サービス紹介」「2026年 製品カタログ」）
- summary: 資料の要点を日本語で1〜2文（80文字以内）
- person: 資料に担当者名が書かれていればその氏名。なければ空文字
- kind: 資料の種類を次から1つ: 会社案内, 製品カタログ, 価格表・見積, 提案書, 契約・規約, 展示会・イベント資料, チラシ・パンフレット, その他
- detail: 資料の中身から、営業で後から見返すときに役立つ情報を抜き出して整理した文章（1500文字以内）。
  見出しは「■」、項目は「・」で始め、改行で区切る。資料に書かれている見出しだけ使い、書かれていない見出しは出さない。
  ■要点（3〜5行。何の資料で、相手が何を伝えたいか）
  ■会社・事業（事業内容、拠点、規模、取引先、強み）
  ■商品・サービス（商品名ごとに1行。規格・容量・産地・等級など）
  ■価格・取引条件（単価、最低ロット、卸値、送料、支払い条件、納期。金額と単位は資料のまま正確に）
  ■日付・期限（有効期限、開催日、締切）
  ■連絡先（担当者、電話、メール、URL）
  資料にない情報を推測で書かないこと。数字・固有名詞は資料の表記どおりに写すこと"""


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


def image_size(path):
    """JPEG / PNG の幅と高さを返す（読めなければ None）。Opus に座標で答えてもらうために使う"""
    with open(path, "rb") as f:
        data = f.read()
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return int.from_bytes(data[16:20], "big"), int.from_bytes(data[20:24], "big")
    i = 2
    while i < len(data) - 9 and data[:2] == b"\xff\xd8":
        if data[i] != 0xFF:
            i += 1
            continue
        marker = data[i + 1]
        if marker in (0xC0, 0xC1, 0xC2):
            return int.from_bytes(data[i + 7:i + 9], "big"), int.from_bytes(data[i + 5:i + 7], "big")
        i += 2 + int.from_bytes(data[i + 2:i + 4], "big")
    return None


def run_claude(img_path, kind="card", hint=""):
    prompt, fields = (DOC_PROMPT, DOC_FIELDS) if kind == "doc" else (PROMPT, FIELDS)
    if kind == "doc":
        text = prompt.format(path=img_path)
    else:
        size = image_size(img_path) if not img_path.endswith(".pdf") else None
        w, h = size or ("?", "?")
        text = prompt.format(path=img_path, w=w, h=h)
    if kind == "doc" and hint:
        # 利用者が資料を入れるときに書いた補足（どこの会社の資料か など）。資料から分からないことはこれに従う
        text += "\n\n利用者からの補足（資料に書かれていないことは、これを正として使う）:\n" + hint[:500]
    out = subprocess.run(
        ["claude", "-p", text,
         "--model", "opus",
         "--allowedTools", "Read",
         "--output-format", "json",
         "--max-turns", "10" if kind == "doc" else "6"],  # 資料はページが多いことがある
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
            fields = run_claude(path, kind, str(data.get("hint") or ""))
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
