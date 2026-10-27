import { cutSegments } from './timber-cut-passes.js?v=0.31.1';
import { getLanguage } from './locale.js?v=0.31.1';
import { cutDescription, cutDetail, cutRetain, trimGuide, cutEfficiency } from './timber-text.js?v=0.31.1';
import { timberCutOverlay } from './timber-cut-overlay.js?v=0.31.1';
const scripts = new Map();
function loadScript(path, name) {
  if (window[name]) return Promise.resolve(window[name]);
  if (!scripts.has(path)) scripts.set(path, new Promise((resolve, reject) => {
    const script = document.createElement('script'); script.src = new URL(path, import.meta.url).href; script.onload = () => window[name] ? resolve(window[name]) : reject(new Error('PDF library did not load.')); script.onerror = () => { scripts.delete(path); script.remove(); reject(new Error('Could not load the PDF library.')); }; document.head.append(script);
  }));
  return scripts.get(path);
}
let fontData;
// fontkit's default shaping swaps this font's digits for alternate glyphs that
// pdf-lib leaves out of the PDF width table, so viewers drew every digit 1 em wide
// ("1 ,4 2 8"). Horizontal Latin and CJK text needs none of these substitutions.
export const PDF_FONT_OPTIONS = { subset: false, features: { ccmp: false, locl: false, liga: false, dlig: false, calt: false, clig: false, rlig: false } };
export async function loadPDFTools() {
  const PDFLib = await loadScript('./vendor/pdf/pdf-lib.min.js', 'PDFLib');
  const fontkit = await loadScript('./vendor/pdf/fontkit.umd.min.js', 'fontkit');
  fontData ||= fetch(new URL('./vendor/pdf/PaperNestTC-Regular.ttf', import.meta.url)).then((r) => { if (!r.ok) throw new Error('Could not load the Traditional Chinese PDF font.'); return r.arrayBuffer(); }).catch((error) => { fontData = null; throw error; });
  return { PDFLib, fontkit, fontBytes: await fontData };
}
export async function createTimberPDF(project, plan, { PDFLib, fontkit, fontBytes, language = getLanguage() }) {
  const { PDFDocument, rgb } = PDFLib, doc = await PDFDocument.create(); doc.registerFontkit(fontkit);
  // Full embedding avoids fontkit subset glyph mapping errors for this CJK font.
  const font = await doc.embedFont(fontBytes, PDF_FONT_OPTIONS);
  const L = (en, zh) => language === 'zh-Hant' ? zh : en;
  const gray = rgb(.28,.32,.37), brown = rgb(.6,.36,.25), blue = rgb(.15,.29,.47);
  const characters = new Set(font.getCharacterSet());
  const safe = (s) => [...String(s)].map((c) => (c === '\n' || characters.has(c.codePointAt(0))) ? c : '?').join('');
  const draw = (page, text, x, y, size = 10, color = gray) => page.drawText(safe(text), { x,y,size,font,color });
  const wrap = (text, width, size = 9) => {
    const lines=[];let line='';
    for(const c of safe(text).match(/[A-Za-z0-9][A-Za-z0-9.,-]*|\n|[^\n]/gu) || []){if(c==='\n'){lines.push(line);line='';continue;}if(font.widthOfTextAtSize(line+c,size)>width&&line){lines.push(line);line=c;}else line+=c;}if(line)lines.push(line);return lines;
  };
  doc.setTitle(`${project.name || 'Paper Nest'} — ${L('Cutting plan','開料方案')}`); doc.setProducer('Paper Nest');
  for (const [index, sheet] of plan.sheets.entries()) {
    const page = doc.addPage([842,595]);
    draw(page, `${project.name || 'Paper Nest'} · ${L('Sheet','板材')} ${index+1}/${plan.sheets.length} · S${sheet.number}`, 30,565,15,blue);
    draw(page, `${sheet.stock.material} · ${sheet.stock.thickness} mm · ${sheet.stock.length} × ${sheet.stock.width} mm · ${L('Kerf','鋸縫')} ${plan.settings.kerf} mm`,30,545,10);
    if(plan.unplaced.length)draw(page,L(`${plan.unplaced.length} required parts are NOT placed.`, `尚有 ${plan.unplaced.length} 件零件未放入。`),30,527,10,rgb(.7,.28,.14));
    const overlay=timberCutOverlay(sheet), s=Math.min(770/(sheet.stock.length+overlay.rightMargin),345/sheet.stock.width), ox=35, oy=160;
    const rect=(r,color,border)=>page.drawRectangle({x:ox+r.x*s,y:oy+(sheet.stock.width-r.y-r.h)*s,width:r.w*s,height:r.h*s,color,borderColor:border||rgb(.6,.57,.5),borderWidth:.4});
    rect({x:0,y:0,w:sheet.stock.length,h:sheet.stock.width},rgb(.94,.91,.85));
    for(const o of sheet.offcuts)rect(o,rgb(.89,.94,.86));
    for(const p of sheet.parts){rect(p,rgb(.86,.81,.68));const size=Math.max(4,Math.min(9,p.w*s/Math.max(6,p.id.length),p.h*s/3));draw(page,p.id,ox+(p.x+p.w/2)*s-font.widthOfTextAtSize(p.id,size)/2,oy+(sheet.stock.width-p.y-p.h/2)*s,size);}
    for(const c of cutSegments(sheet)){const x=c.axis==='x'?c.x+c.offset:c.x,y=c.axis==='y'?c.y+c.offset:c.y;page.drawLine({start:{x:ox+x*s,y:oy+(sheet.stock.width-y)*s},end:{x:ox+(c.axis==='x'?x:c.x+c.w)*s,y:oy+(sheet.stock.width-(c.axis==='y'?y:c.y+c.h))*s},thickness:.8,color:brown});}
    for(const b of overlay.badges){const x=ox+b.x*s,y=oy+(sheet.stock.width-b.y)*s,r=Math.max(5,overlay.radius*s);page.drawCircle({x,y,size:r,color:rgb(1,.99,.97),borderColor:brown,borderWidth:.8});const size=Math.min(9,r);draw(page,String(b.step),x-font.widthOfTextAtSize(String(b.step),size)/2,y-size*.34,size,brown);}
    let y=137;for(const line of wrap(trimGuide(sheet,plan.settings,language) + '\n' + cutEfficiency(sheet,language),770,9)){draw(page,line,30,y,9);y-=14;}
    draw(page,L('Numbered lines show the cutting order. Dimensions are finished sizes; separation gaps are not exported.','編號切線顯示切割次序。尺寸為完成尺寸；示意分離間距不會輸出。'),30,45,9);
    let guide=doc.addPage([842,595]), gy=535;
    const title=()=>{draw(guide,`${project.name || 'Paper Nest'} · S${sheet.number} · ${L('Cutting sequence','切割次序')}`,30,565,14,blue);};title();
    if(!sheet.cuts.length)draw(guide,L('No numbered cuts needed after edge preparation.','修邊後毋須再切割。'),30,gy,11);
    for(const c of sheet.cuts){const lines=wrap(`${c.step}. ${cutDescription(c,language)}\n${cutDetail(c,language)} ${cutRetain(c,language)}`,775,10);if(gy-lines.length*15<40){guide=doc.addPage([842,595]);gy=535;title();}for(const line of lines){if(gy<40){guide=doc.addPage([842,595]);gy=535;title();}draw(guide,line,30,gy,10);gy-=15;}gy-=13;}
  }
  return doc.save();
}

