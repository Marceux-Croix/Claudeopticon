import { expect, test } from 'claude-code/testing'

import { findMainTodo, isMainTodoName, isTodoFileName } from '../hooks/todo-file-names'

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
