/**
 * AES-256-GCM envelope for private, recoverable Cloudflare D1 SQL backups.
 * Streams input; no plaintext content, secret or hash is logged.
 */
import {createCipheriv,createDecipheriv,createHash,randomBytes} from "node:crypto";
import {createReadStream,createWriteStream} from "node:fs";
import {appendFile,open,stat,unlink} from "node:fs/promises";
import {pipeline} from "node:stream/promises";
import {Writable} from "node:stream";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";

const MARK=Buffer.from("XINGYU-D1-AES256GCM-V1\0","utf8");
const NONCE_BYTES=12;
const TAG_BYTES=16;

function secretKey(encoded){
  if(typeof encoded!=="string"||!/^[A-Za-z0-9+/]{43}=$/.test(encoded.trim()))
    throw new Error("A protected 32-byte backup key is required");
  const key=Buffer.from(encoded.trim(),"base64");
  if(key.length!==32||key.toString("base64")!==encoded.trim())
    throw new Error("Malformed protected backup key");
  return key;
}
async function sha256(path){
  const hash=createHash("sha256");
  for await(const chunk of createReadStream(path))hash.update(chunk);
  return hash.digest("hex");
}
export async function encryptBackup(source,destination,encodedKey){
  if(resolve(source)===resolve(destination))throw new Error("Source and destination must differ");
  const info=await stat(source);
  if(!info.isFile()||info.size<1024)throw new Error("Incomplete D1 SQL export");
  const key=secretKey(encodedKey),nonce=randomBytes(NONCE_BYTES);
  const cipher=createCipheriv("aes-256-gcm",key,nonce);
  let owned=false;
  try{
    const reserved=await open(destination,"wx",0o600);
    owned=true;
    await reserved.close();
    const output=createWriteStream(destination,{flags:"w",mode:0o600});
    output.write(Buffer.concat([MARK,nonce]));
    await pipeline(createReadStream(source),cipher,output);
    await appendFile(destination,cipher.getAuthTag());
    return (await stat(destination)).size;
  }catch(error){
    if(owned)await unlink(destination).catch(()=>{});
    throw error;
  }finally{key.fill(0);}
}
export async function verifyBackup(source,encrypted,encodedKey){
  if(resolve(source)===resolve(encrypted))throw new Error("Cannot verify a file against itself");
  const info=await stat(encrypted);
  const offset=MARK.length+NONCE_BYTES;
  if(!info.isFile()||info.size<offset+TAG_BYTES+1024)throw new Error("Incomplete encrypted D1 backup");
  const handle=await open(encrypted,"r");
  const head=Buffer.alloc(offset),tag=Buffer.alloc(TAG_BYTES);
  try{
    const a=await handle.read(head,0,offset,0);
    const b=await handle.read(tag,0,TAG_BYTES,info.size-TAG_BYTES);
    if(a.bytesRead!==offset||b.bytesRead!==TAG_BYTES||!head.subarray(0,MARK.length).equals(MARK))
      throw new Error("Unrecognized D1 backup format");
  }finally{await handle.close();}
  const key=secretKey(encodedKey);
  try{
    const decipher=createDecipheriv("aes-256-gcm",key,head.subarray(MARK.length));
    decipher.setAuthTag(tag);
    const digest=createHash("sha256");
    await pipeline(
      createReadStream(encrypted,{start:offset,end:info.size-TAG_BYTES-1}),
      decipher,
      new Writable({write(chunk,_encoding,callback){digest.update(chunk);callback();}})
    );
    if(digest.digest("hex")!==(await sha256(source)))
      throw new Error("Retrieved encrypted backup does not match SQL export");
    return true;
  }finally{key.fill(0);}
}
/** Restore an independently downloadable R2 ciphertext into a protected SQL file.
 * AES-GCM authentication must succeed before the file is considered usable.
 * A failed decrypt always removes the partial plaintext.
 */
export async function decryptBackup(encrypted,destination,encodedKey){
  if(resolve(encrypted)===resolve(destination))throw new Error("Source and destination must differ");
  const info=await stat(encrypted),offset=MARK.length+NONCE_BYTES;
  if(!info.isFile()||info.size<offset+TAG_BYTES+1024)throw new Error("Incomplete encrypted D1 backup");
  const handle=await open(encrypted,"r");
  const head=Buffer.alloc(offset),tag=Buffer.alloc(TAG_BYTES);
  try{
    const a=await handle.read(head,0,offset,0);
    const b=await handle.read(tag,0,TAG_BYTES,info.size-TAG_BYTES);
    if(a.bytesRead!==offset||b.bytesRead!==TAG_BYTES||!head.subarray(0,MARK.length).equals(MARK))
      throw new Error("Unrecognized D1 backup format");
  }finally{await handle.close();}
  const key=secretKey(encodedKey);
  let owned=false;
  try{
    const reserved=await open(destination,"wx",0o600);
    owned=true;
    await reserved.close();
    const decipher=createDecipheriv("aes-256-gcm",key,head.subarray(MARK.length));
    decipher.setAuthTag(tag);
    await pipeline(createReadStream(encrypted,{start:offset,end:info.size-TAG_BYTES-1}),
      decipher,createWriteStream(destination,{flags:"w",mode:0o600}));
    return (await stat(destination)).size;
  }catch(error){
    if(owned)await unlink(destination).catch(()=>{});
    throw error;
  }finally{key.fill(0);}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [mode,source,destination]=process.argv.slice(2);
  try{
    if(!source||!destination)throw new Error("Usage: encrypt|verify|decrypt SOURCE DESTINATION");
    const key=process.env.REVISION_BACKUP_KEY_B64;
    if(mode==="encrypt")await encryptBackup(source,destination,key);
    else if(mode==="verify")await verifyBackup(source,destination,key);
    else if(mode==="decrypt")await decryptBackup(source,destination,key);
    else throw new Error("Use encrypt or verify");
    console.log(mode==="encrypt"?"Private backup encrypted":mode==="verify"?"Retrieved R2 backup authenticated and byte-for-byte verified":"Authenticated backup decrypted into a private local SQL file");
  }catch(error){
    console.error(error instanceof Error?error.message:"Backup failed closed");
    process.exitCode=1;
  }
}
