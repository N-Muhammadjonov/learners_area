import { ButtonHTMLAttributes, forwardRef } from "react";

type Variant = "primary" | "secondary" | "ghost";

const variantClass: Record<Variant, string> = {
  primary: "btn-primary",
  secondary: "btn-secondary",
  ghost: "btn-ghost",
};

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
};

export const Button = forwardRef<HTMLButtonElement, Props>(
  ({ variant = "primary", type = "button", className = "", ...props }, ref) => {
    return (
      <button ref={ref} type={type} className={`${variantClass[variant]} ${className}`} {...props} />
    );
  }
);
Button.displayName = "Button";
