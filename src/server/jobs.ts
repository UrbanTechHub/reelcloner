// In-memory job store. Lives in the worker for the duration of the crawl.
// Note: serverless workers may evict between requests; for a more robust
// production setup, persist to KV / a DB. Good enough for interactive use.

export type JobFile = {
  path: string;
  contentType: string;
  data: Uint8Array;
};

export type Job = {
  id: string;
  url: string;
  baseHost: string;
  status: "running" | "completed" | "failed";
  error?: string;
  startedAt: number;
  finishedAt?: number;
  pagesDone: number;
  assetsDone: number;
  totalPages?: number;
  files: Map<string, JobFile>;
  log: string[];
  zipBase64?: string;
  zipFilename?: string;
};

declare global {
  // eslint-disable-next-line no-var
  var __crawlJobs: Map<string, Job> | undefined;
}

const store: Map<string, Job> = globalThis.__crawlJobs ?? new Map();
globalThis.__crawlJobs = store;

export function createJob(url: string, baseHost: string): Job {
  const id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  const job: Job = {
    id,
    url,
    baseHost,
    status: "running",
    startedAt: Date.now(),
    pagesDone: 0,
    assetsDone: 0,
    files: new Map(),
    log: [`Crawl started for ${url}`],
  };
  store.set(id, job);
  // Auto-clean after 30 minutes
  setTimeout(() => store.delete(id), 30 * 60 * 1000);
  return job;
}

export function getJob(id: string): Job | undefined {
  return store.get(id);
}

export function addFile(job: Job, path: string, contentType: string, data: Uint8Array) {
  job.files.set(path, { path, contentType, data });
}

export function appendLog(job: Job, msg: string) {
  job.log.push(msg);
  if (job.log.length > 200) job.log.splice(0, job.log.length - 200);
}
