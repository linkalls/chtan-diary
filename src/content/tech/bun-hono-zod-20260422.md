---
title: "Bun + Hono + Zodで最速かつ型安全なAPIサーバーを構築する"
date: "2026-04-22T17:03:00+09:00"
tags: ["Bun", "Hono", "Zod", "TypeScript"]
---

最近はバックエンドの構築において、BunとHonoの組み合わせがデファクトスタンダードになりつつありますね。今回は、そこにスキーマバリデーションライブラリのZodを組み合わせることで、**「圧倒的な速度」と「堅牢な型安全」**を両立させたAPIサーバーを構築する手法について深掘りしていきます。

## なぜBun + Hono + Zodなのか？

Node.jsの時代から、ExpressやFastifyといった素晴らしいフレームワークがありました。しかし、Bunの登場によりJavaScript/TypeScriptランタイムのパフォーマンス基準は大きく跳ね上がりました。

HonoはEdge（Cloudflare Workers等）やNode.js、Bunなどあらゆる環境で動く超軽量・高速なWebフレームワークです。これにZodを組み合わせることで、リクエストのバリデーションを簡潔に記述しつつ、TypeScriptの型推論を最大限に活かすことができます。

### Zodによるスキーマ定義の強力さ

TypeScriptを使っていると、「実行時の型」が保証されない問題に必ず直面します。APIで受け取るJSONペイロードは、コンパイル時にはどんな型か分かりません。

Zodを使えば、実行時のバリデーションと型定義を一度に行うことができます。

```typescript
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';

const app = new Hono();

// バリデーションスキーマの定義
const userSchema = z.object({
  name: z.string().min(1, "名前は必須です"),
  age: z.number().int().positive("年齢は正の整数である必要があります"),
  email: z.string().email("無効なメールアドレスです").optional(),
});

// ZodスキーマからTypeScriptの型を抽出
type User = z.infer<typeof userSchema>;
```

## Honoの `zValidator` ミドルウェアを活用する

Honoには公式で `@hono/zod-validator` が提供されており、これを使うとミドルウェアとして簡単にバリデーションを組み込めます。

```typescript
app.post(
  '/api/users',
  zValidator('json', userSchema, (result, c) => {
    if (!result.success) {
      return c.json({ error: result.error.format() }, 400);
    }
  }),
  (c) => {
    // ここに到達した時点で、req.valid('json') は完全に型推論されている
    const data = c.req.valid('json');
    
    // data.name や data.age が安全に使える
    console.log(`登録ユーザー: ${data.name} (${data.age}歳)`);
    
    return c.json({
      message: 'ユーザーが正常に作成されました',
      user: data,
    }, 201);
  }
);
```

### 実際の検証ログ

ローカルでBunを使って実行し、わざと不正なリクエストを送ってみた結果です。

```bash
# 不正な年齢（マイナス値）を送る
$ curl -X POST http://localhost:3000/api/users \
  -H "Content-Type: application/json" \
  -d '{"name": "Poteto", "age": -5}'

# レスポンス
{"error":{"_errors":[],"age":{"_errors":["年齢は正の整数である必要があります"]}}}
```

見事にZodのバリデーションが弾いてくれていますね。バリデーションエラー時の処理も `zValidator` 側でまとめて記述できるため、ルーティングのコールバック内は非常にスッキリします。

## 開発体験（DX）の向上

この構成の最大のメリットは、**「コードを書いている最中の安心感」**です。

1. `userSchema` を変更すれば、自動的に `type User` も更新される。
2. Honoのハンドラ内で `c.req.valid('json')` を呼ぶと、即座に型が適用される。
3. もし `data.name` をタイポして `data.nam` と書けば、TypeScriptコンパイラが怒ってくれる。

このフィードバックループの速さと正確さは、一度味わうと元には戻れません。

## まとめ

Bunの圧倒的な実行速度、Honoの軽量さと使いやすさ、そしてZodによる堅牢な型安全。これらを組み合わせることで、モダンで快適なバックエンド開発が可能になります。

TypeScriptで `any` を許さない厳格なプロジェクトにおいて、Zodは必須のツールと言えるでしょう。皆さんもぜひ、次のプロジェクトで **Bun + Hono + Zod** のスタックを試してみてください。最高に気持ちよくコードが書けるはずです！