import test from "node:test";
import assert from "node:assert/strict";
import {openTestHarness,closeTestHarness,jsonRequest} from "./harness.mjs";
import {makeActiveUser} from "./identity-fixtures.mjs";
import {compactDocumentRevisions} from "../../db/revision-compaction.ts";

async function api(h,path,{cookie,method="GET",body}={}){
  const response=await jsonRequest(h,path,{cookie,method,body});
  return {status:response.status,body:await response.json().catch(()=>({}))};
}

test("real D1 compactor stores only verified old deltas, reconstructs versions and is idempotent",async()=>{
  const h=await openTestHarness();
  try {
    const owner=await makeActiveUser(h,"delta-compactor-owner");
    const root=await h.db.prepare(
      "SELECT id FROM spaces WHERE workspace_id=? AND parent_id IS NULL ORDER BY id LIMIT 1"
    ).bind(owner.workspaceId).first();
    assert.ok(root?.id);
    const v1="# Runbook\n## Deployment\noriginal deploy\n## Recovery\noriginal recovery\n"+
      ("Markdown paragraph content must remain reconstructible 😀.\n".repeat(120));
    const created=await api(h,"/api/space-collaboration/"+root.id,{cookie:owner.cookie,method:"POST",body:{
      action:"create_document",title:"Compaction verified",content:v1,
    }});
    assert.equal(created.status,201,JSON.stringify(created.body));
    const publicId=created.body.result.publicId;
    const postId=created.body.result.id;
    const endpoint="/api/space-collaboration/documents/"+publicId;
    const v2=v1.replace("original deploy","updated deploy");
    const v3=v2.replace("original recovery","updated recovery");
    for(const [baseVersion,content] of [[1,v2],[2,v3]]){
      const saved=await api(h,endpoint,{cookie:owner.cookie,method:"PATCH",body:{
        baseVersion,content,summary:"change "+baseVersion,
      }});
      assert.equal(saved.status,200,JSON.stringify(saved.body));
      assert.equal(saved.body.result.version,baseVersion+1);
    }
    const before=await h.db.prepare(
      "SELECT version,content FROM document_revisions WHERE post_id=? ORDER BY version"
    ).bind(postId).all();
    assert.deepEqual(before.results.map(x=>x.version),[1,2,3]);
    assert.deepEqual(before.results.map(x=>x.content),[v1,v2,v3]);

    const report=await compactDocumentRevisions(h.db,25);
    assert.equal(report.compacted,2,JSON.stringify(report));
    assert.equal(report.skipped,0,JSON.stringify(report));
    assert.ok(report.bytesSaved>0);
    const after=await h.db.prepare(
      "SELECT version,content,reverse_patch,original_content_length,compaction_state FROM document_revisions WHERE post_id=? ORDER BY version"
    ).bind(postId).all();
    assert.equal(after.results.length,3);
    for(const [i,original] of [[0,v1],[1,v2]]){
      assert.equal(after.results[i].content,"");
      assert.ok(after.results[i].reverse_patch,"compact row "+i+" requires reverse patch");
      assert.equal(after.results[i].original_content_length,original.length);
      assert.equal(after.results[i].compaction_state,"delta");
    }
    assert.equal(after.results[2].content,v3,"latest revision remains full");
    assert.equal((await api(h,endpoint+"?revision=1",{cookie:owner.cookie})).body.revision.content,v1);
    assert.equal((await api(h,endpoint+"?revision=2",{cookie:owner.cookie})).body.revision.content,v2);
    assert.equal((await api(h,endpoint,{cookie:owner.cookie})).body.document.content,v3);
    const rerun=await compactDocumentRevisions(h.db,25);
    assert.equal(rerun.compacted,0,"compactor must be idempotent");
    assert.equal(rerun.examined,0,"already verified diffs must not be selected again");
    const restored=await api(h,endpoint,{cookie:owner.cookie,method:"POST",body:{
      action:"restore",revision:1,expectedVersion:3,
    }});
    assert.equal(restored.status,200,JSON.stringify(restored.body));
    assert.equal((await api(h,endpoint,{cookie:owner.cookie})).body.document.content,v1);
    assert.equal((await api(h,endpoint+"?revision=2",{cookie:owner.cookie})).body.revision.content,v2);
  } finally {
    await closeTestHarness(h);
  }
});

test("incompressible rewrites keep full snapshots and do not grow D1 with patches",async()=>{
  const h=await openTestHarness();
  try {
    const owner=await makeActiveUser(h,"delta-no-savings");
    const root=await h.db.prepare(
      "SELECT id FROM spaces WHERE workspace_id=? AND parent_id IS NULL ORDER BY id LIMIT 1"
    ).bind(owner.workspaceId).first();
    const created=await api(h,"/api/space-collaboration/"+root.id,{cookie:owner.cookie,method:"POST",body:{
      action:"create_document",title:"Full replacement",content:"a".repeat(2000),
    }});
    assert.equal(created.status,201);
    const postId=created.body.result.id;
    const saved=await api(h,"/api/space-collaboration/documents/"+created.body.result.publicId,{
      cookie:owner.cookie,method:"PATCH",body:{baseVersion:1,content:"b".repeat(2000),summary:"replace all"},
    });
    assert.equal(saved.status,200,JSON.stringify(saved.body));
    const report=await compactDocumentRevisions(h.db,25);
    assert.equal(report.compacted,0,JSON.stringify(report));
    assert.ok(report.retained>=1);
    const old=await h.db.prepare(
      "SELECT content,reverse_patch,compaction_state FROM document_revisions WHERE post_id=? AND version=1"
    ).bind(postId).first();
    assert.equal(old.content,"a".repeat(2000));
    assert.equal(old.reverse_patch,null);
    assert.equal(old.compaction_state,"retained");
  } finally {
    await closeTestHarness(h);
  }
});
