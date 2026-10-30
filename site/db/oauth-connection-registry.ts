import {and,eq} from "drizzle-orm";
import {getDb} from "./index";
import {oauthClients,oauthConnectionLabels,oauthConsents} from "./schema";
import {sanitizeConnectionLabel} from "@/worker/oauth/account-subject";

/** A nickname is an owner's private description, not proof of the
 * remote AI provider's identity or signed-in email address. */
export async function setConnectionNickname(clientId:string,subject:string,label:string){
  const normalized=sanitizeConnectionLabel(label);
  if(!normalized||label.trim().length>40||normalized!==label.trim())
    throw new Error("连接名称必须为 1–40 个可见字符");
  const client=await getDb().select({id:oauthClients.clientId})
    .from(oauthClients).where(eq(oauthClients.clientId,clientId)).limit(1);
  if(!client.length)throw new Error("客户端不存在");
  if(subject){
    const grants=await getDb().select({id:oauthConsents.id}).from(oauthConsents)
      .where(and(eq(oauthConsents.clientId,clientId),eq(oauthConsents.subject,subject)))
      .limit(1);
    if(!grants.length)throw new Error("该客户端没有对应的星屿账号授权");
  }
  await getDb().insert(oauthConnectionLabels).values({
    clientId,subject,label:normalized,updatedAt:new Date().toISOString(),
  }).onConflictDoUpdate({
    target:[oauthConnectionLabels.clientId,oauthConnectionLabels.subject],
    set:{label:normalized,updatedAt:new Date().toISOString()},
  });
}

export async function rememberAuthorizedConnectionLabel(clientId:string,subject:string,rawLabel:string|null){
  const label=sanitizeConnectionLabel(rawLabel);
  if(label)await setConnectionNickname(clientId,subject,label);
}
