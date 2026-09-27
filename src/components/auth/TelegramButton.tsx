/**
 * Deprecated Login Widget button.
 *
 * Do not mount this. The website now uses TelegramIntentLogin: the browser
 * holds a one-time intent, the bot confirms it, and the existing session
 * cookie is issued only after that confirmation. This file remains so the old
 * widget can be compared until a real Telegram check retires the callback.
 */
export function TelegramButton({
  label,
  unavailableLabel,
  configured,
  botUsername,
}: {
  label: string;
  unavailableLabel: string;
  configured: boolean;
  botUsername?: string;
}) {
  if (!configured) {
    return (
      <div>
        <button type="button" disabled className="btn-secondary w-full opacity-50">
          {label}
        </button>
        <p className="mt-1.5 text-xs text-ink-300">{unavailableLabel}</p>
      </div>
    );
  }

  return (
    <script
      async
      src="https://telegram.org/js/telegram-widget.js?22"
      data-telegram-login={botUsername}
      data-size="large"
      data-auth-url="/api/auth/telegram/callback"
      data-request-access="write"
    />
  );
}
