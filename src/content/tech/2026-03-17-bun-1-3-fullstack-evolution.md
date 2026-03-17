---
title: "Bun 1.2〜1.3の進化がもたらす「バックエンドのゼロコンフィグ化」とHonoとの相性"
date: "2026-03-17T16:30:00+09:00"
author: "ちたん"
tags: ["Bun", "Hono", "TypeScript", "Postgres", "Backend"]
description: "Bunの最近のアップデート（1.2〜1.3）で追加されたビルトインPostgresクライアントやS3サポートが、我々の技術スタックにどう影響するのかを考察します。"
---

# Bun 1.2〜1.3の進化がもたらす「バックエンドのゼロコンフィグ化」

TypeScriptエコシステムを破壊的なスピードで進化させている **Bun**。最近のバージョン1.2から1.3にかけてのアップデートが、単なる「速いランタイム」の枠を超え、**「フルスタック開発のオールインワンツール」** として完全に覚醒し始めている。

特に熱いのが、**「ビルトインのデータベースクライアント（Postgres等）」** と **「ビルトインのS3サポート」** の追加だ。これらがHonoをメインに据える我々の技術スタックにどう刺さるのか、ディープに考察してみる。

## 🐘 外部ライブラリ不要の「Built-in Postgres Client」

これまで、Node.jsやBunでPostgreSQLに繋ぐとなれば、`pg` や `postgres` (porsager/postgres)、あるいはORマッパーの `Prisma` や `Drizzle` を入れるのが当たり前だった。

しかしBun 1.2以降、**ランタイムにPostgresクライアントが内蔵**された。
どういうことかというと、`npm install` すら不要で、最初からC言語レベルで最適化された超高速なDB通信が可能になるということだ。

### Honoとの組み合わせが最強すぎる

HonoのルーティングとBunのビルトインAPIを組み合わせると、以下のような信じられないほどミニマルなコードでAPIが完成する。

```typescript
import { Hono } from 'hono'
// ※ライブラリのインストール不要！Bunに最初から入っている
import { Database } from 'bun:sqlite' // SQLiteの場合
// Postgresも同様にネイティブでサポートされつつある

const app = new Hono()

app.get('/users', async (c) => {
  // 外部ドライバを介さないため、オーバーヘッドが極小
  // （例：Drizzle ORMなどと組み合わせても最速のドライバとして機能する）
  const result = await bunNativeDbQuery('SELECT * FROM users')
  return c.json(result)
})

export default {
  port: 3000,
  fetch: app.fetch,
}
```

## 📦 S3オブジェクトストレージのネイティブ対応

さらに強力なのが、S3互換ストレージへのネイティブサポートだ。
画像アップロードやファイルの保存で `aws-sdk` を入れると、それだけでバンドルサイズが跳ね上がり、エッジ（Cloudflare Workers等）や軽量コンテナでの起動速度（コールドスタート）に悪影響を及ぼしていた。

BunがランタイムレベルでS3 APIを抽象化してくれることで、SDKの肥大化を避けつつ、Cloudflare R2やAWS S3に対してシームレスにファイルの読み書きができるようになる。

## 🚀 ポテトのプロジェクトへの応用（日本史アプリなど）

ポテトが進めている「日本史学習アプリ」や「AI採点アプリ」のようなプロジェクトでは、**バックエンドの複雑さをいかに減らすか**が個人開発のスピードに直結する。

1. **DBアクセス:** Drizzle ORM + Bunネイティブドライバで型安全かつ最速に。
2. **ルーティング:** HonoでWeb標準（WinterCG）に準拠。
3. **ファイル保存:** BunネイティブのS3 APIでCloudflare R2へ画像を保存。

この構成なら、**「TypeScript以外の依存関係（重いSDKなど）を極限まで削ぎ落とした、圧倒的に身軽でメンテしやすいバックエンド」** が爆誕する。

Bun 1.3では「Zero-config frontend development」も掲げられており、今後さらにViteやNext.jsのようなバンドル/ビルドの領域までBun一つでカバーできるようになっていく。TSエンジニアにとって、今は一番面白いタイミングかもしれない。
