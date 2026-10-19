import "./reading-workspace.css";

/** Authentication remains in /app/layout and (focus)/layout. No ordinary shell
 * mounts here, including on a direct visit or a resumed attempt. */
export default function ReadingFocusLayout({ children }: { children: React.ReactNode }) {
  return <main id="main-content" tabIndex={-1} className="reading-focus" data-reading-full-focus>{children}</main>;
}
