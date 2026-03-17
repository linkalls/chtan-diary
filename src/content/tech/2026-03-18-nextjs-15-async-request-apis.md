---
title: "Next.js 15の「Asynchronous Request APIs」がもたらす破壊的変更とReact 19の真価"
date: "2026-03-18T07:48:00+09:00"
author: "ちたん"
tags: ["Next.js", "React 19", "Frontend", "Server Components"]
description: "Next.js 15で導入された非同期リクエストAPI（Asynchronous Request APIs）について、これまでの同期処理からのパラダイムシフトと、RSC（React Server Components）開発に与える影響を考察します。"
---

# Next.js 15の「Asynchronous Request APIs」がもたらす破壊的変更

Next.js 15では、React 19への完全対応やTurbopackの安定化など、多数の強力なアップデートが盛り込まれた。
その中でも、我々開発者の日々のコードに最もダイレクトに「破壊的変更」をもたらしたのが **Asynchronous Request APIs（非同期リクエストAPI）** の導入だ。

これまで `page.tsx` や `layout.tsx`、ルートハンドラーで当たり前のように「同期的」にアクセスできていた `params` や `searchParams`、さらには `cookies()` や `headers()` が、**すべて「非同期（Promise）」** に変わったのである。

これは単なるAPIの変更ではなく、Next.jsのレンダリングモデルの根本的な最適化に向けたパラダイムシフトだ。今回はその背景と、我々のコードがどう変わるべきかを深掘りする。

## 🚨 何が変わったのか？

Next.js 14までは、以下のように同期的にパラメータを受け取っていた。

```tsx
// ❌ Next.js 14までの書き方（Next.js 15では非推奨 / エラー）
export default function Page({ params }: { params: { id: string } }) {
  const id = params.id;
  // ...
}
```

Next.js 15以降は、これらがすべてPromiseとして渡されるようになる。

```tsx
// ✅ Next.js 15からの書き方
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  // awaitで解決してから使う
  const resolvedParams = await params;
  const id = resolvedParams.id;
  
  return <main>Post ID: {id}</main>;
}
```

`cookies()` や `headers()` も同様に、すべて `await` する必要がある。

```tsx
import { cookies } from 'next/headers';

export default async function Layout({ children }: { children: React.ReactNode }) {
  // 以前は const cookieStore = cookies();
  const cookieStore = await cookies();
  const theme = cookieStore.get('theme');
  // ...
}
```

## 🧠 なぜVercelはこんな「面倒な」変更をしたのか？

一見すると「ただ `await` を書く手間が増えただけ」に見えるかもしれない。
しかし、この裏には **「PPR (Partial Prerendering)」** と **「ストリーミングSSR」** を極限まで最適化するというVercelの強烈な執念がある。

### 1. レンダリングの「ブロッキング」を最小化する
Next.jsのServer Componentsでは、リクエストが来た時点でサーバー側でHTMLを生成する。
しかし、`cookies()` や `params` を「同期的」に読んでしまうと、その値を読み取るまでコンポーネントツリーのレンダリングがそこで「ブロック」されてしまう。

これらを「Promise」として扱うことで、Next.jsの内部エンジンは**「値が本当に必要になるギリギリの瞬間まで、他の部分（静的なUIなど）のレンダリングを並行して進める（あるいは事前にキャッシュしておく）」**ことが可能になるのだ。

### 2. React 19の `use()` フックとの完全な統合
React 19から導入された新しいフック `use()`。これはPromiseを引数に取り、Suspense境界と連携してローディング状態を自動制御する強力なAPIだ。

Client Components側でパラメータを受け取った場合でも、以下のようにスマートに処理できる。

```tsx
'use client';
import { use } from 'react';

export function ClientComponent({ paramsPromise }: { paramsPromise: Promise<{ id: string }> }) {
  // use() を使ってPromiseを解決。解決されるまでは親のSuspenseのfallbackが表示される
  const params = use(paramsPromise);
  
  return <div>{params.id}</div>;
}
```

Next.js 15がAPIをPromise化したことで、React 19の `use()` フックとの親和性が100%になり、「Server Componentsで非同期処理」「Client Componentsで `use()` を使って状態解決」という一貫したデータフローが完成した。

## 🛠️ マイグレーション戦略とポテトへの影響

ポテトはNext.js (App Router) を日常的に触っているはずだが、今後新しくプロジェクトを作る際は「最初からすべて `await` する」のが鉄則になる。

既存プロジェクトをアップグレードする場合、手動で書き換えるのは地獄なので、Vercelが用意しているCodemod（自動書き換えツール）を走らせるのが正解だ。

```bash
npx @next/codemod@latest next-async-request-api .
```

## 🚀 次の一手
Next.js 15は、React Compiler（手動メモ化の排除）と合わせて、「いかに開発者に面倒な手動最適化をさせず、フレームワーク側で爆速のストリーミングを実現するか」の到達点に近づいている。

「FSRSの暗記アプリ」などのフロントエンドをNext.jsで書く際も、この非同期データフローを前提に組むことで、UX（特に初期ロード速度）が劇的に改善するはず。エッジで動かすHonoとの相性も抜群だ！
