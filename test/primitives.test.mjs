// primitives 接入层的契约测试。
//
// 这些测试存在的理由：0.1.7 把 `MarkdownText` 的 `labels` 从可选改成**必填**，而渲染器是
// 无保护解引用（`dsh-client-ui-primitives/lib/index.js:10725-10727` 的
// `context.labels.code.copyLabel`、`:11025` 的 `context.labels.footnotes`）。
// 漏传的后果不是"文案不对"，而是**章节正文里一旦出现代码块或脚注就 TypeError**，
// slot entry 被错误边界整条摘掉 —— 屏幕上那一段阅读流直接消失，且只在特定章节复现。
//
// 所以这里钉两件事：
//   1. `resolveMarkdownLabels` 对缺失与畸形的输入都给出安全值；
//   2. 套上外壳后，**忠实复刻 0.1.7 无保护解引用**的组件既不会崩、也照常输出正文。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  FALLBACK_MARKDOWN_LABELS,
  pickIcon,
  resolveMarkdownLabels,
  withSafePrimitives,
} from '../src/client/primitives.ts'

/** 逐字复刻 0.1.7 渲染器那句无保护解引用（本文件的"真值来源"）。 */
function UnprotectedMarkdownText({ text, labels }) {
  return React.createElement(
    'div',
    null,
    `${labels.code.copyLabel}/${labels.code.copiedLabel}/${labels.footnotes}:${text}`,
  )
}

test('labels 缺失时给出安全默认值，且是**同一个对象**', () => {
  for (const missing of [undefined, null]) {
    const labels = resolveMarkdownLabels(missing)
    assert.equal(typeof labels.code.copyLabel, 'string')
    assert.equal(typeof labels.code.copiedLabel, 'string')
    assert.equal(typeof labels.footnotes, 'string')
    // 引用必须稳定：MarkdownText 的 props 文档明说 labels 换新对象会丢掉流式渲染缓存。
    assert.equal(labels, FALLBACK_MARKDOWN_LABELS, '缺省路径必须命中同一个单例')
  }
})

test('兜底文案与 0.1.7 自带的中文词典一致（不是自己编的）', () => {
  // 物证：dsh-client-locale/lib/client.js:933-937,966
  assert.deepEqual(FALLBACK_MARKDOWN_LABELS, {
    code: {
      copyLabel: '复制',
      copiedLabel: '复制成功',
      toolbarLabels: {
        codeLabel: '代码块',
        wrapLabel: '自动换行',
        unwrapLabel: '取消自动换行',
      },
    },
    footnotes: '脚注',
  })
})

test('畸形的 labels 被逐字段补齐，且同一份输入永远得到同一个输出对象', () => {
  const broken = [
    {}, // 空对象
    { code: null },
    { code: {} },
    { code: { copyLabel: 42, copiedLabel: '已复制' } }, // 类型错 + 少一项
    { code: { copyLabel: '复制', copiedLabel: '复制成功' } }, // 少 footnotes
    { code: { copyLabel: '复制', copiedLabel: '复制成功', toolbarLabels: null }, footnotes: '脚注' },
    { footnotes: '脚注' },
    'labels', // 根本不是对象
    7,
  ]

  for (const input of broken) {
    const labels = resolveMarkdownLabels(input)
    assert.equal(typeof labels.code.copyLabel, 'string', `${JSON.stringify(input)} 的 copyLabel`)
    assert.equal(typeof labels.code.copiedLabel, 'string')
    assert.equal(typeof labels.footnotes, 'string')
    // toolbarLabels 给了就必须成形：CodeToolbar 直接读 labels.codeLabel。
    assert.equal(typeof labels.code.toolbarLabels.codeLabel, 'string')
    assert.equal(typeof labels.code.toolbarLabels.wrapLabel, 'string')
    assert.equal(typeof labels.code.toolbarLabels.unwrapLabel, 'string')

    if (input !== null && typeof input === 'object') {
      assert.equal(resolveMarkdownLabels(input), labels, '同一份输入必须命中缓存，保持引用稳定')
    }
  }
})

test('完整的 labels 原样放行（连"故意省略 toolbarLabels"也尊重）', () => {
  const mine = { code: { copyLabel: 'Copy', copiedLabel: 'Copied' }, footnotes: 'Footnotes' }
  assert.equal(resolveMarkdownLabels(mine), mine, '不该制造新对象')
  assert.equal(mine.code.toolbarLabels, undefined, '省略 toolbarLabels 是 0.1.7 允许的（无工具栏布局）')
})

