import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ape: {
          bg: "#0a0a0a",
          card: "#141414",
          line: "#2a2a2a",
          acid: "#c8ff00",
          pink: "#ff2d95",
          mute: "#8a8a8a",
        },
        acid: "#c8ff00",
        hot: "#ff2d95",
        yell: "#ffe600",
        ink: "#0a0a0a",
      },
      fontFamily: {
        display: ['"Comic Sans MS"', '"Comic Sans"', "Chalkboard SE", "cursive"],
        meme: [
          '"Comic Sans MS"',
          '"Comic Sans"',
          '"Chalkboard SE"',
          '"Comic Neue"',
          "cursive",
        ],
        smash: ["Impact", "Haettenschweiler", '"Arial Black"', "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
