import Link from "next/link";
import { Suspense } from "react";
import { AuthShell } from "@/components/auth/AuthShell";
import { LoginForm } from "@/components/auth/LoginForm";
import { getDictionary, getLocale } from "@/lib/i18n";
import { isTelegramConfigured } from "@/lib/auth/providers/telegram";

export default function LoginPage() {
  const dict = getDictionary(getLocale());
  return (
    <AuthShell
      title={dict.auth.loginTitle}
      subtitle={dict.auth.loginSubtitle}
      footer={
        <>
          {dict.auth.noAccount}{" "}
          <Link href="/register" className="text-signal-600 hover:underline">
            {dict.auth.registerCta}
          </Link>
        </>
      }
    >
      <Suspense>
        <LoginForm
          dict={dict}
          telegramConfigured={isTelegramConfigured()}
          telegramBotUsername={process.env.TELEGRAM_BOT_USERNAME}
        />
      </Suspense>
    </AuthShell>
  );
}
