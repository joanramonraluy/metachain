import { TanStackRouterVite } from "@tanstack/router-plugin/vite"
import legacy from "@vitejs/plugin-legacy"
import react from "@vitejs/plugin-react-swc"
import { copyFileSync } from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { defineConfig } from "vite"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export default defineConfig({
  base: "",
  publicDir: "public",
  build: {
    outDir: "build",
    rollupOptions: {
      external: (id) => {
        // Exclude anything from examples directory
        if (id.includes('/examples/')) return true;
        return false;
      },
      onwarn(warning, warn) {
        // Suppress eval warnings from lottie-web (safe usage)
        if (warning.code === 'EVAL' && warning.id?.includes('lottie')) return;
        // Suppress warnings about examples directory
        if (warning.message?.includes('examples')) return;
        warn(warning);
      },
    }
  },
  server: {
    watch: {
      ignored: ['**/examples/**']
    },
    fs: {
      strict: true,
      deny: ['**/examples/**']
    }
  },
  optimizeDeps: {
    entries: [
      'index.html',
      'src/**/*.{ts,tsx,js,jsx}'
    ],
    exclude: []
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  plugins: [
    // Custom plugin to block examples directory from being processed
    {
      name: 'block-examples-directory',
      enforce: 'pre',
      resolveId(id) {
        // Block any imports from examples directory
        if (id.includes('/examples/') || id.includes('\\examples\\')) {
          return null;
        }
      },
      load(id) {
        // Block loading any files from examples directory
        if (id.includes('/examples/') || id.includes('\\examples\\')) {
          return null;
        }
      }
    },
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
