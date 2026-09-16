import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { spawn } from 'node:child_process';

const projectRoot = new URL('../', import.meta.url).pathname;
const catalog = JSON.parse(await readFile(join(projectRoot, 'audio-sources.json'), 'utf8'));
const outputRoot = join(projectRoot, 'public/assets/audio');
const cacheRoot = join(projectRoot, '.audio-source-cache');
const encoderMode = process.env.ATMOSPHERE_ENCODER || 'ffmpeg';
const ffmpegImage = 'docker.io/jrottenberg/ffmpeg:7.1-alpine';
const commonsIp = process.env.ATMOSPHERE_COMMONS_IP || '';
const uploadIp = process.env.ATMOSPHERE_UPLOAD_IP || '';
const sourceTitles = [...new Set(Object.values(catalog).flat().map((track) => track.sourceTitle))];
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const metadataCacheFile = join(projectRoot, 'audio-metadata.json');
const downloadDelay = Number(process.env.ATMOSPHERE_DOWNLOAD_DELAY || 900);

await mkdir(outputRoot, { recursive: true });
await mkdir(cacheRoot, { recursive: true });

async function commonsMetadata(titles) {
  const params = new URLSearchParams({
    action: 'query', titles: titles.join('|'), prop: 'videoinfo',
    viprop: 'url|derivatives|extmetadata|size', format: 'json', origin: '*',
  });
  const url = `https://commons.wikimedia.org/w/api.php?${params}`;
  let payload;
  if (commonsIp) {
    payload = JSON.parse(await runCapture('curl', [
      '--fail', '--silent', '--show-error', '--resolve', `commons.wikimedia.org:443:${commonsIp}`,
      '--user-agent', 'AtmosphereAudioImporter/1.0 (local ambient audio project)', url,
    ]));
  } else {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'AtmosphereAudioImporter/1.0 (local ambient audio project)' },
    });
    if (!response.ok) throw new Error(`Commons metadata request failed: ${response.status}`);
    payload = await response.json();
  }
  return Object.values(payload.query?.pages || {}).map((page) => {
    const info = page.videoinfo?.[0];
    if (!info) throw new Error(`No media metadata for ${page.title}`);
    const meta = info.extmetadata || {};
    const derivatives = info.derivatives || [];
    const webAudio = derivatives.find((item) => item.type === 'audio/mpeg')
      || derivatives.find((item) => item.type?.startsWith('audio/ogg'));
    return {
      sourceTitle: page.title,
      sourceUrl: (webAudio?.src || info.url).replace(/\?.*$/, ''),
      sourcePage: info.descriptionurl,
      sourceDuration: Number(info.duration || 0),
      artist: String(meta.Artist?.value || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(),
      license: meta.LicenseShortName?.value || meta.UsageTerms?.value || 'See source page',
      licenseUrl: meta.LicenseUrl?.value || '',
    };
  });
}

let metadata = await readFile(metadataCacheFile, 'utf8').then(JSON.parse).catch(() => null);
if (!metadata) {
  metadata = [];
  for (let i = 0; i < sourceTitles.length; i += 45) {
    metadata.push(...await commonsMetadata(sourceTitles.slice(i, i + 45)));
  }
  await writeFile(metadataCacheFile, `${JSON.stringify(metadata, null, 2)}\n`);
}
const byTitle = new Map(metadata.map((item) => [item.sourceTitle, item]));

if (process.argv.includes('--metadata-only')) {
  console.log(`Metadata complete: ${metadata.length} recordings written to ${metadataCacheFile}`);
  process.exit(0);
}

async function download(url, target) {
  if (uploadIp) {
    await run('curl', [
      '--fail', '--silent', '--show-error', '--retry', '5', '--retry-all-errors', '--retry-delay', '5',
      '--resolve', `upload.wikimedia.org:443:${uploadIp}`,
      '--user-agent', 'AtmosphereAudioImporter/1.0 (local ambient audio project)', '--output', target, url,
    ]);
    return;
  }
  let response;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    response = await fetch(url, {
      headers: { 'User-Agent': 'AtmosphereAudioImporter/1.0 (local ambient audio project)' },
    });
    if (response.ok && response.body) break;
    if (response.status !== 429 || attempt === 5) throw new Error(`Download failed (${response.status}): ${url}`);
    const retryAfter = Number(response.headers.get('retry-after') || 0) * 1000;
    await wait(Math.max(retryAfter, 6000 * (attempt + 1)));
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(target));
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'inherit', 'inherit'] });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)));
  });
}

function runCapture(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'inherit'] });
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve(output) : reject(new Error(`${command} exited ${code}`)));
  });
}

function containerPath(localPath) {
  return `/work/${localPath.slice(projectRoot.length)}`;
}

