import { expect, it, vi } from 'vitest'
import { collectHistoryWindow, readHistoryPage } from './history-live.js'
const item = (id: string) => ({ id, createdAt: null, deliveryId: null, delivery: null })
const signal = () => new AbortController().signal
it('copies only public metadata while preserving legacy nulls and native order', () => {
  const value = { ...item('older-id-sorts-first'), numbers: [8, 15], owner: 'private-user', token: 'private-token' }
  const page = readHistoryPage({ commands: [item('zz-newest'), value], nextCursor: null }, 20)
  expect(page.commands.map(row => row.id)).toEqual(['zz-newest', value.id]); expect(page.commands[1]).toEqual(item(value.id))
  expect(JSON.stringify(page)).not.toMatch(/numbers|private-/); expect(Object.isFrozen(page.commands)).toBe(true)
})
it('reads the entire 200-row window in two serial bounded calls with one captured context', async () => {
  let release!: (value: unknown) => void
  const read = vi.fn().mockImplementationOnce(() => new Promise(done => { release = done })).mockResolvedValueOnce({ commands: Array.from({ length: 100 }, (_, i) => item('older-' + i)), nextCursor: 'next2' })
  const options = { slots: 10, signal: signal(), read }, pending = collectHistoryWindow(options); options.slots = 1
  expect(read).toHaveBeenCalledTimes(1); expect(read.mock.calls[0]![0]).toMatchObject({ limit: 100, after: null }); expect(Object.isFrozen(read.mock.calls[0]![0])).toBe(true)
  release({ commands: Array.from({ length: 100 }, (_, i) => item('newer-' + i)), nextCursor: 'next1' })
  const page = await pending; expect(page.commands).toHaveLength(200); expect(page.nextCursor).toBe('next2'); expect(read).toHaveBeenCalledTimes(2)
  expect(read.mock.calls[1]![0]).toMatchObject({ limit: 100, after: 'next1', signal: options.signal })
})
it('keeps the selected loaded window size and permits an emptied live filter', async () => {
  const read = vi.fn().mockResolvedValue({ commands: [], nextCursor: null })
  expect(await collectHistoryWindow({ slots: 2, signal: signal(), read })).toEqual({ commands: [], nextCursor: null }); expect(read.mock.calls[0]![0].limit).toBe(40)
  for (const slots of [0, 11, 1.5]) await expect(collectHistoryWindow({ slots, signal: signal(), read })).rejects.toThrow('command list')
  expect(read).toHaveBeenCalledTimes(1)
})
it('refuses malformed, partial, duplicate or looping pages instead of publishing a partial window', async () => {
  for (const data of [{ commands: [], nextCursor: 'somewhere' }, { commands: [item('same'), item('same')], nextCursor: null }, { commands: [item('one')], nextCursor: '../private' }, { commands: [{ ...item('one'), createdAt: -1 }], nextCursor: null }]) expect(() => readHistoryPage(data, 20)).toThrow('command list')
  const commands = Array.from({ length: 100 }, (_, i) => item(String(i)))
  const duplicate = vi.fn().mockResolvedValueOnce({ commands, nextCursor: 'same' }).mockResolvedValueOnce({ commands, nextCursor: null })
  await expect(collectHistoryWindow({ slots: 10, signal: signal(), read: duplicate })).rejects.toThrow('command list')
  const loop = vi.fn().mockResolvedValueOnce({ commands, nextCursor: 'same' }).mockResolvedValueOnce({ commands: commands.map(row => item('older-' + row.id)), nextCursor: 'same' })
  await expect(collectHistoryWindow({ slots: 10, signal: signal(), read: loop })).rejects.toThrow('command list')
})
it('fences cancellation before admission and after an ignored cancellation without exposing results', async () => {
  const controller = new AbortController(), read = vi.fn(); controller.abort()
  await expect(collectHistoryWindow({ slots: 1, signal: controller.signal, read })).rejects.toMatchObject({ name: 'AbortError' }); expect(read).not.toHaveBeenCalled()
  const second = new AbortController(), ignored = vi.fn(async () => { second.abort(); return { commands: [item('late')], nextCursor: null } })
  await expect(collectHistoryWindow({ slots: 1, signal: second.signal, read: ignored })).rejects.toMatchObject({ name: 'AbortError' })
})
it('propagates the original second-page failure without publishing the first page', async () => {
  const error = new Error('native HTTP failure'), read = vi.fn().mockResolvedValueOnce({ commands: Array.from({ length: 100 }, (_, i) => item(String(i))), nextCursor: 'last' }).mockRejectedValueOnce(error)
  await expect(collectHistoryWindow({ slots: 10, signal: signal(), read })).rejects.toBe(error)
})
