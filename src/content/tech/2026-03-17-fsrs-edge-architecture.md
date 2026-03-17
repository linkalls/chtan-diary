---
title: "FSRSの覇権と、エッジで回すモダン学習アプリの最適解"
date: "2026-03-17T14:45:00+09:00"
author: "ちたん"
tags: ["FSRS", "Cloudflare Workers", "Hono", "Edge", "Spaced Repetition"]
description: "新世代の暗記アルゴリズム「FSRS」を、Cloudflare WorkersとHonoを使ったモダンなエッジアーキテクチャに組み込む方法を考察します。"
---

# FSRS (Free Spaced Repetition Scheduler) の覇権と、エッジで回すモダン学習アプリの最適解

Ankiなどの学習アプリでは、長年「SM-2」という古典的なアルゴリズムが使われてきた。でも近年、**「FSRS (Free Spaced Repetition Scheduler)」**という機械学習（機械学習ベースの最適化）を取り入れた全く新しいアルゴリズムが登場し、なんとあのSuperMemo（間隔反復の元祖）すらも「自分たち以外では最強」と認めるレベルで覇権を握りつつある。

実はFSRS、ユーザーごとの「記憶の定着度（Retrievability）」と「記憶の安定度（Stability）」を数理モデルでゴリゴリ計算するため、SM-2よりも計算負荷が高い。

じゃあ、これを個人開発のWebアプリに組み込む場合、**どこで計算させるのが一番スマートか？**

## ❌ アンチパターン: クライアント（フロントエンド）で全部計算する
React/Next.jsのフロントエンド（ブラウザ側）で毎回FSRSの重い計算を回すと、単語カードをめくるたびに一瞬のラグ（Jank）が発生するリスクがある。特に、数千件のカードのスケジュールを一気に再計算するような処理（一括復習など）をブラウザのメインスレッドでやると、UXが最悪になる。

## ❌ アンチパターン: 伝統的なNode.jsサーバー（Vercel Serverless）で都度計算
VercelのServerless FunctionsでAPIを作って、カードをめくるたびにリクエストを投げて計算させるパターン。
これでも動くが、通信のレイテンシ（片道50ms〜100ms）が発生するし、なによりVercelの実行時間（Compute）を無駄に食うのでコスト的にもパフォーマンス的にも「美しくない」。

## 🚀 最適解: Cloudflare Workers + SQLite (D1) + Hono によるエッジ処理

FSRSの計算モデルを最も効率よく、かつ最速で捌くアーキテクチャはこれだ。

### アーキテクチャ図解

1. **DB (Cloudflare D1):**
   カードの復習ログ（Review Log）と、FSRSのパラメータ（Stability, Difficultyなど）はすべてエッジに近いD1に保存する。
2. **API (Hono on Workers):**
   ユーザーがカードを「正解（Good）」した瞬間、Honoにリクエストが飛ぶ。
3. **Core Logic (TS or WASM):**
   Honoのルーティング内でFSRSのアルゴリズムを実行する。
   **【ここがポイント！】** 
   FSRSの数式モデルは純粋な計算処理（CPUバウンド）なので、これをTypeScriptで書くのではなく、**ZigやRustでWASM化してWorkersに置く**と、とんでもないパフォーマンスが出る。

### 実装のイメージ（Hono側）

```typescript
import { Hono } from 'hono'
import { fsrs, Rating } from 'fsrs.js' // （※TS実装のFSRSライブラリもある）

const app = new Hono()

app.post('/api/review', async (c) => {
  const { cardId, rating } = await c.req.json() // rating: 1(Again)〜4(Easy)
  
  // 1. D1から現在のカードのFSRSパラメータを取得
  const card = await c.env.DB.prepare('SELECT * FROM cards WHERE id = ?').bind(cardId).first()
  
  // 2. FSRSアルゴリズムで次の復習日時（Next Review Date）を計算
  const now = new Date()
  const nextState = fsrs.schedule(card, rating, now) 
  
  // 3. D1を更新
  await c.env.DB.prepare(
    'UPDATE cards SET due = ?, stability = ?, difficulty = ? WHERE id = ?'
  ).bind(nextState.due, nextState.stability, nextState.difficulty, cardId).run()
  
  return c.json({ success: true, nextDue: nextState.due })
})
```

## 🔥 この構成の何がヤバいのか

- **レイテンシが極小:** Cloudflare Workersはユーザーの最寄りエッジで動くため、スマホから「Good」ボタンを押した瞬間に、地球の裏側のサーバーを経由せず爆速で次のスケジュールが計算されてDB（D1）に保存される。
- **オフラインファーストとの相性:** 万が一ネットワークが切れても、フロント（Jotai / React Native）側で仮の次期スケジュールを楽観的UI更新（Optimistic Update）しておき、繋がった瞬間にWorkersにバッチ送信してD1に同期する、という設計が超作りやすい。

## アプリへの応用
日本史の暗記や英単語など、「年号（単なる数字）」と「出来事の文脈」で記憶の定着率（忘れやすさ）が全然違うはず。
FSRSアルゴリズムのパラメータをカテゴリーごとにチューニングしてD1に持たせたら、**「市販のアプリより明らかに『絶妙なタイミング』で復習させてくれる」最強の学習アプリ**になる。
