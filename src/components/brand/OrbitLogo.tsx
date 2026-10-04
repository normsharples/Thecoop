import { cn } from "@/lib/utils";

/**
 * ORBIT brand marks — traced from the brand artboard.
 *
 * `OrbitRocket` is the rocket on its own: the body takes `currentColor` so it
 * inherits whatever it sits in (white on the navy sidebar, ink on a light
 * card), and the exhaust is always ORBIT orange. The porthole is cut out with
 * `evenodd`, so the mark reads on any ground.
 *
 * `OrbitWordmark` is the lockup — the rocket stands in for the I. Size it by
 * setting a font-size on the parent (or passing a text-* class); the rocket
 * scales with the type.
 */

interface MarkProps {
  className?: string;
  /** Override the exhaust colour. Defaults to ORBIT orange. */
  flame?: string;
  /** Accessible name. Pass null when the mark sits beside the word ORBIT. */
  label?: string | null;
}

export function OrbitRocket({ className, flame = "#FF692E", label = "ORBIT" }: MarkProps) {
  return (
    <svg
      viewBox="0 0 48 94"
      className={cn("h-6 w-auto", className)}
      role={label ? "img" : undefined}
      aria-label={label ?? undefined}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M24 2c3.6 4.4 6.4 8.4 8 12.5 2.4 5.1 4.5 10.6 5.4 16.5.5 3.4.6 6.8.5 10v10.9c2.5 2.3 6.2 8.8 9.2 17.2H1c3-8.4 6.7-14.9 9.2-17.2V41c-.1-3.2 0-6.6.5-10 .9-5.9 3-11.4 5.4-16.5 1.6-4.1 4.4-8.1 8-12.5Zm0 19.7a6.4 6.4 0 1 0 0 12.8 6.4 6.4 0 0 0 0-12.8Z"
      />
      <path fill={flame} d="M17 69.1h14L24 92.4 17 69.1Z" />
    </svg>
  );
}

/** The rocket inside a rounded ink tile — app icon, avatars, tight chrome. */
export function OrbitTile({ className, flame, label }: MarkProps) {
  return (
    <span
      className={cn(
        "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-foreground text-white",
        className
      )}
    >
      <OrbitRocket className="h-[62%] w-auto" flame={flame} label={label} />
    </span>
  );
}

export function OrbitWordmark({ className, flame }: MarkProps) {
  return (
    <span
      className={cn(
        "inline-flex select-none items-center font-sans font-bold leading-none tracking-[0.07em]",
        className
      )}
    >
      <span aria-hidden>ORB</span>
      <OrbitRocket className="mx-[0.05em] h-[1.3em] w-auto shrink-0" flame={flame} label={null} />
      <span aria-hidden>T</span>
      <span className="sr-only">ORBIT</span>
    </span>
  );
}
