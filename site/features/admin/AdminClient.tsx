"use client";

import "@/app/admin/admin.css";

import { useCallback, useEffect, useRef, useState } from "react";
import AdminSettingsPanel, { type SiteSettingsForm } from "./AdminSettingsPanel";
import AdminPageEditor, { type EditablePage } from "./AdminPageEditor";
import { CONTENT_LIMITS } from "@/domain/site/config";
import AdminCategoriesPanel from "./AdminCategoriesPanel";
import AdminIntegrationsPanel from "./AdminIntegrationsPanel";
import AdminSpacesPanel from "./AdminSpacesPanel";
import ArticleWritingStudio, { useSplitScrollSync } from "./ArticleWritingStudio";
import AdminArticleSearch from "./AdminArticleSearch";
import AdminBrowsePanel, { type AdminBrowseVisibility } from "./AdminBrowsePanel";
import AdminArticlesPanel from "./AdminArticlesPanel";
import AdminSidebar from "./AdminSidebar";
import AdminFilesPanel from "./AdminFilesPanel";
import AdminArticleEditor from "./AdminArticleEditor";
import AdminPreviewShareDialog from "./AdminPreviewShareDialog";
import type { AdminCategory, AdminMcpConnection, AdminPost, AdminSection, AdminStats, ArticleForm } from "./admin-types";
import { readApiJson } from "@/app/api-response";
import ModalPostLink from "../reader/ModalPostLink";
import type { AdminReaderContext, AdminReaderReturnTarget } from "@/domain/reader/admin-reader-context";
import { adminLocationHref, parseAdminLocation, type AdminLocation } from "@/domain/admin/location";
import type { BetaActivationSignal } from "@/domain/admin/activation";

const emptyForm = (categoryId = 1,spaceId:number|null=null,spacePath=""): ArticleForm => ({ title: "", slug: "", excerpt: "", content: "", categoryId, spaceId,sortOrder:0,spacePath,status: "draft", featured: false, publishedAt:null });

function isSiteAdminSection(section:AdminSection){
  return section==="home"||section==="about"||section==="categories";
}
type AdminInitialLocation=AdminLocation;

function mapKnowledgePost(post: Record<string, unknown>, visibility: "personal" | "public", categories: AdminCategory[]): AdminPost {
  const categorySlug = typeof post.categorySlug === "string" ? post.categorySlug : "";
  const category = categories.find((item) => item.slug === categorySlug);
  const categoryId = typeof post.categoryId === "number" ? post.categoryId : category?.id ?? categories[0]?.id ?? 1;
  const publicPost = visibility === "public";
  return {
    id: Number(post.id),
    version: Number(post.version ?? 1),
    publicId: String(post.publicId ?? ""),
    title: String(post.title ?? ""),
    slug: String(post.slug ?? ""),
    excerpt: String(post.excerpt ?? ""),
    categoryId,
    categoryName: typeof post.categoryName === "string" ? post.categoryName : category?.name ?? (publicPost ? "公开文章" : "个人文章"),
    status: publicPost ? "published" : "draft",
    featured: false,
    viewCount: Number(post.viewCount ?? 0),
    publishedAt: publicPost && typeof post.publishedAt === "string" ? post.publishedAt : null,
    updatedAt: String(post.updatedAt ?? post.publishedAt ?? new Date(0).toISOString()),
    spaceId: publicPost ? null : Number(post.spaceId ?? 0),
    sortOrder: Number(post.sortOrder ?? 0),
    spacePath: publicPost ? null : "个人知识空间",
    visibility,
    canEdit: !publicPost,
  };
}

