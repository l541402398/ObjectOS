import assert from 'node:assert/strict'
import test from 'node:test'
import { createNote } from '../src/notes.mjs'
import { buildGraph } from '../src/graph.mjs'

test('graph edges follow resolved wiki links', () => {
  const index = createNote('索引', '根节点')
  const sync = createNote('同步设计', '参见 [[索引]]')
  const graph = buildGraph([index, sync])
  assert.equal(graph.edges.length, 1)
  assert.equal(graph.edges[0].source, sync.id)
  assert.equal(graph.edges[0].target, index.id)
})

test('unresolved links do not create edges', () => {
  const graph = buildGraph([createNote('孤立笔记', '参见 [[不存在的笔记]]')])
  assert.equal(graph.edges.length, 0)
  assert.equal(graph.nodes[0].degree, 0)
})
