---
title: "Bunと正規表現でゴリ押す軽量Markdownパーサーの実装と限界"
date: "2026-03-16T05:03:00+09:00"
tags: ["Bun", "TypeScript", "Markdown"]
---

# Bunと正規表現でゴリ押す軽量Markdownパーサーの実装と限界

最近、静的サイトジェネレーターやCLIツールを自作していると、どうしても「ちょっとしたMarkdownのパース」が必要になる場面がある。

`remark`や`marked`といった素晴らしいライブラリは存在するが、依存関係を極力減らしたい、あるいは特定の独自記法だけをサクッと処理したい場合には、いささかオーバースペックに感じることがある。そこで今回は、Bunの高速な実行環境を活かしつつ、正規表現を駆使してどこまで実用的な軽量Markdownパーサーを作れるか実験してみた。

## そもそもなぜ自作するのか

TypeScriptでCLIツールを書く際、`node_modules`が肥大化するのは避けたい。Bunなら単一ファイルにバンドルするのも簡単だが、それでもサードパーティの依存はビルド時間の増加や予期せぬ脆弱性のリスクを伴う。

特に、ブログのフロントマター（YAML）と本文を分離するだけ、あるいは特定の見出し構造だけを抽出するといった用途なら、数百行の正規表現と文字列操作で十分なことが多い。

## 実装のアプローチ

まずはフロントマターの抽出から。これは比較的簡単で、`^---\n([\s\S]*?)\n---`のようなパターンでキャプチャできる。

```typescript
function parseFrontmatter(markdown: string) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { frontmatter: null, content: markdown };
  
  // 簡易的なYAMLパース（実用では制約が大きい）
  const fmString = match[1];
  const frontmatter: Record<string, string> = {};
  
  fmString.split('\n').forEach(line => {
    const [key, ...values] = line.split(':');
    if (key && values.length > 0) {
      frontmatter[key.trim()] = values.join(':').trim().replace(/^['"]|['"]$/g, '');
    }
  });
  
  return {
    frontmatter,
    content: markdown.slice(match[0].length).trim()
  };
}
```

このアプローチの利点は、とにかく軽くて速いことだ。BunのJITコンパイラと正規表現エンジンの相性も良く、数千ファイルの処理も一瞬で終わる。

## AST（抽象構文木）なき世界の苦難

しかし、見出し（Heading）やリスト、コードブロックなどを解析しようとすると、途端に正規表現の限界が見えてくる。

たとえば、コードブロック内に書かれた `# 見出し` を誤爆せずにパースするには、状態を持つステートマシンを実装するか、コードブロックを先に抽出してプレースホルダーに置換するなどのハックが必要になる。

```typescript
// コードブロックを一旦退避する泥臭いハック
const codeBlocks: string[] = [];
let safeContent = content.replace(/```[\s\S]*?```/g, (match) => {
  codeBlocks.push(match);
  return `__CODE_BLOCK_${codeBlocks.length - 1}__`;
});

// ここで安全に見出しを抽出
const headings = [...safeContent.matchAll(/^(#{1,6})\s+(.+)$/gm)].map(m => ({
  level: m[1].length,
  text: m[2]
}));

// 後でプレースホルダーを戻す（省略）
```

こうした「プレースホルダー置換法」は、小規模なスクリプトでは非常に有用だが、ネストされたリストや引用ブロックが絡んでくるとエッジケースの温床になる。

## 結論：どこまで正規表現で戦うべきか

今回の実験を通して得られた結論は、「**AST（抽象構文木）を構築しないパーサーは、用途を極限まで絞るべき**」という当たり前の教訓だった。

フロントマターの抽出、特定のタグの置換、あるいはシンプルな見出しの目次（TOC）生成くらいであれば、Bun + 正規表現の組み合わせは最高に身軽で強力だ。

しかし、MarkdownからHTMLへの完全な変換や、複雑なDOM操作を伴うような処理を自作し始めると、正規表現の複雑さが指数関数的に増大し、結局はバグだらけの「オレオレパーサー」が完成してしまう。

何事も適材適所。軽量さを求めるなら機能を割り切り、フル機能が必要なら素直にエコシステムの巨人に頼るのが一番だ。