export const ADMIN_SECTIONS=["browse","home","articles","spaces","files","connect","integrations","about","categories"] as const;

export type AdminSection=typeof ADMIN_SECTIONS[number];
export type AdminBrowseVisibility="all"|"public"|"private";
export type AdminLocation={
  section:AdminSection;
  browseCategory:string;
  browseVisibility:AdminBrowseVisibility;
  query:string;
  category:string;
  status:"all"|"draft"|"published";
  spaceId:number|null;
};

export function parseAdminLocation(params:Pick<URLSearchParams,"get">):AdminLocation{
  const requestedSection=params.get("section");
  const section=ADMIN_SECTIONS.includes(requestedSection as AdminSection)?requestedSection as AdminSection:"browse";
  const requestedVisibility=params.get("visibility");
  const browseVisibility:AdminBrowseVisibility=requestedVisibility==="public"||requestedVisibility==="private"?requestedVisibility:"all";
  const requestedStatus=params.get("status");
  const status:AdminLocation["status"]=requestedStatus==="draft"||requestedStatus==="published"?requestedStatus:"all";
  const requestedCategory=params.get("category")?.trim()||"all";
  const requestedSpaceId=Number(params.get("spaceId"));
  return {
    section,
    browseCategory:section==="browse"?requestedCategory:"all",
    browseVisibility:section==="browse"?browseVisibility:"all",
    query:section==="articles"?params.get("q")?.trim()||"":"",
    category:section==="articles"?requestedCategory:"all",
    status:section==="articles"?status:"all",
    spaceId:section==="spaces"&&Number.isInteger(requestedSpaceId)&&requestedSpaceId>0?requestedSpaceId:null,
  };
}

export function adminLocationHref(input:Partial<AdminLocation>&Pick<AdminLocation,"section">){
  const params=new URLSearchParams({section:input.section});
  if(input.section==="browse"){
    if(input.browseVisibility&&input.browseVisibility!=="all")params.set("visibility",input.browseVisibility);
    if(input.browseCategory&&input.browseCategory!=="all")params.set("category",input.browseCategory);
  }else if(input.section==="articles"){
    if(input.query?.trim())params.set("q",input.query.trim());
    if(input.category&&input.category!=="all")params.set("category",input.category);
    if(input.status&&input.status!=="all")params.set("status",input.status);
  }else if(input.section==="spaces"&&input.spaceId){
    params.set("spaceId",String(input.spaceId));
  }
  return `/admin?${params}`;
}
