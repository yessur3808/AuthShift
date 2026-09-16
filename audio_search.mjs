const query = process.argv.slice(2).join(' ');
if (!query) throw new Error('Pass a Commons search query');

const params = new URLSearchParams({
  action: 'query', generator: 'search', gsrsearch: `filetype:audio ${query}`,
  gsrnamespace: '6', gsrlimit: '50', prop: 'imageinfo',
  iiprop: 'url|extmetadata|size', format: 'json', origin: '*',
});
const response = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, {
  headers: { 'User-Agent': 'AtmosphereAudioCurator/1.0 (local project asset research)' },
});
if (!response.ok) throw new Error(`${response.status} ${query}`);
const payload = await response.json();
const rows = Object.values(payload.query?.pages || {})
  .map((page) => {
    const info = page.imageinfo?.[0] || {};
    const meta = info.extmetadata || {};
    return {
      title: page.title,
      duration: Math.round(Number(info.duration || 0)),
      sizeMb: +(Number(info.size || 0) / 1048576).toFixed(1),
      license: meta.LicenseShortName?.value || '',
      artist: String(meta.Artist?.value || '').replace(/<[^>]+>/g, '').trim(),
      url: info.url?.replace(/\?.*$/, ''),
      page: info.descriptionurl,
    };
  })
  .filter((item) => item.duration >= 10 && item.url && /^(CC|Public domain)/.test(item.license));
console.log(JSON.stringify(rows, null, 2));
