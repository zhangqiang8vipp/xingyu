import type { Metadata, Viewport } from "next";
import "./globals.css";
import "@/features/reader/quiet-island.css";
import ScrollIndicator from "./ScrollIndicator";
import RouteTransition from "./RouteTransition";
import { getSiteSettings } from "@/db/queries";
import DismissibleDetails from "@/features/markdown/DismissibleDetails";

const preferenceBootstrap = `(function(){try{var root=document.documentElement;var themeSaved=localStorage.getItem("xingyu-theme-mode");var legacy=localStorage.getItem("xingyu-theme");var theme=(themeSaved==="light"||themeSaved==="dark"||themeSaved==="system")?themeSaved:((legacy==="light"||legacy==="dark")?legacy:"system");var dark=theme==="system"?matchMedia("(prefers-color-scheme: dark)").matches:theme==="dark";var readingSaved=localStorage.getItem("xingyu-reading-mode");var reading=readingSaved==="page"?"page":"modal";var motionSaved=localStorage.getItem("xingyu-motion-mode");var motion=(motionSaved==="flip"||motionSaved==="static")?motionSaved:(matchMedia("(prefers-reduced-motion: reduce)").matches?"static":"flip");root.dataset.themeMode=theme;root.dataset.theme=dark?"dark":"light";root.dataset.readingMode=reading;root.dataset.motionMode=motion;root.style.colorScheme=dark?"dark":"light"}catch(e){}})();`;

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export async function generateMetadata():Promise<Metadata>{
  const settings=await getSiteSettings();
  return {title:{default:settings.seoTitle,template:`%s · ${settings.brandName}`},description:settings.seoDescription,icons:{
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  }};
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html:preferenceBootstrap }} /></head>
      <body id="page-content"><RouteTransition>{children}</RouteTransition><ScrollIndicator /><DismissibleDetails /></body>
    </html>
  );
}
