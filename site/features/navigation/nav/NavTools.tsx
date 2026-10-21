import MotionModeToggle from "../MotionModeToggle";
import ReadingModeToggle from "../ReadingModeToggle";
import ThemeToggle from "../ThemeToggle";
import AskAiTrigger from "./AskAiTrigger";

/** Reading / motion / theme stay one control set; each surface only places this group. */
export default function NavTools() {
  return <div className="nav-tools">
    <AskAiTrigger />
    <ReadingModeToggle />
    <MotionModeToggle />
    <ThemeToggle />
  </div>;
}
