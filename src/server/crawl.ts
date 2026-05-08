import { createServerFn } from "@tanstack/react-start";
import Firecrawl from "@mendable/firecrawl-js";
import JSZip from "jszip";

function sanitizePath(urlStr: string, baseHost: string): string | null {
  try {
    const u = new URL(urlStr);
    if (u.host !== baseHost) return null;
    let p = decodeURIComponent(u.pathname);
    if (p.endsWith("/") || p === "") p = p + "index.html";
    else if (!/\.[a-z0-9]{2,5}$/i.test(p)) p = p + "/index.html";
    p = p.replace(/^\/+/, "");
    p = p.split("/").filter((s) => s && s !== ".." && s !== ".").join("/");
    return p || "index.html";
  } catch {
    return null;
  }
}

function extractAssetUrls(html: string, base: string): string[] {
  const urls = new Set<string>();
  const patterns = [
    /<link[^>]+href=["']([^"']+)["']/gi,
    /<script[^>]+src=["']([^"']+)["']/gi,
    /<img[^>]+src=["']([^"']+)["']/gi,
    /<source[^>]+src=["']([^"']+)["']/gi,
    /url\(["']?([^"')]+)["']?\)/gi,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(html)) !== null) {
      try {
        const abs = new URL(m[1], base).toString();
        if (abs.startsWith("http")) urls.add(abs);
      } catch {}
    }
  }
  return Array.from(urls);
}

function rewriteHtml(html: string, pageUrl: string, baseHost: string): string {
  return html.replace(
    /(href|src)=["']([^"']+)["']/gi,
    (match, attr, val) => {
      try {
        if (val.startsWith("data:") || val.startsWith("#") || val.startsWith("mailto:") || val.startsWith("javascript:"))
          return match;
        const abs = new URL(val, pageUrl);
        if (abs.host !== baseHost) return match;
        const rel = sanitizePath(abs.toString(), baseHost);
        if (!rel) return match;
        return `${attr}="/${rel}"`;
      } catch {
        return match;
      }
    },
  );
}

function getClient() {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) throw new Error("FIRECRAWL_API_KEY not configured");
  return new Firecrawl({ apiKey });
}

export const startCrawlJob = createServerFn({ method: "POST" })
  .inputValidator((d: { url: string; limit: number; includeAssets: boolean }) => {
    if (!d?.url) throw new Error("URL required");
    try { new URL(d.url); } catch { throw new Error("Invalid URL"); }
    return {
      url: d.url,
      limit: Math.min(Math.max(Number(d.limit) || 10, 1), 50),
      includeAssets: !!d.includeAssets,
    };
  })
  .handler(async ({ data }) => {
    const fc = getClient();
    const baseHost = new URL(data.url).host;
    const job = await fc.startCrawl(data.url, {
      limit: data.limit,
      scrapeOptions: { formats: ["html", "links"] },
    });
    const jobId = (job as any).id || (job as any).jobId;
    if (!jobId) throw new Error("Failed to start crawl");
    return { jobId, baseHost, includeAssets: data.includeAssets };
  });

export const getCrawlJobStatus = createServerFn({ method: "POST" })
  .inputValidator((d: { jobId: string }) => {
    if (!d?.jobId) throw new Error("jobId required");
    return { jobId: d.jobId };
  })
  .handler(async ({ data }) => {
    const fc = getClient();
    const status = await fc.getCrawlStatus(data.jobId, { autoPaginate: false });
    const s: any = status;
    return {
      status: s.status as string,
      completed: s.completed || 0,
      total: s.total || 0,
    };
  });

export const buildCrawlZip = createServerFn({ method: "POST" })
  .inputValidator((d: { jobId: string; baseHost: string; includeAssets: boolean }) => {
    if (!d?.jobId || !d?.baseHost) throw new Error("jobId & baseHost required");
    return d;
  })
  .handler(async ({ data }) => {
    const fc = getClient();
    const status = await fc.getCrawlStatus(data.jobId, { autoPaginate: true });
    const pages = ((status as any).data || []) as any[];
    if (!pages.length) throw new Error("No pages crawled");

    const zip = new JSZip();
    const assetUrls = new Set<string>();
    const filesAdded: string[] = [];

    for (const page of pages) {
      const sourceUrl: string = page.metadata?.sourceURL || page.metadata?.url || "";
      const html: string = page.html || page.rawHtml || "";
      if (!html || !sourceUrl) continue;
      const path = sanitizePath(sourceUrl, data.baseHost);
      if (!path) continue;
      zip.file(path, rewriteHtml(html, sourceUrl, data.baseHost));
      filesAdded.push(path);
      if (data.includeAssets) {
        for (const a of extractAssetUrls(html, sourceUrl)) {
          if (new URL(a).host === data.baseHost) assetUrls.add(a);
        }
      }
    }

    if (data.includeAssets && assetUrls.size) {
      const list = Array.from(assetUrls).slice(0, 200);
      const batch = 8;
      for (let i = 0; i < list.length; i += batch) {
        await Promise.all(
          list.slice(i, i + batch).map(async (u) => {
            try {
              const res = await fetch(u, { signal: AbortSignal.timeout(15000) });
              if (!res.ok) return;
              const buf = new Uint8Array(await res.arrayBuffer());
              const path = sanitizePath(u, data.baseHost);
              if (path) {
                zip.file(path, buf);
                filesAdded.push(path);
              }
            } catch {}
          }),
        );
      }
    }

    const blob = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < blob.length; i += chunk) {
      binary += String.fromCharCode(...blob.subarray(i, i + chunk));
    }
    const base64 = btoa(binary);

    return {
      base64,
      filename: `${data.baseHost.replace(/[^a-z0-9.-]/gi, "_")}.zip`,
      stats: {
        pages: pages.length,
        assets: assetUrls.size,
        files: filesAdded.length,
        sizeKB: Math.round(blob.length / 1024),
      },
      files: filesAdded.slice(0, 100),
    };
  });
