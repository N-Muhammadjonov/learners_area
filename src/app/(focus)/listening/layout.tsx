import { BackLink } from "@/components/ui/BackLink";
import { getDictionary, getLocale } from "@/lib/i18n";

/**
 * Listening tests and attempts own the viewport. The ordinary application sidebar/topbar
 * never mount on this route tree, while one consistent BackLink remains
 * reachable at the top-left and falls back to the Listening library.
 */
export default async function ListeningFocusLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const dict = getDictionary(await getLocale());

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="listening-full-focus relative min-h-dvh w-full min-w-0 overflow-x-hidden bg-paper"
      data-listening-full-focus
    >
      <div
        className="sticky top-0 z-40 flex min-h-16 w-full items-center bg-paper-raised/95 px-3 py-2 backdrop-blur"
        style={{
          paddingTop: "calc(0.5rem + env(safe-area-inset-top))",
          paddingLeft: "calc(0.75rem + env(safe-area-inset-left))",
          paddingRight: "calc(0.75rem + env(safe-area-inset-right))",
        }}
        data-listening-focus-backbar
      >
        <BackLink
          fallbackHref="/listening"
          label={dict.nav.listening}
          className="btn-secondary inline-flex min-h-11 w-fit items-center gap-1"
        />
      </div>
      <div className="w-full min-w-0" data-listening-focus-content>
        {children}
      </div>
    </main>
  );
}
