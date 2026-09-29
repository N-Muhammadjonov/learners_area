"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/Button";
import { useOptionalInstantInteraction } from "@/components/interaction/InstantInteractionProvider";
import type { InteractionCategory } from "@/lib/interaction/navigation";

/** Shared pending contract for future async controls. It never implies success. */
export function AsyncActionButton({
  pending = false,
  pendingLabel,
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  pending?: boolean;
  pendingLabel?: ReactNode;
}) {
  return (
    <Button
      {...props}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      data-interaction-type="mutation"
    >
      {pending && pendingLabel ? pendingLabel : children}
    </Button>
  );
}

/**
 * Use run() at the event boundary, before awaiting transport. The ref closes
 * the same-tick double-submit gap while React commits the visible busy state.
 */
export function useAsyncAction(category: InteractionCategory = "mutation") {
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const interaction = useOptionalInstantInteraction();

  async function run<T>(action: () => Promise<T>): Promise<T | undefined> {
    if (inFlight.current) return undefined;
    inFlight.current = true;
    setPending(true);
    const measurement = interaction?.beginMeasurement(category, "button") ?? null;
    try {
      const result = await action();
      interaction?.finishMeasurement(measurement, "success");
      return result;
    } catch (error) {
      interaction?.finishMeasurement(measurement, "failure");
      throw error;
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return { pending, run };
}

/** A select for privilege/status changes that cannot apply until confirmation and server success. */
export function ConfirmSelect({
  value,
  options,
  ariaLabel,
  className,
  disabled = false,
  title,
  description,
  confirmLabel,
  cancelLabel,
  pendingLabel,
  failureMessage,
  onConfirm,
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  pendingLabel: string;
  failureMessage: string;
  onConfirm: (value: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [requested, setRequested] = useState<string | null>(null);
  const [confirmedValue, setConfirmedValue] = useState<string | null>(null);
  const [failure, setFailure] = useState(false);
  const selectRef = useRef<HTMLSelectElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const wasOpen = useRef(false);
  const dialogId = useId();
  const { pending, run } = useAsyncAction("destructive");
  const selectedValue = confirmedValue ?? value;

  useEffect(() => { setConfirmedValue(value); }, [value]);

  useEffect(() => {
    if (!open) {
      if (dialogRef.current?.open) dialogRef.current.close();
      if (wasOpen.current) selectRef.current?.focus();
      wasOpen.current = false;
      return;
    }
    const dialog = dialogRef.current;
    if (!dialog) return;
    wasOpen.current = true;
    if (!dialog.open) dialog.showModal();
    dialog.querySelector<HTMLButtonElement>("[data-confirm-action]")?.focus();
  }, [open]);

  async function confirm() {
    if (!requested) return;
    setFailure(false);
    try {
      const completed = await run(async () => { await onConfirm(requested); return true; });
      if (completed) {
        setConfirmedValue(requested);
        setOpen(false);
        setRequested(null);
      }
    } catch {
      setFailure(true);
    }
  }

  const requestedLabel = options.find((option) => option.value === requested)?.label ?? requested;
  return (
    <>
      <select
        ref={selectRef}
        className={className}
        value={selectedValue}
        disabled={disabled || pending}
        aria-label={ariaLabel}
        aria-busy={pending || undefined}
        data-interaction-type="destructive"
        onChange={(event) => {
          if (event.target.value === selectedValue) return;
          setFailure(false);
          setRequested(event.target.value);
          setOpen(true);
        }}
      >
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <dialog
        ref={dialogRef}
        aria-labelledby={`${dialogId}-title`}
        aria-describedby={`${dialogId}-description`}
        onCancel={(event) => { event.preventDefault(); if (!pending) { setOpen(false); setRequested(null); } }}
        onClose={() => { if (open && !pending) { setOpen(false); setRequested(null); } }}
        className="interaction-confirm-dialog"
      >
        <h2 id={`${dialogId}-title`}>{title}</h2>
        <p id={`${dialogId}-description`}>{description}</p>
        {requestedLabel ? <p>{requestedLabel}</p> : null}
        {failure ? <p role="alert">{failureMessage}</p> : null}
        <div className="interaction-confirm-dialog__actions">
          <button type="button" disabled={pending} onClick={() => { setOpen(false); setRequested(null); }}>
            {cancelLabel}
          </button>
          <AsyncActionButton
            type="button"
            data-confirm-action
            pending={pending}
            pendingLabel={pendingLabel}
            onClick={() => void confirm()}
          >
            {confirmLabel}
          </AsyncActionButton>
        </div>
      </dialog>
    </>
  );
}

/** An accessible, immediate confirmation surface for destructive/security actions. */
export function ConfirmAction({
  trigger,
  title,
  description,
  confirmLabel,
  cancelLabel,
  pendingLabel,
  failureMessage,
  triggerClassName,
  triggerRole,
  triggerDisabled = false,
  onConfirm,
}: {
  trigger: ReactNode;
  triggerClassName?: string;
  triggerRole?: "menuitem";
  triggerDisabled?: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  pendingLabel: string;
  failureMessage: string;
  onConfirm: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const dialogId = useId();
  const { pending, run } = useAsyncAction("destructive");

  useEffect(() => {
    if (!open) {
      if (dialogRef.current?.open) dialogRef.current.close();
      if (wasOpen.current) triggerRef.current?.focus();
      wasOpen.current = false;
      return;
    }
    const dialog = dialogRef.current;
    if (!dialog) return;
    wasOpen.current = true;
    if (!dialog.open) dialog.showModal();
    dialog.querySelector<HTMLButtonElement>("[data-confirm-action]")?.focus();
  }, [open]);

  async function confirm() {
    setFailure(false);
    try {
      const completed = await run(async () => { await onConfirm(); return true; });
      if (completed) setOpen(false);
    } catch {
      setFailure(true);
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        role={triggerRole}
        className={triggerClassName}
        disabled={triggerDisabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-interaction-type="destructive"
        onClick={() => { setFailure(false); setOpen(true); }}
      >
        {trigger}
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby={`${dialogId}-title`}
        aria-describedby={`${dialogId}-description`}
        onCancel={(event) => { event.preventDefault(); if (!pending) setOpen(false); }}
        onClose={() => { if (open && !pending) setOpen(false); }}
        className="interaction-confirm-dialog"
      >
        <h2 id={`${dialogId}-title`}>{title}</h2>
        <p id={`${dialogId}-description`}>{description}</p>
        {failure ? <p role="alert">{failureMessage}</p> : null}
        <div className="interaction-confirm-dialog__actions">
          <button type="button" disabled={pending} onClick={() => setOpen(false)}>
            {cancelLabel}
          </button>
          <AsyncActionButton
            type="button"
            data-confirm-action
            pending={pending}
            pendingLabel={pendingLabel}
            onClick={() => void confirm()}
          >
            {confirmLabel}
          </AsyncActionButton>
        </div>
      </dialog>
    </>
  );
}
