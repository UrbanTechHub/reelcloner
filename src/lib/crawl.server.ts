import Firecrawl from "@mendable/firecrawl-js";

export function sanitizePath(urlStr: string, baseHost: string): string | null {
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

export function extractAssetUrls(html: string, base: string): string[] {
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

export function rewriteHtml(html: string, pageUrl: string, baseHost: string): string {
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

export function getClient() {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) throw new Error("FIRECRAWL_API_KEY not configured");
  return new Firecrawl({ apiKey });
}