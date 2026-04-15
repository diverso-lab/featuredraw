import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        panel: "#141416",
        bg: "#0f0f10",
        grid: "#1f1f1f",
        gridStrong: "#2a2a2a",
      },
    },
  },
  plugins: [],
};
export default config;
