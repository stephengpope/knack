"use client";

import { useRef, useEffect, type RefObject } from "react";

const BAR_COUNT = 4;
const MULTIPLIERS = [0.7, 1.0, 0.85, 0.6];

/** Animated level meter driven by the hook's per-frame RMS (via a ref, so it
 * never re-renders). Renders nothing when not recording; inherits `currentColor`. */
export function VoiceBars({
  volumeRef,
  isRecording,
}: {
  volumeRef: RefObject<number>;
  isRecording: boolean;
}) {
  const barsRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isRecording) return;
    const animate = () => {
      const el = barsRef.current;
      if (el) {
        const level = Math.min(volumeRef.current * 8, 1); // speech RMS ~0.02–0.15
        for (let i = 0; i < BAR_COUNT; i++) {
          const h = Math.max(3, level * 16 * MULTIPLIERS[i]);
          (el.children[i] as HTMLElement).style.height = `${h}px`;
        }
      }
      rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isRecording, volumeRef]);

  if (!isRecording) return null;

  return (
    <div
      ref={barsRef}
      className="flex items-center justify-center gap-[2px]"
      style={{ width: 16, height: 16 }}
    >
      {Array.from({ length: BAR_COUNT }, (_, i) => (
        <div
          key={i}
          className="w-[2px] rounded-full bg-current"
          style={{ height: 3, transition: "height 80ms ease-out" }}
        />
      ))}
    </div>
  );
}
