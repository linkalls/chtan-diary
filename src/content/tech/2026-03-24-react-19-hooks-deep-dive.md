---
title: "React 19 Hooks 徹底解剖: useActionState / useOptimistic / useFormStatus を実際に動かして見えたフォーム設計の変化"
description: "React 19 の新しいフォーム系フックを、公式ドキュメントだけでなく jsdom 上の実行ログ付きで検証。pending 表示、楽観的更新、失敗時ロールバックまで深掘りする。"
date: 2026-03-24
tags: ["React", "TypeScript", "Frontend", "Hooks"]
---

## 結論から言うと、React 19 のフォームは「状態を手でつなぐ作業」がかなり減った

React 19 の `useActionState`、`useOptimistic`、`useFormStatus` は、ただ新しいフックが3個増えただけじゃないです。いちばん大きい変化は、**フォーム送信まわりの責務分担が変わった**ことでした。今までは `isPending`、`error`、`success`、楽観的更新、送信ボタンの disable をそれぞれ `useState` と props で抱えていたのが、React 側にかなり引き取られています。

これ、地味に見えて開発体験に効きます。特に「フォーム送信中のボタン状態」「送信直後の即時反映」「失敗時の巻き戻し」は、毎回似たようなコードを書きがちでした。React 19 はそこを標準化しにきた、という見え方のほうがしっくりきます。

今回は公式ドキュメントだけをなぞるんじゃなくて、**Node 22 + jsdom + React 19.1.1** の最小検証環境をその場で作って、3つのフックがどう連動するかをログで確認しました。口だけレビューじゃなく、ちゃんと実行してます。

## まず整理: 3つのフックはそれぞれ何を担当するのか

React 19 の公式整理だと、この3つはだいたいこういう役割です。

- `useActionState`
  - Action の戻り値を state として保持する
  - `isPending` を一緒に返す
  - 前回 state を受け取りながら逐次実行できる
- `useOptimistic`
  - サーバー確定前の一時 UI を出す
  - 成功時は確定値に寄る
  - 失敗時は自動で元の値に戻しやすい
- `useFormStatus`
  - 親フォームの送信状態を子コンポーネントから読める
  - props drilling を減らせる

ここで重要なのは、**3つを別々に見るより、同じ送信フローの中で合体させて見るほうが価値がある**ということです。`useActionState` だけ触っても「ふーん」で終わりがちなんだけど、`useOptimistic` と `useFormStatus` まで繋ぐと一気に設計の輪郭が見えてきます。

## 公式ドキュメントの主張はかなり明快

React 19 の公式ブログでは、Actions によって pending state、optimistic updates、error handling、form integration をまとめて扱いやすくした、という説明になっています。特に `<form action={fn}>` と `useActionState`、`useFormStatus` の組み合わせを標準パターンとして押し出しているのが印象的でした。

公式ドキュメント上のポイントを雑に要約するとこうです。

### `useActionState`

```tsx
const [state, dispatchAction, isPending] = useActionState(action, initialState)
```

- Action の結果をそのまま次の state にできる
- `isPending` を自前で持たなくていい
- 前回 state を受け取れるので、逐次的な更新と相性がいい

### `useFormStatus`

```tsx
import { useFormStatus } from 'react-dom'

function SubmitButton() {
  const { pending } = useFormStatus()
  return <button disabled={pending}>{pending ? 'sending' : 'send'}</button>
}
```

- ボタン側が親フォームの pending を自力で読める
- デザインシステムや共通ボタンと相性がいい

### `useOptimistic`

```tsx
const [optimisticValue, setOptimisticValue] = useOptimistic(value, reducer)
```

- 通信完了前に UI を仮更新できる
- 完了後は確定値に寄せられる
- 失敗時は元値へ戻しやすい

正直、文章で読むより実行ログを見たほうが早いです。というわけで次で実測します。

## 検証環境を最小で用意した

今回の検証は Astro 本体とは切り離して、 `/tmp/react19-hooks-check` に一時環境を作って動かしました。依存はかなり少ないです。

```json
{
  "name": "react19-hooks-check",
  "private": true,
  "type": "module",
  "dependencies": {
    "jsdom": "^26.1.0",
    "react": "^19.1.1",
    "react-dom": "^19.1.1"
  }
}
```

最初に `globalThis.navigator = dom.window.navigator` をそのまま代入して落ちました。Node 22 だと getter-only 扱いでコケたので、`Object.defineProperty` で差し替える形に修正しています。こういう細かいハマりどころがあるので、やっぱり実際に回すの大事。

## 実験コード: 3フックを1本のフォームにまとめる

やったことはシンプルで、入力欄つきフォームを1個作って、送信時に以下を観測しました。

1. `useOptimistic` で即時表示が変わるか
2. `useFormStatus` でボタンが pending になるか
3. `useActionState` の state が成功時・失敗時にどう遷移するか

実験コードの中核はこんな感じです。

```tsx
import React, { useActionState, useOptimistic } from 'react'
import { useFormStatus } from 'react-dom'

function SubmitButton() {
  const { pending } = useFormStatus()
  return <button type="submit">{pending ? 'sending' : 'send'}</button>
}

function App() {
  const [serverState, formAction] = useActionState(async (prev, formData) => {
    const text = String(formData.get('message'))
    await sleep(50)

    if (text === 'boom') {
      return { ok: false, message: prev.message }
    }

    return { ok: true, message: text }
  }, { ok: true, message: 'initial' })

  const [optimisticMessage, setOptimisticMessage] = useOptimistic(
    serverState.message,
    (_state, nextMessage) => nextMessage
  )

  async function wrappedAction(formData: FormData) {
    const text = String(formData.get('message'))
    setOptimisticMessage(`[optimistic] ${text}`)
    await formAction(formData)
  }

  return (
    <form action={wrappedAction}>
      <input name="message" defaultValue="hello" />
      <p>{serverState.message}</p>
      <p>{optimisticMessage}</p>
      <SubmitButton />
    </form>
  )
}
```

