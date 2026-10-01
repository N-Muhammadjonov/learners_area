import Link from "next/link";
import { performanceDiagnosticsEnabled } from "@/lib/config/site";
import { Suspense } from "react";
import { AuthShell } from "@/components/auth/AuthShell";
import { LoginForm } from "@/components/auth/LoginForm";
import { getDictionary, getLocale } from "@/lib/i18n";
import { isTelegramConfigured } from "@/lib/auth/providers/telegram";
import { googleConfigFrom } from "@/lib/auth/providers/google-config";

export default async function LoginPage() {
  const dict = getDictionary(await getLocale());
  return (
    <AuthShell
      title={dict.auth.loginTitle}
      subtitle={dict.auth.loginSubtitle}
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
          dict={dict}
          diagnostics={performanceDiagnosticsEnabled()}
          telegramConfigured={isTelegramConfigured()}
          telegramBotUsername={process.env.TELEGRAM_BOT_USERNAME}
          googleConfigured={googleConfigFrom(process.env).config !== null}
        />
      </Suspense>
    </AuthShell>
  );
}
