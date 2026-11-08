// Builds the hero slideshow list from assets/hero-slides/.
// Run from the site folder:  node scripts/build-hero-slides.mjs
// GitHub Actions runs this on every push before publishing the site.
//
// - Every valid WebP / JPEG / PNG / AVIF file in assets/hero-slides/ becomes a slide.
// - Order: leading number in the file name (01-, 02-, ...), then name. Files without a number go last.
// - Background blend: a word in the file name — onyx, olive or navy. Anything else uses near-black.
// - Optional per-photo crop focus / alt text: assets/hero-slides/slide-settings.json
// Output: assets/hero-slides.json (read by the page) and the first slide written into index.html.

import { readdirSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { join, extname, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dirRel = 'assets/hero-slides';
const dir = join(root, dirRel);
const outFile = join(root, 'assets/hero-slides.json');
const htmlFile = join(root, 'index.html');
const FALLBACK = { src: 'assets/gold-flower-dark.jpg', tone: 'onyx', alt: 'Gold flower hoop earrings on a dark surface', focus: { desktop: '50% 50%', mobile: '50% 50%' } };
const TONES = ['onyx', 'olive', 'navy'];
const EXT = new Set(['.webp', '.jpg', '.jpeg', '.png', '.avif']);

// Check the file really is the image type its name says.
function isImage(path) {
  let b;
  try { b = readFileSync(path).subarray(0, 32); } catch { return false; }
  if (b.length < 12) return false;
  const ascii = (s, e) => b.subarray(s, e).toString('latin1');
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return true;                       // JPEG
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return true; // PNG
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return true;                     // WebP
  if (ascii(4, 8) === 'ftyp' && /avi[fs]/.test(ascii(8, 32))) return true;                 // AVIF
  return false;
}

const words = name => basename(name, extname(name)).toLowerCase().split(/[-_\s.]+/).filter(Boolean);

function sortKey(name) {
  const m = name.match(/^(\d+)/);
  return { has: m ? 0 : 1, num: m ? parseInt(m[1], 10) : 0, name };
}

let settings = {};
const settingsFile = join(dir, 'slide-settings.json');
if (existsSync(settingsFile)) {
  try { settings = JSON.parse(readFileSync(settingsFile, 'utf8')); }
  catch (e) { console.warn(`! slide-settings.json ignored: ${e.message}`); }
}
const cleanPos = v => (typeof v === 'string' && /^\s*-?\d+(\.\d+)?%\s+-?\d+(\.\d+)?%\s*$/.test(v) ? v.trim() : null);

let files = [];
try { files = readdirSync(dir); } catch { console.warn(`! ${dirRel} not found — page will use the fallback photo.`); }

const skipped = [];
const slides = files
  .filter(f => {
    if (f.startsWith('.') || f.startsWith('_')) return false;
    if (!EXT.has(extname(f).toLowerCase())) return false;
    const p = join(dir, f);
    if (!statSync(p).isFile() || statSync(p).size === 0 || !isImage(p)) { skipped.push(f); return false; }
    return true;
  })
  .map(sortKey)
  .sort((a, b) => a.has - b.has || a.num - b.num || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  .map(({ name }) => {
    const w = words(name);
    const tone = w.find(x => TONES.includes(x)) || 'neutral';
    const label = w.filter((x, i) => !(i === 0 && /^\d+$/.test(x)) && !TONES.includes(x)).join(' ');
    const s = settings[name] || settings[basename(name, extname(name))] || {};
    const desktop = cleanPos(s.desktop) || '50% 50%';
    return {
      src: `${dirRel}/${encodeURIComponent(name)}`,
      tone,
      alt: typeof s.alt === 'string' ? s.alt : (label ? label[0].toUpperCase() + label.slice(1) : 'JNL STUDIO jewellery'),
      focus: { desktop, mobile: cleanPos(s.mobile) || desktop },
    };
  });

writeFileSync(outFile, JSON.stringify({ slides }, null, 2) + '\n');

// Put the slide list into the page, plus a tiny script that picks a random first photo
// and a random order on every visit, before any photo starts downloading.
const first = slides[0] || FALLBACK;
const esc = v => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const data = JSON.stringify({ slides }).replace(/</g, '\\u003c');
const pick = `(()=>{const F=${JSON.stringify(FALLBACK)};let L=[];try{L=JSON.parse(document.getElementById('heroData').textContent).slides||[]}catch(e){}if(!L.length)L=[F];const o=L.map((_,i)=>i);for(let i=o.length-1;i>0;i--){const j=Math.random()*(i+1)|0;[o[i],o[j]]=[o[j],o[i]]}let last=null;try{last=localStorage.getItem('jnl-hero-last')}catch(e){}if(o.length>1&&L[o[0]].src===last){const k=1+(Math.random()*(o.length-1)|0);[o[0],o[k]]=[o[k],o[0]]}const list=o.map(i=>L[i]),s=list[0],f=s.focus||{};try{localStorage.setItem('jnl-hero-last',s.src)}catch(e){}window.__hero={list};const img=document.getElementById('heroFirst');img.alt=s.alt||'';img.dataset.tone=s.tone||'neutral';img.style.setProperty('--pd',f.desktop||'50% 50%');img.style.setProperty('--pm',f.mobile||f.desktop||'50% 50%');img.onerror=()=>{img.onerror=null;img.src=F.src};img.src=s.src;const t=document.querySelector('.hero-tone');if(t)t.dataset.tone=['onyx','olive','navy'].includes(s.tone)?s.tone:'neutral'})()`;
const tag = `<!--hero-first--><img class="hs on" id="heroFirst" alt="" data-tone="${first.tone}" fetchpriority="high"><script id="heroData" type="application/json">${data}</script><script>${pick}</script><noscript><img class="hs on" src="${esc(first.src)}" alt="${esc(first.alt)}" style="--pd:${first.focus.desktop};--pm:${first.focus.mobile}"></noscript><!--/hero-first-->`;
const html = readFileSync(htmlFile, 'utf8');
const re = /<!--hero-first-->[\s\S]*?<!--\/hero-first-->/;
if (re.test(html)) {
  const next = html.replace(re, tag).replace(/(<div class="hero-tone" data-tone=")[a-z]+(")/, `$1${first.tone}$2`);
  if (next !== html) writeFileSync(htmlFile, next);
} else console.warn('! index.html has no <!--hero-first--> marker; first slide not written.');

console.log(`${slides.length} slide(s):`);
slides.forEach((s, i) => console.log(`  ${String(i + 1).padStart(2, '0')}  ${decodeURIComponent(s.src)}  [${s.tone}]`));
if (skipped.length) console.log(`skipped (not a valid image): ${skipped.join(', ')}`);
