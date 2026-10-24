export function parseNumbers(text:string):number[]{
  const parts=text.trim().split(/[\s,]+/)
  if(!text.trim()||parts.length>100||parts.some(value=>!(/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value))||!Number.isFinite(Number(value))||Math.abs(Number(value))>1e12))throw new Error('Enter 1–100 numbers between −1 trillion and 1 trillion.')
  return parts.map(Number)
}
export class CommandCopyError extends Error{
  constructor(){super('The saved numbers do not meet the current command limits.');this.name='CommandCopyError'}
}
/** Saved JSON must be numeric, bounded and independent from the source object. */
export function copyCommandNumbers(input:unknown):number[]{
  if(!Array.isArray(input)||input.length<1||input.length>100)throw new CommandCopyError()
  const numbers=[...input]
  if(numbers.some(value=>typeof value!=='number'))throw new CommandCopyError()
  try{return parseNumbers(numbers.join(', '))}catch{throw new CommandCopyError()}
}
