export const PUBLIC_DOCUMENT_TTL_SECONDS=3600;
export const PUBLIC_CACHE_CONTRACT_VERSION="3";
const REVISION_PARAMETER="__xingyu_cache_revision";

type RevisionStatement={
  bind?:(...values:unknown[])=>RevisionStatement;
  first:<T>()=>Promise<T|null>;
};

type RevisionDatabase={
  prepare:(query:string)=>RevisionStatement;
};

function normalizePublicContentRevision(revision:unknown):string|null{
  if(typeof revision==="number")return Number.isSafeInteger(revision)&&revision>0?String(revision):null;
  return typeof revision==="string"&&/^[1-9]\d*$/.test(revision)?revision:null;
}

export function hasRequestIdentity(request:Request):boolean{
  return request.headers.has("Authorization")||request.headers.has("Cookie");
}

export function isHtmlDocumentRequest(request:Request):boolean{
  return (request.method==="GET"||request.method==="HEAD")&&request.headers.get("Accept")?.includes("text/html")===true;
}

export function publicDocumentCategory(url:URL):string|undefined|null{
  if(url.searchParams.size===0)return undefined;
  if(url.pathname!=="/"&&url.pathname!=="/archive")return null;
  if([...url.searchParams.keys()].some((key)=>key!=="category"))return null;
  const values=url.searchParams.getAll("category");
  if(values.length!==1)return null;
  const category=values[0]?.trim();
  if(!category||category.length>180||/[\u0000-\u001f\u007f]/.test(category))return null;
  return category==="all"?undefined:category;
}

export function isPublicDocumentRequest(request:Request,url:URL):boolean{
  if(!isHtmlDocumentRequest(request))return false;
  if(request.method!=="GET")return false;
  if(hasRequestIdentity(request))return false;
  if(request.headers.has("Range")||request.headers.has("RSC"))return false;
  if(request.headers.has("Next-Router-State-Tree")||url.searchParams.has("_rsc"))return false;
  if(url.pathname.startsWith("/admin")||url.pathname.startsWith("/api")||url.pathname.startsWith("/oauth")||url.pathname.startsWith("/.well-known")||url.pathname.startsWith("/preview"))return false;
  if(url.searchParams.has("adminPreview"))return false;
  if(publicDocumentCategory(url)===null)return false;
  return true;
}

export async function readPublicContentRevision(db:RevisionDatabase,category?:string):Promise<string|null>{
  try{
    const statement=db.prepare(category===undefined
      ?"SELECT revision FROM public_cache_state WHERE id=1"
      :"SELECT state.revision FROM public_cache_state AS state WHERE state.id=1 AND EXISTS (SELECT 1 FROM categories WHERE slug=? LIMIT 1)");
    const bound=category===undefined?statement:statement.bind?.(category);
    if(!bound)return null;
    const row=await bound.first<{revision:unknown}>();
    return row?normalizePublicContentRevision(row.revision):null;
  }catch{
    // A missing migration or transient D1 failure must bypass cache instead of
    // serving an older public document under a guessed revision.
    return null;
  }
}

export function publicDocumentCacheKey(url:URL,revision:string):Request{
  const cacheUrl=new URL(url);
  cacheUrl.searchParams.set(REVISION_PARAMETER,`${PUBLIC_CACHE_CONTRACT_VERSION}.${revision}`);
  return new Request(cacheUrl,{method:"GET"});
}

export function responseAllowsPublicStorage(response:Pick<Response,"ok"|"headers">):boolean{
  return response.ok&&!response.headers.has("Set-Cookie")&&response.headers.get("Vary")?.trim()!=="*";
}

export function publicDocumentCacheControl(revision:string|null):string{
  return revision===null
    ?"no-store"
    :"public, max-age=0, must-revalidate";
}

export function publicDocumentStorageCacheControl():string{
  return `public, max-age=${PUBLIC_DOCUMENT_TTL_SECONDS}`;
}
