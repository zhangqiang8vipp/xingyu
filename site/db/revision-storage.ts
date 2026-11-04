import {applyReverseDelta} from "@/domain/revision-delta.mjs";

export type RevisionPost={id:number;workspaceId:number;version:number;content:string};
type RevisionRecord={
  version:number;content:string;reversePatch:string|null;originalContentLength:number|null;
};

/** Read an old version through verified reverse deltas, starting from the
 * nearest surviving FULL snapshot. Gaps/corrupt patches always fail closed.
 * The CURRENT version still comes directly from posts for fast reads.
 */
export async function readStoredRevisionContent(db:D1Database,post:RevisionPost,version:number):Promise<string|null>{
  if(!Number.isSafeInteger(version)||version<1||version>post.version)return null;
  const target=await db.prepare(
    "SELECT content,reverse_patch AS reversePatch,original_content_length AS originalContentLength,version FROM document_revisions WHERE post_id=? AND workspace_id=? AND version=?"
  ).bind(post.id,post.workspaceId,version).first<RevisionRecord>();
  if(!target)return null;
  if(target.reversePatch===null)return target.content;
  if(target.content!=="")throw new Error("Historical delta still contains an unexpected full snapshot");

  const anchor=await db.prepare(
    "SELECT version,content FROM document_revisions WHERE post_id=? AND workspace_id=? AND version>? AND reverse_patch IS NULL ORDER BY version ASC LIMIT 1"
  ).bind(post.id,post.workspaceId,version).first<{version:number;content:string}>();
  let fromVersion=anchor?.version??post.version;
  let current=anchor?.content??post.content;
  if(fromVersion===post.version&&current!==post.content)
    throw new Error("Current document revision snapshot differs from posts");
  let traversed=0;
  while(fromVersion>version){
    const rows=await db.prepare(
      "SELECT version,content,reverse_patch AS reversePatch,original_content_length AS originalContentLength FROM document_revisions WHERE post_id=? AND workspace_id=? AND version<? AND version>=? ORDER BY version DESC LIMIT 100"
    ).bind(post.id,post.workspaceId,fromVersion,version).all<RevisionRecord>();
    if(!rows.results?.length)throw new Error("Historical revision chain is incomplete");
    for(const row of rows.results){
      if(row.version!==fromVersion-1)
        throw new Error("Historical revision chain has a missing version");
      if(row.reversePatch!==null){
        if(row.content!=="")throw new Error("Historical delta row unexpectedly contains a snapshot");
        current=applyReverseDelta(current,row.reversePatch);
        if(row.originalContentLength!==current.length)
          throw new Error("Historical revision delta length mismatch");
      }else current=row.content;
      fromVersion=row.version;
      if(++traversed>20000)throw new Error("Historical revision reconstruction exceeded safe limits");
    }
  }
  return current;
}
