import { InputHTMLAttributes, LabelHTMLAttributes, TextareaHTMLAttributes, forwardRef } from "react";

export const Label = (props: LabelHTMLAttributes<HTMLLabelElement>) => (
  <label {...props} className={`mb-1.5 block text-sm font-medium text-ink-700 ${props.className ?? ""}`} />
);

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className = "", ...props }, ref) => (
    <input ref={ref} className={`input ${className}`} {...props} />
  )
);
Input.displayName = "Input";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className = "", ...props }, ref) => (
    <textarea ref={ref} className={`input min-h-[160px] resize-y font-sans leading-relaxed ${className}`} {...props} />
  )
);
Textarea.displayName = "Textarea";

export function FieldError({ children }: { children?: string }) {
  if (!children) return null;
  return <p className="mt-1 text-xs text-band-bad">{children}</p>;
}
