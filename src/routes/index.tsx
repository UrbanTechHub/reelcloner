import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { startCrawl, getCrawlStatusFn } from "@/server/crawl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Download,
  Globe,
  Loader2,
  FileCode,
  Layers,
  HardDrive,
  Sparkles,
  ExternalLink,
  RefreshCw,
} from "lucide-react";
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
        content: "Crawl and download any website's HTML, CSS, JS, images and more as a ZIP. Live preview while crawling.",
      },
    ],
  }),
});

type Status = {
  id: string;
  status: "running" | "completed" | "failed";
  pagesDone: number;
  assetsDone: number;
  totalPages?: number;
  filesCount: number;
  log: string[];
  recentFiles: string[];
  error?: string;
  zipBase64?: string;
  zipFilename?: string;
};

function Index() {
  const startFn = useServerFn(startCrawl);
  const statusFn = useServerFn(getCrawlStatusFn);

  const [url, setUrl] = useState("");
  const [limit, setLimit] = useState(10);
  const [includeAssets, setIncludeAssets] = useState(true);
  const [starting, setStarting] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [iframeKey, setIframeKey] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!jobId) return;
    const tick = async () => {
      try {
        const s = await statusFn({ data: { jobId } });
        setStatus(s);
        if (s.status === "completed") {
          toast.success(`Done — ${s.filesCount} files captured`);
          if (pollRef.current) clearInterval(pollRef.current);
        } else if (s.status === "failed") {
          toast.error(s.error || "Crawl failed");
          if (pollRef.current) clearInterval(pollRef.current);
        }
      } catch (e: any) {
        toast.error(e?.message || "Lost job");
        if (pollRef.current) clearInterval(pollRef.current);
      }
    };
    tick();
    pollRef.current = setInterval(tick, 2000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [jobId, statusFn]);

  const handleStart = async () => {
    if (!url.trim()) {
      toast.error("Enter a URL first");
      return;
    }
    setStarting(true);
    setStatus(null);
    setJobId(null);
    try {
      const res = await startFn({ data: { url, limit, includeAssets } });
      setJobId(res.jobId);
      toast.success("Crawling started");
    } catch (e: any) {
      toast.error(e?.message || "Failed to start");
    } finally {
      setStarting(false);
    }
  };

  const handleDownload = () => {
    if (!status?.zipBase64) return;
    const bin = atob(status.zipBase64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: "application/zip" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = status.zipFilename || "site.zip";
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const previewUrl = jobId ? `/api/preview/${jobId}/index.html` : null;
  const progressPct = status?.totalPages
    ? Math.min(100, Math.round((status.pagesDone / status.totalPages) * 100))
    : status?.pagesDone
      ? Math.min(95, status.pagesDone * 8)
      : 0;

  return (
    <main className="relative min-h-screen overflow-hidden">
      <Toaster theme="dark" />
      <div
        className="absolute inset-0 -z-10 opacity-40"
        style={{ backgroundImage: `url(${heroBg})`, backgroundSize: "cover", backgroundPosition: "center" }}
      />
      <div className="absolute inset-0 -z-10" style={{ background: "var(--gradient-hero)" }} />
      <div className="absolute inset-0 -z-10 bg-background/60" />

      <div className="container mx-auto px-4 sm:px-6 py-8 sm:py-12 md:py-16 max-w-6xl">
        <div className="text-center mb-8 sm:mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 sm:px-4 sm:py-1.5 rounded-full bg-card/60 border border-border backdrop-blur-sm mb-4 sm:mb-6">
            <Sparkles className="w-3.5 h-3.5 text-primary" />
            <span className="text-[11px] sm:text-xs font-medium text-muted-foreground">Live preview · Powered by Firecrawl</span>
          </div>
          <h1 className="text-4xl sm:text-5xl md:text-7xl font-bold tracking-tight mb-3 sm:mb-4 leading-[1.05]">
            <span className="bg-clip-text text-transparent" style={{ backgroundImage: "var(--gradient-primary)" }}>
              Clone any website
            </span>
            <br />
            <span className="text-foreground">watch it live.</span>
          </h1>
          <p className="text-base sm:text-lg text-muted-foreground max-w-xl mx-auto px-2">
            Crawl pages, assets, fonts, media. Preview as it builds. Download a runnable ZIP.
          </p>
        </div>

        <Card className="p-4 sm:p-6 md:p-8 backdrop-blur-xl bg-card/70 border-border" style={{ boxShadow: "var(--shadow-card)" }}>
          <div className="space-y-5 sm:space-y-6">
            <div>
              <Label htmlFor="url" className="mb-2 flex items-center gap-2">
                <Globe className="w-4 h-4" /> Website URL
              </Label>
              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  id="url"
                  placeholder="example.com"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  disabled={starting || status?.status === "running"}
                  onKeyDown={(e) => e.key === "Enter" && handleStart()}
                  className="text-base h-12"
                />
                <Button
                  onClick={handleStart}
                  disabled={starting || status?.status === "running"}
                  size="lg"
                  className="h-12 px-6 font-semibold text-primary-foreground w-full sm:w-auto shrink-0"
                  style={{ background: "var(--gradient-primary)", boxShadow: "var(--shadow-glow)" }}
                >
                  {starting || status?.status === "running" ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Cloning…
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 mr-2" /> Start clone
                    </>
                  )}
                </Button>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
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
                  max={100}
                  step={1}
                  disabled={status?.status === "running"}
                />
              </div>
              <div className="flex items-center justify-between p-4 rounded-lg bg-secondary/50 border border-border">
                <div>
                  <Label htmlFor="assets" className="font-medium">Download assets</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">CSS, JS, images, fonts, media</p>
                </div>
                <Switch
                  id="assets"
                  checked={includeAssets}
                  onCheckedChange={setIncludeAssets}
                  disabled={status?.status === "running"}
                />
              </div>
            </div>
          </div>
        </Card>

        {status && (
          <Card
            className="mt-6 p-4 sm:p-6 md:p-8 backdrop-blur-xl bg-card/70 border-border animate-in fade-in"
            style={{ boxShadow: "var(--shadow-card)" }}
          >
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between mb-5 gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 sm:gap-3 mb-1 flex-wrap">
                  <h2 className="text-xl sm:text-2xl font-bold">
                    {status.status === "running" && "Cloning…"}
                    {status.status === "completed" && "Clone ready"}
                    {status.status === "failed" && "Crawl failed"}
                  </h2>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-mono ${
                      status.status === "running"
                        ? "bg-primary/20 text-primary"
                        : status.status === "completed"
                          ? "bg-accent/20 text-accent"
                          : "bg-destructive/20 text-destructive"
                    }`}
                  >
                    {status.status}
                  </span>
                </div>
                <p className="text-xs sm:text-sm text-muted-foreground font-mono truncate">job {status.id}</p>
              </div>
              <div className="flex flex-col sm:flex-row gap-2 sm:shrink-0">
                {previewUrl && (
                  <Button asChild variant="outline" size="lg" className="w-full sm:w-auto">
                    <a href={previewUrl} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="w-4 h-4 mr-2" /> Open in new tab
                    </a>
                  </Button>
                )}
                {status.status === "completed" && (
                  <Button
                    onClick={handleDownload}
                    size="lg"
                    className="font-semibold text-primary-foreground w-full sm:w-auto"
                    style={{ background: "var(--gradient-primary)", boxShadow: "var(--shadow-glow)" }}
                  >
                    <Download className="w-4 h-4 mr-2" /> Download ZIP
                  </Button>
                )}
              </div>
            </div>

            {status.status === "running" && (
              <div className="mb-5">
                <Progress value={progressPct} className="h-2" />
                <p className="text-xs text-muted-foreground mt-2">
                  {status.pagesDone} / {status.totalPages ?? "?"} pages · {status.assetsDone} assets fetched
                </p>
              </div>
            )}

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              <Stat icon={<FileCode />} label="Pages" value={status.pagesDone} />
              <Stat icon={<Sparkles />} label="Assets" value={status.assetsDone} />
              <Stat icon={<Layers />} label="Files" value={status.filesCount} />
              <Stat
                icon={<HardDrive />}
                label="Status"
                value={status.status === "completed" ? "Ready" : status.status === "failed" ? "Failed" : "Live"}
              />
            </div>

            {/* Live preview */}
            {previewUrl && (
              <div className="mb-6">
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-sm flex items-center gap-2">
                    <Globe className="w-4 h-4" /> Live preview
                  </Label>
                  <button
                    onClick={() => setIframeKey((k) => k + 1)}
                    className="text-xs text-muted-foreground hover:text-primary inline-flex items-center gap-1"
                  >
                    <RefreshCw className="w-3 h-3" /> Refresh
                  </button>
                </div>
                <div
                  className="rounded-lg overflow-hidden border border-border bg-background"
                  style={{ boxShadow: "var(--shadow-card)" }}
                >
                  <iframe
                    key={iframeKey}
                    src={previewUrl}
                    title="Live clone preview"
                    className="w-full h-[320px] sm:h-[420px] md:h-[520px] bg-white"
                    sandbox="allow-same-origin allow-scripts allow-forms"
                  />
                </div>
              </div>
            )}

            {/* Log + files side by side */}
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <Label className="text-xs text-muted-foreground mb-2 block">Activity log</Label>
                <div className="h-48 overflow-y-auto bg-background/60 rounded-lg p-3 font-mono text-xs space-y-1 border border-border">
                  {status.log.map((l, i) => (
                    <div key={i} className="text-muted-foreground">
                      <span className="text-primary">›</span> {l}
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-2 block">
                  Recent files ({status.filesCount} total)
                </Label>
                <div className="h-48 overflow-y-auto bg-background/60 rounded-lg p-3 font-mono text-xs space-y-1 border border-border">
                  {status.recentFiles.map((f, i) => (
                    <a
                      key={i}
                      href={`/api/preview/${status.id}/${f}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block text-muted-foreground hover:text-primary truncate"
                    >
                      📄 {f}
                    </a>
                  ))}
                </div>
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
