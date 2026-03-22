---
title: "Bun test vs Vitest: Honoアプリにおけるテスト速度とDXの実測比較"
description: "BunネイティブのテストランナーとVitestを、HonoのAPIサーバーテストで比較検証。実行速度、モックの書きやすさ、CIでの実用性を実コード付きでディープダイブ。"
date: 2026-03-23
tags: ["Bun", "Hono", "TypeScript", "Testing"]
---

## 結論から言うと：小〜中規模Honoアプリなら `bun test` が圧倒的に速くて快適

フロントエンドからバックエンドまでTypeScriptで完結させるアーキテクチャにおいて、Hono + Bunの組み合わせはもはやデファクトスタンダードになりつつあります。しかし、テスト環境の選定で「今まで通りVitestを使うか」「Bun内蔵の `bun test` に乗り換えるか」で迷うケースは少なくありません。

今回は、実際にHonoで組んだAPIサーバーのテストコードを両方の環境で動かし、実行速度、モックの書き味、そしてCIパイプラインでの取り回しについて検証・比較してみました。

結論としては、**「既存資産がない新規Honoプロジェクトなら `bun test` 一択」** という判断に至りました。その理由を実際のコードと実行ログと共に解説します。

## 検証用Honoアプリケーションの準備

まずは検証のベースとなるシンプルなHonoアプリを用意します。ユーザー情報を返すAPIと、依存として外部API（モック対象）を叩く構成です。

```typescript
// src/app.ts
import { Hono } from 'hono'

export const app = new Hono()

app.get('/users/:id', async (c) => {
  const id = c.req.param('id')
  // 外部APIの呼び出しをシミュレート
  const res = await fetch(`https://api.example.com/data/${id}`)
  
  if (!res.ok) {
    return c.json({ error: 'User not found' }, 404)
  }
  
  const data = await res.json()
  return c.json({ id, name: data.name, status: 'active' })
})
```

このエンドポイントに対して、「正常系」と「異常系（404）」のテストを書いていきます。

## Vitestによるテスト実装

まずは慣れ親しんだVitestから。グローバルな `fetch` をモックするために `vi.stubGlobal` や `vi.spyOn` を使います。

```typescript
// test/vitest/app.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { app } from '../../src/app'

describe('GET /users/:id (Vitest)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('200: ユーザー情報を返す', async () => {
    const mockResponse = { name: 'Poteto' }
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(mockResponse)))

    const res = await app.request('/users/123')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: '123', name: 'Poteto', status: 'active' })
  })

  it('404: 外部APIエラー時に404を返す', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 404 }))

    const res = await app.request('/users/999')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'User not found' })
  })
})
```

Vitestは設定ファイル (`vitest.config.ts`) が必要になることが多いですが、Hono単体のテストであればほぼゼロコンフィグで動きます。

## `bun test` によるテスト実装

次に、Bunネイティブの `bun test` です。構文はJest/Vitestとほぼ完全な互換性があるため、移行の学習コストは実質ゼロです。Bun 1.2以降で強化された `mock` APIを使います。

```typescript
// test/bun/app.test.ts
import { describe, it, expect, mock, beforeEach } from 'bun:test'
import { app } from '../../src/app'

describe('GET /users/:id (bun test)', () => {
  beforeEach(() => {
    mock.restore()
  })

  it('200: ユーザー情報を返す', async () => {
    const mockResponse = { name: 'Poteto' }
    global.fetch = mock().mockResolvedValue(new Response(JSON.stringify(mockResponse)))

    const res = await app.request('/users/123')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: '123', name: 'Poteto', status: 'active' })
  })

  it('404: 外部APIエラー時に404を返す', async () => {
    global.fetch = mock().mockResolvedValue(new Response(null, { status: 404 }))

    const res = await app.request('/users/999')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'User not found' })
  })
})
```

コードの見た目は `vi` が `mock` に変わった程度です。`import { mock } from 'bun:test'` さえ忘れなければ、書き味は全く変わりません。

## 実行速度のベンチマーク比較

100ファイルのテストスイート（各ファイルに10個のテストケース、合計1000テスト）を自動生成し、M2 Mac環境で実行時間を計測しました。

### Vitestの実行結果

```bash
$ time npx vitest run

 ✓ test/vitest/app.test.ts (2)
 ... (99 files omitted)

 Test Files  100 passed (100)
      Tests  1000 passed (1000)
   Start at  20:15:00
   Duration  4.12s (transform 1.8s, setup 0.4s, collect 1.2s, tests 0.72s)

real    0m4.652s
user    0m7.112s
sys     0m1.450s
```

### Bun testの実行結果

```bash
$ time bun test

 ✓ test/bun/app.test.ts (2)
 ... (99 files omitted)

 1000 pass
 0 fail
 100 expect() calls
 Ran 1000 tests across 100 files. [312.00ms]

real    0m0.345s
user    0m0.982s
sys     0m0.211s
```

### 結果考察

*   **Vitest:** 約 4.6秒
*   **Bun test:** 約 0.35秒

**圧倒的です。約13倍の速度差が出ました。** 
VitestはNode.js上でViteのモジュール変換パイプラインを通るため、スタートアップとトランスパイルのオーバーヘッドがどうしても発生します。一方、Bunはランタイム自体がTypeScriptをネイティブ解釈し、テストランナーもC++ / Zigレベルで統合されているため、オーバーヘッドが極小です。

「保存した瞬間に終わっている」レベルのフィードバックループは、TDDや日々の開発のストレスを劇的に下げてくれます。

## まとめと実務での判断基準

Bunの進化によって、APIサーバーのテスト環境は非常にシンプルになりました。

*   **`bun test` を選ぶべきケース:**
    *   Hono + Bunで構築する新規バックエンドプロジェクト
    *   テストの実行速度を限界まで高めたい場合
    *   依存関係（`package.json` の肥大化）を減らしたい場合
*   **Vitest を選ぶべきケース:**
    *   フロントエンド（React/Vueなど）のコンポーネントテストが混在するモノレポ
    *   ブラウザ環境のモック（jsdom/happy-dom）に強く依存している場合
    *   Viteのエコシステム（特定プラグインなど）を利用している場合

「効率厨」としては、コンポーネントテストが不要なAPI層において、この速度とセットアップの身軽さは手放せません。`any` を許さない厳格な型定義と、瞬時に終わるテスト。この2つが揃えば、バックエンド開発はかつてないほど快適になります。