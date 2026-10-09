// Builds the Angular view into one self-contained page: dist/view/mcp-app.html
//
// An MCP host renders a `ui://` resource as a single HTML document, usually in
// a sandboxed iframe via `srcdoc`, so the page cannot fetch the `main-*.js` and
// `styles-*.css` that `ng build` writes next to index.html. The Angular CLI has
// no single-file output and no plugin hook for one, so this runs after it:
// esbuild folds Angular's chunks back into one ES module, and the module and
// the stylesheets are inlined into index.html.
//
//   node scripts/build-view.mjs           production build
//   node scripts/build-view.mjs --watch   `ng build --watch`, re-inlined after
//                                         every rebuild; add --serve to also run
//                                         the MCP server (needs `npm run build:server`)
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { build } from 'esbuild';

const BROWSER = join('dist', 'angular', 'browser'); // angular.json outputPath + /browser
const OUT_DIR = join('dist', 'view');
const OUT_FILE = join(OUT_DIR, 'mcp-app.html');

const watch = process.argv.includes('--watch');
const serve = process.argv.includes('--serve');
const ng = createRequire(import.meta.url).resolve('@angular/cli/bin/ng.js');

// `</script>` or `</style>` inside inlined code would end the element early.
const escapeEnd = (code, tag) => code.replaceAll(`</${tag}`, `<\\/${tag}`);

async function replaceAsync(text, pattern, replacer) {
  const matches = [...text.matchAll(pattern)];
  const values = await Promise.all(matches.map((m) => replacer(...m)));
  let i = 0;
  return text.replace(pattern, () => values[i++]);
}

async function inline() {
  let html = await readFile(join(BROWSER, 'index.html'), 'utf8');

  // Preload hints point at chunks that are about to be folded into the entry.
  html = html.replace(/<link rel="modulepreload"[^>]*>/g, '');

  html = await replaceAsync(
    html,
    /<link rel="stylesheet" href="([^"]+)"[^>]*>(?:<noscript>.*?<\/noscript>)?/g,
    async (_, href) => {
      const css = await readFile(join(BROWSER, href), 'utf8');
      return `<style>${escapeEnd(css, 'style')}</style>`;
    },
  );

  html = await replaceAsync(
    html,
    /<script src="([^"]+)" type="module"><\/script>/g,
    async (_, src) => {
      const result = await build({
        entryPoints: [join(BROWSER, src)],
        bundle: true,
        format: 'esm',
        minify: !watch,
        sourcemap: watch ? 'inline' : false,
        write: false,
        logLevel: 'warning',
      });
      const js = result.outputFiles[0].text;
      return `<script type="module">${escapeEnd(js, 'script')}</script>`;
    },
  );

  // Fail loudly rather than ship a page that 404s inside the host. Only the
  // markup counts: the inlined code may well contain such tags in strings.
  const markup = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/g, '');
  const leftover = markup.match(/<(?:script|link)\b[^>]*\b(?:src|href)="(?![a-z]+:)[^"]*"[^>]*>/i);
  if (leftover) {
    throw new Error(`build-view: ${leftover[0]} still points at a local file`);
  }

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(OUT_FILE, html);
  console.log(`build-view: wrote ${OUT_FILE} (${(html.length / 1024).toFixed(1)} kB)`);
}

if (!watch) {
  const ngBuild = spawn(process.execPath, [ng, 'build'], { stdio: 'inherit' });
  const code = await new Promise((resolve) => ngBuild.on('exit', resolve));
  if (code !== 0) process.exit(code ?? 1);
  await inline();
} else {
  const ngBuild = spawn(
    process.execPath,
    [ng, 'build', '--watch', '--configuration', 'development'],
    { stdio: ['inherit', 'pipe', 'inherit'] },
  );
  let server;
  ngBuild.stdout.on('data', async (chunk) => {
    process.stdout.write(chunk);
    // Printed once per rebuild, but the CLI may still be writing the output
    // files, so give it a few tries before reporting a failure.
    if (!/Application bundle generation complete/.test(chunk.toString())) return;
    for (let attempt = 1; ; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      try {
        await inline();
        break;
      } catch (e) {
        if (attempt === 10) {
          console.error(e);
          return;
        }
      }
    }
    // The server reads the page on every resources/read, so it never needs a
    // restart for view changes; reload the app in the host instead.
    if (serve && !server) {
      server = spawn(process.execPath, [join('dist', 'server', 'index.js')], { stdio: 'inherit' });
    }
  });
  const stop = () => {
    server?.kill();
    ngBuild.kill();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
