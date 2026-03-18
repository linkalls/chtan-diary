---
title: "ZigとWasmで遊ぶ：手動メモリ管理とWebブラウザの境界線"
date: "2026-03-18T17:05:00+09:00"
tags: ["Zig", "WebAssembly", "TypeScript"]
description: "TypeScript/JavaScriptの世界から一歩踏み出し、ZigでWasmモジュールを書いてみる。手動メモリ管理の面白さと、ブラウザとのやり取りの仕組みについて。"
---

TypeScriptで`any`を駆使する（というか撲滅する）日々に少し疲れを感じたとき、ふと低レイヤーの風を浴びたくなることがある。最近はRustだけでなく、Zigの勢いも目覚ましい。今回はZigで書いたコードをWebAssembly（Wasm）にコンパイルし、ブラウザ上で動かす実験をしてみた。

Zigの魅力は「隠された制御フローがない」ことと、「メモリの確保が常に明示的」であることだ。ガベージコレクション（GC）に慣れきったフロントエンドエンジニアにとって、これは新鮮な体験でもあり、同時に恐ろしい体験でもある。しかし、Wasmという箱庭の中であれば、多少メモリをリークさせても（ブラウザのタブを閉じれば済むので）安全に実験ができる。

## ZigからWasmへのコンパイル

Zigは標準でWasmの出力をサポートしている。LLVMバックエンドの恩恵により、特別なツールチェーンを追加インストールしなくても、`zig build-lib` コマンド一発で`.wasm`ファイルが生成される。このDX（開発者体験）の良さは異常だ。

```zig
// math.zig
export fn add(a: i32, b: i32) i32 {
    return a + b;
}
```

これをコンパイルするには、以下のコマンドを実行するだけ。

```bash
zig build-lib math.zig -target wasm32-freestanding -dynamic
```

あっという間に`math.wasm`が生成される。これだけでも「おっ、動いた」という感動があるが、単に数値を足すだけでは面白くない。文字列や配列をブラウザとやり取りするにはどうすればいいのか。ここからが手動メモリ管理の本番だ。

## メモリの境界を越える

WasmとJavaScript/TypeScriptの間では、数値（`i32`, `f64`など）は直接やり取りできるが、文字列やオブジェクトといった複雑なデータ型はそのままでは渡せない。Wasmのメモリ（線形メモリ）上のどこにデータがあるかという「ポインタ」と「長さ」を渡す必要がある。

Zig側で文字列を返す関数を書いてみよう。

```zig
const std = @import("std");

var buffer: [100]u8 = undefined;

export fn get_greeting() [*]const u8 {
    const msg = "Hello from Zig Wasm!";
    std.mem.copy(u8, &buffer, msg);
    return &buffer;
}

export fn get_greeting_len() usize {
    return "Hello from Zig Wasm!".len;
}
```

ここでは、静的に確保したバッファに文字列をコピーし、そのポインタを返している。TypeScript側では、このポインタを受け取り、Wasmのメモリから文字列を読み取る必要がある。

## TypeScript側からの呼び出し

ブラウザ（TypeScript）側では、`WebAssembly.instantiateStreaming` などを使ってWasmモジュールを読み込む。そして、Wasmのエクスポートされた関数とメモリ（`exports.memory`）を使ってデータを復元する。

```typescript
async function loadWasm() {
  const response = await fetch('/math.wasm');
  const { instance } = await WebAssembly.instantiateStreaming(response);
  const exports = instance.exports as any; // ここは一旦anyで許して...

  // ポインタと長さを取得
  const ptr = exports.get_greeting();
  const len = exports.get_greeting_len();

  // Wasmのメモリ空間（ArrayBuffer）から文字列を読み取る
  const memory = new Uint8Array(exports.memory.buffer, ptr, len);
  const decoder = new TextDecoder('utf-8');
  const greeting = decoder.decode(memory);

  console.log(greeting); // "Hello from Zig Wasm!"
}
```

このように、WasmとJSの間には「メモリの共有」という低いレイヤーでのやり取りが存在する。普段ReactやNext.jsで隠蔽されているDOMやメモリの操作が、ここでは全てむき出しになっている。

## 手動メモリ管理のロマン

今回は静的なバッファを使ったが、動的にメモリを確保する（アロケータを使う）場合は、Zig側で`alloc`と`free`を行うエクスポート関数を用意し、JS側から適切なタイミングで呼び出してメモリを解放してやる必要がある。

これは非常に面倒くさい。しかし、同時に「自分がメモリのどこからどこまでを管理しているか」が完全に把握できるという、謎の万能感（ロマン）がある。TypeScriptの型システムで状態を縛るのとはまた違った、物理的なリソースを制御している感覚だ。

フロントエンドのパフォーマンス最適化において、Wasmは常に「銀の弾丸」ではない。DOM操作が絡むとオーバーヘッドのほうが大きくなることも多い。しかし、画像処理や音声処理、暗号化など、純粋な計算タスクにおいては、Zigのような言語でWasmを書く強力な選択肢となる。何より、書いていて純粋に楽しい。次はもう少し実用的なアルゴリズム（例えばFSRSのコアロジックなど）をZigで書き直してみるのも面白いかもしれない。
