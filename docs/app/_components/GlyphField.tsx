"use client";

import { useMemo } from "react";

type GlyphKind =
  | "heart"
  | "star"
  | "flower"
  | "dot"
  | "donut"
  | "cloud"
  | "plus"
  | "moon"
  | "sparkle4"
  | "ring"
  | "squiggle";

interface GlyphProps {
  kind: GlyphKind;
  size?: number;
  color?: string;
  outline?: string;
  stroke?: number;
}

function Glyph({
  kind,
  size = 20,
  color = "#fbc4c9",
  outline = "#2e1f4a",
  stroke = 2,
}: GlyphProps) {
  const props = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    "aria-hidden": true as const,
  };

  switch (kind) {
    case "heart":
      return (
        <svg {...props}>
          <path
            d="M12 21 C5 16 2 12 2 8 C2 5 4 3 7 3 C9 3 11 4 12 6 C13 4 15 3 17 3 C20 3 22 5 22 8 C22 12 19 16 12 21 Z"
            fill={color}
            stroke={outline}
            strokeWidth={stroke}
            strokeLinejoin="round"
          />
        </svg>
      );
    case "star":
      return (
        <svg {...props}>
          <path
            d="M12 2 L14.5 9 L22 9 L16 13.5 L18.5 21 L12 16.5 L5.5 21 L8 13.5 L2 9 L9.5 9 Z"
            fill={color}
            stroke={outline}
            strokeWidth={stroke}
            strokeLinejoin="round"
          />
        </svg>
      );
    case "flower":
      return (
        <svg {...props}>
          <g
            fill={color}
            stroke={outline}
            strokeWidth={stroke}
            strokeLinejoin="round"
          >
            <circle cx="12" cy="5" r="3.5" />
            <circle cx="19" cy="12" r="3.5" />
            <circle cx="12" cy="19" r="3.5" />
            <circle cx="5" cy="12" r="3.5" />
          </g>
          <circle cx="12" cy="12" r="2.5" fill={outline} />
        </svg>
      );
    case "dot":
      return (
        <svg {...props}>
          <circle
            cx="12"
            cy="12"
            r="6"
            fill={color}
            stroke={outline}
            strokeWidth={stroke}
          />
        </svg>
      );
    case "donut":
      return (
        <svg {...props}>
          <circle
            cx="12"
            cy="12"
            r="9"
            fill={color}
            stroke={outline}
            strokeWidth={stroke}
          />
          <circle
            cx="12"
            cy="12"
            r="3"
            fill="none"
            stroke={outline}
            strokeWidth={stroke}
          />
        </svg>
      );
    case "cloud":
      return (
        <svg {...props}>
          <path
            d="M6 17 C3 17 2 15 2 13 C2 11 4 9 6 9 C6 6 9 4 12 4 C15 4 17 6 17 9 C20 9 22 11 22 13 C22 15 20 17 18 17 Z"
            fill={color}
            stroke={outline}
            strokeWidth={stroke}
            strokeLinejoin="round"
          />
        </svg>
      );
    case "plus":
      return (
        <svg {...props}>
          <path
            d="M10 3 H14 V10 H21 V14 H14 V21 H10 V14 H3 V10 H10 Z"
            fill={color}
            stroke={outline}
            strokeWidth={stroke}
            strokeLinejoin="round"
          />
        </svg>
      );
    case "moon":
      return (
        <svg {...props}>
          <path
            d="M17 3 C10 3 5 8 5 14 C5 18 8 21 13 21 C19 21 22 16 22 13 C19 15 14 14 13 10 C12 7 14 4 17 3 Z"
            fill={color}
            stroke={outline}
            strokeWidth={stroke}
            strokeLinejoin="round"
          />
        </svg>
      );
    case "sparkle4":
      return (
        <svg {...props}>
          <path
            d="M12 2 C12.5 8 14 9.5 22 12 C14 14.5 12.5 16 12 22 C11.5 16 10 14.5 2 12 C10 9.5 11.5 8 12 2 Z"
            fill={color}
            stroke={outline}
            strokeWidth={stroke}
            strokeLinejoin="round"
          />
        </svg>
      );
    case "ring":
      return (
        <svg {...props}>
          <circle
            cx="12"
            cy="12"
            r="8"
            fill="none"
            stroke={color}
            strokeWidth={stroke + 1}
          />
        </svg>
      );
    case "squiggle":
      return (
        <svg {...props}>
          <path
            d="M2 14 Q6 6 10 14 T18 14 T22 12"
            fill="none"
            stroke={color}
            strokeWidth={stroke + 0.5}
            strokeLinecap="round"
          />
        </svg>
      );
    default:
      return null;
  }
}

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

interface GlyphItem {
  kind: GlyphKind;
  size: number;
  color: string;
  outline: string;
  stroke: number;
  top: string;
  left: string;
  rotate: number;
  opacity: number;
  anim: string;
  animDuration: number;
  animDelay: number;
}

interface GlyphFieldProps {
  pink?: string;
  lilac?: string;
  blue?: string;
  gold?: string;
  outline?: string;
}

export function GlyphField({
  pink = "#fbc4c9",
  lilac = "#d8cbef",
  blue = "#c9e2ee",
  gold = "#fbe4c9",
  outline = "#2e1f4a",
}: GlyphFieldProps) {
  const glyphs = useMemo<GlyphItem[]>(() => {
    const rand = rng(42);
    const kinds: GlyphKind[] = [
      "heart",
      "star",
      "flower",
      "dot",
      "donut",
      "cloud",
      "plus",
      "moon",
      "sparkle4",
      "ring",
      "squiggle",
    ];
    const colors = [pink, lilac, blue, gold];
    const out: GlyphItem[] = [];

    for (let i = 0; i < 22; i++) {
      const kind = kinds[Math.floor(rand() * kinds.length)];
      const sizeRoll = rand();
      const size =
        sizeRoll < 0.55
          ? 14 + Math.floor(rand() * 10)
          : sizeRoll < 0.9
            ? 26 + Math.floor(rand() * 12)
            : 42 + Math.floor(rand() * 14);

      out.push({
        kind,
        size,
        color: colors[Math.floor(rand() * colors.length)],
        outline,
        stroke: size > 30 ? 2.5 : 2,
        top: `${(rand() * 3600).toFixed(0)}px`,
        left: `${(rand() * 98).toFixed(2)}%`,
        rotate: Math.floor(rand() * 60 - 30),
        opacity: 0.25 + rand() * 0.25,
        anim: rand() > 0.5 ? "floaty" : "sparkleFloat",
        animDuration: 4 + rand() * 8,
        animDelay: rand() * 6,
      });
    }

    return out;
  }, [pink, lilac, blue, gold, outline]);

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
      {glyphs.map((g, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            top: g.top,
            left: g.left,
            transform: `rotate(${g.rotate}deg)`,
            opacity: g.opacity,
            animation: `${g.anim} ${g.animDuration.toFixed(2)}s ease-in-out ${g.animDelay.toFixed(2)}s infinite`,
          }}
        >
          <Glyph
            kind={g.kind}
            size={g.size}
            color={g.color}
            outline={g.outline}
            stroke={g.stroke}
          />
        </div>
      ))}
    </div>
  );
}
