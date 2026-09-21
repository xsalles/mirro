import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

const variants = {
  primary: "bg-[var(--ink)] text-white hover:bg-black",
  secondary: "border border-[var(--line)] bg-white text-[var(--ink)] hover:bg-[var(--surface-2)]",
  ghost: "text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]",
  danger: "bg-[var(--danger)] text-white hover:brightness-95",
} as const;

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode; variant?: keyof typeof variants }>(function Button(
  { children, className = "", variant = "primary", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      {...props}
      className={`inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-[background-color,color,transform] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--thread)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 active:translate-y-px ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
});
