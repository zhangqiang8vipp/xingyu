import test from "node:test";
import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {mkdtemp,readFile,writeFile,rm} from "node:fs/promises";
import {join,resolve} from "node:path";
import {readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {encryptBackup,verifyBackup,decryptBackup} from "../scripts/encrypted-d1-backup.mjs";

test("encrypted private D1 export roundtrips exactly",async()=>{
  const root=await mkdtemp(join(tmpdir(),"xingyu-d1-"));
  const sql=join(root,"backup.sql"),encrypted=join(root,"backup.enc");
  const key=randomBytes(32).toString("base64");
  try{
    const original=("CREATE TABLE document_revisions(id INT);\nINSERT INTO document_revisions VALUES(1);\n知识空间机密内容\n").repeat(160);
    await writeFile(sql,original,{mode:0o600});
    const size=await encryptBackup(sql,encrypted,key);
    assert.ok(size>1024);
    assert.equal(await verifyBackup(sql,encrypted,key),true);
    const restored=join(root,"restored.sql");
    await decryptBackup(encrypted,restored,key);
    assert.equal((await readFile(restored,"utf8")),original);
    await assert.rejects(decryptBackup(encrypted,restored,key),/EEXIST/);
    assert.equal((await readFile(restored,"utf8")),original,"existing restore cannot be overwritten");
    const encryptedContent=await readFile(encrypted);
    assert.equal(encryptedContent.includes(Buffer.from("知识空间机密内容")),false);
    await assert.rejects(verifyBackup(sql,encrypted,randomBytes(32).toString("base64")));
    encryptedContent[Math.floor(encryptedContent.length/2)]^=0x40;
    await writeFile(encrypted,encryptedContent);
    await assert.rejects(verifyBackup(sql,encrypted,key));
    const damaged=join(root,"damaged.sql");
    await assert.rejects(decryptBackup(encrypted,damaged,key));
    await assert.rejects(readFile(damaged),/ENOENT/);
  }finally{await rm(root,{recursive:true,force:true});}
});

test("bad key, tiny SQL and altered plaintext cannot produce a trusted backup",async()=>{
  const root=await mkdtemp(join(tmpdir(),"xingyu-d1-reject-"));
  const sql=join(root,"backup.sql"),encrypted=join(root,"backup.enc");
  const key=randomBytes(32).toString("base64");
  try{
    await writeFile(sql,"too small");
    await assert.rejects(encryptBackup(sql,encrypted,key),/Incomplete/);
    await writeFile(sql,"X".repeat(5000));
    await assert.rejects(encryptBackup(sql,encrypted,"not-a-key"),/key/);
    await assert.rejects(encryptBackup(sql,sql,key),/differ/);
    await encryptBackup(sql,encrypted,key);
    await writeFile(sql,"Y".repeat(5000));
    await assert.rejects(verifyBackup(sql,encrypted,key),/does not match/);
  }finally{await rm(root,{recursive:true,force:true});}
});

test("protected enable always backs up before enabling and audit remains read only",()=>{
  const workflow=readFileSync(resolve("..",".github/workflows/revision-delta-compaction-optin.yml"),"utf8");
  const backupCall='bash scripts/revision-private-backup.sh';
  const positionEnable=workflow.lastIndexOf(backupCall);
  const positionWrite=workflow.indexOf("INSERT INTO app_meta(key,value) SELECT 'revision_delta_compaction_enabled','1'");
  assert.ok(positionEnable>=0&&positionEnable<positionWrite,
    "encrypted R2 backup must precede the first enable flag write");
  assert.match(workflow,/if \[\[ "\$MODE" == "audit" \]\]; then/);
  assert.match(workflow,/if \[\[ "\$MODE" == "backup" \]\]; then/);
});
