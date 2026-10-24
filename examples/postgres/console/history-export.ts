import { projectCommandMetadata } from './history-metadata.js'
import { collectBoundedExport } from './bounded-export.js'
import type { BoundedExportOptions } from './bounded-export.js'
import { normalizeHistorySearch } from './history-search.js'
export type HistoryExportSelection={readonly scope:string;readonly state:string;readonly q?:string}
export interface HistoryExportOptions extends BoundedExportOptions {readonly selection:HistoryExportSelection}
export class HistoryExportError extends Error {constructor(message:string){super(message);this.name='HistoryExportError'}}
const invalid=()=>new HistoryExportError('History could not be exported. Refresh and try again.')
/** Collect a bounded segment; no partial file escapes after a failed or canceled read. */
export async function collectHistoryExport(options:HistoryExportOptions){
  let search:string|undefined;try{search=normalizeHistorySearch(options.selection.q)}catch{throw invalid()}
  const selection={scope:options.selection.scope,state:options.selection.state,...(search?{q:search}:{})}
  if(!['mine','all'].includes(selection.scope)||!['all','pending','running','succeeded','failed','unavailable'].includes(selection.state))throw invalid()
  return collectBoundedExport(options,{
    recordsKey:'commands',project:value=>projectCommandMetadata(value,invalid),line:command=>({type:'command',command}),
    header:exportedAt=>({type:'longhorn-command-history',version:search?2:1,exportedAt,selection}),invalid,
    tooLarge:()=>new HistoryExportError('This history page is too large to export. Try a narrower delivery filter.'),
    timeout:()=>new HistoryExportError('The export timed out. Try again.'),
  })
}