test('withSafePrimitives：缺 labels 既不崩、也仍然输出正文', () => {
  const module = {
    MarkdownText: UnprotectedMarkdownText,
    StateDot: () => null,
    DisclosureRow: () => null,
  }

  // 先证明这个替身是忠实的：不套外壳时，正是 0.1.7 在真实书源上会崩的那一下。
  assert.throws(
    () => UnprotectedMarkdownText({ text: '正文' }),
    TypeError,
    '替身必须复刻 0.1.7 的无保护解引用，否则本文件等于没测',
  )

  const primitives = withSafePrimitives(module)
  assert.equal(primitives.StateDot, module.StateDot, '其余成员原样透传')
  assert.notEqual(primitives.MarkdownText, module.MarkdownText, 'MarkdownText 必须被换成带兜底的外壳')
  assert.equal(module.MarkdownText, UnprotectedMarkdownText, '不能就地改写模块对象（ESM 命名空间是只读的）')

  // 调用点照旧不传 labels（reading.tsx 就是 `{ text, streaming: false }`）。
  const html = renderToStaticMarkup(
    React.createElement(primitives.MarkdownText, { text: '第一章 正文', streaming: false }),
  )
  assert.match(html, /第一章 正文/, '正文必须照常输出')
  assert.match(html, /复制/, 'labels 由外壳补上')
})

test('withSafePrimitives：显式传入的完整 labels 不被改写；畸形值也不会传到渲染器', () => {
  const module = { MarkdownText: UnprotectedMarkdownText }
  const primitives = withSafePrimitives(module)
  const mine = { code: { copyLabel: 'Copy', copiedLabel: 'Copied' }, footnotes: 'Footnotes' }

  assert.equal(
    renderToStaticMarkup(React.createElement(primitives.MarkdownText, { text: 'A', labels: mine })),
    '<div>Copy/Copied/Footnotes:A</div>',
  )
  assert.doesNotThrow(() =>
    renderToStaticMarkup(
      React.createElement(primitives.MarkdownText, { text: 'B', labels: { code: null } }),
    ),
  )
})

test('withSafePrimitives：模块不是对象时返回 null（调用方退回自绘）', () => {
  assert.equal(withSafePrimitives(undefined), null)
  assert.equal(withSafePrimitives(null), null)
  assert.equal(withSafePrimitives('not a module'), null)
  // 没有 MarkdownText 的模块照常返回：其他原语仍然可用。
  const bare = { StateDot: () => null }
  assert.equal(withSafePrimitives(bare), bare)
})

test('MarkdownText 是 React.memo 对象时，兜底外壳必须照样套上', () => {
  // 前提（0.1.7 实测）：React.memo 返回的是**对象**，`typeof` 不是 'function'：
  //   typeof MarkdownText → 'object'，$$typeof → Symbol(react.memo)
  // 只认函数的判据会在这里提前 return，于是 labels 兜底整条失效 —— 正文里出现
  // 代码块或脚注就是 TypeError，而且不报错、只在特定章节复现。
  assert.equal(typeof React.memo(() => null), 'object', '前提：memo 产物的 typeof 是 object')

  const MemoMarkdown = React.memo(UnprotectedMarkdownText)
  const primitives = withSafePrimitives({ MarkdownText: MemoMarkdown })

  assert.notEqual(
    primitives.MarkdownText,
    MemoMarkdown,
    'memo 形态被 `typeof === "function"` 判成"基线没有 MarkdownText"，兜底外壳没套上',
  )
  const html = renderToStaticMarkup(
    React.createElement(primitives.MarkdownText, { text: '第二章 正文', streaming: false }),
  )
  assert.match(html, /第二章 正文/, '正文必须照常输出')
  assert.match(html, /复制/, 'labels 必须由外壳补上')
})

test('pickIcon 也认 memo 形态的图标（不能把 memo 组件当成"名字在但值不是组件"）', () => {
  const MemoIcon = React.memo(() => null)
  assert.equal(typeof MemoIcon, 'object', '前提：memo 图标是对象')
  assert.equal(pickIcon({ IconThinkOutlineRegular: MemoIcon }, 'IconThinkOutlineRegular'), MemoIcon)
})

test('pickIcon：新名优先、旧名兜底、非函数视为缺失', () => {
  const Regular = () => null
  const Legacy = () => null

  // 0.1.7：只有新名（lib/types/icons/index.d.ts 里 Outline14|Outline16 命中 0）
  assert.equal(
    pickIcon({ IconChevronRightOutlineRegular: Regular }, 'IconChevronRightOutlineRegular', 'IconChevronRightOutline14'),
    Regular,
  )
  // 旧版：只有旧名
  assert.equal(
    pickIcon({ IconChevronRightOutline14: Legacy }, 'IconChevronRightOutlineRegular', 'IconChevronRightOutline14'),
    Legacy,
  )
  // 两版都在时取新名
  assert.equal(
    pickIcon(
      { IconChevronRightOutlineRegular: Regular, IconChevronRightOutline14: Legacy },
      'IconChevronRightOutlineRegular',
      'IconChevronRightOutline14',
    ),
    Regular,
  )
  // 名字在、值不是组件 → 按"没有"处理，绝不把非组件塞进 createElement
  assert.equal(pickIcon({ IconChevronRightOutlineRegular: 'svg' }, 'IconChevronRightOutlineRegular'), undefined)
  assert.equal(pickIcon({}, 'IconChevronRightOutlineRegular'), undefined)
  assert.equal(pickIcon(null, 'IconChevronRightOutlineRegular'), undefined)
})
