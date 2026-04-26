import { createServerFn } from "@tanstack/react-start";
import Firecrawl from "@mendable/firecrawl-js";
import JSZip from "jszip";
import { addFile, appendLog, createJob, getJob, type Job } from "./jobs";

// ---------- Path / URL helpers ----------

const ASSET_EXT_RE = /\.[a-z0-9]{2,6}(\?|#|$)/i;

function sanitizePath(urlStr: string, baseHost: string): string | null {
  try {
    const u = new URL(urlStr);
    if (u.host !== baseHost) return null;
    let p = decodeURIComponent(u.pathname);
    if (p.endsWith("/") || p === "") p = p + "index.html";
    else if (!ASSET_EXT_RE.test(p)) p = p + "/index.html";
    p = p.replace(/^\/+/, "");
    p = p.split("/").filter((s) => s && s !== ".." && s !== ".").join("/");
    if (u.search) {
      // include short query hash so different querystrings get distinct files
      const hash = Array.from(u.search).reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0);
      const dot = p.lastIndexOf(".");
      const tag = `__q${Math.abs(hash).toString(36)}`;
      p = dot > 0 ? `${p.slice(0, dot)}${tag}${p.slice(dot)}` : `${p}${tag}`;
    }
    return p || "index.html";
  } catch {
    return null;
  }
}

function extractUrls(html: string, base: string): string[] {
  const urls = new Set<string>();
  const patterns = [
    /<(?:a|link|area|base)[^>]+href=["']([^"']+)["']/gi,
    /<(?:script|img|iframe|source|video|audio|embed|track)[^>]+src=["']([^"']+)["']/gi,
    /<(?:video|audio)[^>]+poster=["']([^"']+)["']/gi,
    /<(?:img|source)[^>]+srcset=["']([^"']+)["']/gi,
    /<link[^>]+rel=["'](?:icon|shortcut icon|manifest|apple-touch-icon|preload|stylesheet)["'][^>]*href=["']([^"']+)["']/gi,
    /<meta[^>]+content=["']([^"']+\.(?:png|jpe?g|gif|webp|svg|ico))["']/gi,
    /url\(\s*["']?([^"')]+)["']?\s*\)/gi,
    /@import\s+["']([^"']+)["']/gi,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(html)) !== null) {
      const raw = m[1];
      // srcset can have multiple comma-separated entries
      const candidates = raw.includes(",") && /\s\d/.test(raw)
        ? raw.split(",").map((s) => s.trim().split(/\s+/)[0])
        : [raw];
      for (const c of candidates) {
        try {
          const abs = new URL(c, base).toString();
          if (abs.startsWith("http")) urls.add(abs.split("#")[0]);
        } catch {}
      }
    }
  }
  return Array.from(urls);
}

function rewriteHtml(html: string, pageUrl: string, baseHost: string, jobId: string): string {
  const rewriteOne = (val: string): string => {
    if (!val || val.startsWith("data:") || val.startsWith("#") || val.startsWith("mailto:") || val.startsWith("tel:") || val.startsWith("javascript:"))
      return val;
    try {
      const abs = new URL(val, pageUrl);
      if (abs.host !== baseHost) return val;
      const rel = sanitizePath(abs.toString(), baseHost);
      if (!rel) return val;
      // Use root-relative paths so live preview + extracted zip both work.
      return "/" + rel;
    } catch {
      return val;
    }
  };

  let out = html.replace(/(href|src|poster)=["']([^"']+)["']/gi, (_, attr, val) => {
    return `${attr}="${rewriteOne(val)}"`;
  });

  out = out.replace(/srcset=["']([^"']+)["']/gi, (_, val) => {
    const parts = val.split(",").map((p: string) => {
      const trimmed = p.trim();
      const [u, ...rest] = trimmed.split(/\s+/);
      return rewriteOne(u) + (rest.length ? " " + rest.join(" ") : "");
    });
    return `srcset="${parts.join(", ")}"`;
  });

  // Inline a tiny banner so the live preview shows it's a clone.
  const banner = `<div style="position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#0b0c10;color:#7df9ff;font:600 12px/1.6 system-ui,sans-serif;text-align:center;padding:6px;border-bottom:1px solid #7df9ff;pointer-events:none;">SiteSnatch live preview · job ${jobId}</div><div style="height:32px"></div>`;
  out = out.replace(/<body([^>]*)>/i, (_m, attrs) => `<body${attrs}>${banner}`);
  return out;
}

