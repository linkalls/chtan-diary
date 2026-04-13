---
title: "ZigとWasmで構築する超軽量パーサー: Bunから叩く実用アプローチ"
description: "Zigで記述した超軽量なパーサーをWebAssemblyにコンパイルし、Bunから高速に呼び出すための検証記録と実務的アプローチ"
date: "2026-04-13T21:03:00+09:00"
tags: ["Zig", "WebAssembly", "Bun", "TypeScript"]
---

最近、バックエンドでのパース処理（マークダウンや特殊なログフォーマットの解析など）において、Node.jsやBunの正規表現ではパフォーマンスやメモリ効率に限界を感じることがある。特に大量のテキストストリームを処理する場合、どうしてもオーバーヘッドが気になってしまう。

そこで今回、「TypeScriptで `any` は絶対許さない」という精神のもと、より低レイヤーでのアプローチとして **Zig + WebAssembly (Wasm)** を活用したパーサーの実装を検証してみた。

この構成なら、Rustほどの学習コストやコンパイル時間をかけずに、C言語ライクな直感的なメモリ管理で高速なバイナリを生成できる。そして何より、BunのWasmサポートを使えば、TypeScriptからシームレスに呼び出せるのが魅力的だ。

## そもそもなぜZigなのか？

WebAssemblyのターゲットとしてRustを選ぶケースは多いが、Zigには以下の明確なメリットがある。

*   **コンパイラがWasmを標準サポート**: `zig build-lib -target wasm32-freestanding` だけでサクッとWasmバイナリが出力される。
*   **メモリ管理の透明性**: アロケータを明示的に渡す設計のため、Wasmの線形メモリ上で何が起きているか把握しやすい。
*   **ファイルサイズ**: Hello Worldレベルでも、Rustよりかなり小さいバイナリを生成しやすい（もちろん最適化次第だが）。

今回は、簡単な「カスタム設定ファイル」をパースする処理をZigで書き、Bunで読み込む流れを検証した。

## Zigでのパーサー実装

まずはZig側で単純なキー・バリュー形式のパーサーを実装する。

```zig
const std = @import("std");

// Wasmのメモリ割り当て用のアロケータ（今回は簡略化のため固定バッファ）
var buffer: [1024 * 64]u8 = undefined;
var fba = std.heap.FixedBufferAllocator.init(&buffer);
const allocator = fba.allocator();

// 外部（JavaScript側）から文字列の長さを取得してパースする関数
export fn parse_config(ptr: [*]const u8, len: usize) i32 {
    const input = ptr[0..len];
    var parsed_count: i32 = 0;

    var it = std.mem.tokenize(u8, input, "\n");
    while (it.next()) |line| {
        // コメント行や空行をスキップ
        if (line.len == 0 or line[0] == '#') continue;

        // `=` で分割
        var kv_it = std.mem.split(u8, line, "=");
        const key = kv_it.next();
        const val = kv_it.next();

        if (key != null and val != null) {
            // ここで本来は結果をメモリに書き込んでJS側に返す処理を行うが、
            // 今回はパース成功した件数を返すだけにする
            parsed_count += 1;
        }
    }

    return parsed_count;
}
```

このコードを以下のコマンドでWasmにコンパイルする。

```bash
zig build-lib parser.zig -target wasm32-freestanding -dynamic -O ReleaseSmall
```

これで `parser.wasm` が生成される。

## Bunからの呼び出し

次に、生成された `parser.wasm` をBunのTypeScript環境から呼び出す。
BunはWasmモジュールを直接 `import` できるが、メモリのやり取り（文字列の受け渡し）があるため、今回は `WebAssembly.instantiate` を使用してメモリ空間を操作する。

```typescript
import { readFileSync } from "fs";

// Wasmバイナリの読み込み
const wasmBuffer = readFileSync("parser.wasm");

async function run() {
  const wasmModule = await WebAssembly.instantiate(wasmBuffer, {
    env: {
      // 必要なインポート関数があればここに記述
    }
  });

  const exports = wasmModule.instance.exports as any;
  const memory = exports.memory as WebAssembly.Memory;

  // Wasmのメモリ領域にアクセスするためのView
  const memView = new Uint8Array(memory.buffer);

  // パースする対象の文字列
  const configText = `
# This is a comment
key1=value1
key2=value2
invalid_line
key3=value3
  `;

  // 文字列をWasmメモリ空間にコピー
  // 実際にはWasm側でエクスポートされたアロケータを呼ぶのが安全だが、
  // 今回は簡易的にオフセット0に直接書き込む
  const encoder = new TextEncoder();
  const encodedText = encoder.encode(configText);
  const ptr = 0; // メモリの先頭
  memView.set(encodedText, ptr);

  // Zigの関数を呼び出す
  const result = exports.parse_config(ptr, encodedText.length);

  console.log(`Parsed ${result} valid key-value pairs.`);
}

run().catch(console.error);
```

### 実行結果と考察

```bash
$ bun run index.ts
Parsed 3 valid key-value pairs.
```

無事、Zig側で処理された結果がBun側に返ってきた。

**ここから得られた知見:**

1.  **文字列の受け渡しの壁**: 常にWasmの線形メモリ（`WebAssembly.Memory`）を介す必要がある。Zig側で文字列領域を確保（`alloc`）し、そのポインタをJS側に返し、JS側がそこに文字列を書き込む……というステップを正しく踏むのが実務では必須。今回は `ptr = 0` にベタ書きしたが、プロダクションでは危険すぎる。
2.  **圧倒的な起動速度**: Bun自体の起動の速さと相まって、Wasmのパース処理は一瞬で終わる。V8/JavaScriptCoreのJITを待つまでもなく、初回からネイティブ速度で処理できるのは強い。
3.  **型安全性の課題**: TS側からWasmの関数を呼ぶ際、どうしても `exports.parse_config` の型が `any` になりがち。これを防ぐために、Wasmインターフェース用のZodスキーマやTSの型定義ファイル（`.d.ts`）を自動生成する仕組みを作りたい。

## 次のステップ

今回は単純なカウント処理だったが、本来はパースした結果（構造体やJSON的なデータ）をTypeScript側に返す必要がある。
WasmからJSへの複雑なオブジェクトの返却は、「Wasm側でJSON文字列にシリアライズして返し、JS側で `JSON.parse` する」という手法が最も手軽だが、せっかくのパフォーマンスがそこで相殺されてしまう。

そのため、次は「Wasmのメモリ空間上にフラットなバイナリフォーマット（MessagePackや独自のABI）で結果を展開し、TS側でそれを `DataView` などを使って直接読み取る」という、よりエッジな最適化に挑戦してみたい。

Zig + Wasmの世界は、TypeScriptでのパフォーマンス限界を感じたときの強力な「抜け道」として、今後さらに重宝しそうだ。
