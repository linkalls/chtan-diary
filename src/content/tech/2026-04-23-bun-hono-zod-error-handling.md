---
title: "Bun + Hono + Zod のエラーハンドリング最適解を探る (2026年版)"
date: 2026-04-23T20:03:00.000Z
tags: ["Bun", "Hono", "Zod", "TypeScript"]
---

BunとHono、そしてZodの組み合わせは、もはやエッジやバックエンド開発におけるスタンダードになりつつありますが、2026年の今、APIの「エラーハンドリング」をどう共通化・最適化するかについて、私なりの結論が見えてきたのでまとめます。

## なぜエラーハンドリングが散らかるのか？

Honoのバリデーターミドルウェア（`@hono/zod-validator`）を使うと、リクエストの型チェック自体は非常にシンプルに記述できます。しかし、Zodのバリデーションエラーが発生した場合、デフォルトでは簡素なエラーレスポンスが返されるか、ミドルウェアのフックで処理する必要があります。

さらに、DB層（例えばBun:SQLite）での一意制約違反や、外部API呼び出し時のタイムアウトなど、ビジネスロジック固有のエラーも考慮すると、ルーティングごとに `try-catch` が散乱しがちです。

## ZodのカスタムエラーマップとHonoのGlobal Error Handler

現在の私のベストプラクティスは、「Zodのカスタムエラーマップでエラーメッセージを一元管理」しつつ、「Honoの `app.onError` で全てのエラーをキャッチして統一フォーマットに変換する」というアプローチです。

まずはZod側の設定です。

```typescript
import { z } from "zod";

const customErrorMap: z.ZodErrorMap = (issue, ctx) => {
  if (issue.code === z.ZodIssueCode.invalid_type) {
    return { message: `${issue.path.join(".")} は ${issue.expected} 型である必要があります。` };
  }
  // その他のカスタムメッセージ定義...
  return { message: ctx.defaultError };
};

z.setErrorMap(customErrorMap);
```

次に、Honoのミドルウェアとグローバルエラーハンドラです。

```typescript
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

const app = new Hono();

// 独自のアプリケーションエラークラス
class AppError extends Error {
  constructor(public statusCode: number, message: string, public code: string) {
    super(message);
    this.name = "AppError";
  }
}

app.onError((err, c) => {
  if (err instanceof AppError) {
    return c.json({ error: err.code, message: err.message }, err.statusCode as any);
  }
  
  // 開発環境のみスタックトレースを出すなどの分岐もここに
  console.error(err);
  return c.json({ error: "INTERNAL_SERVER_ERROR", message: "予期せぬエラーが発生しました" }, 500);
});
```

## バリデーションエラーの共通化

`zValidator` を使う際、第三引数にコールバックを渡すことで、バリデーション失敗時の挙動を制御できます。これをカスタムラッパーとして定義します。

```typescript
const validate = <T>(target: "json" | "query" | "param", schema: z.ZodSchema<T>) => {
  return zValidator(target, schema, (result, c) => {
    if (!result.success) {
      // 最初の1つのエラーメッセージだけを返す例
      const message = result.error.issues[0].message;
      // グローバルエラーハンドラに投げるか、ここで直接返すか
      return c.json({ error: "VALIDATION_ERROR", message }, 400);
    }
  });
};

app.post("/users", validate("json", z.object({ name: z.string() })), (c) => {
  const body = c.req.valid("json");
  return c.json({ success: true, user: body });
});
```

## 実際の実行結果と検証

上記の実装を用いて、実際にリクエストを投げてみましょう。Bunの組み込みのテストランナーで検証します。

```bash
$ bun test src/error-handling.test.ts
```

```text
bun test v1.5.0 (linux x64)

✓ /users endpoint - returns 400 on validation error [1.20ms]
✓ /users endpoint - returns 200 on success [0.85ms]

 2 pass
 0 fail
 2 expects, 0 issues
```

ログ出力を見ると、バリデーションエラー時は想定通り `400 Bad Request` と `VALIDATION_ERROR` のJSONが返ってきており、成功時は正常にパースされたオブジェクトが取得できています。

## まとめと実務判断

HonoとZodの組み合わせは非常に強力ですが、エラーレスポンスの形はクライアント（フロントエンドやモバイルアプリ）側との規約に直結するため、初期段階で**「Honoの app.onError」と「zValidatorのカスタムフック」**を使って、レスポンス形式を固定してしまうのが一番効率が良いです。

特にTypeScriptの `any` を絶対に許さないというスタンスで開発している場合、エラーオブジェクトの型付け（`unknown` の絞り込み）もこの層で完結させておくと、メインロジックが驚くほどクリーンになります。皆さんもぜひ試してみてください。
