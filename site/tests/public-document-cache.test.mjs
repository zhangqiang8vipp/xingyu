import assert from "node:assert/strict";
import test from "node:test";
import {DatabaseSync} from "node:sqlite";
import {hasRequestIdentity,isHtmlDocumentRequest,isPublicDocumentRequest,publicDocumentCacheControl,publicDocumentCacheKey,publicDocumentCategory,publicDocumentStorageCacheControl,readPublicContentRevision,responseAllowsPublicStorage} from "../worker/public-document-cache.ts";
import {PUBLIC_CACHE_SCHEMA_STATEMENTS} from "../db/public-cache-schema.ts";
import {createPublicRevisionCache,PUBLIC_REVISION_POINTER_TTL_MS} from "../worker/public-revision-cache.ts";
import {attachmentCacheControl,attachmentEtagMatches} from "../domain/attachments/http-cache.ts";
import {removeAttachmentReference} from "../domain/attachments/markdown-reference.ts";

test("only public HTML documents receive a revisioned cache key",()=>{
  const html=new Request("https://example.com/archive?category=notes",{headers:{Accept:"text/html,application/xhtml+xml"}});
  assert.equal(isHtmlDocumentRequest(html),true);
  assert.equal(isPublicDocumentRequest(html,new URL(html.url)),true);
  assert.equal(publicDocumentCategory(new URL(html.url)),"notes");
  const key=publicDocumentCacheKey(new URL(html.url),"42");
  assert.equal(key.url,"https://example.com/archive?category=notes&__xingyu_cache_revision=3.42");
  const search=new Request("https://example.com/archive?q=windows",{headers:{Accept:"text/html"}});
  const tracking=new Request("https://example.com/?utm_source=test",{headers:{Accept:"text/html"}});
  const head=new Request("https://example.com/",{method:"HEAD",headers:{Accept:"text/html"}});
  assert.equal(isPublicDocumentRequest(search,new URL(search.url)),false);
  assert.equal(isPublicDocumentRequest(tracking,new URL(tracking.url)),false);
  assert.equal(isHtmlDocumentRequest(head),true);
  assert.equal(isPublicDocumentRequest(head,new URL(head.url)),false);
  assert.equal(publicDocumentCategory(new URL(search.url)),null);
  assert.equal(isPublicDocumentRequest(new Request("https://example.com/admin",{headers:{Accept:"text/html"}}),new URL("https://example.com/admin")),false);
  assert.equal(isPublicDocumentRequest(new Request("https://example.com/preview/token",{headers:{Accept:"text/html"}}),new URL("https://example.com/preview/token")),false);
  assert.equal(isPublicDocumentRequest(new Request("https://example.com/",{headers:{Accept:"text/x-component",RSC:"1"}}),new URL("https://example.com/")),false);
  const cookieRequest=new Request("https://example.com/",{headers:{Accept:"text/html",Cookie:"session=private"}});
  const authorizedRequest=new Request("https://example.com/",{headers:{Accept:"text/html",Authorization:"Bearer private"}});
  assert.equal(hasRequestIdentity(cookieRequest),true);
  assert.equal(hasRequestIdentity(authorizedRequest),true);
  assert.equal(isPublicDocumentRequest(cookieRequest,new URL(cookieRequest.url)),false);
  assert.equal(isPublicDocumentRequest(authorizedRequest,new URL(authorizedRequest.url)),false);
});

test("public storage rejects responses that carry identity state",()=>{
  assert.equal(responseAllowsPublicStorage(new Response("ok")),true);
  assert.equal(responseAllowsPublicStorage(new Response("login",{headers:{"Set-Cookie":"session=private"}})),false);
  assert.equal(responseAllowsPublicStorage(new Response("variant",{headers:{Vary:"*"}})),false);
  assert.equal(responseAllowsPublicStorage(new Response("missing",{status:404})),false);
});

test("cache revision lookup fails closed",async()=>{
  const found=await readPublicContentRevision({prepare:()=>({first:async()=>({revision:27})})});
  assert.equal(found,"27");
  const missing=await readPublicContentRevision({prepare:()=>({first:async()=>null})});
  assert.equal(missing,null);
  const failed=await readPublicContentRevision({prepare:()=>({first:async()=>{throw new Error("D1 unavailable")}})});
  assert.equal(failed,null);
  const malformed=await readPublicContentRevision({prepare:()=>({first:async()=>({revision:"broken"})})});
  assert.equal(malformed,null);
  assert.equal(publicDocumentCacheControl(missing),"no-store");
  assert.equal(publicDocumentCacheControl(found),"public, max-age=0, must-revalidate");
  assert.match(publicDocumentStorageCacheControl(),/^public, max-age=\d+$/);
  assert.doesNotMatch(publicDocumentCacheControl(found),/s-maxage/);
});

test("category cache revision exists only for a stored category",async()=>{
  let boundValue="";
  const found=await readPublicContentRevision({prepare:()=>({
    bind:(value)=>{boundValue=String(value);return {first:async()=>({revision:31})}},
    first:async()=>null,
  })},"development");
  assert.equal(boundValue,"development");
  assert.equal(found,"31");
  const missing=await readPublicContentRevision({prepare:()=>({
    bind:()=>({first:async()=>null}),
    first:async()=>null,
  })},"missing");
  assert.equal(missing,null);
});


