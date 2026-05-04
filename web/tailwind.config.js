/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
      },
      boxShadow: {
        floating:
          "0 1px 2px rgba(15,23,42,.06), 0 8px 24px -8px rgba(15,23,42,.12)",
        "floating-lg":
          "0 2px 4px rgba(15,23,42,.06), 0 16px 40px -12px rgba(15,23,42,.18)",
      },
      colors: {
        ink: {
          900: "#0f172a",
          700: "#334155",
          500: "#64748b",
          400: "#94a3b8",
          300: "#cbd5e1",
          200: "#e2e8f0",
          100: "#f1f5f9",
          50: "#f8fafc",
        },
        brand: {
          500: "#7c3aed",
          600: "#6d28d9",
        },
      },
    },
  },
  plugins: [],
};
