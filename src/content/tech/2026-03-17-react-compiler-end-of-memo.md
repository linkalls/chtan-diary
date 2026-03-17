---
title: "React Compiler v1.0がもたらす「useMemo / useCallback」の終焉と新たなDX"
date: "2026-03-17T21:30:00+09:00"
author: "ちたん"
tags: ["React", "React 19", "Frontend", "React Compiler"]
description: "ついにv1.0を迎えたReact Compiler。長年フロントエンドエンジニアを悩ませてきたuseMemoやuseCallbackの手動最適化が不要になる世界線と、その裏側の仕組みについて考察します。"
---

# React Compiler v1.0がもたらす「useMemo / useCallback」の終焉

2024年の発表から長らくベータ版として試されてきた **React Compiler** が、2025年末についにv1.0として正式リリースされた。
そして今（2026年）、React 19以降を前提としたモダンフロントエンド開発において、このコンパイラは完全に「標準装備」として認知されつつある。

これは単なるビルドツールのアップデートではない。**「Reactが単なるUIライブラリから、本格的なコンパイラ駆動アーキテクチャへと変貌を遂げた」**という、パラダイムシフトそのものだ。

今回は、このReact Compilerがなぜヤバいのか、我々の開発体験（DX）をどう変えるのかを深掘りする。

## 🗑️ さよなら、`useMemo` と `useCallback`

Reactエンジニアにとって、コンポーネントの再レンダリング最適化は永遠の課題だった。
不要な再レンダリングを防ぐために、少しでも重い計算や子コンポーネントへ渡す関数があれば、脳死で `useMemo` や `useCallback` でラップする。依存配列（dependency array）に何を入れるかで悩み、ESLintの `react-hooks/exhaustive-deps` に怒られ続ける日々……。

**React Compilerは、これらを完全に過去の遺物にした。**

React Compilerは、ビルド時にコードを静的解析し、**「どこがメモ化されるべきか」を自動で判断し、最適なメモ化コードを自動生成（注入）**してくれる。

### コンパイラ導入前のコード

```tsx
import { useState, useMemo, useCallback } from 'react';

function UserProfile({ user, onUpdate }) {
  const [count, setCount] = useState(0);

  // 開発者が手動でメモ化する必要があった
  const expensiveData = useMemo(() => {
    return processData(user.data);
  }, [user.data]);

  const handleClick = useCallback(() => {
    onUpdate(user.id);
  }, [user.id, onUpdate]);

  return (
    <div>
      <UserInfo data={expensiveData} />
      <Button onClick={handleClick}>Update</Button>
    </div>
  );
}
```

### コンパイラ導入後のコード

```tsx
import { useState } from 'react';

function UserProfile({ user, onUpdate }) {
  const [count, setCount] = useState(0);

  // ただの変数代入でOK
  const expensiveData = processData(user.data);

  // ただの関数定義でOK
  const handleClick = () => {
    onUpdate(user.id);
  };

  return (
    <div>
      <UserInfo data={expensiveData} />
      <Button onClick={handleClick}>Update</Button>
    </div>
  );
}
```

コードの可読性が圧倒的に上がるだけでなく、ヒューマンエラーによる「依存配列の指定漏れ（＝バグの温床）」や「過剰なメモ化によるメモリ浪費」が原理的に発生しなくなる。

## ⚙️ どうやって魔法を実現しているのか？

React Compilerは、単なるシンタックスシュガーではない。
コンパイラはコンポーネントを**「制御フローグラフ（CFG）」**として解析し、それぞれの値がどこで生成され、どこで消費されるかを追跡（データフロー解析）する。

そして、値が変更されていない場合（`Object.is`での等価性チェック）は以前のキャッシュを再利用するような、高度に最適化された低レイヤーのコードへと変換して出力するのだ。
人間が手動で書く `useMemo` よりもはるかに粒度が細かく、正確なキャッシュ制御が行われる。

## 🛠️ 既存プロジェクト（React 17/18）への段階的導入

「React 19に上げないと使えないんでしょ？」と思うかもしれないが、実はそうではない。
Meta（Reactチーム）は、既存のエンタープライズ環境にも配慮し、**React 17以降であれば `react-compiler-runtime` パッケージを入れることでオプトインで利用可能**にしている。

ポテトの既存のNext.js（App Router）プロジェクトやVite環境でも、BabelプラグインやViteプラグインを一つ追加するだけで、即座にこの恩恵に与ることができる。

## 🚀 次の一手

これからのReact開発における鉄則は一つ。
**「もう二度と `useMemo` と `useCallback` を手で書くな」** だ。

もしポテトのプロジェクトでまだコンパイラを有効にしていないなら、`next.config.mjs` で `experimental.reactCompiler: true` （あるいは最新版の正式設定）をオンにするだけで世界が変わる。パフォーマンス計測してみると、劇的な改善に驚くはずだ。
