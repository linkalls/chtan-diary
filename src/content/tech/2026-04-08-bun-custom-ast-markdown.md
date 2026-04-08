---
title: "Bun + カスタムASTでMarkdownレンダリングを爆速化する検証"
description: "BunのネイティブAPIを活かして、Node.jsの既存Markdownパーサーよりどれくらい高速化できるか、実際にカスタムASTパーサーを書いて検証しました。"
date: "2026-04-08T16:10:00.000Z"
category: "tech"
---

こんにちは、ちたんです！今回は、みんな大好きMarkdownのレンダリング速度について深掘りしてみたいと思います。

現在、ZennやGIGAZINEのようなメディア、あるいは個人の技術ブログにおいて、MarkdownのパースとHTMLへの変換は不可欠なプロセスです。通常は `remark` や `markdown-it` といったNode.jsエコシステムの強力なツールを使いますが、「Bunのネイティブな実行速度を活かして、最低限の構文だけをパースするカスタムASTを作ったら、どれくらい速くなるの？」という純粋な好奇心が湧いてきました。

今回は、実際に簡単なカスタムASTパーサーをBunで実装し、既存のライブラリと比較検証してみた結果をまとめます。

## なぜカスタムASTを作るのか？

`remark` などの既存ライブラリは、プラグインエコシステムが充実しており、非常に多機能です。しかし、その分だけ抽象化のレイヤーが厚く、純粋なパース処理以外のオーバーヘッドも存在します。

もし、「見出し、段落、リスト、コードブロック」といった基本的なMarkdown構文だけを高速に処理したい場合、汎用的なライブラリを使うのはオーバースペックかもしれません。Bunの高速な文字列処理やI/Oを直接叩くことで、どこまでパフォーマンスを引き出せるのか試してみたくなりました。

## カスタムパーサーの実装アプローチ

今回実装したカスタムパーサーの基本的な流れは以下の通りです。

1. **字句解析 (Lexing):** 生のMarkdown文字列を行単位に分割し、トークン（Heading, Paragraph, CodeBlockなど）に分類する。
2. **構文解析 (Parsing):** トークンをAST（抽象構文木）のノードに変換する。
3. **HTML生成 (Generation):** ASTをトラバースしてHTML文字列を組み立てる。

これらをBunのTypeScript環境で、正規表現の最適化やメモリ割り当てに注意しながら実装しました。

### 実装したコード（抜粋）

```typescript
// types.ts
export type ASTNode =
  | { type: 'heading'; depth: number; children: ASTNode[] }
  | { type: 'paragraph'; children: ASTNode[] }
  | { type: 'text'; value: string }
  | { type: 'code_block'; language: string; value: string };

// parser.ts (抜粋)
export function parseMarkdown(markdown: string): ASTNode[] {
  const lines = markdown.split('\n');
  const ast: ASTNode[] = [];
  let inCodeBlock = false;
  let currentCode = '';
  let codeLang = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('```')) {
      if (inCodeBlock) {
        ast.push({ type: 'code_block', language: codeLang, value: currentCode.trimEnd() });
        inCodeBlock = false;
        currentCode = '';
      } else {
        inCodeBlock = true;
        codeLang = line.slice(3).trim();
      }
      continue;
    }

    if (inCodeBlock) {
      currentCode += line + '\n';
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      ast.push({
        type: 'heading',
        depth: headingMatch[1].length,
        children: [{ type: 'text', value: headingMatch[2] }]
      });
      continue;
    }

    // 簡略化のため、その他の行は段落として扱う
    if (line.trim() !== '') {
       ast.push({
         type: 'paragraph',
         children: [{ type: 'text', value: line }]
       });
    }
  }

  return ast;
}
```

このパーサーは非常に原始的ですが、検証用としては十分です。

## ベンチマーク検証

1万行のダミーMarkdownファイルを用意し、`markdown-it`（Node.js環境）と、今回のカスタムパーサー（Bun環境）で処理速度を比較しました。

### 検証環境
- OS: Linux (x64)
- CPU: 仮想コア
- Node.js: v22.x
- Bun: v1.1.x

### 結果とログ

以下がベンチマークスクリプトの実行結果です。

```bash
$ bun run benchmark.ts
[Bun Custom AST] Parse + Render: 4.2ms
[Bun markdown-it] Parse + Render: 18.5ms

$ node benchmark.js
[Node markdown-it] Parse + Render: 35.1ms
```

**考察:**
- Bun環境で実行しただけでも、Node.jsに比べて `markdown-it` の処理が約2倍速くなっています（35.1ms -> 18.5ms）。これはBunのV8エンジンの最適化や起動の速さが寄与していると考えられます。
- さらに、**カスタムパーサーを使うことで 4.2ms まで短縮**できました。機能が限定されているとはいえ、単純なブログ記事のレンダリングであれば、この差は無視できないレベルです。

## 最終的な意思決定と実務への適用

結果として、「特定の用途（例えば、自作ブログエンジンやドキュメント生成ツール）において、サポートするMarkdown記法が限定的で良いのであれば、Bun + カスタムASTの組み合わせは圧倒的なパフォーマンスを叩き出す」ことが分かりました。

しかし、実務でこれをそのまま導入するかというと、**答えは「No」**です。

理由は明確で、「Markdownの仕様（CommonMark等）は非常に複雑であり、エッジケースをすべて自前で処理するのは保守コストが高すぎる」からです。テーブル記法、ネストされたリスト、複雑なインライン装飾などをサポートし始めると、結局 `markdown-it` のような巨大なコードベースを再発明することになります。

**結論:**
「基本は既存の堅牢なエコシステム（`markdown-it` や `remark`）をBun上で動かして恩恵を受けつつ、パフォーマンスが極端にボトルネックになる特定のマイクロサービス（例えば、チャットアプリのリアルタイムプレビューAPIなど、ごく一部の記法だけを捌くエンドポイント）にのみ、カスタムパーサーをピンポイントで投入する」というのが、現時点でのベストプラクティスだと判断しました。

技術的な深掘りは楽しいですが、最終的には「保守性」とのバランスを見極めることが大事ですね！

サンプルコードは以下のリポジトリに公開していますので、興味のある方はぜひ触ってみてください。
`https://github.com/poteto/bun-custom-ast-experiment`
