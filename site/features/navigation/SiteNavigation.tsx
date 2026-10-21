import Link from "next/link";
import type { ReactNode } from "react";
import DesktopIslandNav from "./nav/DesktopIslandNav";
import AxisMark from "./AxisMark";
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
        <AxisMark className="brand-axis" />
        <span className="brand-word" data-preview-field="brandName">{brandName}</span>
      </Link>
      {children}
      <DesktopIslandNav current={current} />
      <MobileIslandMenu current={current} />
    </nav>
  </header>;
}
