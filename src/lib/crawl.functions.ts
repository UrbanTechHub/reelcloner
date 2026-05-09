import { createServerFn } from "@tanstack/react-start";
import { extractAssetUrls, getClient, rewriteHtml, sanitizePath } from "./crawl.server";

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
    const job = await fc.startCrawl(data.url, {
      limit: data.limit,
      scrapeOptions: {
        formats: ["html", "links"],
        waitFor: 3500,
        onlyMainContent: false,
      },
    });
    const jobId = (job as any).id || (job as any).jobId;
    if (!jobId) throw new Error("Failed to start crawl");
    return { jobId, baseHost: new URL(data.url).host, includeAssets: data.includeAssets };
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

export const getCrawlPages = createServerFn({ method: "POST" })
  .inputValidator((d: { jobId: string; baseHost: string; includeAssets: boolean }) => {
    if (!d?.jobId || !d?.baseHost) throw new Error("jobId & baseHost required");
    return d;
  })
  .handler(async ({ data }) => {
    const fc = getClient();
    const status = await fc.getCrawlStatus(data.jobId, { autoPaginate: true });
    const pages = ((status as any).data || []) as any[];
    if (!pages.length) throw new Error("No pages crawled");

    const out: { path: string; html: string }[] = [];
    const assetUrls = new Set<string>();

    for (const page of pages) {
      const sourceUrl: string = page.metadata?.sourceURL || page.metadata?.url || "";
      const html: string = page.html || page.rawHtml || "";
      if (!html || !sourceUrl) continue;
      const path = sanitizePath(sourceUrl, data.baseHost);
      if (!path) continue;
      out.push({ path, html: rewriteHtml(html, sourceUrl, data.baseHost) });
      if (data.includeAssets) {
        for (const a of extractAssetUrls(html, sourceUrl)) {
          try { if (new URL(a).host === data.baseHost) assetUrls.add(a); } catch {}
        }
      }
    }

    return {
      pages: out,
      assets: Array.from(assetUrls).slice(0, 300),
      baseHost: data.baseHost,
    };
  });

export const fetchAssetBatch = createServerFn({ method: "POST" })
  .inputValidator((d: { urls: string[]; baseHost: string }) => {
    if (!Array.isArray(d?.urls)) throw new Error("urls required");
    return { urls: d.urls.slice(0, 8), baseHost: d.baseHost };
  })
  .handler(async ({ data }) => {
    const results = await Promise.all(
      data.urls.map(async (u) => {
        try {
          const res = await fetch(u, { signal: AbortSignal.timeout(10000) });
          if (!res.ok) return null;
          const buf = new Uint8Array(await res.arrayBuffer());
          const path = sanitizePath(u, data.baseHost);
          if (!path) return null;
          let bin = "";
          const chunk = 0x8000;
          for (let i = 0; i < buf.length; i += chunk) {
            bin += String.fromCharCode(...buf.subarray(i, i + chunk));
          }
          return { path, base64: btoa(bin) };
        } catch {
          return null;
        }
      }),
    );
    return { files: results.filter((x): x is { path: string; base64: string } => !!x) };
  });