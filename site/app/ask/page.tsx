import { getSiteSettings } from "@/db/queries";
import { currentIdentity } from "@/server/auth/identity";
import SiteNavigation from "@/features/navigation/SiteNavigation";
import AskClient from "./AskClient";

export const dynamic="force-dynamic";

export default async function AskPage({
  searchParams,
}:{
  searchParams:Promise<{scope?:string}>;
}) {
  const [settings,identity,params]=await Promise.all([
    getSiteSettings(),currentIdentity(),searchParams,
  ]);
  const scope=params.scope==="mine"||params.scope==="all"?params.scope:"public";
  return <main className="xy-ask-page">
    <link rel="stylesheet" href="/ask.css" />
    <SiteNavigation brandName={settings.brandName} current="ask">
      <span className="xy-ask-nav-center">知识问答</span>
    </SiteNavigation>
    <AskClient authenticated={Boolean(identity)} defaultScope={identity?scope:"public"}/>
    <footer className="xy-ask-footer">{settings.brandName} · 人与 AI 都能使用的开放知识库</footer>
  </main>;
}
