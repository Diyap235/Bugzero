import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "#050705",
        surface: "#0B120F",
        card: "#101915",
        "surface-hover": "#16211B",
        border: "#1E3025",
        "border-strong": "#294134",
        primary: {
          DEFAULT: "#2E7D32",
          hover: "#388E3C",
          active: "#256B2A",
        },
        success: "#4CAF50",
        warning: "#F59E0B",
        danger: "#EF4444",
        info: "#3B82F6",
        text: {
          primary: "#FFFFFF",
          secondary: "#AAB5AF",
          muted: "#7E8A84",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      borderRadius: {
        button: "12px",
        input: "12px",
        card: "16px",
        dialog: "20px",
      },
      spacing: {
        "sidebar": "280px",
        "topbar": "72px",
      },
      maxWidth: {
        "content": "1440px",
      },
    },
  },
  plugins: [],
};

export default config;
