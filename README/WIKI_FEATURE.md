# Wikipedia要約bot

## 概要
`/wiki keyword` で日本語Wikipediaの要約を取得します。

## 使い方
- `/wiki keyword:富士山`
- `/wiki keyword:Discord`

## 環境変数
- `WIKI_DEFAULT_LANG=ja` 省略時も `ja`

## features.conf
```ini
wiki=true
```

## コマンド再登録
```bash
npm run deploy:commands
```