// Part labels (roadmap 2.3) on A4 in the common 3 × 7 sticker layout (63.5 × 38.1 mm,
// e.g. Avery L7160). Light corner marks make plain paper easy to cut by hand too.
export const LABEL_LAYOUT = { page: [595.28, 841.89], columns: 3, rows: 7, mm: 72 / 25.4, width: 63.5, height: 38.1, left: 7.25, top: 15.15, gap: 2.54 };
export async function createLabelsPDF(project, labels, { PDFLib, fontkit, fontBytes, language = getLanguage() }) {
  const { PDFDocument, rgb } = PDFLib, doc = await PDFDocument.create(); doc.registerFontkit(fontkit);
  const font = await doc.embedFont(fontBytes, PDF_FONT_OPTIONS);
  const L = (en, zh) => language === 'zh-Hant' ? zh : en;
  const characters = new Set(font.getCharacterSet());
  const safe = (s) => [...String(s)].map((c) => characters.has(c.codePointAt(0)) ? c : '?').join('');
  const fit = (text, size, width) => { let t = safe(text); while (t.length > 1 && font.widthOfTextAtSize(t, size) > width) t = t.slice(0, -2) + '…'; return t; };
  const { page: [pw, ph], columns, rows, mm, width, height, left, top, gap } = LABEL_LAYOUT;
  const ink = rgb(.1, .14, .2), muted = rgb(.38, .42, .48), mark = rgb(.78, .8, .83);
  const machine = { panel: rgb(.18, .44, .56), table: rgb(.54, .31, .69) };
  const n = (v) => Number(v.toFixed(1)).toLocaleString('en-GB');
  doc.setTitle(`${project.name || 'Paper Nest'} — ${L('Part labels', '零件標籤')}`); doc.setProducer('Paper Nest');
  const perPage = columns * rows;
  for (let start = 0; start < labels.length; start += perPage) {
    const page = doc.addPage([pw, ph]);
    labels.slice(start, start + perPage).forEach((p, i) => {
      const col = i % columns, row = Math.floor(i / columns);
      const x = (left + col * (width + gap)) * mm, y = ph - (top + (row + 1) * height) * mm, w = width * mm, h = height * mm, pad = 3.5 * mm;
      for (const [cx, cy, dx, dy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]]) {
        page.drawLine({ start: { x: cx, y: cy }, end: { x: cx + dx * 3 * mm, y: cy }, thickness: .4, color: mark });
        page.drawLine({ start: { x: cx, y: cy }, end: { x: cx, y: cy + dy * 3 * mm }, thickness: .4, color: mark });
      }
      const where = p.step ? L(`S${p.sheet} · step ${p.step}`, `S${p.sheet} · 第 ${p.step} 刀`) : `S${p.sheet}`;
      const whereSize = 8, whereWidth = font.widthOfTextAtSize(safe(where), whereSize);
      page.drawText(fit(p.id, 20, w - whereWidth - 3 * pad), { x: x + pad, y: y + h - pad - 17, size: 20, font, color: ink });
      page.drawText(safe(where), { x: x + w - pad - whereWidth, y: y + h - pad - 9, size: whereSize, font, color: p.machine ? machine[p.machine] : muted });
      page.drawText(fit(p.label, 10, w - 2 * pad), { x: x + pad, y: y + h - pad - 32, size: 10, font, color: ink });
      page.drawText(fit(`${n(p.length)} × ${n(p.width)} mm · ${n(p.thickness)} mm ${p.material}`, 8, w - 2 * pad), { x: x + pad, y: y + pad + 11, size: 8, font, color: muted });
      if (p.grain) page.drawText(safe(L('Grain along length →', '木紋沿長度 →')), { x: x + pad, y: y + pad, size: 7, font, color: muted });
      if (p.machine) page.drawText(safe(p.machine === 'table' ? L('Table saw', '檯鋸') : L('Panel saw', '板鋸')), { x: x + w - pad - font.widthOfTextAtSize(safe(p.machine === 'table' ? L('Table saw', '檯鋸') : L('Panel saw', '板鋸')), 7), y: y + pad, size: 7, font, color: machine[p.machine] });
    });
  }
  return doc.save();
}
