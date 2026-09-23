import { getDictionary, getLocale } from "@/lib/i18n";
import { ModuleComingSoon } from "@/components/shell/ModuleComingSoon";

export default function MocksPage() {
  const dict = getDictionary(getLocale());
  return (
    <ModuleComingSoon
      title={dict.nav.mocks}
      body="mock_tests / mock_attempts tables exist; the timed full-test runner isn't built yet."
      ctaLabel={dict.dashboard.startWriting}
    />
  );
}
