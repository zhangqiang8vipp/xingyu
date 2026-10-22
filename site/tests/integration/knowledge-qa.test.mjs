import assert from "node:assert/strict";
import test from "node:test";
import {closeTestHarness,jsonRequest,loginAdmin,openTestHarness} from "./harness.mjs";
import {makeActiveUser} from "./identity-fixtures.mjs";
import {readFileSync} from "node:fs";

const vars={VIEWS_IDENTITY_SECRET:"test-qa-hmac-key-longer-than-twenty-characters"};

async function ask(h,body,cookie,headers={}) {
  const response=await jsonRequest(h,"/api/ask",{
    method:"POST",body,cookie,headers,
  });
  return {status:response.status,json:await response.json(),headers:response.headers};
}

test("public Q&A includes only actually published site articles; private Q&A requires login and consent",async()=>{
  const h=await openTestHarness({vars});
  try {
    const category=await h.db.prepare("SELECT id FROM categories WHERE workspace_id=1 ORDER BY id LIMIT 1").first();
    assert.ok(category);
    await h.db.prepare(
      "INSERT INTO posts(workspace_id,public_id,title,slug,excerpt,content,category_id,space_id,status,published_at) " +
      "VALUES(1,'qa-public-1','Cloudflare 技术经验','qa-public-1','技术经验汇总','# D1 云数据库技术经验与实践',?,NULL,'published',CURRENT_TIMESTAMP)"
    ).bind(category.id).run();
    await h.db.prepare(
      "INSERT INTO posts(workspace_id,public_id,title,slug,excerpt,content,category_id,space_id,status) " +
      "VALUES(1,'qa-draft-1','Cloudflare 技术草稿','qa-draft-1','技术经验草稿','# 不公开的技术经验',?,NULL,'draft')"
    ).bind(category.id).run();
    const publicSearch=await ask(h,{
      question:"这个网站主要分享哪些技术经验？",scope:"public",mode:"sources",
    });
    assert.equal(publicSearch.status,200,JSON.stringify(publicSearch.json));
    assert.ok(publicSearch.json.sources.some(x=>x.title.includes("Cloudflare 技术经验")));
    assert.ok(!publicSearch.json.sources.some(x=>x.title.includes("技术草稿")));
    assert.ok(publicSearch.json.sources.every(x=>x.visibility==="public"&&x.url.includes("/posts/")));
    assert.equal(publicSearch.json.model,null);
    const denied=await ask(h,{question:"请检索私人技术知识",scope:"mine",mode:"sources"});
    assert.equal(denied.status,401);
    const data=await ask(h,{question:"请检索私人技术知识",scope:"mine",mode:"answer"});
    assert.equal(data.status,400,"private knowledge cannot be sent to a model without consent");
  } finally { await closeTestHarness(h); }
});

test("personal search cannot reveal another account or site draft; openrouter failures do not expose keys",async()=>{
  const h=await openTestHarness({vars});
  try{
    const alice=await makeActiveUser(h,"qa-owner-a");
    const bob=await makeActiveUser(h,"qa-owner-b");
    const created=await jsonRequest(h,"/api/knowledge/posts",{
      method:"POST",cookie:alice.cookie,
      body:{title:"Alice 数据库优化秘诀",excerpt:"专用性能技术",
        content_markdown:"# Alice 私有优化日志\n使用特定性能测试方法。"},
    });
    assert.equal(created.status,201,await created.clone().text());
    const aliceSearch=await ask(h,{
      question:"数据库优化秘诀是怎样的？",scope:"mine",mode:"sources",
    },alice.cookie);
    assert.equal(aliceSearch.status,200,JSON.stringify(aliceSearch.json));
    assert.ok(aliceSearch.json.sources.some(x=>x.title==="Alice 数据库优化秘诀"));
    assert.ok(aliceSearch.json.sources.every(x=>x.visibility==="personal"));
    assert.ok(aliceSearch.json.sources.every(x=>x.url.startsWith("/admin?")));
    const bobSearch=await ask(h,{
      question:"数据库优化秘诀是怎样的？",scope:"mine",mode:"sources",
    },bob.cookie);
    assert.equal(bobSearch.status,200);
    assert.deepEqual(bobSearch.json.sources,[],"Bob must not see Alice private knowledge");

    const blocked=await ask(h,{
      question:"数据库优化秘诀是怎样的？",scope:"mine",mode:"answer",
    },alice.cookie);
    assert.equal(blocked.status,400,"private model request requires explicit consent");

    const missingProvider=await ask(h,{
      question:"数据库优化秘诀是怎样的？",scope:"mine",mode:"answer",
      confirmedExternalProcessing:true,
    },alice.cookie);
    assert.equal(missingProvider.status,503,"provider must fail closed if Worker secret is unset");
    assert.ok(!JSON.stringify(missingProvider.json).includes("sk-or-v1"));
  }finally{await closeTestHarness(h);}
});