function rewriteCss(css: string, sheetUrl: string, baseHost: string): string {
  return css.replace(/url\(\s*["']?([^"')]+)["']?\s*\)/gi, (_m, val) => {
    if (val.startsWith("data:")) return `url(${val})`;
    try {
      const abs = new URL(val, sheetUrl);
      if (abs.host !== baseHost) return `url(${val})`;
      const rel = sanitizePath(abs.toString(), baseHost);
      return `url(/${rel})`;
    } catch {
      return `url(${val})`;
    }
  });
}

function guessContentType(path: string, fallback: string): string {
  const ext = path.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  const map: Record<string, string> = {
    html: "text/html; charset=utf-8",
    htm: "text/html; charset=utf-8",
    css: "text/css; charset=utf-8",
    js: "application/javascript; charset=utf-8",
    mjs: "application/javascript; charset=utf-8",
    json: "application/json",
    xml: "application/xml",
    svg: "image/svg+xml",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    avif: "image/avif",
    ico: "image/x-icon",
    woff: "font/woff",
    woff2: "font/woff2",
    ttf: "font/ttf",
    otf: "font/otf",
    eot: "application/vnd.ms-fontobject",
    mp4: "video/mp4",
    webm: "video/webm",
    mp3: "audio/mpeg",
    ogg: "audio/ogg",
    wav: "audio/wav",
    pdf: "application/pdf",
    txt: "text/plain; charset=utf-8",
    map: "application/json",
  };
  return (ext && map[ext]) || fallback || "application/octet-stream";
}

// ---------- Crawl orchestration ----------

async function downloadAssets(job: Job, urls: Set<string>) {
  const list = Array.from(urls).filter((u) => !job.files.has(sanitizePath(u, job.baseHost) || ""));
  const batch = 8;
  for (let i = 0; i < list.length; i += batch) {
    await Promise.all(
      list.slice(i, i + batch).map(async (u) => {
        try {
          const res = await fetch(u, {
            signal: AbortSignal.timeout(15000),
            headers: { "user-agent": "Mozilla/5.0 SiteSnatch/1.0" },
          });
          if (!res.ok) return;
          const path = sanitizePath(u, job.baseHost);
          if (!path) return;
          const ct = res.headers.get("content-type") || guessContentType(path, "");
          let buf: Uint8Array;
          if (ct.includes("text/css")) {
            const text = await res.text();
            buf = new TextEncoder().encode(rewriteCss(text, u, job.baseHost));
          } else {
            buf = new Uint8Array(await res.arrayBuffer());
          }
          addFile(job, path, ct, buf);
          job.assetsDone++;
        } catch {}
      }),
    );
  }
}

