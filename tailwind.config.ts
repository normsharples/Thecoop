import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

const config: Config = {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        "border-strong": "hsl(var(--border-strong))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
          hover: "hsl(var(--primary-hover))",
          soft: "hsl(var(--primary-soft))",
          softer: "hsl(var(--primary-softer))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
          soft: "hsl(var(--destructive-soft))",
          border: "hsl(var(--destructive-border))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
          soft: "hsl(var(--success-soft))",
          strong: "hsl(var(--success-strong))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
          soft: "hsl(var(--warning-soft))",
          strong: "hsl(var(--warning-strong))",
        },
        info: "hsl(var(--info))",
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        surface: {
          subtle: "hsl(var(--surface-subtle))",
          sunken: "hsl(var(--surface-sunken))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar))",
          foreground: "hsl(var(--sidebar-foreground))",
          active: "hsl(var(--sidebar-active))",
          "active-bg": "hsl(var(--sidebar-active-bg))",
          border: "hsl(var(--sidebar-border))",
          heading: "hsl(var(--sidebar-heading))",
          mark: "hsl(var(--sidebar-mark))",
        },
        chart: {
          1: "hsl(var(--primary))",
          2: "hsl(var(--chart-2))",
          3: "hsl(var(--primary-soft))",
          4: "hsl(var(--success))",
          5: "hsl(var(--warning))",
          6: "hsl(var(--info))",
        },
        // ── Brand accent ────────────────────────────────────────────────
        // Set per-brand at runtime. Used for brand marks only — the app
        // chrome stays navy so switching brand never restyles the UI.
        brand: {
          accent: "hsl(var(--brand-accent))",
        },
      },
      borderRadius: {
        xl: "calc(var(--radius) + 4px)",
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        sans: ["Archivo", "system-ui", "-apple-system", "sans-serif"],
        display: ["'Source Serif 4'", "Georgia", "serif"],
        mono: ["ui-monospace", "SFMono-Regular", "monospace"],
      },
      fontSize: {
        stat: ["2.5rem", { lineHeight: "1", letterSpacing: "-0.02em", fontWeight: "600" }],
      },
      boxShadow: {
        // Flat by default — the design separates surfaces with borders,
        // not elevation. Shadows are reserved for genuinely floating layers.
        sm: "0 1px 2px 0 hsl(220 43% 11% / 0.04)",
        DEFAULT: "0 1px 2px 0 hsl(220 43% 11% / 0.04)",
        md: "0 2px 6px -1px hsl(220 43% 11% / 0.07)",
        lg: "0 8px 24px -6px hsl(220 43% 11% / 0.12)",
        popover: "0 12px 32px -8px hsl(220 43% 11% / 0.18)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [tailwindcssAnimate],
};

export default config;
