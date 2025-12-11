import { TanStackRouterVite } from "@tanstack/router-plugin/vite"
import legacy from "@vitejs/plugin-legacy"
import react from "@vitejs/plugin-react-swc"
import { copyFileSync } from "fs"
import path from "path"
import { defineConfig } from "vite"

export default defineConfig({
  base: "",
  build: {
    outDir: "build",
    rollupOptions: {
      onwarn(warning, warn) {
        // Suppress eval warnings from lottie-web (safe usage)
        if (warning.code === 'EVAL' && warning.id?.includes('lottie')) return;
        warn(warning);
      },
      manualChunks: (id) => {
        // Split external dependencies
        if (id.includes('node_modules')) {
          if (id.includes('@minima-global/mds')) {
            return 'vendor-mds';
          }
          if (id.includes('react') || id.includes('@tanstack')) {
            return 'vendor-react';
          }
          // Other vendors can stay in default or be split further if needed
        }

        // Split services into their own chunk
        if (id.includes('src/services')) {
          return 'services';
        }
      }
    }
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  plugins: [
    TanStackRouterVite(),
    react(),
    legacy({
      targets: ["defaults", "not IE 11", "Android >= 9"],
    }),
    {
      name: "copy-changelog",
      closeBundle() {
        try {
          copyFileSync("CHANGELOG.md", "build/CHANGELOG.md")
        } catch (error) {
          console.warn(
            "Could not copy CHANGELOG.md, please check that it exists in the root directory"
          )
        }
      },
    },
  ],
})
