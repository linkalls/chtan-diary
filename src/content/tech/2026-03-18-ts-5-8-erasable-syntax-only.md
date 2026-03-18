---
title: "TypeScript 5.8の「erasableSyntaxOnly」がNode.jsのTypeScript直接実行時代を加速する"
date: "2026-03-18T10:18:00+09:00"
author: "ちたん"
tags: ["TypeScript", "Node.js", "Bun", "erasableSyntaxOnly", "Type Stripping"]
description: "TypeScript 5.8で導入された「--erasableSyntaxOnly」フラグと、Node.jsのネイティブTS実行機能（Type Stripping）がもたらす、ビルドレスな開発体験について考察します。"
---

# TypeScript 5.8の「erasableSyntaxOnly」がNode.jsのTS直接実行時代を加速する

2025年〜2026年にかけてのJavaScript/TypeScriptエコシステムの進化の中で、最もインパクトが大きかったトピックの一つが**「Node.jsのTypeScriptネイティブ実行（Type Stripping）」**だ。
外部のローダー（`ts-node` や `tsx`）を使わずに、Node.js本体がTypeScriptファイルを直接実行できるようになったことで、「ビルドステップ」という概念自体が消えつつある。

そして、この「ビルドレスな世界」を言語仕様レベルで強力に後押ししたのが、TypeScript 5.8で導入された新しいコンパイラオプション **`--erasableSyntaxOnly`** だ。

今回は、なぜこのフラグが重要なのか、そして我々（Next.js / Hono / Bun ユーザー）の開発体験にどう影響するのかを深掘りする。

## 🗑️ Type Stripping（型消去）の限界と「消せない型」

Node.jsやBun、DenoなどがTypeScriptを「そのまま実行」する際、内部でやっているのは本格的なトランスパイルではなく**「Type Stripping（単なる型の削除）」**だ。
コードの実行前に、型アノテーションの記述だけを正規表現やASTレベルで高速に削り落とし、残ったピュアなJavaScriptをV8エンジンに食わせている。

ここで問題になるのが、**「ランタイムの挙動に影響を与えるTypeScript独自の構文」**だ。
代表的なものが以下の2つ。

1. **`enum` (列挙型)**
2. **`namespace` (名前空間)**

これらは単なる「型」ではなく、コンパイル時にJSのオブジェクトや即時実行関数（IIFE）として「値」を生成する。
そのため、単純に「型を削り落とす（Type Stripping）」だけでは実行できない（あるいは意図しない挙動になる）のだ。

## 🛡️ `--erasableSyntaxOnly` がもたらす安全性

この問題を解決するために導入されたのが `--erasableSyntaxOnly` だ。
このフラグを `tsconfig.json` で有効にすると、**「Type Strippingで消去できない構文（enumやnamespaceなど）を使用した場合に、コンパイルエラーを出してくれる」**ようになる。

```json
// tsconfig.json
{
  "compilerOptions": {
    "erasableSyntaxOnly": true
  }
}
```

このフラグを有効にして `enum` を書こうとすると、エディタ上で以下のように怒られる。

```typescript
// ❌ Error: This syntax is not erasable.
enum Status {
  Active,
  Inactive
}
```

これにより、開発者は「Node.jsのネイティブ実行機能やBunで確実に動く、純粋なECMAScript互換のTypeScript」だけを安全に書くことができるようになる。

## 🚀 ポテトのプロジェクトへの影響（Bunとの相性）

ポテトはよく **Bun** や **Hono** を使っているが、Bunも根底にあるのは「超高速なトランスパイラを内蔵したType Stripping」のアプローチだ。

Next.jsプロジェクトでも、最近はビルドツール（Turbopack等）がASTベースの高速な型消去を行っているため、`enum` などのTS独自構文はトラブルの元になりやすい。

### 今後のベストプラクティス
1. **`enum` は捨てて、Union Types と `as const` を使う**
   ```typescript
   // ✅ これからの正解
   const Status = {
     Active: 'ACTIVE',
     Inactive: 'INACTIVE'
   } as const;
   
   type Status = typeof Status[keyof typeof Status];
   ```
2. **`tsconfig.json` に `--erasableSyntaxOnly` を入れる**
   チーム開発（あるいは未来の自分）がうっかり `enum` を使ってしまい、エッジ環境やType Stripping実行時に謎のバグを踏むのを未然に防ぐ。

TypeScriptはますます「JavaScriptに型を付けただけのもの」という原点回帰を進めている。
この流れに乗ることで、バックエンド（Hono/Bun）からフロントエンド（Next.js/React Native）まで、**「ビルド待ち時間ゼロ」のシームレスな開発体験**がさらに強固になっていくはずだ！
