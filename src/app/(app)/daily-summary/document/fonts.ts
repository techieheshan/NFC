import { Noto_Sans_Sinhala } from "next/font/google";

/**
 * Sinhala for the document ONLY. The root layout loads Geist with the Latin subset, so a Sinhala name
 * would otherwise fall back to whatever the device happens to have — and on paper (and in the PDF image) the
 * document must not depend on that. Scoped to this route (not the root layout), self-hosted by next/font,
 * and `preload: false`: the file is fetched only when a Sinhala character is actually on the page.
 */
export const sinhala = Noto_Sans_Sinhala({
  subsets: ["sinhala"],
  variable: "--font-ds-sinhala",
  display: "swap",
  preload: false,
});
