/**
 * Reversible content deltas for document history (UTF-16 offsets, UTF-8 savings).
 * Document titles and audit metadata remain in document_revisions; only bodies
 * are compacted. No external compression service or non-deterministic format.
 */
export const REVISION_DELTA_FORMAT="axis-reverse-delta-v1";
const MAX_LENGTH=1_600_000;
const utf8Size=value=>new TextEncoder().encode(value).length;
function checksum(value){
  let hash=2166136261;
  for(let i=0;i<value.length;i++){
    hash=Math.imul(hash^value.charCodeAt(i),16777619);
  }
  return (hash>>>0).toString(16).padStart(8,"0");
}
function checkText(value){
  if(typeof value!=="string"||value.length>MAX_LENGTH)throw new Error("Document revision content is invalid or too long");
}
export function makeReverseDelta(newer,older){
  checkText(newer);checkText(older);
  let prefix=0;
  const max=Math.min(newer.length,older.length);
  while(prefix<max&&newer.charCodeAt(prefix)===older.charCodeAt(prefix))prefix++;
  let suffix=0;
  while(suffix<max-prefix&&
    newer.charCodeAt(newer.length-suffix-1)===older.charCodeAt(older.length-suffix-1))suffix++;
  const patch=JSON.stringify({
    format:REVISION_DELTA_FORMAT,
    p:prefix,s:suffix,
    removed:newer.slice(prefix,newer.length-suffix),
    inserted:older.slice(prefix,older.length-suffix),
    fromLength:newer.length,toLength:older.length,
    fromHash:checksum(newer),toHash:checksum(older),
  });
  // Incompressible changes keep their full snapshot; never grow D1 just
  // because a document was almost completely rewritten.
  return utf8Size(patch)<utf8Size(older)*.88?patch:null;
}
export function applyReverseDelta(newer,serialized){
  checkText(newer);
  if(typeof serialized!=="string"||serialized.length>MAX_LENGTH*2)
    throw new Error("Invalid historical delta encoding");
  let data;
  try{data=JSON.parse(serialized)}catch{throw new Error("Malformed historical revision delta")}
  if(!data||data.format!==REVISION_DELTA_FORMAT||
    !Number.isSafeInteger(data.p)||!Number.isSafeInteger(data.s)||
    data.p<0||data.s<0||data.p+data.s>newer.length||
    !Number.isSafeInteger(data.fromLength)||!Number.isSafeInteger(data.toLength)||
    typeof data.removed!=="string"||typeof data.inserted!=="string"||
    typeof data.fromHash!=="string"||typeof data.toHash!=="string")
      throw new Error("Invalid historical revision delta fields");
  if(newer.length!==data.fromLength||checksum(newer)!==data.fromHash||
    newer.slice(data.p,newer.length-data.s)!==data.removed)
    throw new Error("Historical revision chain does not match its delta base");
  const older=newer.slice(0,data.p)+data.inserted+newer.slice(newer.length-data.s);
  checkText(older);
  if(older.length!==data.toLength||checksum(older)!==data.toHash)
    throw new Error("Historical revision delta integrity check failed");
  return older;
}