test("source-only searches have their own larger daily quota without consuming free-model budget",async()=>{
  const h=await openTestHarness({vars});
  try{
    const first=await ask(h,{question:"search-not-present-anywhere",mode:"sources"},
      undefined,{"CF-Connecting-IP":"198.51.100.77"});
    assert.equal(first.status,200,JSON.stringify(first.json));
    await h.db.prepare("UPDATE oauth_rate_limits SET attempts=29 WHERE identifier LIKE 'qa:v1:search:%'").run();
    const last=await ask(h,{question:"search-not-present-anywhere",mode:"sources"},
      undefined,{"CF-Connecting-IP":"198.51.100.77"});
    assert.equal(last.status,200);
    const blocked=await ask(h,{question:"search-not-present-anywhere",mode:"sources"},
      undefined,{"CF-Connecting-IP":"198.51.100.77"});
    assert.equal(blocked.status,429);
    assert.match(blocked.json.error,/额度/);
    const meta=await h.db.prepare("SELECT identifier,attempts FROM oauth_rate_limits WHERE identifier LIKE 'qa:v1:%'").all();
    assert.ok(meta.results.some(x=>x.identifier.startsWith("qa:v1:search:")&&x.attempts===30));
    assert.ok(!meta.results.some(x=>x.identifier.startsWith("qa:v1:model:")||x.identifier.startsWith("qa:v1:global:")),
      "search-only requests must not spend free model allocation");
  }finally{await closeTestHarness(h);}
});


test("Q&A page serves its own stylesheet without swelling the global public CSS",async()=>{
  const h=await openTestHarness({vars});
  try{
    const page=await h.dispatch("/ask",{headers:{Accept:"text/html"}});
    assert.equal(page.status,200,"site Q&A route must render successfully");
    assert.match(await page.text(),/问问星屿/);
    const stylesheet=await h.dispatch("/ask.css");
    assert.equal(stylesheet.status,200,"route-only CSS must be available as a static asset");
    assert.match(await stylesheet.text(),/\.xy-ask-page/);
  }finally{await closeTestHarness(h);}
});

test("legacy site-wide model usage never blocks OpenRouter; owner accounts bypass local limits",async()=>{
  const h=await openTestHarness({vars:{...vars,OPENROUTER_API_KEY:"integration-only-no-real-model-call"}});
  try{
    const day=new Date().toISOString().slice(0,10);
    await h.db.prepare("INSERT INTO oauth_rate_limits(identifier,attempts,window_started,updated_at) VALUES(?,1000,?,?)")
      .bind("qa:v1:global:"+day,Math.floor(Date.now()/86400000)*86400,Math.floor(Date.now()/1000)).run();
    const routeSource=readFileSync(new URL("../../app/api/ask/route.ts",import.meta.url),"utf8");
    const quotaSource=readFileSync(new URL("../../server/qa-quotas.ts",import.meta.url),"utf8");
    assert.doesNotMatch(routeSource,/takeAskGlobalQuota/);
    assert.doesNotMatch(quotaSource,/ASK_DAILY_GLOBAL_LIMIT|takeAskGlobalQuota/);
    const noMatch={question:"zzzxxyyqnotpresent98765",mode:"answer"};
    const legacyAdmin=await loginAdmin(h);
    for(let i=0;i<3;i++){
      const resp=await ask(h,noMatch,legacyAdmin);
      assert.equal(resp.status,200,JSON.stringify(resp.json));
      assert.deepEqual(resp.json.sources,[],"no upstream model call for empty retrieval");
    }
    assert.equal((await h.db.prepare("SELECT COUNT(*) AS n FROM oauth_rate_limits WHERE identifier LIKE 'qa:v1:model:%'").first()).n,0,
      "site password-admin bypasses model daily counters");
    const siteOwner=await makeActiveUser(h,"qa-site-owner-unlimited");
    await h.db.prepare("INSERT INTO site_memberships(user_id,role) VALUES(?,'owner')").bind(siteOwner.id).run();
    const ownerResponse=await ask(h,noMatch,siteOwner.cookie);
    assert.equal(ownerResponse.status,200,JSON.stringify(ownerResponse.json));
    assert.equal((await h.db.prepare("SELECT COUNT(*) AS n FROM oauth_rate_limits WHERE identifier LIKE 'qa:v1:model:%'").first()).n,0,
      "verified site owner identity bypasses model daily counters");
    assert.equal((await h.db.prepare("SELECT attempts FROM oauth_rate_limits WHERE identifier=?")
      .bind("qa:v1:global:"+day).first()).attempts,1000,"a legacy global counter never changes");
  }finally{await closeTestHarness(h);}
});

