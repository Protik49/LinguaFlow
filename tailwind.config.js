/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/popup/**/*.{ts,tsx,html}", "./src/options/**/*.{ts,tsx,html}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: ["Aeonik", "Arial", "sans-serif"],
      },
      fontSize: {
        xs: "12.39px",
        sm: "13.63px",
        md: "15.58px",
        base: "15.5824px",
        lg: "17.53px",
        xl: "19.48px",
        "2xl": "23.37px",
        "3xl": "31.16px",
        "4xl": "38.96px",
      },
      colors: {
        text: {
          primary: "#ffffff",
          secondary: "#30322a",
          inverse: "#7e8371",
        },
        border: {
          strong: "#273f2b",
        },
        surface: {
          base: "#000000",
          raised: "#5ce086",
        },
        brand: {
          50: "#eef2ff",
          100: "#e0e7ff",
          200: "#c7d2fe",
          300: "#a5b4fc",
          400: "#818cf8",
          500: "#6366f1",
          600: "#4f46e5",
          700: "#4338ca",
          800: "#3730a3",
          900: "#312e81",
          950: "#1e1b4b",
        },
      },
      spacing: {
        "space-1": "2.5px",
        "space-2": "3.9px",
        "space-3": "5px",
        "space-4": "7px",
        "space-5": "7.79px",
        "space-6": "11.69px",
        "space-7": "15px",
        "space-8": "15.58px",
      },
      borderRadius: {
        xs: "4px",
        sm: "15.58px",
        md: "19.48px",
        lg: "23.37px",
        xl: "26px",
        "2xl": "27.27px",
        "step7": "31.16px",
        "step8": "48.69px",
      },
      animation: {
        "slide-up": "slideUp 0.2s ease-out",
        "fade-in": "fadeIn 0.15s ease-out",
      },
      keyframes: {
        slideUp: {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        fadeIn: {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
      },
    },
  },
  plugins: [],
};