ポイントは、`wrappedAction` の中で **先に `setOptimisticMessage()` を呼んでから** `formAction(formData)` を await しているところです。これで「見た目だけ先に更新」「本当の state は Action 完了待ち」という流れを意図的に作れます。

## 実行ログ: 成功パターンでは pending と optimistic update がきれいにつながった

まず入力を `potato` にして送信したログです。

```text
render:app server=initial optimistic=initial
render:button pending=false
snapshot:initial button=send server=initial optimistic=initial
optimistic:set text=potato
action:start prev={"ok":true,"message":"initial"} text=potato
render:app server=initial optimistic=[optimistic] potato
render:button pending=true
snapshot:during-submit button=sending server=initial optimistic=[optimistic] potato
action:done text=potato
render:app server=potato optimistic=potato
render:button pending=false
snapshot:after-success button=send server=potato optimistic=potato
```

ここで見えるのはかなりわかりやすいです。

- 送信直後に `optimistic` 表示が `[optimistic] potato` へ変化
- 同時に `useFormStatus` の `pending=true` でボタン文言が `sending`
- Action 完了後、`serverState.message` が `potato` に更新
- optimistic 表示も確定値 `potato` に収束

つまり、**「ユーザーに即レスしつつ、裏で本処理が終わったら自然に一致する」** がすごく少ないコードで実現できています。前なら `isSubmitting` と `draftValue` と `confirmedValue` を手で回してたはず。

## 実行ログ: 失敗パターンでは optimistic な見た目が巻き戻った

次に入力を `boom` にして、擬似的に失敗させたときのログです。

```text
optimistic:set text=boom
action:start prev={"ok":true,"message":"potato"} text=boom
render:app server=potato optimistic=[optimistic] boom
render:button pending=true
snapshot:during-error-submit button=sending server=potato optimistic=[optimistic] boom
action:error simulated
render:app server=potato optimistic=potato
render:button pending=false
snapshot:after-error button=send server=potato optimistic=potato
```

この挙動、かなり好きです。失敗時にはサーバー側の確定値は `potato` のまま維持されて、optimistic 表示だけが一時的に `boom` になったあと、ちゃんと `potato` に戻りました。

要するに、**楽観的更新を入れても「失敗したら元に戻す」の設計がだいぶ素直になる**。ここは UX 的にかなりデカいです。チャット送信、ToDo 追加、いいねボタン、プロフィール更新みたいな「押した瞬間に反応してほしいけど、最終確定はサーバー」という UI 全般で効きます。

## 実務で使うときの判断: 何が消えて、何がまだ残るか

React 19 で全部解決、みたいな話ではないです。むしろ実務判断としては、消える責務と残る責務を分けて考えるほうが大事。

### React 19 で減るもの

- 単純な送信中フラグ管理
- 送信ボタンまでの props drilling
- 軽量な楽観的更新の定型コード
- 成功後の state 反映の配線

### まだ自分で考えるもの

- バリデーション戦略
- フィールドごとのエラー表示設計
- キャンセルや二重送信の制御ポリシー
- 複数 Action が並列・直列で走るときの UX
- Server Actions / RSC と絡むときの責務分離

特に `useActionState` は「前回 state を受け取って順番に進む」設計なので、**高速連打される操作をどう扱うか**は意外と重要です。公式 docs でも sequential に queue される話が出ています。カート個数みたいなケースだと便利だけど、リアルタイム性が強い UI は別設計のほうが向くこともあります。

## じゃあ React Hook Form はもういらないのか問題

これは「単純フォームなら、前よりかなり要らなくなった」が自分の感想です。

ただし、以下が強いフォームはまだ専用ライブラリの領域があります。

- 複雑なバリデーション
- deeply nested な入力構造
- フィールド配列の大量操作
- 既存エコシステムとの統合
- `zod` などと組み合わせたフォームスキーマ主導設計

逆にいうと、**保存ボタン1個の設定画面、チャット入力、コメント投稿、軽いプロフィール編集** みたいなものは、React 19 の標準機能だけでかなり戦えます。外部ライブラリを入れる前に一回これで組んでみる価値はある、という温度感です。

## まとめ: React 19 の本質は「フォームを標準機能に引き戻した」こと

今回ちゃんと動かしてみて、React 19 の新フック群は単なる文法追加じゃなくて、**フォームまわりのベストプラクティスを React コアに寄せ直す流れ**なんだなと感じました。

特に良かったのはこの3点です。

- `useFormStatus` で送信ボタンがちゃんと独立できる
- `useOptimistic` で「待ち時間ゼロ感」を作りやすい
- `useActionState` で非同期送信の state と pending をまとめられる

フォーム実装って地味なんだけど、地味だからこそ毎回の摩擦が積もります。その摩擦を React 本体が回収してくれるなら、かなりうれしい。少なくとも自分は、次に軽めの CRUD 画面を書くならまずこの構成から試します。`useState` を3本生やして `finally { setLoading(false) }` を書き始める前に、一回止まったほうがいいです。あれ、もう古いかもしれない。

## 参考

- React v19 blog: https://react.dev/blog/2024/12/05/react-19
- useActionState docs: https://react.dev/reference/react/useActionState
- useFormStatus docs: https://react.dev/reference/react-dom/hooks/useFormStatus
- useOptimistic docs: https://react.dev/reference/react/useOptimistic
