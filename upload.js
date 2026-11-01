// The browser side of an upload: one selection of files goes up as one batch, each file in
// chunks the server writes straight into temporary storage, and once every chunk is there
// the batch's handler runs on the server, once. A chunk that fails is sent again; the answer
// to a complete that got lost is asked for again (the server remembers it); anything that
// still fails aborts the batch, so nothing half-done is left behind. Progress is reported
// after every chunk. Small files travel the same way, in one chunk.
import { apiBase, reportUnauthorized } from './endpoints.js';

const ATTEMPTS = 3;
const BACKOFF_MS = 400;

async function failure(response, fallback) {
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) reportUnauthorized(data);
  const error = new Error(data.error?.message || fallback);
  error.status = response.status;
  error.serverStack = data.error?.stack;
  return error;
}

async function json(method, url, body) {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (!response.ok) throw await failure(response, `${method} ${url} failed.`);
  return response.json();
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Tries fn up to ATTEMPTS times. A thrown fetch (the network) is retried; an answer from the
// server is final unless `retryStatus` says otherwise for its status.
async function attempt(fn, { retryStatus = () => false } = {}) {
  let last;
  for (let i = 0; i < ATTEMPTS; i += 1) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      const fromServer = typeof err.status === 'number';
      if (fromServer && !retryStatus(err.status)) throw err;
      if (i < ATTEMPTS - 1) await wait(BACKOFF_MS * (i + 1));
    }
  }
  throw last;
}

async function putChunk(base, batchId, uploadId, index, blob) {
  const response = await fetch(`${base}/uploads/${batchId}/${uploadId}/${index}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: blob
  });
  if (!response.ok) throw await failure(response, 'The upload was interrupted.');
  return response.json();
}

// Which chunks the server still misses, per upload id; null when it cannot say.
async function missingChunks(base, batchId) {
  try {
    const state = await json('GET', `${base}/uploads/${batchId}`);
    return new Map(state.files.map((file) => [file.uploadId, new Set(file.missing)]));
  } catch {
    return null;
  }
}

// Sends `files` (File objects) to `handler` (a complete "Module.script.fn") and resolves with
// the server's answer: { result, files: [{ uploadId, name, type, size, saved }] }.
export async function uploadBatch({ files, handler, onProgress }) {
  const base = apiBase();
  const list = [...files];
  const created = await json('POST', `${base}/uploads`, {
    handler,
    files: list.map((file) => ({ name: file.name, type: file.type || '', size: file.size }))
  });
  const { batchId, chunkSize } = created;
  const total = list.reduce((sum, file) => sum + file.size, 0);
  let sent = 0;
  const report = () => {
    if (onProgress) onProgress({ sent, total, percent: total ? Math.min(100, Math.floor((sent * 100) / total)) : 100 });
  };
  report();
  try {
    for (let i = 0; i < list.length; i += 1) {
      const file = list[i];
      const { uploadId, chunks } = created.files[i];
      for (let index = 0; index < chunks; index += 1) {
        const blob = file.slice(index * chunkSize, Math.min(file.size, (index + 1) * chunkSize));
        await attempt(
          async () => {
            try {
              await putChunk(base, batchId, uploadId, index, blob);
            } catch (err) {
              // The chunk may have landed although the answer did not: ask before resending.
              if (typeof err.status === 'number' && err.status < 500) throw err;
              const missing = await missingChunks(base, batchId);
              if (missing && missing.has(uploadId) && !missing.get(uploadId).has(index)) return;
              throw err;
            }
          },
          { retryStatus: (status) => status >= 500 }
        );
        sent += blob.size;
        report();
      }
    }
    // The handler runs once on the server; a lost answer is asked for again, and the server
    // gives the same one without running the handler twice.
    const answer = await attempt(() => json('POST', `${base}/uploads/${batchId}/complete`));
    sent = total;
    report();
    return answer;
  } catch (err) {
    await fetch(`${base}/uploads/${batchId}`, { method: 'DELETE' }).catch(() => {});
    throw err;
  }
}

// The address of what a server function sends with files.send(): the function runs when it
// is fetched, its args the way callServer hands them over.
export function downloadUrl(target, args) {
  const url = `${apiBase()}/download/${encodeURIComponent(target)}`;
  return args === undefined ? url : `${url}?args=${encodeURIComponent(JSON.stringify(args))}`;
}

// A browser download of the URL, the page staying where it is.
export function triggerDownload(url) {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = '';
  anchor.style.display = 'none';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}