export default function AdminClient({ categories:initialCategories, settings, connectPage, aboutPage, stats:initialStats, connections, activation, initialArticle, initialLocation, userName, signOutPath, isPersonalAccount = false }: { categories: AdminCategory[]; settings:SiteSettingsForm; connectPage:EditablePage; aboutPage:EditablePage; stats:AdminStats; connections:AdminMcpConnection[]; activation:BetaActivationSignal; initialArticle:ArticleForm|null; initialLocation:AdminInitialLocation; userName: string; signOutPath: string; isPersonalAccount?: boolean }) {
  const articleEditorPreviewRef=useRef<HTMLDivElement>(null);
  const [section,setSection]=useState<AdminSection>(isPersonalAccount&&isSiteAdminSection(initialLocation.section)?"browse":initialLocation.section);
  const [spaceLandingId,setSpaceLandingId]=useState<number|null>(initialLocation.spaceId);
  const [createSpaceOnOpen,setCreateSpaceOnOpen]=useState(false);
  const [categories,setCategories]=useState(initialCategories);
  const [posts, setPosts] = useState<AdminPost[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<Array<string | null>>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [query, setQuery] = useState(initialLocation.query);
  const [category, setCategory] = useState(initialLocation.category);
  const [status, setStatus] = useState(initialLocation.status);
  const [browseCategory,setBrowseCategory]=useState(initialLocation.browseCategory);
  const [browseVisibility,setBrowseVisibility]=useState<AdminBrowseVisibility>(initialLocation.browseVisibility);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<ArticleForm | null>(initialArticle);
  const [message, setMessage] = useState("");
  const [stats,setStats]=useState(initialStats);
  const [studio,setStudio]=useState<null|"code"|"split"|"reading">(null);
  const [sidebarCollapsed,setSidebarCollapsed]=useState(false);
  const [sharePost,setSharePost]=useState<{id:number;title:string}|null>(null);
  const readerReturnRef=useRef<AdminReaderReturnTarget|null>(null);
  useSplitScrollSync(articleEditorPreviewRef,Boolean(form));
  const editableCategories = isPersonalAccount ? categories.filter((item) => item.slug.startsWith("user-")) : categories;
  const selectedFormCategory = form ? editableCategories.find((item) => item.id === form.categoryId) ?? categories.find((item) => item.id === form.categoryId) : undefined;

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    const params = new URLSearchParams({ pageSize: String(CONTENT_LIMITS.adminBatch), q: query, category, status });
    if (cursor) params.set("cursor", cursor);
    try {
      if (isPersonalAccount) {
        // The API pages across both private and published content in a single,
        // permission-scoped database query. Never slice two 50-item arrays in JS.
        const personalParams = new URLSearchParams({
          type: "all", limit: String(CONTENT_LIMITS.adminBatch),
          q: query, category, status,
        });
        if (cursor) personalParams.set("cursor", cursor);
        const response = await fetch(`/api/knowledge/posts?${personalParams}`, { signal, cache: "no-store" });
        const data = await readApiJson<{ posts: Record<string, unknown>[]; nextCursor: string | null }>(response);
        if (!response.ok) throw new Error("文章列表读取失败");
        if (!signal?.aborted) {
          setPosts((data.posts ?? []).map(post =>
            mapKnowledgePost(post, post.visibility === "public" ? "public" : "personal", categories)));
          setNextCursor(data.nextCursor ?? null);
        }
      } else {
        const response = await fetch(`/api/posts?${params}`, { signal });
        const data = await readApiJson<{rows:AdminPost[];nextCursor:string|null}>(response);
        if (!signal?.aborted) { setPosts(data.rows ?? []); setNextCursor(data.nextCursor ?? null); }
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) setMessage("文章列表读取失败，请稍后重试");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [cursor, query, category, status, isPersonalAccount, categories]);

  const loadStats = useCallback(async () => {
    const response = await fetch("/api/stats", { cache: "no-store" });
    if (response.ok) setStats((await readApiJson<{stats:AdminStats}>(response)).stats);
  }, []);

  useEffect(() => {
    const refresh = () => { void loadStats(); };
    window.addEventListener("xingyu:spaces-changed", refresh);
    const timer = isPersonalAccount ? window.setTimeout(() => { void loadStats(); }, 0) : null;
    return () => {
      window.removeEventListener("xingyu:spaces-changed", refresh);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [loadStats, isPersonalAccount]);

  useEffect(() => {
    const controller = new AbortController();
    const task = window.setTimeout(() => { void load(controller.signal); }, 160);
    return () => { window.clearTimeout(task); controller.abort(); };
  }, [load]);

  useEffect(()=>{
    const frame=window.requestAnimationFrame(()=>{
      setSidebarCollapsed(window.localStorage.getItem("xingyu:admin-sidebar") === "collapsed");
    });
    return()=>window.cancelAnimationFrame(frame);
  },[]);

  useEffect(()=>{
    // Admin sections are separate workspaces. Reusing the previous document
    // scroll can hide a new section's heading and actions behind the mobile dock.
    const frame=window.requestAnimationFrame(()=>window.scrollTo(0,0));
    return()=>window.cancelAnimationFrame(frame);
  },[section]);

  useEffect(()=>{
    const restoreLocation=()=>{
      const parsed=parseAdminLocation(new URLSearchParams(window.location.search));
      const nextSection=isPersonalAccount&&isSiteAdminSection(parsed.section)?"browse":parsed.section;
      setSection(nextSection);
      if(nextSection!==parsed.section)window.history.replaceState(null,"",adminLocationHref({...parsed,section:nextSection}));
      setBrowseCategory(parsed.browseCategory);
      setBrowseVisibility(parsed.browseVisibility);
      setQuery(parsed.query);
      setCategory(parsed.category);
      setStatus(parsed.status);
      setSpaceLandingId(parsed.spaceId);
      setCreateSpaceOnOpen(false);
      setCursor(null);
      setCursorStack([]);
      setStudio(null);
      setForm(null);
      readerReturnRef.current=null;
    };
    window.addEventListener("popstate",restoreLocation);
    return()=>window.removeEventListener("popstate",restoreLocation);
  },[isPersonalAccount]);

  function toggleSidebar(){
    setSidebarCollapsed((current)=>{
      const next=!current;
      window.localStorage.setItem("xingyu:admin-sidebar",next?"collapsed":"expanded");
      return next;
    });
  }

  function resetCursor() {
    setCursor(null);
    setCursorStack([]);
  }

  function currentLocation(overrides:Partial<AdminLocation>={}):AdminLocation{
    return {section,browseCategory,browseVisibility,query,category,status:status as AdminLocation["status"],spaceId:spaceLandingId,...overrides};
  }

  function writeLocation(next:AdminLocation,mode:"push"|"replace"="replace"){
    window.history[mode==="push"?"pushState":"replaceState"](null,"",adminLocationHref(next));
  }

  function closeEditor() {
    const returnTarget=readerReturnRef.current;
    readerReturnRef.current=null;
    setStudio(null);
    setForm(null);
    writeLocation(currentLocation());
    if(returnTarget)window.requestAnimationFrame(()=>openAdminReader(returnTarget));
  }

  function openNewArticle(spaceId:number|null=null,spacePath="") {
    readerReturnRef.current=null;
    setStudio(null);
    setForm(isPersonalAccount ? emptyForm(editableCategories[0]?.id,0,"个人知识空间") : emptyForm(categories[0]?.id,spaceId,spacePath));
    setMessage("");
  }

  function previousBatch() {
    const history = [...cursorStack];
    setCursor(history.pop() ?? null);
    setCursorStack(history);
  }

  function nextBatch() {
    if (!nextCursor) return;
    setCursorStack((history) => [...history, cursor]);
    setCursor(nextCursor);
  }

  async function save() {
    if (!form) return;
    const response = isPersonalAccount
      ? await fetch(form.publicId ? `/api/knowledge/posts/${encodeURIComponent(form.publicId)}` : "/api/knowledge/posts", {
          method: form.publicId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: form.title, slug: form.slug, category: String(form.categoryId), excerpt: form.excerpt, content_markdown: form.content, ...(form.publicId ? { expected_version: form.version } : {}) }),
        })
      : await fetch(form.id ? `/api/posts/${form.id}` : "/api/posts", {
          method: form.id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form),
        });
    const data = await readApiJson<{post:ArticleForm}>(response);
    if (!response.ok) return setMessage(data.error ?? "保存失败");
    const returnTarget=readerReturnRef.current;
    readerReturnRef.current=null;
    setMessage("保存成功"); setStudio(null); setForm(null);
    window.dispatchEvent(new Event("xingyu:spaces-changed"));
    writeLocation(currentLocation());
    await Promise.all([load(), loadStats()]);
    if(returnTarget)openAdminReader(returnTarget);
  }

  async function loadArticle(postId:number,identifierOverride?:string){
    if (isPersonalAccount) {
      const row = posts.find((post) => post.id === postId);
      const identifier = identifierOverride ?? row?.publicId ?? String(postId);
      const response = await fetch(`/api/knowledge/posts/${encodeURIComponent(identifier)}`, { cache: "no-store" });
      const data = await readApiJson<{post:Record<string, unknown>}>(response);
      if (!response.ok || !data.post) return null;
      const post = data.post;
      const category = categories.find((item) => item.slug === post.categorySlug || item.id === post.categoryId);
      return {
        id: Number(post.id ?? row?.id ?? postId),
        publicId: String(post.publicId ?? row?.publicId ?? ""),
        version: Number(post.version ?? row?.version ?? 1),
        title: String(post.title ?? row?.title ?? ""),
        slug: String(post.slug ?? row?.slug ?? ""),
        excerpt: String(post.excerpt ?? row?.excerpt ?? ""),
        content: String(post.content ?? post.content_markdown ?? ""),
        categoryId: category?.id ?? categories[0]?.id ?? 1,
        spaceId: post.visibility === "public" ? null : Number(post.spaceId ?? 0),
        spacePath: post.visibility === "public" ? "" : "个人知识空间",
        status: post.visibility === "public" ? "published" : "draft",
        featured: false,
        publishedAt: typeof post.publishedAt === "string" ? post.publishedAt : null,
        visibility: post.visibility === "public" ? "public" : "personal",
      } as ArticleForm;
    }
    const response=await fetch(`/api/posts/${postId}`);
    const data=await readApiJson<{post:ArticleForm}>(response);
    return response.ok?data.post:null;
  }

  async function editById(postId:number,returnTarget?:AdminReaderReturnTarget){
    if (isPersonalAccount && posts.some((post) => post.id === postId && !post.canEdit)) {
      setMessage("公开文章只读；你只能编辑自己的文章。");
      return;
    }
    const article=await loadArticle(postId);
    if (isPersonalAccount && article?.visibility === "public") {
      setMessage("公开文章只读；你只能编辑自己的文章。");
      return;
    }
    if(article){readerReturnRef.current=returnTarget??null;setStudio(null);setForm(article);setMessage("")}
  }

  function openAdminReader(target:AdminReaderReturnTarget){
    window.dispatchEvent(new CustomEvent("xingyu:admin-reader-open",{detail:target}));
  }

  async function browseById(postId:number,adminReaderContext?:AdminReaderContext,identifierOverride?:string){
    const article=await loadArticle(postId,identifierOverride);
    if(!article)return setMessage("文章暂时无法打开，请稍后再试");
    if (isPersonalAccount) {
      if (article.visibility === "public") {
        window.open(`/posts/${article.publicId}/${article.slug}`, "_blank", "noopener,noreferrer");
        return;
      }
      setStudio(null);setForm(article);setMessage("");
      return;
    }
    setStudio(null);setForm(null);setMessage("");
    window.dispatchEvent(new CustomEvent("xingyu:admin-reader-open",{detail:{publicId:article.publicId,adminReaderContext}}));
  }

  function changeSpace(choice:{id:number;name:string;path?:Array<{id:number;name:string}>}|null){
    if(!form)return;
    const nextSpaceId=choice?.id??null;
    if(form.spaceId===nextSpaceId)return;
    if(form.id&&form.spaceId===null&&nextSpaceId!==null){
      if(!window.confirm("这篇文章保存后将离开公开博客，只能由管理员和 MCP 检索。确认移入知识空间吗？"))return;
    }
    if(form.id&&form.spaceId!==null&&nextSpaceId===null){
      const consequence=form.status==="published"
        ?"这篇文章当前为“内容完成”，保存后会立即进入公开博客并可被所有人访问。"
        :"这篇文章会移回公开博客草稿区，发布后才会公开访问。";
      if(!window.confirm(`${consequence}\n\n确认移出知识空间吗？`))return;
    }
    setForm({...form,spaceId:nextSpaceId,spacePath:choice?.path?.map((item)=>item.name).join(" / ")??"",featured:nextSpaceId===null?form.featured:false});
  }

  async function remove(post: AdminPost) {
    if (isPersonalAccount && !post.canEdit) return setMessage("公开文章只读；你只能删除自己的文章。");
    if (!window.confirm(`确定删除《${post.title}》吗？`)) return;
    try {
      const response = isPersonalAccount
        ? await fetch(`/api/knowledge/posts/${encodeURIComponent(post.publicId)}`, {
            method: "DELETE", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ expected_version: post.version }),
          })
        : await fetch(`/api/posts/${post.id}`, {
            method: "DELETE", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ version: post.version }),
          });
      const data = await readApiJson<{ok:boolean;error?:string}>(response);
      if (!response.ok) return setMessage(data.error ?? "删除失败，请刷新列表后重试");
      setMessage("");
      await Promise.all([load(), loadStats()]);
    } catch {
      setMessage("删除请求未完成，请检查网络后刷新列表确认文章状态");
    }
  }

  async function signOut() {
    if (signOutPath.startsWith("/api/")) {
      await fetch(signOutPath, { method: "POST" });
      window.location.replace(isPersonalAccount ? "/login" : "/admin/login");
      return;
    }
    window.location.href = signOutPath;
  }

  function changeSection(requested:AdminSection){
    if(isPersonalAccount&&isSiteAdminSection(requested)){
      setMessage("站点管理仅管理员可访问");
      return;
    }
    const next = requested;
    if(next===section)return;
    const nextSpaceId=next==="spaces"?null:spaceLandingId;
    if(next==="spaces"){
      setCreateSpaceOnOpen(false);
      setSpaceLandingId(null);
    }
    setSection(next);
    writeLocation(currentLocation({section:next,spaceId:nextSpaceId}),"push");
  }

  function openSpaces(spaceId:number|null=null){
    setCreateSpaceOnOpen(false);
    setSpaceLandingId(spaceId);
    setSection("spaces");
    writeLocation(currentLocation({section:"spaces",spaceId}),"push");
  }

  function changeBrowseCategory(value:string){
    setBrowseCategory(value);
    writeLocation(currentLocation({browseCategory:value}));
  }

  function changeBrowseVisibility(value:AdminBrowseVisibility){
    setBrowseVisibility(value);
    writeLocation(currentLocation({browseVisibility:value}));
  }

  function changeArticleQuery(value:string){
    setQuery(value);resetCursor();
    writeLocation(currentLocation({query:value}));
  }

  function changeArticleCategory(value:string){
    setCategory(value);resetCursor();
    writeLocation(currentLocation({category:value}));
  }

  function changeArticleStatus(value:string){
    const next:AdminLocation["status"]=value==="draft"||value==="published"?value:"all";
    setStatus(next);resetCursor();
    writeLocation(currentLocation({status:next}));
  }

  function changeSpaceLocation(spaceId:number|null){
    setSpaceLandingId(spaceId);
    if(section==="spaces")writeLocation(currentLocation({spaceId}));
  }

  return (
    <main className={`admin-shell${sidebarCollapsed?" sidebar-collapsed":""}`}>
      <AdminSidebar brandName={settings.brandName} avatarUrl={settings.avatarUrl} authorName={settings.authorName} userName={userName} section={section} stats={stats} categoryCount={categories.length} collapsed={sidebarCollapsed} onSectionChange={changeSection} onToggle={toggleSidebar} onSignOut={()=>void signOut()} isPersonalAccount={isPersonalAccount}/>
      <div className="admin-workspace">
        <div className="admin-workspace-bar axis-workspace-command">
          <div className="axis-workspace-location"><span className="axis-command-dot" aria-hidden="true"/><span>WORKSPACE</span><b>{({browse:"浏览",articles:"文章",spaces:"知识空间",files:"文件",home:"首页设置",about:"关于",categories:"分类",connect:"接入",integrations:"AI 连接"} as Record<AdminSection,string>)[section]}</b></div>
          <AdminArticleSearch disabled={Boolean(form||studio)} articleCount={isPersonalAccount?stats.total:stats.total+stats.privateArticles} onBrowse={(postId,publicId)=>void browseById(postId,undefined,publicId)} isPersonalAccount={isPersonalAccount}/>
        </div>
      {section==="browse" ? <AdminBrowsePanel settings={settings} categories={categories} stats={stats} category={browseCategory} visibility={browseVisibility} onCategoryChange={changeBrowseCategory} onVisibilityChange={changeBrowseVisibility} onEdit={(postId)=>void editById(postId)} onWrite={()=>openNewArticle()} onOpenArticles={()=>changeSection("articles")} onOpenSpaces={(spaceId)=>openSpaces(spaceId??null)} isPersonalAccount={isPersonalAccount} /> : section==="home" ? <AdminSettingsPanel initial={settings} readOnly={isPersonalAccount} /> : section==="articles" ? <AdminArticlesPanel brandName={settings.brandName} stats={stats} posts={posts} categories={categories} loading={loading} message={message} query={query} category={category} status={status} batch={cursorStack.length+1} hasPrevious={cursorStack.length>0} hasNext={Boolean(nextCursor)} onQueryChange={changeArticleQuery} onCategoryChange={changeArticleCategory} onStatusChange={changeArticleStatus} onNew={()=>openNewArticle()} onBrowse={(postId)=>void browseById(postId,{range:"all",query,category,status:status as "all"|"draft"|"published",source:"articles"})} onShare={setSharePost} onEdit={(postId)=>void editById(postId)} onRemove={(post)=>void remove(post)} onPrevious={previousBatch} onNext={nextBatch} isPersonalAccount={isPersonalAccount}/> : section==="files" ? <AdminFilesPanel isPersonalAccount={isPersonalAccount}/> : section==="spaces" ? <AdminSpacesPanel initialSpaceId={spaceLandingId} createOnOpen={createSpaceOnOpen} onLocationChange={changeSpaceLocation} onCreateArticle={(spaceId,spacePath)=>openNewArticle(spaceId,spacePath)} onEditArticle={(postId)=>void editById(postId)} onBrowseArticle={(postId,readerContext)=>void browseById(postId,readerContext)} onShareArticle={setSharePost} isPersonalAccount={isPersonalAccount} authorName={settings.authorName} avatarUrl={settings.avatarUrl} /> : section==="connect" ? <AdminPageEditor initial={connectPage} settings={settings} kind="connect" label="接入" readOnly={isPersonalAccount} /> : section==="integrations" ? <AdminIntegrationsPanel initial={connections} initialActivation={activation} isPersonalAccount={isPersonalAccount} /> : section==="about" ? <AdminPageEditor initial={aboutPage} settings={settings} kind="about" label="关于" readOnly={isPersonalAccount} /> : <AdminCategoriesPanel initial={isPersonalAccount?categories.filter((item)=>!item.slug.startsWith("user-")):categories} onChange={setCategories} readOnly={isPersonalAccount} />}
      </div>

      {form&&<AdminArticleEditor form={form} category={selectedFormCategory} categories={isPersonalAccount?editableCategories:categories} settings={settings} message={message} previewRef={articleEditorPreviewRef} onChange={setForm} onChangeSpace={changeSpace} onClose={closeEditor} onOpenStudio={setStudio} onSharePreview={!isPersonalAccount&&form.id?()=>setSharePost({id:form.id!,title:form.title}):undefined} onSave={save} isPersonalAccount={isPersonalAccount}/>}
      {form&&studio&&<ArticleWritingStudio draft={form} categoryName={selectedFormCategory?.name??"随笔"} categoryColor={selectedFormCategory?.color??"#8E8E93"} authorName={settings.authorName} avatarUrl={settings.avatarUrl} initialMode={studio} onChange={(content)=>setForm(current=>current?{...current,content}:current)} onPostVersionChange={(version)=>setForm(current=>current?{...current,version}:current)} onClose={()=>setStudio(null)}/>}
      <ModalPostLink controllerOnly readerScope="admin" publicId="" slug="" onEdit={(postId,returnTarget)=>void editById(postId,returnTarget)}/>
      {sharePost&&<AdminPreviewShareDialog post={sharePost} onClose={()=>setSharePost(null)}/>}
    </main>
  );
}
