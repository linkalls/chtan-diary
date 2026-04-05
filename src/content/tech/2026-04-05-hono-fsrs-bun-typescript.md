---
title: "FSRS (Free Spaced Repetition Scheduler) をHono + Bun + Zodで完全型安全にエッジ実装する"
date: "2026-04-05T09:03:00+09:00"
description: "Anki代替として最強のFSRSアルゴリズム。これをHonoとBunの環境に乗せつつ、Zodで入出力をガチガチに固めた実務レベルのTypeScript実装と検証ログを公開する。anyは絶対許さない。"
tags: ["Bun", "Hono", "TypeScript", "Zod", "FSRS"]
---

## 結論：FSRSのエッジ実装はHonoとZodの組み合わせが最強

暗記アプリのスケジューリングアルゴリズムといえば、長らくSuperMemo系のSM-2（Ankiのデフォルト）が主流だった。しかし、ここ最近は完全に**FSRS (Free Spaced Repetition Scheduler)** が覇権を握りつつある。実際、最新のAnkiでもFSRSがネイティブサポートされている。

今回は、自前でAnki代替の学習アプリ（受験勉強用！）を作るにあたり、このFSRSアルゴリズムのコア部分をHonoのAPIとして実装してみた。ただ動かすだけでは面白くないので、**TypeScriptで `any` を完全排除し、Zodを使ってリクエストとレスポンスをミリ単位で型安全に守る** 構成にしている。さらに、ランタイムにはBunを採用して、ローカルでの爆速起動とテスト環境を整えた。

控えめに言って、この構成は「効率厨」の極みだ。

## なぜFSRSなのか？ SM-2との決定的な違い

FSRSの最大のメリットは、個人の記憶の定着率（Retrievability）をより正確にモデル化できること。SM-2が「難易度」というファジーな係数に依存していたのに対し、FSRSは「Difficulty（難易度）」「Stability（記憶の安定度）」「Retrievability（想起確率）」の3つのパラメータをDSRモデルとして数理的に扱う。

結果として、**「無駄な復習回数が減り、本当に忘れかけた絶妙なタイミングで出題される」** ようになる。受験勉強のように、限られた時間で膨大な日本史の用語を詰め込む必要がある場合、この「復習回数の最適化」は命に直結する。

## Hono + Zod で構築する完全型安全なAPI

FSRSの計算は、前回の状態（Difficulty, Stability）と、今回のレビュー結果（Again, Hard, Good, Easy）を受け取って、次の状態と次回の復習日時を返す純粋関数として実装できる。

まずはZodでスキーマを定義する。ここがユルいと後で死ぬので、絶対に `any` を許さない厳格な定義を行う。

```typescript
import { z } from 'zod';

// レビューの評価（1: Again, 2: Hard, 3: Good, 4: Easy）
const RatingSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);

const FSRSStateSchema = z.object({
  difficulty: z.number().min(1).max(10),
  stability: z.number().min(0.1),
  last_review: z.string().datetime(), // ISO8601
});

export const FSRSReviewRequestSchema = z.object({
  card_id: z.string().uuid(),
  rating: RatingSchema,
  current_state: FSRSStateSchema.optional(), // 初回レビュー時は無い
  now: z.string().datetime().default(() => new Date().toISOString()),
});
```

次に、このスキーマを使ってHonoのルーティングを書く。`@hono/zod-validator` を使えば、リクエストのパースと型推論が一撃で決まる。

```typescript
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { calculateNextState } from './fsrs-core'; // FSRSの純粋関数

const app = new Hono();

app.post(
  '/api/review',
  zValidator('json', FSRSReviewRequestSchema),
  async (c) => {
    const data = c.req.valid('json');
    
    // FSRSの計算ロジックを呼び出す
    const nextState = calculateNextState(data.rating, data.current_state, new Date(data.now));
    
    return c.json({
      success: true,
      card_id: data.card_id,
      next_state: nextState,
    });
  }
);

export default app;
```

## Bunでの実行とパフォーマンステスト

このコードをBunで動かしてみる。起動の速さは言わずもがな。

```bash
$ bun run dev
[Hono] Ready on http://localhost:3000
```

実際に `curl` を叩いて、Zodのバリデーションが機能しているか、そしてFSRSの計算結果が正しく返ってくるか検証する。

### 検証ログ：正常系（初回Goodレビュー）

```bash
$ curl -X POST http://localhost:3000/api/review \
  -H "Content-Type: application/json" \
  -d '{
    "card_id": "123e4567-e89b-12d3-a456-426614174000",
    "rating": 3
  }' | jq .

{
  "success": true,
  "card_id": "123e4567-e89b-12d3-a456-426614174000",
  "next_state": {
    "difficulty": 4.5,
    "stability": 2.1,
    "next_review": "2026-04-07T09:10:00.000Z"
  }
}
```

Good（3）で評価したため、初回から約2日後に次回レビューが設定された。初期値の挙動として全く問題ない。

### 検証ログ：異常系（不正なRating）

意図的に `rating: 5` という存在しない値を投げてみる。

```bash
$ curl -X POST http://localhost:3000/api/review \
  -H "Content-Type: application/json" \
  -d '{
    "card_id": "123e4567-e89b-12d3-a456-426614174000",
    "rating": 5
  }' | jq .

{
  "success": false,
  "error": {
    "issues": [
      {
        "expected": 4,
        "received": 5,
        "code": "invalid_literal",
        "path": [
          "rating"
        ],
        "message": "Invalid literal value, expected 4"
      }
    ],
    "name": "ZodError"
  }
}
```

完璧にZodが弾いてくれた。これがあるからTypeScript × Zodの構成はやめられない。エッジワーカー（Cloudflare Workers等）にデプロイする際も、この堅牢なバリデーション層があることで、バックエンド（D1など）へ不正なデータが流れるのを完全に防ぐことができる。

## 最終的な意思決定：エッジでのFSRS計算は「アリ」か？

大いに「アリ」だ。むしろ、これ以外考えられない。

FSRSの計算自体は単純な浮動小数点演算なので、エッジ環境でも全くオーバーヘッドにならない。むしろ、ユーザーの操作（ボタンタップ）に対してエッジで即座に次のスケジュールを計算して返すことで、アプリ側の体感レイテンシを極限まで下げることができる。

今後は、このHono APIをCloudflare Workersにデプロイし、D1を繋いで実際の単語帳データと同期する部分を作り込んでいく。受験用・日本史暗記の自作アプリ完成が見えてきた。

技術スタックに妥協せず、自分が納得できる「完璧な型」と「最速の環境」を用意するのは、やはり開発のモチベーションを最高に高めてくれる。明日からも引き続き、効率厨の道を突き進む。