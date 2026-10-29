import assert from 'node:assert/strict'
import test from 'node:test'
import { createNote, extractWikiLinks, normalizeTags } from '../src/notes.mjs'
import { searchNotes } from '../src/search.mjs'

test('search ranks title matches above body matches', () => {
  const notes = [
    createNote('SQLite 索引', '本地存储与恢复'),
    createNote('同步设计', 'SQLite 索引的增量更新'),
  ]
  const hits = searchNotes(notes, 'sqlite')
  assert.equal(hits.length, 2)
  assert.equal(hits[0].noteId, notes[0].id)
})

test('blank query returns no hits', () => {
  assert.deepEqual(searchNotes([createNote('a', 'b')], '   '), [])
})

test('wiki links are extracted from the body', () => {
  assert.deepEqual(extractWikiLinks('参见 [[同步设计]] 与 [[索引]]'), ['同步设计', '索引'])
})

test('tags are lowercased and de-duplicated', () => {
  assert.deepEqual(normalizeTags([' SQL ', 'sql', '', 'Sync']), ['sql', 'sync'])
})
