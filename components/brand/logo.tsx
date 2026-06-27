import { cn } from "@/lib/utils";

/** Concentric-circle Knack mark. Inherits text color via currentColor; coral center. */
export function Logomark({
  size = 26,
  strokeWidth = 1.8,
  className,
}: {
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={cn("shrink-0", className)}
      aria-hidden
    >
      <circle cx="12" cy="12" r="9.3" stroke="currentColor" strokeWidth={strokeWidth} />
      <circle cx="12" cy="12" r="4.9" stroke="currentColor" strokeWidth={strokeWidth} />
      <circle cx="12" cy="12" r="2" fill="var(--coral)" />
    </svg>
  );
}

/** Mark + "Knack" wordmark. */
export function Wordmark({
  size = 26,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Logomark size={size} />
      <span className="text-xl font-extrabold tracking-display">Knack</span>
    </div>
  );
}

/** Gradient avatar tile with white mark — used for the agent + brand chips. */
export function AgentMark({
  size = 30,
  radius = 9,
  className,
}: {
  size?: number;
  radius?: number;
  className?: string;
}) {
  return (
    <div
      className={cn("knack-gradient flex items-center justify-center", className)}
      style={{ width: size, height: size, borderRadius: radius }}
    >
      <svg width={size * 0.53} height={size * 0.53} viewBox="0 0 24 24" fill="none" aria-hidden>
        <circle cx="12" cy="12" r="8.6" stroke="#fff" strokeWidth="2" />
        <circle cx="12" cy="12" r="3.2" fill="#fff" />
      </svg>
    </div>
  );
}
