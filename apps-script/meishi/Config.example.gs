// このファイルを Config.gs という名前でコピーし、合鍵を書く（Config.gs は Git に入れない）
// 合鍵は推測されない長いランダムな文字列にする（例: openssl rand -base64 33）
const API_TOKEN = 'ここに長いランダムな文字列';

// （任意）Sales Desk へ自動登録するときの署名用の秘密鍵。対になる公開鍵を Sales Desk の
// MEISHI_PUBLIC_KEY に置く。作り方: openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out sd_private.pem
//   公開鍵: openssl pkey -in sd_private.pem -pubout
// const SD_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n';
