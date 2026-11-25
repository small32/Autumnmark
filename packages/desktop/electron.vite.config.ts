import { resolve, dirname, relative } from 'path'
import { createRequire } from 'node:module'
import { normalizePath, type PluginOption } from 'vite'
import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import svgLoader from 'vite-svg-loader'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import postcssPresetEnv from 'postcss-preset-env'
import packageJson from './package.json' with { type: 'json' }
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const excalidrawFonts = normalizePath(resolve(dirname(createRequire(import.meta.url).resolve('@excalidraw/excalidraw')), 'fonts'))
const excalidrawFontBase = normalizePath(relative(resolve(__dirname, 'src/renderer'), dirname(excalidrawFonts)))
  .split('/').filter(segment => segment && segment !== '..').length

export default defineConfig({
  main: {
    build: {
      externalizeDeps: {
        // Bundle ESM-only dependencies so main can load them from CommonJS at startup.
        exclude: ['electron-store', '@csstools/css-tokenizer'],
        include: ['native-keymap']
      }
    },
    define: {
      MARKTEXT_VERSION: JSON.stringify(packageJson.version),
      MARKTEXT_VERSION_STRING: JSON.stringify(`v${packageJson.version}`)
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src'),
        common: resolve(__dirname, 'src/common'),
        '@shared': resolve(__dirname, 'src/shared')
      },
      extensions: ['.mjs', '.ts', '.js', '.json']
    }
  },
  preload: {
    // Sandboxed preload cannot require npm packages; inline its ESM path helpers.
    build: {
      externalizeDeps: {
        exclude: ['pathe', '@jsr/std__path']
      }
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src'),
        common: resolve(__dirname, 'src/common'),
        '@shared': resolve(__dirname, 'src/shared')
      },
      extensions: ['.mjs', '.ts', '.js', '.json']
    }
  },
  renderer: {
    build: {
      minify: true,
      rolldownOptions: {
        input: {
          editor: resolve(__dirname, 'src/renderer/index.html'),
          settings: resolve(__dirname, 'src/renderer/settings.html'),
          themePreview: resolve(__dirname, 'src/renderer/theme-preview.html'),
          themeStudio: resolve(__dirname, 'src/renderer/theme-studio.html')
        }
      }
    },
    // The sandboxed renderer accesses Node only through preload and IPC.
    assetsInclude: ['**/*.md'],
    // Some browser dependencies reference Node’s global; map it to globalThis before imports run.
    define: {
      global: 'globalThis'
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src'),
        common: resolve(__dirname, 'src/common'),
        '@shared': resolve(__dirname, 'src/shared'),
        // Shared `common/*` helpers import the bare `path` specifier; route it to
        // a platform-correct module so the renderer never builds mixed-separator
        // paths (#5683).
        path: resolve(__dirname, 'src/renderer/src/node/platformPath.ts')
      },
      extensions: ['.mjs', '.ts', '.js', '.json', '.vue']
    },
    optimizeDeps: {
      // Opening the separate studio or its preview must not invalidate the running editor's optimized modules.
      include: [
        'pako', 'pathe', 'codemirror', 'codemirror/mode/css/css', 'codemirror/mode/markdown/markdown',
        'codemirror/addon/display/placeholder', 'postcss', 'postcss-selector-parser'
      ]
    },
    plugins: [vue(), svgLoader(), viteStaticCopy({
      targets: [{ src: excalidrawFonts, dest: 'excalidraw', rename: { stripBase: excalidrawFontBase } }]
    })] as PluginOption[],
    css: {
      postcss: {
        plugins: [
          postcssPresetEnv({
            stage: 0,
            features: {
              'nesting-rules': true,
              // Electron ships Chromium, which supports CSS logical properties
              // natively. Leave them untouched so `padding-inline-start` /
              // `inset-inline-start` mirror correctly under `dir="rtl"` instead
              // of being down-compiled to hard-coded LTR physical props (#4673).
              'logical-properties-and-values': false
            }
          })
        ]
      }
    }
  }
})
