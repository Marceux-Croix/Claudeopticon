import { expect, test } from 'claude-code/testing'

import { findMainTodo, isMainTodoName, isTodoFileName, todoKind } from '../hooks/todo-file-names'

// ----------------------------------------------------------------
// Property: a `.html` todo file is a todo file the same as a `.md` one; other files are not.

test('isTodoFileName takes .md and .html names and paths, and no other file', () => {
  for (const name of ['TODO.md', 'TODO.html', 'notes.html', 'archive/OLD.html', '/r/.claude_todo/a.md']) {
    expect(isTodoFileName(name)).toBe(true)
  }
  for (const name of ['categories.json', 'TODO.htm', 'TODO.md.bak', 'html', 'README.txt', '']) {
    expect(isTodoFileName(name)).toBe(false)
  }
})

test('isMainTodoName takes TODO.md and TODO.html in any case, and no other name', () => {
  for (const name of ['TODO.md', 'todo.md', 'TODO.html', 'Todo.HTML']) {
    expect(isMainTodoName(name)).toBe(true)
  }
  for (const name of ['TODO.htm', 'MYTODO.md', 'TODO.md.html', 'archive/TODO.md']) {
    expect(isMainTodoName(name)).toBe(false)
  }
})

test('findMainTodo picks TODO.md before TODO.html, keeps the name as listed, and gives undefined for none', () => {
  expect(findMainTodo(['A.md', 'TODO.html', 'todo.md'])).toBe('todo.md')
  expect(findMainTodo(['A.md', 'todo.HTML'])).toBe('todo.HTML')
  expect(findMainTodo(['A.md', 'B.html'])).toBeUndefined()
  expect(findMainTodo([])).toBeUndefined()
})

// ----------------------------------------------------------------

test('todoKind is html for a .html name or path, else md', () => {
  expect([todoKind('TODO.html'), todoKind('/repo/.claude_todo/archive/x.html'), todoKind('TODO.md'), todoKind('x.htm')]).toEqual(['html', 'html', 'md', 'md'])
})

// ----------------------------------------------------------------
// Property: the extension compares without case, as `listedName` and `isMainTodoName` do: the archive file a disk
// lists as `TODO.HTML` for `todo.html` reads as html, and an `X.MD` file is a todo file.

test('todoKind and isTodoFileName ignore the case of the extension', () => {
  expect([todoKind('x.HTML'), todoKind('archive/TODO.Html'), todoKind('X.MD')]).toEqual(['html', 'html', 'md'])
  for (const name of ['X.MD', 'Notes.Md', 'archive/TODO.HTML', 'a.HtMl']) {
    expect([name, isTodoFileName(name)]).toEqual([name, true])
  }
  for (const name of ['X.MDX', 'TODO.HTM', 'a.MD.BAK']) {
    expect([name, isTodoFileName(name)]).toEqual([name, false])
  }
})
