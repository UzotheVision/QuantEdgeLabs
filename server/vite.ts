import express, { type Express } from "express";
import { injectServerSeo } from "./seo-metadata";
import fs from "fs";
import path from "path";
import { createServer as createViteServer, createLogger } from "vite";
import { type Server } from "http";
import viteConfig from "../vite.config";
import { nanoid } from "nanoid";

const viteLogger = createLogger();

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

export async function setupVite(app: Express, server: Server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true as const,
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        viteLogger.error(msg, options);
        // A source edit can briefly be invalid while it is being written. Vite can
        // recover on the next edit; killing Express here makes the whole preview
        // vanish and, unlike PM2, the preview launcher does not restart it.
      },
    },
    server: serverOptions,
    appType: "custom",
  });

  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;

    try {
      const clientTemplate = path.resolve(
        import.meta.dirname,
        "..",
        "client",
        "index.html",
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`,
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(import.meta.dirname, "public");

  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  // Hashed assets (JS/CSS chunks with content hashes) — cache aggressively (1 year).
  // When content changes, Vite generates new filenames, so stale caches are never served.
  app.use(
    "/assets",
    express.static(path.resolve(distPath, "assets"), {
      maxAge: "1y",
      immutable: true,
    })
  );

  // Everything else (index.html, favicon, etc.) — no cache so users always get latest HTML.
  // This ensures new deploys are picked up immediately without chunk hash mismatches.
  app.use(
    express.static(distPath, {
      maxAge: 0,
      etag: true,
      lastModified: true,
      setHeaders: (res, filePath) => {
        // HTML must never be cached — stale HTML references old chunk hashes
        if (filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        }
      },
    })
  );

  // fall through to index.html if the file doesn't exist (SPA routing)
  app.use("*", (req, res) => {
    // Never serve HTML for missing static assets — return 404 so the browser
    // knows the file is gone and doesn't silently try to parse HTML as JS/CSS.
    // Without this, stale cached HTML requesting old chunk hashes (e.g.
    // /assets/index-OLD.js) gets index.html back with 200, the browser tries
    // to parse HTML as JavaScript, fails silently, and the app never mounts.
    if (req.originalUrl.startsWith('/assets/')) {
      return res.status(404).type('text').send('Asset not found');
    }
    res.set("Cache-Control", "no-cache, no-store, must-revalidate");
    const indexPath = path.resolve(distPath, "index.html");
    fs.readFile(indexPath, "utf-8", (error, html) => {
      if (error) return res.status(500).type("text").send("Unable to load application");
      res.status(200).type("html").send(injectServerSeo(html, req.originalUrl));
    });
  });
}