async function runCrawl(job: Job, limit: number, includeAssets: boolean) {
  try {
    const apiKey = process.env.FIRECRAWL_API_KEY;
    if (!apiKey) throw new Error("FIRECRAWL_API_KEY not configured");
    const firecrawl = new Firecrawl({ apiKey });

    appendLog(job, "Starting Firecrawl crawl…");
    const started = await firecrawl.startCrawl(job.url, {
      limit,
      maxDiscoveryDepth: 5,
      allowBackwardLinks: true,
      allowSubdomains: false,
      sitemap: "include",
      scrapeOptions: { formats: ["html", "links"], onlyMainContent: false },
    });
    const jobId = (started as any).id || (started as any).jobId;
    if (!jobId) throw new Error("Failed to start crawl");

    const seen = new Set<string>();
    const allAssets = new Set<string>();
    let done = false;

    while (!done) {
      const status = await firecrawl.getCrawlStatus(jobId);
      const pages = (status as any).data || [];
      job.totalPages = (status as any).total || pages.length;

      for (const page of pages) {
        const sourceUrl: string = page.metadata?.sourceURL || page.metadata?.url;
        if (!sourceUrl || seen.has(sourceUrl)) continue;
        seen.add(sourceUrl);
        const html: string = page.html || page.rawHtml || "";
        if (!html) continue;
        const path = sanitizePath(sourceUrl, job.baseHost);
        if (!path) continue;
        const rewritten = rewriteHtml(html, sourceUrl, job.baseHost, job.id);
        addFile(job, path, "text/html; charset=utf-8", new TextEncoder().encode(rewritten));
        job.pagesDone++;
        appendLog(job, `Page: ${path}`);
        if (includeAssets) {
          for (const a of extractUrls(html, sourceUrl)) {
            try {
              if (new URL(a).host === job.baseHost) allAssets.add(a);
            } catch {}
          }
        }
      }

      if ((status as any).status === "completed") {
        done = true;
      } else if ((status as any).status === "failed" || (status as any).status === "cancelled") {
        throw new Error(`Crawl ${(status as any).status}`);
      } else {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    if (includeAssets && allAssets.size) {
      appendLog(job, `Downloading ${allAssets.size} assets…`);
      await downloadAssets(job, allAssets);
    }

    // Build zip
    appendLog(job, "Packaging ZIP…");
    const zip = new JSZip();
    for (const f of job.files.values()) zip.file(f.path, f.data);
    const blob = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < blob.length; i += chunk) binary += String.fromCharCode(...blob.subarray(i, i + chunk));
    job.zipBase64 = btoa(binary);
    job.zipFilename = `${job.baseHost.replace(/[^a-z0-9.-]/gi, "_")}.zip`;
    job.status = "completed";
    job.finishedAt = Date.now();
    appendLog(job, `Done. ${job.files.size} files, ${Math.round(blob.length / 1024)} KB`);
  } catch (e: any) {
    job.status = "failed";
    job.error = e?.message || String(e);
    job.finishedAt = Date.now();
    appendLog(job, `Error: ${job.error}`);
  }
}

// ---------- Server functions ----------

export const startCrawl = createServerFn({ method: "POST" })
  .inputValidator((d: { url: string; limit: number; includeAssets: boolean }) => {
    if (!d?.url) throw new Error("URL required");
    let url = d.url.trim();
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
    new URL(url); // validate
    return {
      url,
      limit: Math.min(Math.max(Number(d.limit) || 10, 1), 100),
      includeAssets: !!d.includeAssets,
    };
  })
  .handler(async ({ data }) => {
    const baseHost = new URL(data.url).host;
    const job = createJob(data.url, baseHost);
    // Fire and forget — runs in worker background.
    runCrawl(job, data.limit, data.includeAssets);
    return { jobId: job.id };
  });

export const getCrawlStatusFn = createServerFn({ method: "POST" })
  .inputValidator((d: { jobId: string }) => {
    if (!d?.jobId) throw new Error("jobId required");
    return d;
  })
  .handler(async ({ data }) => {
    const job = getJob(data.jobId);
    if (!job) throw new Error("Job not found or expired");
    const recentFiles = Array.from(job.files.values()).slice(-50).map((f) => f.path);
    return {
      id: job.id,
      status: job.status,
      pagesDone: job.pagesDone,
      assetsDone: job.assetsDone,
      totalPages: job.totalPages,
      filesCount: job.files.size,
      log: job.log.slice(-30),
      recentFiles,
      error: job.error,
      zipBase64: job.status === "completed" ? job.zipBase64 : undefined,
      zipFilename: job.zipFilename,
    };
  });

export { guessContentType };
