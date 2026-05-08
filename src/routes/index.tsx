import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { startCrawlJob, getCrawlJobStatus, getCrawlPages, fetchAssetBatch } from "@/server/crawl";
import JSZip from "jszip";
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
      { title: "REELCLONER — Clone Any Website in One Click" },
      { name: "description", content: "Crawl and download any website's HTML, CSS, JS, and images as a ZIP." },
    ],
  }),
});

type Result = {
  base64: string;
  filename: string;
  stats: { pages: number; assets: number; files: number; sizeKB: number };
  files: string[];
};

type Job = { jobId: string; baseHost: string; includeAssets: boolean; url: string };

const JOB_KEY = "reelcloner_job";

function Index() {
  const startFn = useServerFn(startCrawlJob);
  const statusFn = useServerFn(getCrawlJobStatus);
  const pagesFn = useServerFn(getCrawlPages);
  const assetsFn = useServerFn(fetchAssetBatch);

  const [url, setUrl] = useState("");
  const [limit, setLimit] = useState(10);
  const [includeAssets, setIncludeAssets] = useState(true);
  const [job, setJob] = useState<Job | null>(null);
  const [progress, setProgress] = useState<{ status: string; completed: number; total: number } | null>(null);
  const [building, setBuilding] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [unlocked, setUnlocked] = useState(() => {
    if (typeof window === "undefined") return false;
    return sessionStorage.getItem("reelcloner_unlocked") === "1";
  });
  const [pin, setPin] = useState("");
  const pollRef = useRef<number | null>(null);

  // Restore active job from localStorage so it survives tab switches/reloads
  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = localStorage.getItem(JOB_KEY);
    if (raw) {
      try {
        const j: Job = JSON.parse(raw);
        setJob(j);
        setUrl(j.url);
      } catch {}
    }
  }, []);

  // Poll job status while a job is active. Keeps running across tabs (interval is in this tab,
  // but the crawl itself runs server-side on Firecrawl — independent of the browser).
  useEffect(() => {
    if (!job || result) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const s = await statusFn({ data: { jobId: job.jobId } });
        if (cancelled) return;
        setProgress(s);
        if (s.status === "completed") {
          setBuilding(true);
          try {
            const r = await buildFn({ data: { jobId: job.jobId, baseHost: job.baseHost, includeAssets: job.includeAssets } });
            if (cancelled) return;
            setResult(r);
            toast.success(`Cloned ${r.stats.pages} pages, ${r.stats.files} files`);
            localStorage.removeItem(JOB_KEY);
            setJob(null);
          } catch (e: any) {
            toast.error(e?.message || "Build failed");
            localStorage.removeItem(JOB_KEY);
            setJob(null);
          } finally {
            setBuilding(false);
          }
        } else if (s.status === "failed" || s.status === "cancelled") {
          toast.error(`Crawl ${s.status}`);
          localStorage.removeItem(JOB_KEY);
          setJob(null);
        }
      } catch (e: any) {
        // transient — keep polling
        console.warn("poll error", e?.message);
      }
    };
    tick();
    pollRef.current = window.setInterval(tick, 4000);
    return () => {
      cancelled = true;
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [job, result, statusFn, buildFn]);

  const handleUnlock = () => {
    if (pin === "3458") {
      sessionStorage.setItem("reelcloner_unlocked", "1");
      setUnlocked(true);
    } else {
      toast.error("Incorrect PIN");
      setPin("");
    }
  };

  if (!unlocked) {
    return (
      <main className="relative min-h-screen flex items-center justify-center px-4">
        <Toaster theme="dark" />
        <div className="absolute inset-0 -z-10 opacity-40" style={{ backgroundImage: `url(${heroBg})`, backgroundSize: "cover", backgroundPosition: "center" }} />
        <div className="absolute inset-0 -z-10" style={{ background: "var(--gradient-hero)" }} />
        <div className="absolute inset-0 -z-10 bg-background/70" />
        <Card className="p-8 w-full max-w-sm backdrop-blur-xl bg-card/70 border-border" style={{ boxShadow: "var(--shadow-card)" }}>
          <h1 className="text-3xl font-bold mb-2 text-center">
            <span className="bg-clip-text text-transparent" style={{ backgroundImage: "var(--gradient-primary)" }}>REELCLONER</span>
          </h1>
          <p className="text-sm text-muted-foreground text-center mb-6">Enter access PIN to continue</p>
          <Input type="password" inputMode="numeric" placeholder="••••" value={pin}
            onChange={(e) => setPin(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleUnlock()}
            className="text-center text-lg h-12 mb-4 tracking-widest" autoFocus />
          <Button onClick={handleUnlock} className="w-full h-12 font-semibold"
            style={{ background: "var(--gradient-primary)", boxShadow: "var(--shadow-glow)" }}>Unlock</Button>
        </Card>
      </main>
    );
  }

  const handleCrawl = async () => {
    if (!url.trim()) { toast.error("Enter a URL first"); return; }
    let normalized = url.trim();
    if (!/^https?:\/\//i.test(normalized)) normalized = "https://" + normalized;
    setResult(null);
    setProgress(null);
    try {
      const j = await startFn({ data: { url: normalized, limit, includeAssets } });
      const newJob: Job = { ...j, url: normalized };
      localStorage.setItem(JOB_KEY, JSON.stringify(newJob));
      setJob(newJob);
      toast.success("Crawl started — runs in the background");
    } catch (e: any) {
      toast.error(e?.message || "Failed to start crawl");
    }
  };

  const handleCancel = () => {
    localStorage.removeItem(JOB_KEY);
    setJob(null);
    setProgress(null);
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

  const isWorking = !!job || building;

  return (
    <main className="relative min-h-screen overflow-hidden">
      <Toaster theme="dark" />
      <div className="absolute inset-0 -z-10 opacity-40" style={{ backgroundImage: `url(${heroBg})`, backgroundSize: "cover", backgroundPosition: "center" }} />
      <div className="absolute inset-0 -z-10" style={{ background: "var(--gradient-hero)" }} />
      <div className="absolute inset-0 -z-10 bg-background/60" />

      <div className="container mx-auto px-4 py-16 md:py-24 max-w-4xl">
        <div className="text-center mb-12">
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-4">
            <span className="bg-clip-text text-transparent" style={{ backgroundImage: "var(--gradient-primary)" }}>Clone any website</span>
            <br />
            <span className="text-foreground">in one click.</span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-xl mx-auto">
            Crawl pages, bundle HTML, CSS, JS & images into a ZIP. Run it locally, archive it, study it.
          </p>
        </div>

        <Card className="p-6 md:p-8 backdrop-blur-xl bg-card/70 border-border" style={{ boxShadow: "var(--shadow-card)" }}>
          <div className="space-y-6">
            <div>
              <Label htmlFor="url" className="mb-2 flex items-center gap-2"><Globe className="w-4 h-4" /> Website URL</Label>
              <div className="flex gap-2">
                <Input id="url" placeholder="example.com" value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  disabled={isWorking}
                  onKeyDown={(e) => e.key === "Enter" && !isWorking && handleCrawl()}
                  className="text-base h-12" />
                <Button onClick={handleCrawl} disabled={isWorking} size="lg"
                  className="h-12 px-6 font-semibold"
                  style={{ background: "var(--gradient-primary)", boxShadow: "var(--shadow-glow)" }}>
                  {isWorking ? (<><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Working…</>) : (<><Download className="w-4 h-4 mr-2" /> Clone</>)}
                </Button>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <Label className="flex items-center gap-2"><Layers className="w-4 h-4" /> Page limit</Label>
                <span className="text-sm font-mono text-primary">{limit} pages</span>
              </div>
              <Slider value={[limit]} onValueChange={([v]) => setLimit(v)} min={1} max={50} step={1} disabled={isWorking} />
            </div>

            <div className="flex items-center justify-between p-4 rounded-lg bg-secondary/50 border border-border">
              <div>
                <Label htmlFor="assets" className="font-medium">Download assets</Label>
                <p className="text-xs text-muted-foreground mt-0.5">Include CSS, JS, images & fonts (slower)</p>
              </div>
              <Switch id="assets" checked={includeAssets} onCheckedChange={setIncludeAssets} disabled={isWorking} />
            </div>

            {job && (
              <div className="p-4 rounded-lg bg-secondary/50 border border-border space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm">
                    <Loader2 className="w-4 h-4 animate-spin text-primary" />
                    <span className="font-medium">
                      {building ? "Packaging ZIP…" : `Crawling ${job.baseHost}`}
                    </span>
                  </div>
                  <Button variant="ghost" size="sm" onClick={handleCancel}>Dismiss</Button>
                </div>
                {progress && (
                  <p className="text-xs text-muted-foreground font-mono">
                    status: {progress.status} · {progress.completed}/{progress.total || "?"} pages
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Runs in the background — you can switch tabs. Progress resumes when you come back.
                </p>
              </div>
            )}
          </div>
        </Card>

        {result && (
          <Card className="mt-6 p-6 md:p-8 backdrop-blur-xl bg-card/70 border-border animate-in fade-in slide-in-from-bottom-4" style={{ boxShadow: "var(--shadow-card)" }}>
            <div className="flex items-start justify-between mb-6 flex-wrap gap-4">
              <div>
                <h2 className="text-2xl font-bold mb-1">Clone ready</h2>
                <p className="text-sm text-muted-foreground font-mono">{result.filename}</p>
              </div>
              <Button onClick={handleDownload} size="lg" className="font-semibold"
                style={{ background: "var(--gradient-primary)", boxShadow: "var(--shadow-glow)" }}>
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
                  <div key={i} className="text-muted-foreground hover:text-primary transition-colors">📄 {f}</div>
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
