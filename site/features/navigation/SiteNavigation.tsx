import Link from "next/link";
import type { ReactNode } from "react";
import DesktopIslandNav from "./nav/DesktopIslandNav";
import MobileIslandMenu from "./nav/MobileIslandMenu";
import type { NavCurrent } from "./nav/nav-destinations";

type Props = {
  brandName: string;
  children: ReactNode;
  current?: NavCurrent;
};

/** Shared island chrome. Desktop/tablet and phone are separate trees. */
export default function SiteNavigation({ brandName, children, current }: Props) {
  return <header className="site-nav">
    <nav>
      <Link className="brand" href="/" prefetch={false} aria-label={`${brandName}首页`}>
        <svg className="brand-axis" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" aria-hidden="true" focusable="false">
          <path d="M18 17H37.5L79 79H59.5Z" fill="currentColor" />
          <path d="M60 17H80L53.4 53.4L42.5 38Z" fill="#5F78FF" />
          <path d="M41.6 51L52.6 67L38 79H17Z" fill="#5F78FF" />
        </svg>
        <span className="brand-word" data-preview-field="brandName">{brandName}</span>
      </Link>
      {children}
      <DesktopIslandNav current={current} />
      <MobileIslandMenu current={current} />
    </nav>
  </header>;
}
