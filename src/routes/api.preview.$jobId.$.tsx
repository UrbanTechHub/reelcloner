import { createFileRoute } from "@tanstack/react-router";
import { getJob } from "@/server/jobs";
import { guessContentType } from "@/server/crawl";

// Live preview: serves any file from a running or completed crawl job.
// URL: /api/preview/:jobId/path/to/file
export const Route = createFileRoute("/api/preview/$jobId/$")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const job = getJob(params.jobId);
        if (!job) return new Response("Job not found or expired", { status: 404 });

        let path = params._splat || "";
        if (!path || path.endsWith("/")) path = path + "index.html";

        let file = job.files.get(path);
        // Fall back to <path>/index.html for clean URLs
        if (!file) file = job.files.get(path.replace(/\/?$/, "/index.html"));
        // Root request
        if (!file && path === "index.html") {
          file = job.files.values().next().value;
        }

        if (!file) {
          const available = Array.from(job.files.keys()).slice(0, 50);
          return new Response(
            `<!doctype html><meta charset="utf-8"><title>Not in clone yet</title>
             <body style="font-family:system-ui;background:#0b0c10;color:#e6e6e6;padding:32px">
             <h1 style="color:#7df9ff">Not cloned yet</h1>
             <p><code>${path}</code> hasn't been crawled yet.</p>
             <p>Status: <b>${job.status}</b> · ${job.files.size} files captured</p>
             <p>Reload to retry. Available so far:</p>
             <ul>${available.map((p) => `<li><a style="color:#7df9ff" href="/api/preview/${job.id}/${p}">${p}</a></li>`).join("")}</ul>
             <script>setTimeout(()=>location.reload(), 3000)</script>
             </body>`,
            { status: 404, headers: { "content-type": "text/html; charset=utf-8" } },
          );
        }

        return new Response(file.data, {
          status: 200,
          headers: {
            "content-type": guessContentType(path, file.contentType),
            "cache-control": "no-store",
            "x-snatch-job": job.id,
          },
        });
      },
    },
  },
});