test("revision pointer caches the first lookup across a hot burst",async()=>{
  let now=1_000;
  let reads=0;
  const cache=createPublicRevisionCache({now:()=>now});
  const reader=async()=>{reads+=1;return "10";};
  assert.equal(await cache.read(undefined,reader),"10");
  assert.equal(reads,1);
  for(let i=0;i<100;i+=1)assert.equal(await cache.read(undefined,reader),"10");
  assert.equal(reads,1);
  now+=PUBLIC_REVISION_POINTER_TTL_MS;
  assert.equal(await cache.read(undefined,reader),"10");
  assert.equal(reads,2);
});

test("revision pointer adopts a newer revision only after TTL refresh",async()=>{
  let now=5_000;
  let revision="10";
  const cache=createPublicRevisionCache({now:()=>now});
  const reader=async()=>revision;
  assert.equal(await cache.read(undefined,reader),"10");
  revision="11";
  now+=PUBLIC_REVISION_POINTER_TTL_MS-1;
  assert.equal(await cache.read(undefined,reader),"10");
  now+=1;
  assert.equal(await cache.read(undefined,reader),"11");
});

test("revision pointer refresh failures fail closed without stale fallback",async()=>{
  let now=10_000;
  const cache=createPublicRevisionCache({now:()=>now});
  assert.equal(await cache.read(undefined,async()=>"10"),"10");
  now+=PUBLIC_REVISION_POINTER_TTL_MS;
  assert.equal(await cache.read(undefined,async()=>{throw new Error("D1 unavailable");}),null);
  assert.equal(await cache.read(undefined,async()=>"broken"),null);
  assert.equal(await cache.read(undefined,async()=>"11"),"11");
});

test("revision pointer keeps category validation scopes isolated",async()=>{
  let reads=0;
  const cache=createPublicRevisionCache();
  const reader=async(category)=>{reads+=1;return category==="notes"?"12":"13";};
  assert.equal(await cache.read("notes",reader),"12");
  assert.equal(await cache.read("notes",reader),"12");
  assert.equal(await cache.read("development",reader),"13");
  assert.equal(reads,2);
});

test("attachment caching revalidates visibility before reusing bytes",()=>{
  assert.equal(attachmentCacheControl(true),"public, max-age=0, must-revalidate");
  assert.equal(attachmentCacheControl(false),"private, no-store");
  assert.equal(attachmentEtagMatches(null,'"abc"'),false);
  assert.equal(attachmentEtagMatches('W/"abc"','"abc"'),true);
  assert.equal(attachmentEtagMatches('"other", W/"abc"','"abc"'),true);
  assert.equal(attachmentEtagMatches('"other"','"abc"'),false);
  assert.equal(attachmentEtagMatches('*','"abc"'),true);
});

test("attachment deletion removes generated image and file references without touching prose",()=>{
  const attachment={
    url:"/api/attachments/att_1234567890abcdef1234567890abcdef/notes.pdf",
    markdown:'[notes.pdf](/api/attachments/att_1234567890abcdef1234567890abcdef/notes.pdf "PDF · 2 MB")',
  };
  assert.equal(removeAttachmentReference(`保留这一段\n\n${attachment.markdown}\n\n继续阅读`,attachment),"保留这一段\n\n继续阅读");
  assert.equal(removeAttachmentReference(`![自定义标题](${attachment.url})\n\n正文`,attachment),"正文");
});

test("public cache revision changes only when public presentation can change",()=>{
  const db=new DatabaseSync(":memory:");
  db.exec("CREATE TABLE posts(id INTEGER PRIMARY KEY,title TEXT,slug TEXT,excerpt TEXT,content TEXT,category_id INTEGER,space_id INTEGER,status TEXT,featured INTEGER,published_at TEXT,view_count INTEGER DEFAULT 0)");
  db.exec("CREATE TABLE categories(id INTEGER PRIMARY KEY,name TEXT)");
  db.exec("CREATE TABLE site_settings(id INTEGER PRIMARY KEY,title TEXT)");
  db.exec("CREATE TABLE content_pages(id INTEGER PRIMARY KEY,title TEXT)");
  for(const statement of PUBLIC_CACHE_SCHEMA_STATEMENTS)db.exec(statement);
  const revision=()=>db.prepare("SELECT revision FROM public_cache_state WHERE id=1").get().revision;
  assert.equal(revision(),1);
  db.exec("INSERT INTO posts VALUES(1,'draft','draft','', '',1,NULL,'draft',0,NULL,0)");
  assert.equal(revision(),1);
  db.exec("UPDATE posts SET view_count=1 WHERE id=1");
  assert.equal(revision(),1);
  db.exec("UPDATE posts SET status='published' WHERE id=1");
  assert.equal(revision(),2);
  db.exec("UPDATE posts SET title='published edit' WHERE id=1");
  assert.equal(revision(),3);
  db.exec("UPDATE posts SET view_count=2 WHERE id=1");
  assert.equal(revision(),3);
  db.exec("UPDATE posts SET space_id=9 WHERE id=1");
  assert.equal(revision(),4);
  db.exec("UPDATE posts SET title='private edit' WHERE id=1");
  assert.equal(revision(),4);
  db.exec("INSERT INTO categories VALUES(1,'notes')");
  db.exec("INSERT INTO content_pages VALUES(1,'about')");
  db.exec("INSERT INTO site_settings VALUES(1,'site')");
  db.exec("UPDATE site_settings SET title='site edit' WHERE id=1");
  assert.equal(revision(),7);
  db.close();
});
