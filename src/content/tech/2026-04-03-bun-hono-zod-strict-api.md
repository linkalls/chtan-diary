---
title: "BunとHonoで構築する堅牢なエッジAPI：Zodを使った厳格なバリデーション実践"
description: "anyを許さない！BunとHono、そしてZodを組み合わせて、型安全で爆速なエッジAPIを構築する手順と検証結果をまとめました。"
date: 2026-04-04
tags: ["Bun", "Hono", "TypeScript", "Zod", "API"]
---

## 序論：エッジでのバリデーションの重要性

最近、BunとHonoの組み合わせでエッジAPIを構築することが多いのですが、やはり「型安全」は譲れないポイントです。TypeScriptを使っている以上、どこから入ってくるかわからないリクエストデータに対して `any` や `unknown` をそのまま放置するのは、精神衛生上非常によくありません。「TypeScriptで `any` は絶対許さない」という強い意志のもと、今回はZodを使った厳格なバリデーションをHonoに組み込む実践的な手法をまとめました。

APIのエンドポイントにおいて、入力値の検証はセキュリティとビジネスロジックの堅牢性を担保する最前線です。Honoは軽量で高速なルーターですが、Zodなどのバリデーションライブラリと組み合わせることで、開発体験（DX）を損なうことなく、極めて安全なAPIサーバーを構築できます。

## 実行環境のセットアップ

まずは、Bunを使ってサクッとプロジェクトを立ち上げます。最近のBunは本当に起動が早く、ストレスフリーで開発を始められるのが最高ですね。

```bash
$ bun create hono my-hono-zod-api
$ cd my-hono-zod-api
$ bun add hono zod @hono/zod-validator
```

上記のコマンドで、Honoの基本的なテンプレートが展開され、必要なパッケージがインストールされます。 `@hono/zod-validator` は、HonoのミドルウェアとしてZodを簡単に統合するための公式パッケージです。

## Zodスキーマの定義とルーターへの適用

次に、エンドポイントで受け取るデータのスキーマをZodで定義します。ここでは、ユーザー登録APIを想定し、名前、メールアドレス、年齢を受け取るスキーマを作成します。

```typescript
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'

const app = new Hono()

// Zodでスキーマを厳格に定義
const userSchema = z.object({
  name: z.string().min(1, "名前は必須です"),
  email: z.string().email("無効なメールアドレス形式です"),
  age: z.number().min(18, "18歳以上である必要があります")
})

app.post(
  '/api/users',
  zValidator('json', userSchema, (result, c) => {
    if (!result.success) {
      return c.json({ error: result.error.issues }, 400)
    }
  }),
  (c) => {
    // ここに到達した時点で、dataは完全に型付けされている！
    const data = c.req.valid('json')
    
    // DB保存などの処理...
    console.log("登録されたユーザー:", data.name)
    
    return c.json({
      message: "ユーザーが正常に作成されました",
      user: data
    }, 201)
  }
)

export default app
```

このコードの美しいところは、ミドルウェア層でバリデーションが完結しており、メインのハンドラーでは `c.req.valid('json')` を呼ぶだけで、すでに推論された完全な型を持つオブジェクトを取得できる点です。

## 実際の実行結果とエラー検証

実際にこのAPIを立ち上げて、いくつかのリクエストを送信して検証してみましょう。まずは正常なリクエストです。

```bash
$ curl -X POST http://localhost:3000/api/users \
  -H "Content-Type: application/json" \
  -d '{"name": "Poteto", "email": "poteto@example.com", "age": 25}'

# レスポンス
{"message":"ユーザーが正常に作成されました","user":{"name":"Poteto","email":"poteto@example.com","age":25}}
```

完璧ですね。意図した通りのレスポンスが返ってきます。次に、わざと不正なデータ（年齢が18歳未満、メールアドレスが不正）を送ってみます。

```bash
$ curl -X POST http://localhost:3000/api/users \
  -H "Content-Type: application/json" \
  -d '{"name": "", "email": "not-an-email", "age": 15}'

# レスポンス
{
  "error": [
    {
      "code": "too_small",
      "minimum": 1,
      "type": "string",
      "inclusive": true,
      "exact": false,
      "message": "名前は必須です",
      "path": ["name"]
    },
    {
      "validation": "email",
      "code": "invalid_string",
      "message": "無効なメールアドレス形式です",
      "path": ["email"]
    },
    {
      "code": "too_small",
      "minimum": 18,
      "type": "number",
      "inclusive": true,
      "exact": false,
      "message": "18歳以上である必要があります",
      "path": ["age"]
    }
  ]
}
```

Zodがすべてのエラーを正確にキャッチし、定義したカスタムエラーメッセージと共に詳細な情報を返してくれました。これにより、フロントエンド側でもどのフィールドがなぜエラーになったのかを容易に把握できます。

## 結論と今後の展望

Bun + Hono + Zodの組み合わせは、開発スピードと堅牢性を両立させる上で、現時点で最強のスタックの一つだと確信しています。特にエッジ環境での動作を前提とした場合、この軽量さと型安全性の恩恵は計り知れません。

実行速度のベンチマークも以前計測しましたが、Node.js環境と比較してもBunのルーター処理は圧倒的でした。今後は、このスタックに加えてCloudflare D1などのエッジデータベースを組み合わせた完全なフルスタック構成でのパフォーマンス検証も進めていきたいと思います。

「anyを許さない」という哲学は、最初は少し窮屈に感じるかもしれませんが、結果としてバグを未然に防ぎ、長期的なメンテナンス性を劇的に向上させます。ぜひ皆さんも、Zodを使った厳格なAPI構築を試してみてください。
