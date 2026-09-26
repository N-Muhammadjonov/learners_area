import Link from "next/link";
import { AuthShell } from "@/components/auth/AuthShell";
import { RegisterForm } from "@/components/auth/RegisterForm";
import { getDictionary, getLocale } from "@/lib/i18n";
import { isTelegramConfigured } from "@/lib/auth/providers/telegram";

export default async function RegisterPage() {
  const dict = getDictionary(await getLocale());
  return (
    <AuthShell
      title={dict.auth.registerTitle}
      subtitle={dict.auth.registerSubtitle}
      footer={
        <>
          {dict.auth.haveAccount}{" "}
          <Link href="/login" className="text-signal-600 hover:underline">
            {dict.auth.loginCta}
          </Link>
        </>
      }
    >
      <RegisterForm
        dict={dict}
        telegramConfigured={isTelegramConfigured()}
        telegramBotUsername={process.env.TELEGRAM_BOT_USERNAME}
      />
    </AuthShell>
  );
}