function encode(input, output, start) {
  const ffmpegArgs = [
    '-hide_banner', '-loglevel', 'error', '-stream_loop', '-1', '-ss', String(start),
    '-i', encoderMode === 'podman' ? containerPath(input) : input,
    '-t', '60', '-vn', '-af',
    'highpass=f=25,loudnorm=I=-21:TP=-2:LRA=11,afade=t=in:st=0:d=0.45,afade=t=out:st=59.55:d=0.45',
    '-ar', '44100', '-ac', '2', '-codec:a', 'libmp3lame', '-b:a', '160k', '-y',
    encoderMode === 'podman' ? containerPath(output) : output,
  ];
  if (encoderMode === 'podman') {
    return run('podman', [
      'run', '--rm', '--network', 'none', '-v', `${projectRoot}:/work:rw`, '-w', '/work',
      ffmpegImage, ...ffmpegArgs,
    ]);
  }
  return run('ffmpeg', ffmpegArgs);
}

const sourceFiles = new Map();
for (const [index, sourceTitle] of sourceTitles.entries()) {
  const source = byTitle.get(sourceTitle);
  if (!source) throw new Error(`Commons did not resolve ${sourceTitle}`);
  const extension = extname(new URL(source.sourceUrl).pathname) || '.audio';
  const target = join(cacheRoot, `${String(index + 1).padStart(2, '0')}${extension}`);
  const cached = await stat(target).then((item) => item.size > 0).catch(() => false);
  console.log(`${cached ? 'Using cached' : 'Downloading'} ${index + 1}/${sourceTitles.length}: ${sourceTitle}`);
  if (!cached) {
    await download(source.sourceUrl, target);
    await wait(downloadDelay);
  }
  sourceFiles.set(sourceTitle, target);
}

if (process.argv.includes('--download-only')) {
  console.log(`Download complete: ${sourceFiles.size} source recordings cached in ${cacheRoot}`);
  process.exit(0);
}

const manifest = [];
let rendered = 0;
const total = Object.values(catalog).flat().length;
for (const [sceneId, tracks] of Object.entries(catalog)) {
  const folder = sceneId.replace(/^tab_/, '');
  const sceneOutput = join(outputRoot, folder);
  await mkdir(sceneOutput, { recursive: true });
  for (const track of tracks) {
    const source = byTitle.get(track.sourceTitle);
    const input = sourceFiles.get(track.sourceTitle);
    const output = join(sceneOutput, track.file);
    const safeStart = source.sourceDuration > 64
      ? Math.min(track.start || 0, Math.max(0, source.sourceDuration - 61))
      : 0;
    rendered += 1;
    console.log(`Rendering ${rendered}/${total}: ${folder}/${track.file}`);
    await encode(input, output, safeStart);
    manifest.push({
      sceneId,
      file: `/assets/audio/${folder}/${track.file}`,
      title: track.title,
      sourceTitle: source.sourceTitle.replace(/^File:/, ''),
      sourcePage: source.sourcePage,
      artist: source.artist,
      license: source.license,
      licenseUrl: source.licenseUrl,
      edit: '60-second normalized MP3 excerpt; fade in/out; stereo 44.1 kHz at 160 kbps',
    });
  }
}

await writeFile(join(outputRoot, 'SOURCES.json'), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(join(outputRoot, 'README.txt'), [
  'Atmosphere audio library',
  '',
  'Each clip is a normalized excerpt of a Wikimedia Commons recording.',
  'Full creator, license, and source-page details are stored in SOURCES.json.',
  'Source recordings are not redistributed outside this application.',
  '',
].join('\n'));
const escapeHtml = (value) => String(value || '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
const uniqueCredits = [...new Map(manifest.map((item) => [item.sourcePage, item])).values()];
await writeFile(join(projectRoot, 'public/audio-credits.html'), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Atmosphere audio credits</title><style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#0c0d0f;color:#f4f4f1;font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{width:min(900px,calc(100% - 36px));margin:0 auto;padding:72px 0 96px}a{color:#d9e7ff}p{color:#a9abb1}.back{display:inline-block;margin-bottom:36px;text-decoration:none}.credit{padding:20px 0;border-top:1px solid #2b2d31}.credit h2{font-size:1rem;margin:0 0 5px}.credit p{margin:3px 0;font-size:.9rem}.license{display:inline-flex;padding:4px 9px;border:1px solid #3b3d42;border-radius:99px;text-decoration:none;font-size:.78rem}
</style></head><body><main><a class="back" href="/">← Back to Atmosphere</a><h1>Audio credits</h1><p>${manifest.length} theme-matched clips, edited from ${uniqueCredits.length} field recordings. Each file is normalized to a consistent listening level and remains available under the same license as its source; the original creators and licenses are listed below.</p>
${uniqueCredits.map((item) => `<article class="credit"><h2><a href="${escapeHtml(item.sourcePage)}">${escapeHtml(item.sourceTitle)}</a></h2><p>${escapeHtml(item.artist || 'Creator listed on source page')}</p><a class="license" href="${escapeHtml(item.licenseUrl || item.sourcePage)}">${escapeHtml(item.license)}</a></article>`).join('\n')}
</main></body></html>\n`);
await rm(cacheRoot, { recursive: true, force: true });
console.log(`Complete: ${manifest.length} audio clips written to ${outputRoot}`);
