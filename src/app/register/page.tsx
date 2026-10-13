import { telegramIntentAuthEnabled } from "@/lib/auth/telegram-intent-config";
import { headers } from "next/headers";
import { publicAuthPolicy } from "@/lib/auth/public-auth-policy";
import Link from "next/link";
import { AuthShell } from "@/components/auth/AuthShell";
import { RegisterForm } from "@/components/auth/RegisterForm";
import { getDictionary, getLocale } from "@/lib/i18n";
import { isTelegramConfigured } from "@/lib/auth/providers/telegram";

export default async function RegisterPage() {
  const policy = publicAuthPolicy();
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const dict = getDictionary(await getLocale());
  return (
    <AuthShell
      title={dict.auth.registerTitle}
      subtitle={policy.telegramOnly ? dict.auth.continueWithTelegram : dict.auth.registerSubtitle}
      footer={
        <>
          {dict.auth.haveAccount}{" "}
          <Link href="/login" className="btn-secondary ">
            {dict.auth.loginCta}
          </Link>
        </>
      }
    >
      <RegisterForm
        passwordEnabled={policy.passwordEnabled}
          telegramIntentEnabled={telegramIntentAuthEnabled()}
        nonce={nonce}
        dict={dict}
        telegramConfigured={isTelegramConfigured()}
        telegramBotUsername={process.env.TELEGRAM_BOT_USERNAME}
      />
    </AuthShell>
  );
}
