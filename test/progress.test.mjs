// 阅读进度的存储往返。
//
// 用户报过"每次快捷键按出来还是从本章开头"。根因不在存储层（它一直是好的），
// 而在**存进去的东西是错的** —— 存的是滚动位置，而贴底自动跟随让滚动位置恒为 1，
// 续读又被 `ratio >= 0.99` 判定成"整章读完"，于是每次打开都从头开始。
// 算术那一半由 scroll.test.mjs 的 `readingRatio` / `restoreRevealed` 守着；
// 这里守另一半：写进去的进度必须真的读得回来，且反复写是覆盖而不是堆积。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import 'fake-indexeddb/auto'

import { getProgress, openDatabase, putProgress } from '../src/client/storage.ts'

/**
 * 每个用例一个全新数据库名做隔离。
 *
 * 刻意不用 `deleteDatabase`：在 fake-indexeddb 下它的回调会挂起，
 * 让测试以"Promise resolution is still pending"超时结束（与 library.test.mjs 同样的处理）。
 */
let databaseCounter = 0
function freshDatabase() {
  databaseCounter += 1
  return openDatabase(`dsh-stealth-reader-progress-${databaseCounter}`)
}

test('进度写进去、读回来（续读的地基）', async () => {
  const db = await freshDatabase()
  await putProgress(db, { bookId: 'book-a', chapterIndex: 3, ratio: 0.42, updatedAt: 111 })

  const back = await getProgress(db, 'book-a')
  assert.equal(back?.chapterIndex, 3)
  assert.equal(back?.ratio, 0.42)
})

test('同一本书再写一次是覆盖，不是新增', async () => {
  const db = await freshDatabase()
  await putProgress(db, { bookId: 'book-a', chapterIndex: 1, ratio: 0.1, updatedAt: 1 })
  await putProgress(db, { bookId: 'book-a', chapterIndex: 2, ratio: 0.9, updatedAt: 2 })

  const back = await getProgress(db, 'book-a')
  assert.equal(back?.chapterIndex, 2, '章号应该被覆盖')
  assert.equal(back?.ratio, 0.9, '比例应该被覆盖')
})

test('没读过的书读回来是 undefined（而不是一条 0 进度的假记录）', async () => {
  const db = await freshDatabase()
  assert.equal(await getProgress(db, 'never-opened'), undefined)
})

test('0 与 1 都能原样往返（章首与章末最容易被默认值吃掉）', async () => {
  const db = await freshDatabase()
  await putProgress(db, { bookId: 'start', chapterIndex: 0, ratio: 0, updatedAt: 1 })
  await putProgress(db, { bookId: 'end', chapterIndex: 9, ratio: 1, updatedAt: 2 })

  assert.equal((await getProgress(db, 'start'))?.ratio, 0)
  assert.equal((await getProgress(db, 'end'))?.ratio, 1)
})

test('进度里只有"读到哪里"，没有"滚到哪里"', async () => {
  // 曾经存的是滚动位置。它在自动跟随下恒为 1，记了等于没记 —— 而且正是它让每次
  // 打开都被判成"读完了"，丢回本章开头。
  const db = await freshDatabase()
  await putProgress(db, { bookId: 'book-a', chapterIndex: 2, ratio: 0.5, updatedAt: 3 })

  const back = await getProgress(db, 'book-a')
  assert.ok(!('scrollTop' in back), '进度记录里不该出现滚动位置')
  assert.equal(back.ratio, 0.5)
})