test("visitors and ordinary signed-in users get 100 daily AI requests, then source-mode fallback",async()=>{
  const h=await openTestHarness({vars:{...vars,OPENROUTER_API_KEY:"integration-only-no-real-model-call"}});
  try{
    const noMatch={question:"zzzxxyyqnotpresent98765",scope:"public",mode:"answer"};
    const visitorIp={"CF-Connecting-IP":"198.51.100.220"};
    const first=await ask(h,noMatch,undefined,visitorIp);
    assert.equal(first.status,200,JSON.stringify(first.json));
    const rows=await h.db.prepare("SELECT identifier,attempts FROM oauth_rate_limits WHERE identifier LIKE 'qa:v1:model:%'").all();
    assert.equal(rows.results.length,1);
    assert.equal(rows.results[0].attempts,1);
    await h.db.prepare("UPDATE oauth_rate_limits SET attempts=99 WHERE identifier=?").bind(rows.results[0].identifier).run();
    const hundred=await ask(h,noMatch,undefined,visitorIp);
    assert.equal(hundred.status,200,JSON.stringify(hundred.json));
    assert.equal((await h.db.prepare("SELECT attempts FROM oauth_rate_limits WHERE identifier=?")
      .bind(rows.results[0].identifier).first()).attempts,100);
    const afterHundred=await ask(h,noMatch,undefined,visitorIp);
    assert.equal(afterHundred.status,200,JSON.stringify(afterHundred.json));
    assert.deepEqual(afterHundred.json.sources,[]);
    assert.equal((await h.db.prepare("SELECT attempts FROM oauth_rate_limits WHERE identifier=?")
      .bind(rows.results[0].identifier).first()).attempts,100);
    assert.equal((await h.db.prepare("SELECT COUNT(*) AS n FROM oauth_rate_limits WHERE identifier LIKE 'qa:v1:search:%'").first()).n,1,
      "after 100 AI calls the same visitor can still search sources");

    const registered=await makeActiveUser(h,"qa-regular-100");
    const userStart=await ask(h,noMatch,registered.cookie);
    assert.equal(userStart.status,200,JSON.stringify(userStart.json));
    const modelRows=await h.db.prepare("SELECT identifier,attempts FROM oauth_rate_limits WHERE identifier LIKE 'qa:v1:model:%'").all();
    const own=modelRows.results.find(row=>row.identifier!==rows.results[0].identifier);
    assert.ok(own,"registered user has an independent per-user counter");
    await h.db.prepare("UPDATE oauth_rate_limits SET attempts=99 WHERE identifier=?").bind(own.identifier).run();
    assert.equal((await ask(h,noMatch,registered.cookie)).status,200);
    assert.equal((await ask(h,noMatch,registered.cookie)).status,200);
    assert.equal((await h.db.prepare("SELECT attempts FROM oauth_rate_limits WHERE identifier=?").bind(own.identifier).first()).attempts,100);
  }finally{await closeTestHarness(h);}
});


test("broad site question cites actual topic articles without requiring 技术 or 经验 in their text",async()=>{
  const h=await openTestHarness({vars});
  try{
    const category=await h.db.prepare(
      "SELECT id FROM categories WHERE workspace_id=1 ORDER BY id LIMIT 1"
    ).first();
    for(const [id,title,content] of [
      ["qa-topic-workers","Cloudflare Workers 部署实践","# Worker 路由和缓存管理"],
      ["qa-topic-ts","TypeScript 类型规范","# 类型系统与编译器选项"],
    ]){
      await h.db.prepare(
        "INSERT INTO posts(workspace_id,public_id,title,slug,excerpt,content,category_id,space_id,status,published_at) " +
        "VALUES(1,?,?,?,?,?,?,NULL,'published',CURRENT_TIMESTAMP)"
      ).bind(id,title,id,"开发笔记",content,category.id).run();
    }
    const answer=await ask(h,{
      question:"这个网站主要分享哪些技术经验？",scope:"public",mode:"sources",
    });
    assert.equal(answer.status,200,JSON.stringify(answer.json));
    assert.equal(answer.json.sources.length,2);
    assert.ok(answer.json.sources.some(x=>x.title==="Cloudflare Workers 部署实践"));
    assert.ok(answer.json.sources.some(x=>x.title==="TypeScript 类型规范"));
    assert.ok(answer.json.sources.every(x=>x.url.includes("/posts/")));
  }finally{await closeTestHarness(h);}
});

