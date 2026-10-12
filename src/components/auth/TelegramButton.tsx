"use client";

import { useEffect, useRef } from "react";

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
  nonce,
}: {
  label: string;
  unavailableLabel: string;
  configured: boolean;
  botUsername?: string;
  nonce?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!configured || !botUsername || !container.current) return;
    // React 19 hoists async JSX scripts into <head>. The legacy widget inserts
    // its iframe beside its script, so it must execute inside this container.
    const target = container.current;
    const script = document.createElement("script");
    script.async = true;
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    if (nonce) script.nonce = nonce;
    script.setAttribute("data-telegram-login", botUsername);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-auth-url", "/api/auth/telegram/callback");
    script.setAttribute("data-request-access", "write");
    target.appendChild(script);
    return () => { target.replaceChildren(); };
  }, [configured, botUsername, nonce]);

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

  return <div ref={container} aria-label={label} data-telegram-widget />;
}
