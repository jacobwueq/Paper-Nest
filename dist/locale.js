const KEY = 'paper-nest.language.v1';
let language = 'en';
try { if (globalThis.localStorage?.getItem(KEY) === 'zh-Hant') language = 'zh-Hant'; } catch {}
export const getLanguage = () => language;
export const t = (en, zh) => language === 'zh-Hant' ? zh : en;
export const onLanguageChange = (fn) => { if (typeof document !== 'undefined') document.addEventListener('paper-nest:languagechange', fn); };
const pairs = [
['1 · Setup 設定','1 · 設定'],['2 · Auto Nest 排料','2 · 自動排料'],['3 · Manual Adjust 微調','3 · 手動微調'],['4 · Review & Export 匯出','4 · 檢查及匯出'],

["Preview every piece, place it on a sheet, then make your cutting guide.", "一路輸入尺寸，一路睇到零件同板材，再製作切割指引。"],
["一路輸入尺寸，一路睇到零件同板材。Preview every piece, place it on a sheet, then make your cutting guide.", "一路輸入尺寸，一路睇到零件同板材，再製作切割指引。"],
["See every piece as you type.", "一路輸入，一路睇到。"],
["Part", "零件"],
["Restart", "重新開始"],
["↶ Restart", "↶ 重新開始"],
["Lengths × widths shown as entered · rotated parts marked ↻", "長度 × 闊度依輸入顯示 · 已旋轉零件以 ↻ 標示"],
["Your next project starts here.", "由呢度開始下一個專案。"],
["Edit the sample cutting list above, then calculate to see sheet layouts and a step-by-step guide.", "修改上方示範清單，再計算板材排位及逐步切割指引。"],
["PLAN FOR THE SAW", "為開料做好準備"],
["03 / FROM LIST TO WORKSHOP", "03／由清單到工作室"],
["of used stock", "佔已用板材"],
["+ edge preparation", "＋ 修邊準備"],
["mm · largest offcut", "mm · 最大餘料"],
["No cuts needed after edge preparation.", "修邊後毋須再切割。"],
["This part uses the entire prepared panel. No further cuts needed.", "此零件使用整張修邊後嘅板材，毋須再切割。"],
["Remove", "移除"],
["▶ Play cuts", "▶ 播放切割"],
["Separate pieces", "分開板件"],
["Saved in this browser", "已儲存於此瀏覽器"],
["Browser saving unavailable. Use Save project to keep your work.", "瀏覽器未能儲存，請按「儲存專案」保留工作。"],

['More exports','更多匯出'],['Choose workspace','選擇工作模式'],['← Choose workspace','← 選擇工作模式'],['Laser cutting ↗','雷射切割 ↗'],['One workshop. Two ways to cut.','一個工作室，兩種切割模式。'],
['What are we','今日要切'],['cutting today','啲咩材料'],['Files stay in your browser','檔案於本機處理'],['Delete part','刪除零件'],
['What are we cutting today?','今日要切啲咩材料？'],['Start with your material. Turn a list of parts into a plan for the workshop.','由材料開始，將零件清單變成工作室可用嘅切割方案。'],
['Timber cutting','木材開料'],['Laser cutting','雷射切割'],['Cutting lists','開料清單'],['Grain & kerf','木紋及鋸縫'],['Cut-order guide','切割次序指引'],['Shape nesting','異形排料'],['1:1 export','原尺寸匯出'],
['Open timber workspace','開啟木材工作區'],['Open laser workspace','開啟雷射工作區'],['You can switch workspaces at any time.','隨時可以切換工作模式。'],['About laser support & credits','雷射支援範圍及鳴謝'],
['See plywood and MDF parts appear as you type. Place them on a sheet and take a clear cutting sequence to the workshop.','輸入尺寸時即時見到夾板及纖維板零件，放上板材，再按清楚嘅次序開料。'],
['Nest DXF and SVG outlines, review your parts and export full-scale sheets with the existing Paper Nest tools.','使用 Paper Nest 將 DXF／SVG 輪廓排料，核對零件，並以原尺寸匯出。'],
['Your timber, brought to life.','板材排料，即時呈現。'],['Load sample','載入示範'],['Save project ↓','儲存專案 ↓'],['Open project','開啟專案'],['Project name','專案名稱'],
['Saw kerf','鋸縫'],['Trim each edge','每邊修邊'],['Cutting direction','切割方向'],['Auto · minimise cuts','自動 · 減少切割'],['Rip first · along grain','先順紋切割'],['Crosscut first · across grain','先橫紋切割'],
['Allow 90° rotation','允許旋轉 90°'],['Only parts without grain lock','只適用於未鎖定木紋嘅零件'],['Use part priorities','啟用零件優先級'],['Optional · 預設不按先後次序','可選 · 預設不按先後次序'],
['Available stock','可用板材'],['+ Add stock','＋ 新增板材'],['Stock','板材'],['Label','名稱'],['Material','物料'],['Thk.','厚度'],['Length →','長度 →'],['Length','長度'],['Width','闊度'],['Qty','數量'],['Part / label','零件／名稱'],['Optional priority','可選優先級'],['Grain lock','鎖定木紋'],
['High','高'],['Normal','一般'],['Low','低'],['Cutting list','開料清單'],['CSV template ↓','CSV 範本 ↓'],['Import CSV','匯入 CSV'],['+ Add part','＋ 新增零件'],['Optimise cutting plan','優化排料方案'],['Optimise cutting plan →','優化排料方案 →'],['Calculating…','計算中…'],
['Optimise the whole sheet.','以整張板材作整體優化。'],['Match the material.','配對物料。'],['Protect the grain.','保留木紋方向。'],['Reduce cuts. Keep useful offcuts.','減少切割，保留可用餘料。'],
['Plywood and MDF, or different thicknesses, are planned separately.','夾板、纖維板及不同厚度會分開排料。'],['Lock a part’s length to the sheet grain. Locked parts never rotate.','將零件長度鎖定為順板材木紋；已鎖定嘅零件不會旋轉。'],
['Compare the whole list: place all parts, minimise sheets, then minimise cuts and preserve reusable offcuts. Input order is ignored; part priorities apply only when enabled.','比較整份清單：先放齊零件、減少用板，再減少切割及保留可用餘料。唔跟輸入次序；優先級只會喺啟用後生效。'],
['Length follows the stock grain →. Match material and thickness to your parts.','板材木紋沿長度方向 →；零件必須配對相同物料及厚度。'],
['Common sheet: 2440 × 1220 mm · Finite stock quantities are respected.','常用板材：2440 × 1220 毫米 · 排料會遵守可用張數。'],
['All dimensions in mm. Size means finished part size; the planner adds kerf between pieces. Priorities apply only when “Use part priorities” is enabled.','全部尺寸以毫米計，輸入完成尺寸；系統會預留零件之間嘅鋸縫。只有勾選「啟用零件優先級」先會按優先級排料。'],
['Your cutting plan','開料方案'],['Cutting list CSV ↓','下載開料清單 CSV ↓'],['Cut guide CSV ↓','下載切割指引 CSV ↓'],['Download PDF ↓','下載 PDF ↓'],['Print / Save PDF','列印／儲存 PDF'],['Print','列印'],
['Stock sheets used','已用板材張數'],['Parts placed','已放入零件'],['Finished-part yield','成品材料利用率'],['Cutting steps','切割步驟'],['Sheet layout','板材排位'],['Sheet','板材'],['Finished parts','完成零件'],['Offcuts','餘料'],['Selected cut','目前切割線'],['Stock grain →','板材木紋 →'],['Cutting sequence','切割次序'],
['Part labels & workpiece reference','零件名稱及板件編號對照'],['Part ID','零件編號'],['Finished size · mm','完成尺寸 · 毫米'],['Material / thickness','物料／厚度'],['Sheet / workpiece','板材／板件編號'],['Switch workspace','切換工作模式'],
['Changes save in this browser.','改動會儲存喺此瀏覽器。'],['Saved in this browser · timber project & manual layout','已儲存木材專案及手動排位於此瀏覽器'],
['See every piece as you type.','一路輸入，一路睇到零件。'],['Parts tray','零件區'],['Click a part to edit / 點選修改尺寸','點選零件以修改尺寸'],['Add part','新增零件'],['Selected part','已選零件'],['No part selected','未選取零件'],['Stock type','板材種類'],['Thickness','厚度'],['Sheets','張數'],
['Lock grain along length','固定木紋沿長度方向'],['Fit','符合視窗'],['Top view','平面'],['Isometric','立體'],['Free area','可用空位'],['Selected','已選'],['Undo','撤銷'],['Clear placements','清空排位'],
['Start after the edge preparation shown in the cutting guide. Pieces separate after each pass; gaps are exaggerated. For shared passes, keep the listed workpieces aligned in their original sheet positions and move finished parts/offcuts out of the pass. Green = completed; red = current cut.','先按指引修邊。每刀後板件會分開；示意間距已放大。共用切割時，指定板件要按原板材位置對齊，並移開本刀以外已完成嘅零件及餘料。綠色＝已完成；紅色＝目前切割。'],
['All cut numbers are shown on the layout. Click a step to play the animation from that cut. Each measurement starts at the named workpiece’s left or top edge, to the finished edge. The guide identifies which workpieces to keep; kerf lies between them.','圖上已顯示全部切割編號，點選步驟即可由嗰一刀開始播放。尺寸由該板件左邊或上邊量至完成邊；指引會註明保留邊件板，鋸縫留喺兩邊板件之間。'],
['Rectangular guillotine planning · best of several placement orders, with no guarantee of a global optimum. The guide describes a geometric cutting order; confirm machine capacity, blade setup and workpiece support before cutting.','長方形直線切割排料：會比較多個方案，但不保證數學上嘅全局最優。指引顯示幾何切割次序；開料前請核對機台能力、鋸片設定及板件承托。'],
['Drawing','圖檔'],['Sheet size','板材尺寸'],['DXF drawing units','DXF 圖面單位'],['Import DXF / SVG','匯入 DXF／SVG'],['Load sample drawing','載入示範圖檔'],['Part gap','零件間距'],['Margin','留邊'],['Scale','比例'],['Parts','零件'],['Review','檢查'],['Arrange parts','自動排料'],['Continue improving','繼續優化'],['Stop','停止'],['Export current sheet','匯出目前板材'],['Download sheet ↓','下載板材圖 ↓'],['Cut shared sections once','共線段只切一次'],['Cut out selected offcuts','切出已選餘料'],['Minimum offcut short edge','餘料最短邊'],['Rotation search','旋轉角度級距'],['Free rotation','自由旋轉'],['Keep orientation','固定方向'],['Final step','最後一步'],['Support & credits','支援範圍及鳴謝'],
];
const lookup = new Map();
const normalize = (s) => s.replace(/\s+/g, ' ').trim();
for (const [en, zh] of pairs) for (const key of [en, zh, `${en} · ${zh}`, `${en} / ${zh}`, `${en} ${zh}`]) lookup.set(normalize(key), [en, zh]);
export function translateText(text) {
  const source = normalize(String(text)), pair = lookup.get(source);
  if (pair) return t(...pair);
  const mixed = source.match(/^(.+?)\s+[·/／]\s+(.+)$/);
  if (mixed && /[A-Za-z]/.test(mixed[1]) && !/[\u3400-\u9fff]/.test(mixed[1]) && /[\u3400-\u9fff]/.test(mixed[2])) return t(mixed[1], mixed[2]);
  return String(text);
}
const originals = new WeakMap();
let translating = false;
function translateDOM(root) {
  if (translating || !root) return;
  translating = true;
  try {
    for (const small of root.querySelectorAll?.('small,.local>span') || []) {
      const own = normalize([...small.parentElement.childNodes].filter(n => n.nodeType === 3).map(n => n.nodeValue).join(' '));
      const zh = normalize(small.textContent);
      if (/[A-Za-z]/.test(own) && !/[\u3400-\u9fff]/.test(own) && /[\u3400-\u9fff]/.test(zh) && !lookup.has(own)) { lookup.set(own, [own,zh]); lookup.set(zh,[own,zh]); }
    }
    for (const small of root.querySelectorAll?.('small,.local>span') || []) {
      const parent = small.parentElement, own = normalize([...parent.childNodes].filter((n) => n.nodeType === 3).map((n) => n.nodeValue).join(' ')), pair = lookup.get(own);
      if (pair && normalize(small.textContent) === normalize(pair[1])) { small.hidden = true; small.dataset.localeSecondary = ''; }
    }
    for (const element of root.querySelectorAll?.('[title],[aria-label]') || []) {
      if (element.closest('[data-user-content],[data-language-switch]')) continue;
      for (const attribute of ['title','aria-label']) { const value = element.getAttribute(attribute); if (value) element.setAttribute(attribute, translateText(value)); }
    }
    const walker = document.createTreeWalker(root, 4); let node;
    while ((node = walker.nextNode())) {
      if (!node.parentElement || node.parentElement.closest('script,style,input,textarea,svg,pre,code,[data-user-content],[data-language-switch],[data-locale-secondary]')) continue;
      const old = originals.get(node), source = old && node.nodeValue === old.output ? old.source : node.nodeValue;
      const output = translateText(source);
      originals.set(node, { source, output }); if (node.nodeValue !== output) node.nodeValue = output;
    }
  } finally { translating = false; }
}
function updateSwitch() { document.documentElement.lang = language; document.querySelectorAll('[data-set-language]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.setLanguage === language))); }
export function setLanguage(value) {
  if (!['en', 'zh-Hant'].includes(value)) return;
  language = value; try { globalThis.localStorage?.setItem(KEY, value); } catch {}
  if (typeof document !== 'undefined') { updateSwitch(); translateDOM(document.body); document.dispatchEvent(new document.defaultView.CustomEvent('paper-nest:languagechange', { detail: value })); translateDOM(document.body); }
}
function init() {
  const header = document.querySelector('.studio-header,.topbar,header');
  if (header && !header.querySelector('[data-language-switch]')) {
    const control = document.createElement('div'); control.className = 'language-switch'; control.dataset.languageSwitch = '';
    control.setAttribute('role', 'group'); control.setAttribute('aria-label', 'Language / 語言');
    control.innerHTML = '<button type="button" data-set-language="en">English</button><button type="button" data-set-language="zh-Hant">繁體中文</button>';
    control.onclick = (event) => { const button = event.target.closest('[data-set-language]'); if (button) setLanguage(button.dataset.setLanguage); }; header.append(control);
  }
  updateSwitch(); translateDOM(document.body);
  if (document.defaultView?.MutationObserver) new document.defaultView.MutationObserver((mutations) => {
    const roots = new Set(); for (const m of mutations) { if (m.type === 'characterData') roots.add(m.target.parentElement); else if (m.addedNodes.length) roots.add(m.target.nodeType === 1 ? m.target : m.target.parentElement); }
    for (const root of roots) translateDOM(root);
  }).observe(document.body, { childList: true, characterData: true, subtree: true });
}
if (typeof document !== 'undefined') { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init(); }