test("specific public topics in site-overview wording retrieve relevant evidence, not random category samples",async()=>{
  const h=await openTestHarness({vars});
  try{
    const category=await h.db.prepare(
      "SELECT id FROM categories WHERE workspace_id=1 ORDER BY id LIMIT 1"
    ).first();
    assert.ok(category);
    for(const [publicId,title,excerpt,content] of [
      ["qa-topic-specific-workers","Cloudflare Workers 与 D1 技术实践",
        "Workers 路由与 D1 数据库实战","# 使用 Cloudflare Workers 连接 D1 并管理数据库索引"],
      ["qa-topic-specific-windsor","温莎古堡旅行记录",
        "温莎旅行中的路线笔记","# 英国温莎城堡参观路线与景点"],
      ["qa-topic-specific-unrelated","Windows 开发环境管理",
        "版本管理与系统维护","# PowerShell 的环境变量排错与工具安装"],
    ]){
      await h.db.prepare(
        "INSERT INTO posts(workspace_id,public_id,title,slug,excerpt,content,category_id,space_id,status,published_at)"+
        " VALUES(1,?,?,?,?,?,?,NULL,'published',CURRENT_TIMESTAMP)"
      ).bind(publicId,title,publicId,excerpt,content,category.id).run();
    }
    const topical=await ask(h,{
      question:"网站有哪些 Cloudflare Workers 和 D1 相关的技术实践？",
      scope:"public",mode:"sources",
    });
    assert.equal(topical.status,200,JSON.stringify(topical.json));
    assert.ok(topical.json.sources.some(s=>s.title==="Cloudflare Workers 与 D1 技术实践"));
    assert.ok(!topical.json.sources.some(s=>s.title==="Windows 开发环境管理"),
      "unrelated article must not be added by overview category sampling");
    assert.ok(topical.json.sources.every(s=>s.visibility==="public"));
    const named=await ask(h,{
      question:"网站关于温莎都分享了什么？",scope:"public",mode:"sources",
    });
    assert.equal(named.status,200,JSON.stringify(named.json));
    assert.ok(named.json.sources.some(s=>s.title==="温莎古堡旅行记录"));
    assert.ok(!named.json.sources.some(s=>s.title==="Windows 开发环境管理"));
  }finally{await closeTestHarness(h);}
});

test("password-based legacy site admin can ask about authorized private knowledge",async()=>{
  const h=await openTestHarness({vars});
  try{
    const cookie=await loginAdmin(h);
    const category=await h.db.prepare(
      "SELECT id FROM categories WHERE workspace_id=1 ORDER BY id LIMIT 1"
    ).first();
    const space=await h.db.prepare(
      "INSERT INTO spaces(workspace_id,parent_id,name,slug) VALUES(1,NULL,'QA admin space','qa-admin-space') RETURNING id"
    ).first();
    await h.db.prepare(
      "INSERT INTO posts(workspace_id,public_id,title,slug,excerpt,content,category_id,space_id,status,author_id,created_by) " +
      "VALUES(1,'qa-legacy-secret','Site owner private Cloudflare knowledge','qa-legacy-secret'," +
      "'cloudflare backend','# Secret admin article',?,?,'draft',1,1)"
    ).bind(category.id,space.id).run();
    const result=await ask(h,{
      question:"Site owner private Cloudflare knowledge",scope:"mine",mode:"sources",
    },cookie);
    assert.equal(result.status,200,JSON.stringify(result.json));
    assert.equal(result.json.sources.length,1);
    assert.equal(result.json.sources[0].title,"Site owner private Cloudflare knowledge");
    assert.equal(result.json.sources[0].visibility,"personal");
    assert.ok(result.json.sources[0].url.startsWith("/admin?"));
    const page=await h.dispatch("/ask?scope=mine",{
      headers:{cookie,Accept:"text/html"},
    });
    assert.equal(page.status,200,"legacy admin must be able to open Q&A page");
  }finally{await closeTestHarness(h);}
});


