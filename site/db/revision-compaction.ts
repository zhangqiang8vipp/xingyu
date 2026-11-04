import {makeReverseDelta,applyReverseDelta} from "@/domain/revision-delta.mjs";
import {readStoredRevisionContent} from "./revision-storage";

type Candidate={
  postId:number;workspaceId:number;version:number;content:string;
  headVersion:number;headContent:string;
};
export type RevisionCompactionReport={
  examined:number;compacted:number;retained:number;skipped:number;bytesSaved:number;
};

/** Bounded, resumable and concurrency-guarded. Never deletes a revision row.
 * Non-beneficial diffs are retained as snapshots, so every old version remains
 * independently recoverable and no content is lost to failed patch generation.
 */
export async function compactDocumentRevisions(db:D1Database,limit=25):Promise<RevisionCompactionReport>{
  const count=Math.max(1,Math.min(100,Math.floor(limit)));
  const candidates=await db.prepare(
    "SELECT r.post_id AS postId,r.workspace_id AS workspaceId,r.version,r.content,p.version AS headVersion,p.content AS headContent FROM document_revisions r JOIN posts p ON p.id=r.post_id AND p.workspace_id=r.workspace_id WHERE r.version<p.version AND r.reverse_patch IS NULL AND r.compaction_state='pending' ORDER BY r.post_id,r.version DESC LIMIT ?"
  ).bind(count).all<Candidate>();
  const report={examined:0,compacted:0,retained:0,skipped:0,bytesSaved:0};
  for(const row of candidates.results??[]){
    report.examined++;
    const post={id:row.postId,workspaceId:row.workspaceId,version:row.headVersion,content:row.headContent};
    const newer=await readStoredRevisionContent(db,post,row.version+1);
    if(newer===null){
      // No adjacent history: do not fabricate a delta across missing versions.
      const result=await db.prepare(
        "UPDATE document_revisions SET compaction_state='retained' WHERE post_id=? AND workspace_id=? AND version=? AND content=? AND reverse_patch IS NULL AND compaction_state='pending' AND EXISTS(SELECT 1 FROM posts p WHERE p.id=? AND p.version=? AND p.content=?) RETURNING version"
      ).bind(row.postId,row.workspaceId,row.version,row.content,row.postId,row.headVersion,row.headContent).first();
      if(result)report.retained++;else report.skipped++;
      continue;
    }
    const delta=makeReverseDelta(newer,row.content);
    if(delta===null){
      const result=await db.prepare(
        "UPDATE document_revisions SET compaction_state='retained' WHERE post_id=? AND workspace_id=? AND version=? AND content=? AND reverse_patch IS NULL AND compaction_state='pending' AND EXISTS(SELECT 1 FROM posts p WHERE p.id=? AND p.version=? AND p.content=?) RETURNING version"
      ).bind(row.postId,row.workspaceId,row.version,row.content,row.postId,row.headVersion,row.headContent).first();
      if(result)report.retained++;else report.skipped++;
      continue;
    }
    if(applyReverseDelta(newer,delta)!==row.content)
      throw new Error("Refusing to compact a revision without an exact roundtrip");
    const changed=await db.prepare(
      "UPDATE document_revisions SET content='',reverse_patch=?,original_content_length=?,compaction_state='delta' WHERE post_id=? AND workspace_id=? AND version=? AND content=? AND reverse_patch IS NULL AND compaction_state='pending' AND EXISTS(SELECT 1 FROM posts p WHERE p.id=? AND p.version=? AND p.content=?) RETURNING version"
    ).bind(delta,row.content.length,row.postId,row.workspaceId,row.version,row.content,row.postId,row.headVersion,row.headContent).first();
    if(!changed){report.skipped++;continue;}
    const reconstructed=await readStoredRevisionContent(db,post,row.version);
    if(reconstructed!==row.content)throw new Error("Document revision reconstruction mismatch after compaction");
    report.compacted++;
    report.bytesSaved+=new TextEncoder().encode(row.content).length-new TextEncoder().encode(delta).length;
  }
  return report;
}
