import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, ".", "");
  const siteUrl = (environment.VITE_SITE_URL || "http://localhost:5173").replace(
    /\/$/,
    "",
  );

  return {
    base: "./",
    plugins: [
      react(),
      {
        name: "authshift-social-metadata",
        transformIndexHtml(html) {
          return html.replaceAll("%SITE_URL%", siteUrl);
        },
      },
    ],
  };
});
