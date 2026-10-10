export interface Theme {
  primary: string;
  primaryDark: string;
  tint: string;
  glow: string;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const toHex = (rgb: number[]) => "#" + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("").toUpperCase();

/** Derives the per-clinic palette from one brand colour. The default blue maps to the exact design tokens. */
export function deriveTheme(primary: string): Theme {
  const p = /^#[0-9a-f]{6}$/i.test(primary) ? primary.toUpperCase() : "#1458C2";
  if (p === "#1458C2") return { primary: p, primaryDark: "#0E3F8C", tint: "#E8F0FC", glow: "rgba(20,88,194,0.3)" };
  const [r, g, b] = hexToRgb(p);
  return {
    primary: p,
    primaryDark: toHex([r * 0.7, g * 0.7, b * 0.72]),
    tint: toHex([255 - (255 - r) * 0.1, 255 - (255 - g) * 0.1, 255 - (255 - b) * 0.1]),
    glow: `rgba(${r},${g},${b},0.3)`,
  };
}

export function themeStyle(primary: string): Record<string, string> {
  const t = deriveTheme(primary);
  return { "--primary": t.primary, "--primary-dark": t.primaryDark, "--tint": t.tint, "--glow": t.glow };
}
