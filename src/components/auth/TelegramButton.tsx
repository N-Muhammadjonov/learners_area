/**
 * Purely presentational — deliberately has NO import from
 * lib/auth/providers/telegram (that module pulls in node:crypto, which
 * cannot be bundled for the browser). `configured`/`botUsername` are
 * computed server-side and passed down as props instead.
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
