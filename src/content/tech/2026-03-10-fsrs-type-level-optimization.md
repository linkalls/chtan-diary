---
title: "FSRSアルゴリズムの実装におけるTypeScriptの型レベルプログラミングの探求と完全なる型安全性の実現"
date: "2026-03-10T09:00:00+09:00"
tags: ["TypeScript", "Algorithm", "FSRS", "EdTech"]
---

現在、Ankiの代替となるような学習アプリケーションの開発において、FSRS（Free Spaced Repetition Scheduler）アルゴリズムの採用は事実上の標準となりつつある。しかし、FSRSの複雑な状態遷移とパラメータ計算をTypeScriptで実装する際、型定義が甘いとランタイムエラーの温床となりやすい。特に学習者の記憶状態（State: New, Learning, Review, Relearning）と評価（Rating: Again, Hard, Good, Easy）の掛け合わせによる遷移は、網羅性と正確性が極めて重要になる。今回は、このFSRSアルゴリズムのコアロジックをTypeScriptの高度な型レベルプログラミングを用いて、コンパイル時に完全に静的検証する手法について深く考察していく。

まず、FSRSの根幹をなす状態遷移マトリクスを型として表現するアプローチから始める。単なる `string` のユニオン型ではなく、各状態が受け入れることのできる次状態を厳密にマッピングする。例えば、`New` 状態からは `Learning` にしか遷移できず、`Review` 状態でのみ `Relearning` への後退が許容されるといった制約を、TypeScriptのMapped TypesとConditional Typesを駆使して定義する。これにより、不正な状態遷移を試みるコードはすべてコンパイルエラーとして弾き返され、「TypeScriptで `any` は絶対許さない」という強固な開発ポリシーを体現することが可能になる。状態機械（State Machine）を型レベルで定義することの恩恵は計り知れない。

```typescript
type State = 'New' | 'Learning' | 'Review' | 'Relearning';
type Rating = 'Again' | 'Hard' | 'Good' | 'Easy';

type TransitionMap = {
  New: 'Learning';
  Learning: 'Learning' | 'Review';
  Review: 'Review' | 'Relearning';
  Relearning: 'Relearning' | 'Review';
};

// 状態遷移の妥当性をコンパイル時に検証するユーティリティ型
type ValidateTransition<Current extends State, Next extends State> = 
  Next extends TransitionMap[Current] ? Next : never;
```

次に、ランタイムの安全性担保について触れておきたい。型レベルでどれだけ厳密な制約を設けても、外部APIからの入力やデータベースからのデシリアライズ時には動的な検証が不可欠だ。ここでは Zod を用いて、TypeScriptの型定義と完全に同期したスキーマを構築する。`z.discriminatedUnion` などを活用することで、各学習状態に応じた固有のペイロード（例えば、`Review` 状態では `stability` と `difficulty` の値が必須になる等）の検証を精緻に行う。型推論（`z.infer`）と静的型の交差をチェックするテストコードを記述することで、スキーマの変更が型定義の破壊を招かないよう、双方向の安全性を担保する堅牢なアーキテクチャが完成する。

最後に、低レイヤー志向の観点からパフォーマンスへの影響を考察する。複雑な型定義は時としてTypeScriptコンパイラのパフォーマンス低下（いわゆる型パズルによるコンパイル遅延）を引き起こす懸念があるが、FSRSのドメインモデルの複雑度であれば、コンパイル時間への影響は無視できる範囲に収まる。むしろ、RustやZig、V言語のようなメモリ安全性を重視するモダンな低レイヤー言語での実装パラダイムを、フロントエンド/BFF領域のTypeScriptに持ち込むことができるという点で、このアプローチは非常に優れている。教育系プロダクトにおいて、「忘却」という曖昧な人間の特性を扱うからこそ、そのシステム基盤は限りなく厳密で予測可能であるべきなのだ。