---
title: "Bun環境下でのZodバリデーションの高速性と限界：エッジ向け実践検証"
date: "2026-04-04T16:03:00.000Z"
category: "tech"
tags: ["Bun", "TypeScript", "Zod", "Edge", "パフォーマンス"]
---

エッジ環境でのAPI実行がスタンダードになりつつある今、HonoやCloudflare Workersと組み合わせて使われることの多い `Bun` と `Zod` の相性について改めて実環境で検証してみました。

「TypeScriptで `any` は絶対許さない」というスタンスをとる上で、ランタイムの型バリデーションは必須です。しかし、バリデーションのオーバーヘッドがエッジの超高速レスポンス（Zero Latency）を阻害しては元も子もありません。今回はローカルのBunランタイムを使って、実際にZodのパーフォーマンスを計測・検証しました。

## 1. 検証用スクリプトの準備

今回検証するのは、ごく一般的なユーザーデータ（UUID、名前、メールアドレス、年齢、タグ配列）を想定したZodスキーマです。これを10,000回連続でパースし、どの程度時間がかかるかを見ます。

まずは検証用コードを用意しました。

```typescript
import { z } from "zod";

const schema = z.object({
  id: z.string().uuid(),
  name: z.string().min(2),
  email: z.string().email(),
  age: z.number().int().positive(),
  tags: z.array(z.string()),
});

const data = {
  id: crypto.randomUUID(),
  name: "Poteto",
  email: "poteto@example.com",
  age: 20,
  tags: ["typescript", "bun", "hono"],
};

const start = performance.now();
let successCount = 0;
for (let i = 0; i < 10000; i++) {
  const result = schema.safeParse(data);
  if (result.success) successCount++;
}
const end = performance.now();

console.log(`Success: ${successCount}`);
console.log(`Zod validation 10,000 times took: ${(end - start).toFixed(2)} ms`);
```

## 2. 実機検証ログとエラーの有無

実際にこのコードを最新のBunランタイム上で走らせてみました。

```bash
$ bun zod-bench.ts
Success: 10000
Zod validation 10,000 times took: 97.49 ms
```

結果として、10,000回のバリデーションが約97ミリ秒（0.09秒）で完了しました。1回あたりのパース時間は `0.0097ms` となり、HonoでエッジAPIを構築する際のオーバーヘッドとしては完全に無視できるレベルです。

## 3. Zodは重いのか？

一般的に「Zodはバンドルサイズが重く、実行速度もTypeBoxなどの他ライブラリに比べて劣る」と言われることがあります。たしかに極限のマイクロ秒を争う世界ではTypeBoxに軍配が上がるかもしれません。

しかし、実用上のメリットとしてZodには以下の強みがあります。
- **圧倒的なエコシステム**: `zod-to-json-schema` や `hono/zod-validator` など、周辺ツールが豊富
- **APIの直感性**: メソッドチェーンで書きやすく、正規表現などの独自ルールの追加が容易
- **十分なパフォーマンス**: 上記の通り、1万回で100ms未満なら、通常のAPIリクエスト（1回につき数パース）ではボトルネックにならない

## 4. なぜBunと組み合わせるべきか

BunのJITコンパイラと組み合わさることで、Node.js環境よりもスクリプトのパースや初期化が高速化されています。Cold Start（コールドスタート）が命のエッジ環境において、Bunの高速な起動時間と、Zodの堅牢な型安全性の組み合わせは、現時点で「妥協のないベストプラクティス」の一つと言えます。

## 5. 次のステップ

個人的には、Zodのパース結果をD1やBun SQLiteのトランザクションへそのまま流し込むアーキテクチャをもっと掘り下げたいと考えています。また、今後は `TypeBox` や `ArkType` との同一コードベースでの比較検証も進めていく予定です。

TypeScriptを使う上で、実行時の型安全性を捨てる選択肢はありません。ツールの強みと弱みを理解し、適材適所で最速の環境を構築していきましょう。