test("two-character Chinese proper names search titles even when older than 40 newer body mentions",async()=>{
  const h=await openTestHarness({vars});
  try{
    const category=await h.db.prepare("SELECT id FROM categories WHERE workspace_id=1 ORDER BY id LIMIT 1").first();
    assert.ok(category);
    await h.db.prepare(
      "INSERT INTO posts(workspace_id,public_id,title,slug,excerpt,content,category_id,space_id,status,published_at,updated_at) " +
      "VALUES(1,'qa-windsor-old','温莎项目实践','qa-windsor-old','温莎专门记录','# 关于温莎的实践经验',?,NULL,'published',CURRENT_TIMESTAMP,'2020-01-01 00:00:00')"
    ).bind(category.id).run();
    await h.db.prepare(
      "INSERT INTO posts(workspace_id,public_id,title,slug,excerpt,content,category_id,space_id,status) " +
      "VALUES(1,'qa-windsor-draft','温莎私人草稿','qa-windsor-draft','不可见','# 温莎未发布内部资料',?,NULL,'draft')"
    ).bind(category.id).run();
    for(let i=0;i<45;i++){
      await h.db.prepare(
        "INSERT INTO posts(workspace_id,public_id,title,slug,excerpt,content,category_id,space_id,status,published_at) " +
        "VALUES(1,?,?,?,?,?,?,NULL,'published',CURRENT_TIMESTAMP)"
      ).bind("qa-windsor-new-"+i,"更新记录 "+i,"qa-windsor-new-"+i,"普通记录","# 文章正文仅提到温莎。",category.id).run();
    }
    const result=await ask(h,{question:"温莎",scope:"public",mode:"sources"});
    assert.equal(result.status,200,JSON.stringify(result.json));
    assert.ok(result.json.sources.some(s=>s.title==="温莎项目实践"),
      "older exact-title hit must outrank recent body-only mentions");
    assert.ok(result.json.sources.every(s=>s.visibility==="public"));
    assert.ok(result.json.sources.every(s=>s.title!=="温莎私人草稿"),
      "public search must never reveal drafts");
    assert.ok(result.json.sources.every(s=>s.url.startsWith(h.origin+"/posts/")));
  }finally{await closeTestHarness(h);}
});

test("exhausted visitor AI allowance downgrades to genuine source results",async()=>{
  const h=await openTestHarness({vars:{...vars,OPENROUTER_API_KEY:"integration-only-key"}});
  try{
    const category=await h.db.prepare("SELECT id FROM categories WHERE workspace_id=1 ORDER BY id LIMIT 1").first();
    await h.db.prepare(
      "INSERT INTO posts(workspace_id,public_id,title,slug,excerpt,content,category_id,space_id,status,published_at) " +
      "VALUES(1,'qa-windsor-quota','温莎技术实践','qa-windsor-quota','温莎公开记录','# 温莎技术实践',?,NULL,'published',CURRENT_TIMESTAMP)"
    ).bind(category.id).run();
    const ip={"CF-Connecting-IP":"203.0.113.90"};
    const before=await ask(h,{question:"absent-unique-exhaust-test",mode:"answer"},undefined,ip);
    assert.equal(before.status,200);
    assert.deepEqual(before.json.sources,[]);
    await h.db.prepare("UPDATE oauth_rate_limits SET attempts=100 WHERE identifier LIKE 'qa:v1:model:%'").run();
    const limited=await ask(h,{question:"温莎",mode:"answer",scope:"public"},undefined,ip);
    assert.equal(limited.status,200,JSON.stringify(limited.json));
    assert.equal(limited.json.degraded,true);
    assert.equal(limited.json.model,null);
    assert.match(limited.json.answer,/次数已用完/);
    assert.ok(limited.json.sources.some(s=>s.title==="温莎技术实践"));
    const budget=await h.db.prepare(
      "SELECT identifier FROM oauth_rate_limits WHERE identifier LIKE 'qa:v1:global:%'"
    ).first();
    assert.equal(budget,null,"source-only fallback must not use any site-wide model counter");
  }finally{await closeTestHarness(h);}
});


test("assistant panel discovers legacy admin permission only via an authenticated same-site request",async()=>{
  const h=await openTestHarness({vars});
  try{
    const publicStatus=await jsonRequest(h,"/api/ask",{method:"GET"});
    assert.equal(publicStatus.status,200);
    assert.deepEqual(await publicStatus.json(),{authenticated:false});
    const cookie=await loginAdmin(h);
    const ownerStatus=await jsonRequest(h,"/api/ask",{method:"GET",cookie});
    assert.equal(ownerStatus.status,200);
    assert.deepEqual(await ownerStatus.json(),{authenticated:true});
    assert.match(ownerStatus.headers.get("cache-control")??"",/no-store/);
  }finally{await closeTestHarness(h);}
});
