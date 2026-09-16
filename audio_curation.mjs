const themes = {
  rain: ['"rain" sound', '"rainfall" sound', '"rain against"'],
  coffee_shop: ['"cafe" sound', '"coffee shop" audio', '"restaurant ambience" sound'],
  waterfall: ['"waterfall" sound', '"waterfall" audio'],
  lightning: ['"thunder" sound', '"thunderstorm" audio', '"distant thunder"'],
  wind: ['"wind" sound', '"wind blowing" audio', '"wind ambience"'],
  fire: ['"fireplace" sound', '"crackling fire" audio', '"campfire" sound'],
  snow: ['"snow" sound', '"winter wind" audio', '"walking in snow" sound'],
  street: ['"street ambience" sound', '"traffic" sound', '"city street" audio'],
  leaves: ['"rustling leaves" sound', '"leaves" sound wind', '"forest breeze" audio'],
  ocean_waves: ['"ocean waves" sound', '"waves" sound sea', '"surf" sound'],
  train: ['"train interior" sound', '"train" sound railway', '"railroad" sound'],
  typing: ['"typing" sound', '"keyboard" sound', '"typewriter" sound'],
  foot_steps: ['"footsteps" sound', '"walking" sound footsteps', '"steps" sound'],
  birds: ['"birdsong" sound', '"birds singing" audio', '"dawn chorus" audio'],
  white_noise: ['"white noise" audio', '"brown noise" audio', '"pink noise" audio'],
};

const reject = /\b(pronunciation|spoken|speech|word|sentence|language|wikipedia|interview|song|music|anthem|podcast|radio|lecture|speech|voice|woman|man|child|ll-q|lingua libre)\b/i;
const preferred = new Set([
  'CC0', 'Public domain', 'CC BY 4.0', 'CC BY 3.0', 'CC BY 2.0',
  'CC BY-SA 4.0', 'CC BY-SA 3.0', 'CC BY-SA 2.0', 'CC BY 3.0 de', 'CC BY 2.5',
]);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function search(query) {
  const params = new URLSearchParams({
    action: 'query', generator: 'search', gsrsearch: `filetype:audio ${query}`,
    gsrnamespace: '6', gsrlimit: '50', prop: 'imageinfo',
    iiprop: 'url|extmetadata|size', format: 'json', origin: '*',
  });
  let response;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    response = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`,
      { headers: { 'User-Agent': 'AtmosphereAudioCurator/1.0 (local project asset research)' } });
    if (response.ok) break;
    if (response.status !== 429 || attempt === 3) throw new Error(`${response.status} ${query}`);
    await wait(6000 * (attempt + 1));
  }
  const payload = await response.json();
  return Object.values(payload.query?.pages || {}).map((page) => {
    const info = page.imageinfo?.[0] || {};
    const meta = info.extmetadata || {};
    return {
      title: page.title,
      url: info.url?.replace(/\?.*$/, ''),
      page: info.descriptionurl,
      duration: Number(info.duration || 0),
      size: Number(info.size || 0),
      license: meta.LicenseShortName?.value || '',
      licenseUrl: meta.LicenseUrl?.value || '',
      artist: String(meta.Artist?.value || '').replace(/<[^>]+>/g, '').trim(),
      description: String(meta.ImageDescription?.value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    };
  });
}

for (const [theme, queries] of Object.entries(themes)) {
  const found = new Map();
  for (const query of queries) {
    for (const item of await search(query)) found.set(item.url, item);
    await wait(1400);
  }
  const picks = [...found.values()]
    .filter((x) => x.url && preferred.has(x.license) && x.duration >= 12 && x.duration <= 1800 && !reject.test(`${x.title} ${x.description}`))
    .sort((a, b) => {
      const al = /CC0|Public domain/.test(a.license) ? 1 : 0;
      const bl = /CC0|Public domain/.test(b.license) ? 1 : 0;
      const ad = a.duration >= 30 && a.duration <= 360 ? 1 : 0;
      const bd = b.duration >= 30 && b.duration <= 360 ? 1 : 0;
      return (bl - al) || (bd - ad) || (b.size - a.size);
    })
    .slice(0, 8);
  console.log(`\n## ${theme} (${picks.length})`);
  for (const item of picks) {
    console.log(JSON.stringify({
      title: item.title,
      duration: Math.round(item.duration),
      sizeMb: +(item.size / 1048576).toFixed(1),
      license: item.license,
      artist: item.artist,
      url: item.url,
      page: item.page,
    }));
  }
}
