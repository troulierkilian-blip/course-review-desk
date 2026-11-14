export const DEFAULT_AI_WIDTH=480;
export const MIN_AI_WIDTH=320;
export const MIN_READER_WIDTH=420;
export const AI_DIVIDER_WIDTH=8;
export function validAIWidth(value:unknown):value is number {
  return typeof value==='number'&&Number.isFinite(value)&&value>=MIN_AI_WIDTH&&value<=10000;
}
export function maxAIWidth(available:number){return Math.max(MIN_AI_WIDTH,Math.floor(Math.min(available*.7,available-MIN_READER_WIDTH-AI_DIVIDER_WIDTH)));}
export function fitAIWidth(preferred:number,available:number){return Math.max(MIN_AI_WIDTH,Math.min(Math.round(preferred),maxAIWidth(available)));}
