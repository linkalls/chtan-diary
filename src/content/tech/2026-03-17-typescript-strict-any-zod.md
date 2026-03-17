---
title: "TypeScriptで `any` を絶対許さないためのZod徹底活用"
description: "型安全性を極限まで高めるためのZodの実践的な使い方と、なぜanyを親の仇のように憎むべきなのかについて語る。"
date: 2026-03-17T21:03:00+09:00
tags: ["TypeScript", "Zod", "型安全"]
---

## 序論：なぜ `any` をそこまで憎むのか

TypeScriptを使っているのに `any` を書くのは、シートベルトを外して高速道路を逆走するようなものだ。コンパイラという最強の味方を自らの手で黙殺し、ランタイムエラーの温床をわざわざ作り出している。

過去のプロジェクトで、外部APIからのレスポンスをとりあえず `any` で受け取ってしまったがために、本番環境で謎の `undefined is not a function` に何時間も悩まされた経験はないだろうか？ 私はある。だからこそ、「`any` は絶対許さない」という強い意志を持つに至った。

## Zodの真価：実行時バリデーションの強力さ

TypeScriptの型はあくまで静的なものであり、コンパイル時にしか存在しない。外部からの入力（APIのレスポンス、ユーザー入力、ファイルの読み込みなど）に対しては、何の保証もしてくれないのだ。

そこでZodの出番だ。Zodはスキーマファーストのバリデーションライブラリであり、実行時にデータの構造を保証しつつ、TypeScriptの型を自動的に推論してくれる。

```typescript
import { z } from "zod";

const UserSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  email: z.string().email(),
  age: z.number().int().positive().optional(),
});

type User = z.infer<typeof UserSchema>;
```

このようにスキーマを定義するだけで、実行時の安全なパースと静的な型定義の両方を手に入れることができる。

## 実践：外部APIレスポンスの安全な処理

外部APIを叩く際、`fetch` の戻り値である `Response.json()` はデフォルトで `any`（または `unknown`）だ。ここでZodを使って、安全にパースするフローを構築する。

```typescript
async function fetchUser(userId: string): Promise<User> {
  const response = await fetch(`/api/users/${userId}`);
  
  if (!response.ok) {
    throw new Error(`API Error: ${response.status}`);
  }

  const rawData = await response.json();
  
  // parse() を使うことで、不正なデータなら即座にZodErrorを投げる
  const user = UserSchema.parse(rawData);
  
  return user;
}
```

このアプローチの最大の利点は、データ構造の異常を「それが使われる場所」ではなく「境界（バウンダリー）」で検知できることだ。エラーの原因究明が圧倒的に楽になる。

## `unknown` との付き合い方

`any` を禁止するなら、代わりに `unknown` を使うことになる。`unknown` は「型がわからない」ことを明示する型であり、そのままではプロパティにアクセスしたりメソッドを呼んだりできない。

Zodと `unknown` の相性は抜群だ。外部入力はすべて `unknown` として扱い、Zodの `safeParse` を通すことで、安全に型付けされた世界へと導くことができる。

```typescript
function processInput(input: unknown) {
  const result = UserSchema.safeParse(input);
  
  if (!result.success) {
    console.error("Invalid input:", result.error.format());
    return;
  }
  
  // ここから先は result.data が User 型として安全に使える
  console.log(`Hello, ${result.data.name}!`);
}
```

## 結論：型安全は開発者の精神衛生を保つ

`any` を使えば一時的にエラーを消すことはできるが、それは借金を先送りしているに過ぎない。Zodを導入し、システムの境界で徹底的にデータをバリデーションすることで、長期的なメンテナンス性が飛躍的に向上する。

型安全性を高めることは、単なる自己満足ではない。それは未来の自分とチームメンバーに対する思いやりであり、堅牢なプロダクトを作るための必須条件なのだ。
