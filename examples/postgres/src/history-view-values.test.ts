import { expect,it } from 'vitest'
import { normalizeSavedSelection,normalizeViewName } from './history-view-values.js'
it('normalizes private names with NFC and trims outer whitespace while retaining case',()=>{
  expect(normalizeViewName('  Cafe\u0301 failures  ')).toBe('Café failures');expect(normalizeViewName('TRIAGE')).toBe('TRIAGE');expect(normalizeViewName('🐂'.repeat(80))).toHaveLength(160)
})
it('rejects invisible/control/lossy names and bounds raw and normalized input',()=>{
  for(const value of['','  ','\u200b','a\nview','a\u0000view','a\ud800','a\u2028view','x'.repeat(81),'x'.repeat(321),null,{},['view']])expect(()=>normalizeViewName(value)).toThrow('view name')
})
it('accepts visible punctuation as plain text rather than interpreting markup',()=>{expect(normalizeViewName('<triage> & "receipts"')).toBe('<triage> & "receipts"')})
it('copies only canonical scope/status/search values',()=>{
  const input={scope:'all',state:'failed',q:' ABCD '},selection=normalizeSavedSelection(input);input.scope='mine';input.q='abce';expect(selection).toEqual({scope:'all',state:'failed',q:'abcd'})
  expect(normalizeSavedSelection({scope:'mine',state:'all',q:'  '})).toEqual({scope:'mine',state:'all'})
})
it('rejects ownership, cursor, pagination and arbitrary destination claims',()=>{
  for(const key of['ownerId','actor','queue','after','limit','returnTo','page'])expect(()=>normalizeSavedSelection({scope:'mine',state:'all',[key]:'private'})).toThrow('Choose a valid')
})
it('rejects missing, non-string and unknown filter values without coercion',()=>{
  for(const value of[null,[],{}, {scope:['all'],state:'all'},{scope:'mine',state:['failed']},{scope:'other',state:'all'},{scope:'mine',state:'unknown'},{scope:'mine',state:'all',q:null},{scope:'mine',state:'all',q:'abcd%'},{scope:'mine',state:'all',q:'abc'}])expect(()=>normalizeSavedSelection(value)).toThrow('Choose a valid')
})
