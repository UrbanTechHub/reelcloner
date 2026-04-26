import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { crawlSite } from "@/server/crawl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Card } from "@/components/ui/card";
import { Download, Globe, Loader2, FileCode, Layers, HardDrive, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import heroBg from "@/assets/hero-bg.jpg";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "SiteSnatch — Clone Any Website in One Click" },
      {
        name: "description",
        content: "Crawl and download any website's HTML, CSS, JS, and images as a ZIP. Powered by Firecrawl.",
      },
    ],
  }),
});

type Result = {
  base64: string;
  filename: string;
  stats: { pages: number; assets: number; files: number; sizeKB: number };
  files: string[];
};

function Index() {
  const crawl = useServerFn(crawlSite);
  const [url, setUrl] = useState("");
  const [limit, setLimit] = useState(10);
  const [includeAssets, setIncludeAssets] = useState(true);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const handleCrawl = async () => {
    if (!url.trim()) {
      toast.error("Enter a URL first");
      return;
    }
    let normalized = url.trim();
    if (!/^https?:\/\//i.test(normalized)) normalized = "https://" + normalized;
    setLoading(true);
    setResult(null);
    try {
      const res = await crawl({ data: { url: normalized, limit, includeAssets } });
      setResult(res);
      toast.success(`Cloned ${res.stats.pages} pages, ${res.stats.files} files`);
    } catch (e: any) {
      toast.error(e?.message || "Crawl failed");
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = () => {
    if (!result) return;
    const bin = atob(result.base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: "application/zip" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = result.filename;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <main className="relative min-h-screen overflow-hidden">
      <Toaster theme="dark" />
      {/* Hero background */}
      <div
        className="absolute inset-0 -z-10 opacity-40"
        style={{
          backgroundImage: `url(${heroBg})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      />
      <div className="absolute inset-0 -z-10" style={{ background: "var(--gradient-hero)" }} />
      <div className="absolute inset-0 -z-10 bg-background/60" />

      <div className="container mx-auto px-4 py-16 md:py-24 max-w-4xl">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-card/60 border border-border backdrop-blur-sm mb-6">
            <Sparkles className="w-3.5 h-3.5 text-primary" />
            <span className="text-xs font-medium text-muted-foreground">Powered by Firecrawl</span>
          </div>
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-4">
            <span
              className="bg-clip-text text-transparent"
              style={{ backgroundImage: "var(--gradient-primary)" }}
            >
              Clone any website
            </span>
            <br />
            <span className="text-foreground">in one click.</span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-xl mx-auto">
            Crawl pages, bundle HTML, CSS, JS & images into a ZIP. Run it locally, archive it, study it.
          </p>
        </div>

        {/* Form */}
        <Card
          className="p-6 md:p-8 backdrop-blur-xl bg-card/70 border-border"
          style={{ boxShadow: "var(--shadow-card)" }}
        >
          <div className="space-y-6">
            <div>
              <Label htmlFor="url" className="mb-2 flex items-center gap-2">
                <Globe className="w-4 h-4" /> Website URL
              </Label>
              <div className="flex gap-2">
                <Input
                  id="url"
                  placeholder="example.com"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  disabled={loading}
                  onKeyDown={(e) => e.key === "Enter" && handleCrawl()}
                  className="text-base h-12"
                />
                <Button
                  onClick={handleCrawl}
                  disabled={loading}
                  size="lg"
                  className="h-12 px-6 font-semibold"
                  style={{ background: "var(--gradient-primary)", boxShadow: "var(--shadow-glow)" }}
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Cloning…
                    </>
                  ) : (
                    <>
                      <Download className="w-4 h-4 mr-2" /> Clone
                    </>
                  )}
                </Button>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <Label className="flex items-center gap-2">
                  <Layers className="w-4 h-4" /> Page limit
                </Label>
                <span className="text-sm font-mono text-primary">{limit} pages</span>
              </div>
              <Slider
                value={[limit]}
                onValueChange={([v]) => setLimit(v)}
                min={1}
                max={50}
                step={1}
                disabled={loading}
              />
            </div>

            <div className="flex items-center justify-between p-4 rounded-lg bg-secondary/50 border border-border">
              <div>
                <Label htmlFor="assets" className="font-medium">Download assets</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Include CSS, JS, images & fonts (slower)
                </p>
              </div>
              <Switch id="assets" checked={includeAssets} onCheckedChange={setIncludeAssets} disabled={loading} />
            </div>
          </div>
        </Card>

        {/* Result */}
        {result && (
          <Card
            className="mt-6 p-6 md:p-8 backdrop-blur-xl bg-card/70 border-border animate-in fade-in slide-in-from-bottom-4"
            style={{ boxShadow: "var(--shadow-card)" }}
          >
            <div className="flex items-start justify-between mb-6 flex-wrap gap-4">
              <div>
                <h2 className="text-2xl font-bold mb-1">Clone ready</h2>
                <p className="text-sm text-muted-foreground font-mono">{result.filename}</p>
              </div>
              <Button
                onClick={handleDownload}
                size="lg"
                className="font-semibold"
                style={{ background: "var(--gradient-primary)", boxShadow: "var(--shadow-glow)" }}
              >
                <Download className="w-4 h-4 mr-2" /> Download ZIP
              </Button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              <Stat icon={<FileCode />} label="Pages" value={result.stats.pages} />
              <Stat icon={<Layers />} label="Files" value={result.stats.files} />
              <Stat icon={<Sparkles />} label="Assets" value={result.stats.assets} />
              <Stat icon={<HardDrive />} label="Size" value={`${result.stats.sizeKB} KB`} />
            </div>

            <div>
              <Label className="text-xs text-muted-foreground mb-2 block">
                Files preview ({Math.min(result.files.length, 100)} of {result.stats.files})
              </Label>
              <div className="max-h-56 overflow-y-auto bg-background/60 rounded-lg p-3 font-mono text-xs space-y-1 border border-border">
                {result.files.map((f, i) => (
                  <div key={i} className="text-muted-foreground hover:text-primary transition-colors">
                    📄 {f}
                  </div>
                ))}
              </div>
            </div>
          </Card>
        )}

        <p className="text-center text-xs text-muted-foreground mt-8">
          Use responsibly. Respect robots.txt, copyrights & terms of service.
        </p>
      </div>
    </main>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number | string }) {
  return (
    <div className="p-4 rounded-lg bg-secondary/50 border border-border">
      <div className="text-primary mb-2 [&>svg]:w-4 [&>svg]:h-4">{icon}</div>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
