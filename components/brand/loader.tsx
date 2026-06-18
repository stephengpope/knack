import { cn } from "@/lib/utils";

/**
 * Knack lock-on loader — two counter-spinning rings around a breathing coral
 * dot. Scales with `size`; pass an optional `label` for full-page loading.
 */
export function KnackLoader({
  size = 80,
  label,
  className,
}: {
  size?: number;
  label?: string;
  className?: string;
}) {
  const dot = size * 0.2;
  return (
    <div
      role="status"
      aria-label={label ?? "Loading"}
      className={cn("flex flex-col items-center justify-center gap-5", className)}
    >
      <div className="relative" style={{ width: size, height: size }}>
        <svg
          className="ko-outer absolute inset-0"
          width={size}
          height={size}
          viewBox="0 0 80 80"
          fill="none"
        >
          <path
            d="M40 6 A34 34 0 0 1 74 40"
            stroke="var(--primary)"
            strokeWidth="4"
            strokeLinecap="round"
          />
          <path
            d="M40 74 A34 34 0 0 1 6 40"
            stroke="var(--primary)"
            strokeWidth="4"
            strokeLinecap="round"
          />
        </svg>
        <svg
          className="ko-inner absolute inset-0"
          width={size}
          height={size}
          viewBox="0 0 80 80"
          fill="none"
        >
          <circle
            cx="40"
            cy="40"
            r="20"
            stroke="var(--accent-deep)"
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray="62 64"
          />
        </svg>
        <div
          className="ko-dot absolute rounded-full"
          style={{
            left: "50%",
            top: "50%",
            width: dot,
            height: dot,
            marginLeft: -dot / 2,
            marginTop: -dot / 2,
            background: "var(--coral)",
          }}
        />
      </div>
      {label && (
        <div className="text-[14px] font-semibold tracking-[-0.01em] text-ink-soft">
          {label}
        </div>
      )}
    </div>
  );
}
