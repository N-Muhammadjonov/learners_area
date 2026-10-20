import { telegramIntentAuthEnabled } from "@/lib/auth/telegram-intent-config";
import { headers } from "next/headers";
import { publicAuthPolicy } from "@/lib/auth/public-auth-policy";
import Link from "next/link";
import { performanceDiagnosticsEnabled } from "@/lib/config/site";
import { Suspense } from "react";
import { AuthShell } from "@/components/auth/AuthShell";
import { LoginForm } from "@/components/auth/LoginForm";
import { getDictionary, getLocale } from "@/lib/i18n";
import { isTelegramConfigured } from "@/lib/auth/providers/telegram";
import { googleConfigFrom } from "@/lib/auth/providers/google-config";

export default async function LoginPage() {
  const policy = publicAuthPolicy();
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const dict = getDictionary(await getLocale());
  return (
    <AuthShell
      prominentBrand
      title={dict.auth.loginTitle}
      subtitle={policy.telegramOnly ? dict.auth.continueWithTelegram : dict.auth.loginSubtitle}
      footer={
        <>
          {dict.auth.noAccount}{" "}
          <Link href="/register" className="btn-secondary ">
            {dict.auth.registerCta}
          </Link>
        </>
      }
    >
      <Suspense>
        <LoginForm
          passwordEnabled={policy.passwordEnabled}
          telegramIntentEnabled={telegramIntentAuthEnabled()}
          nonce={nonce}
          dict={dict}
          diagnostics={performanceDiagnosticsEnabled()}
          telegramConfigured={isTelegramConfigured()}
          telegramBotUsername={process.env.TELEGRAM_BOT_USERNAME}
          googleConfigured={policy.googleEnabled && googleConfigFrom(process.env).config !== null}
        />
      </Suspense>
    </AuthShell>
  );
}
