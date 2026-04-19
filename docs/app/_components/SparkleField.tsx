"use client";

import { useMemo } from "react";

interface SparkleProps {
  size?: number;
  color?: string;
  rotate?: number;
  opacity?: number;
  style?: React.CSSProperties;
}

function Sparkle({
  size = 20,
  color = "#fbc4c9",
  rotate = 0,
  opacity = 1,
  style = {},
}: SparkleProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      style={{ transform: `rotate(${rotate}deg)`, opacity, ...style }}
      aria-hidden="true"
    >
      <path
        d="M12 0 C13 7 17 11 24 12 C17 13 13 17 12 24 C11 17 7 13 0 12 C7 11 11 7 12 0 Z"
        fill={color}
      />
    </svg>
  );
}

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

interface SparkleItem {
  top: string;
  left: string;
  size: number;
  color: string;
  rotate: number;
  opacity: number;
}

interface SparkleFieldProps {
  pink?: string;
  lilac?: string;
  blue?: string;
  gold?: string;
}

export function SparkleField({
  pink = "#fbc4c9",
  lilac = "#d8cbef",
  blue = "#c9e2ee",
  gold = "#fbe4c9",
}: SparkleFieldProps) {
  const sparkles = useMemo<SparkleItem[]>(() => {
    const hero: SparkleItem[] = [
      { top: "2%", left: "6%", size: 30, color: pink, rotate: 12, opacity: 1 },
      {
        top: "4%",
        left: "92%",
        size: 24,
        color: lilac,
        rotate: -20,
        opacity: 0.9,
      },
      {
        top: "22%",
        left: "3%",
        size: 20,
        color: blue,
        rotate: 30,
        opacity: 0.9,
      },
      {
        top: "26%",
        left: "96%",
        size: 28,
        color: pink,
        rotate: -12,
        opacity: 0.9,
      },
      {
        top: "12%",
        left: "52%",
        size: 16,
        color: lilac,
        rotate: 0,
        opacity: 0.7,
      },
      {
        top: "30%",
        left: "48%",
        size: 22,
        color: blue,
        rotate: 45,
        opacity: 0.9,
      },
    ];

    const cols = [pink, lilac, blue, gold];
    const rand = rng(11);
    const filler: SparkleItem[] = [];
    for (let i = 0; i < 18; i++) {
      filler.push({
        top: `${(4 + rand() * 94).toFixed(2)}%`,
        left: `${(2 + rand() * 96).toFixed(2)}%`,
        size: 8 + Math.floor(rand() * 14),
        color: cols[Math.floor(rand() * cols.length)],
        rotate: Math.floor(rand() * 90 - 45),
        opacity: 0.35 + rand() * 0.4,
      });
    }

    return [...hero, ...filler];
  }, [pink, lilac, blue, gold]);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        overflow: "hidden",
        zIndex: 1,
      }}
    >
      {sparkles.map((s, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            top: s.top,
            left: s.left,
            animation: `sparkleFloat ${4 + (i % 3)}s ease-in-out ${i * 0.3}s infinite`,
          }}
        >
          <Sparkle
            size={s.size}
            color={s.color}
            rotate={s.rotate}
            opacity={s.opacity}
          />
        </div>
      ))}
    </div>
  );
}
