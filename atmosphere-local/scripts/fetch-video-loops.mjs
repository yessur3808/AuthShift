import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const library = JSON.parse(readFileSync(resolve(projectRoot, "src/videoLoops.json"), "utf8"));
const checkOnly = process.argv.includes("--check");
const resolveOnly = process.argv.includes("--resolve");
const userAgent = "Mozilla/5.0 (compatible; AtmosphereMediaFetcher/1.0)";

async function getText(url) {
  const response = await fetch(url, { headers: { "user-agent": userAgent } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.text();
}

async function resolveSources(sourcePage) {
  const html = await getText(sourcePage);
  const match = html.match(/<script class="structured-data-video"[^>]*>([^<]+)<\/script>/);
  if (!match) throw new Error("No video metadata found");
  const metadata = JSON.parse(match[1]);
  if (!metadata.contentUrl?.includes("/1080p.mp4")) throw new Error("No free 1080p MP4 found");
  return {
    high: metadata.contentUrl,
    adaptive: metadata.contentUrl.replace("/1080p.mp4", "/720p.mp4"),
  };
}

async function download(url, destination) {
  if (existsSync(destination)) return "cached";
  mkdirSync(dirname(destination), { recursive: true });
  const response = await fetch(url, { headers: { "user-agent": userAgent } });
  if (!response.ok || !response.body) throw new Error(`${response.status} ${response.statusText}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination));
  return "downloaded";
}

const entries = Object.values(library).flat();
let completed = 0;
let cursor = 0;

async function prepareEntry(entry) {
  try {
    const sources = await resolveSources(entry.source);
    if (resolveOnly) {
      entry.high = sources.high;
      entry.adaptive = sources.adaptive;
      console.log(`✓ ${entry.file} (CDN resolved)`);
    } else if (!checkOnly) {
      const highPath = resolve(projectRoot, "public/assets/videos/loops", entry.file);
      const adaptivePath = resolve(projectRoot, "public/assets/videos/adaptive/loops", entry.file);
      const [highStatus, adaptiveStatus] = await Promise.all([
        download(sources.high, highPath),
        download(sources.adaptive, adaptivePath),
      ]);
      console.log(`✓ ${entry.file} (${highStatus}, ${adaptiveStatus})`);
    } else {
      console.log(`✓ ${entry.file}`);
    }
    completed += 1;
  } catch (error) {
    console.error(`✗ ${entry.file}: ${error.message}`);
  }
}

async function worker() {
  while (cursor < entries.length) {
    const entry = entries[cursor];
    cursor += 1;
    await prepareEntry(entry);
  }
}

await Promise.all(Array.from({ length: Math.min(6, entries.length) }, worker));

if (resolveOnly && completed === entries.length) {
  writeFileSync(resolve(projectRoot, "src/videoLoops.resolved.json"), `${JSON.stringify(library, null, 2)}\n`);
}

if (completed !== entries.length) {
  console.error(`Resolved ${completed}/${entries.length} video loops.`);
  process.exitCode = 1;
} else {
  console.log(`${checkOnly || resolveOnly ? "Resolved" : "Prepared"} ${completed} distinct video loops.`);
}
