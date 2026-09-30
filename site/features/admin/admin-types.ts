export type { AdminSection } from "@/domain/admin/location";

export type AdminMcpSession = {
  subject: string;
  label: string;
  status: "connected" | "revoked";
  scopes: string[];
  grantedAt: string | null;
  lastUsedAt: string | null;
  tokenCount: number;
};

export type AdminMcpConnection = {
  id: string;
  name: string;
  kind: "legacy" | "oauth";
  status: "configured" | "connected" | "revoked";
  scopes: string[];
  lastUsedAt: string | null;
  lastUsedLabel: string | null;
  revocable: boolean;
  sessions: AdminMcpSession[];
};

export type AdminStats={
  total:number;
  published:number;
  drafts:number;
  views:number;
  privateArticles:number;
};

export type AdminCategory={
  id:number;
  name:string;
  slug:string;
  color:string;
};

export type AdminPost={
  id:number;
  version:number;
  publicId:string;
  title:string;
  slug:string;
  excerpt:string;
  categoryId:number;
  categoryName:string;
  status:string;
  featured:boolean;
  viewCount:number;
  publishedAt:string|null;
  updatedAt:string;
  spaceId:number|null;
  sortOrder?:number;
  spacePath:string|null;
};

export type ArticleForm={
  id?:number;
  publicId?:string;
  version?:number;
  title:string;
  slug:string;
  excerpt:string;
  content:string;
  categoryId:number;
  spaceId:number|null;
  sortOrder?:number;
  spacePath?:string;
  status:"draft"|"published";
  featured:boolean;
  publishedAt?:string|null;
};
