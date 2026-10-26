export type MergeResult={status:"merged";content:string}|{status:"conflict";reason:string;conflicts?:Array<{current:{start:number;end:number;lines:string[]};proposed:{start:number;end:number;lines:string[]}}>};
export function mergeMarkdown(base:string,current:string,proposed:string):MergeResult;
