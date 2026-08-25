import type { MetadataRoute } from "next";

/** Served at /manifest.webmanifest. Installability only — see public/sw.js. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Xenon Institute",
    short_name: "Xenon",
    description: "Attendance, payments and payroll for Xenon Institute.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#7c3aed",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
