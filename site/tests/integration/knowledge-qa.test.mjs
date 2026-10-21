import assert from "node:assert/strict";
import test from "node:test";
import {closeTestHarness,jsonRequest,loginAdmin,openTestHarness} from "./harness.mjs";
import {makeActiveUser} from "./identity-fixtures.mjs";

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

test("daily public question quota is persistent and limits anonymous abuse",async()=>{
  const h=await openTestHarness({vars});
  try{
    for(let i=0;i<3;i++){
      const result=await ask(h,{question:"search-not-present-anywhere",mode:"sources"},
        undefined,{"CF-Connecting-IP":"198.51.100.77"});
      assert.equal(result.status,200,JSON.stringify(result.json));
      assert.equal(result.json.sources.length,0);
    }
    const blocked=await ask(h,{question:"search-not-present-anywhere",mode:"sources"},
      undefined,{"CF-Connecting-IP":"198.51.100.77"});
    assert.equal(blocked.status,429);
    assert.match(blocked.json.error,/额度/);
    const meta=await h.db.prepare("SELECT used,bucket FROM ai_question_quotas").all();
    assert.ok(meta.results.some(x=>x.bucket==="visitor"&&x.used===3));
    assert.ok(!meta.results.some(x=>x.bucket==="global"),"no upstream call means no global free-model spend");
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

test("exhausted global OpenRouter budget still returns real sources without making a model request",async()=>{
  const h=await openTestHarness({vars:{
    ...vars,OPENROUTER_API_KEY:"integration-test-not-real-credential",
  }});
  try{
    const category=await h.db.prepare(
      "SELECT id FROM categories WHERE workspace_id=1 ORDER BY id LIMIT 1"
    ).first();
    await h.db.prepare(
      "INSERT INTO posts(workspace_id,public_id,title,slug,excerpt,content,category_id,space_id,status,published_at) " +
      "VALUES(1,'qa-budget-public','Cloudflare 知识文章','qa-budget-public','Cloudflare 技术实践'," +
      "'# Cloudflare D1 技术实践',?,NULL,'published',CURRENT_TIMESTAMP)"
    ).bind(category.id).run();
    await h.db.prepare(
      "INSERT INTO ai_question_quotas(day,bucket,identity_hash,used) VALUES(?,?,?,40)"
    ).bind(new Date().toISOString().slice(0,10),"global","hosted-free").run();
    const response=await ask(h,{
      question:"Cloudflare 有哪些技术实践？",scope:"public",mode:"answer",
    });
    assert.equal(response.status,200,JSON.stringify(response.json));
    assert.equal(response.json.degraded,true);
    assert.ok(response.json.sources.some(item=>item.title==="Cloudflare 知识文章"));
    assert.match(response.json.answer,/额度已满/);
    const quota=await h.db.prepare(
      "SELECT used FROM ai_question_quotas WHERE bucket='global'"
    ).first();
    assert.equal(quota.used,40,"model request must not overrun the free daily budget");
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
