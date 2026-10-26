import { getLanguage } from './locale.js?v=0.26.4';
const n = (value) => Number(value.toFixed(2)).toLocaleString('en-GB', { maximumFractionDigits: 2 });
const choose = (lang, en, zh) => lang === 'zh-Hant' ? zh : en;
const edgeZh = { left: '左', right: '右', top: '上', bottom: '下' };
// Table saw: the distance and the edge that rides the fence.
const fenceAt = (c) => c.fence ?? c.offset, fenceEdge = (c) => c.fenceFrom || (c.axis === 'x' ? 'left' : 'top');
export function cutDescription(c, lang = getLanguage()) {
  const fence = c.saw === 'table' && c.fenceRepeat ? choose(lang, ' · fence unchanged', ' · 鋸導尺不變') : '';
  const machine = c.hybrid ? (c.saw === 'table' ? choose(lang, 'Table saw · ', '檯鋸 · ') : choose(lang, 'Panel saw · ', '板鋸 · ')) : '';
  return machine + describe(c, lang) + fence;
}
function describe(c, lang) {
  if (c.segments?.length > 1 && c.saw === 'table') return choose(lang, `Fence at ${n(fenceAt(c))} mm · ${c.segments.length} pieces, one after another`, `鋸導尺定喺 ${n(fenceAt(c))} 毫米 · 逐件切 ${c.segments.length} 件`);
  if (c.saw === 'table') return choose(lang, `${c.axis === 'x' ? 'Crosscut' : 'Rip cut'} · fence at ${n(fenceAt(c))} mm from the ${fenceEdge(c)} edge`, `${c.axis === 'x' ? '橫紋切割' : '順紋切割'} · 鋸導尺 ${n(fenceAt(c))} 毫米（${edgeZh[fenceEdge(c)]}邊靠鋸導尺）`);
  if (c.segments?.length > 1) return choose(lang, `Shared ${c.axis === 'x' ? 'vertical' : 'horizontal'} pass · ${c.segments.length} aligned workpieces`, `共用${c.axis === 'x' ? '垂直' : '水平'}切割 · 對齊 ${c.segments.length} 件板件`);
  return choose(lang, `${c.axis === 'x' ? 'Crosscut' : 'Rip cut'} at ${n(c.offset)} mm from ${c.axis === 'x' ? 'left' : 'top'} edge`, `${c.axis === 'x' ? '橫紋切割' : '順紋切割'}：由${c.axis === 'x' ? '左邊' : '上邊'}量 ${n(c.offset)} 毫米`);
}
export function cutDetail(c, lang = getLanguage()) {
  const move = c.machineChange ? choose(lang, 'Move the pieces to the table saw. ', '將板件搬去檯鋸。') : '';
  return move + detail(c, lang);
}
function detail(c, lang) {
  const edgeList = c.edgeParts?.slice(0, 6).join(', ') + (c.edgeParts?.length > 6 ? choose(lang, ` … (+${c.edgeParts.length - 6} more)`, `…（另有 ${c.edgeParts.length - 6} 件）`) : '');
  const shared = c.edgeParts?.length > 1 ? choose(lang, ` One straight cut sets matching edges for ${edgeList}.`, ` 一刀直線切割，同時完成 ${edgeList} 嘅對齊邊。`) : '';
  const released = c.releasedParts?.length > 1 ? choose(lang, ` This cut releases ${c.releasedParts.join(' + ')} together.`, ` 呢一刀同時分出 ${c.releasedParts.join(' ＋ ')}。`) : '';
  if (c.segments?.length > 1 && c.saw === 'table') return choose(lang,
    `Set the fence once at ${n(fenceAt(c))} mm and feed each piece separately: ${c.segments.map((s) => `${s.workpiece} (${n(s.w)} × ${n(s.h)} mm, ${fenceEdge(s)} edge against the fence)`).join('; ')}. Ready after step ${c.prerequisite}.`,
    `鋸導尺定喺 ${n(fenceAt(c))} 毫米一次，逐件推過：${c.segments.map((s) => `${s.workpiece}（${n(s.w)} × ${n(s.h)} 毫米，${edgeZh[fenceEdge(s)]}邊靠鋸導尺）`).join('；')}。先完成第 ${c.prerequisite} 刀。`) + shared + released;
  if (c.saw === 'table') return choose(lang, `Workpiece ${c.workpiece} (${n(c.w)} × ${n(c.h)} mm), ${fenceEdge(c)} edge against the fence → ${c.first}${c.second ? ' + ' + c.second : ' + kerf waste'}. ${c.prerequisite ? 'Available after step ' + c.prerequisite + '.' : 'Start from the trimmed sheet.'}`, `板件 ${c.workpiece}（${n(c.w)} × ${n(c.h)} 毫米），${edgeZh[fenceEdge(c)]}邊靠鋸導尺 → ${c.first}${c.second ? ' ＋ ' + c.second : ' ＋ 鋸縫廢料'}。${c.prerequisite ? '先完成第 ' + c.prerequisite + ' 刀。' : '由修邊後嘅整張板開始。'}`) + shared + released;
  if (c.segments?.length > 1) return choose(lang,
    `Keep ${c.segments.map((s) => s.workpiece).join(', ')} aligned in their original sheet positions and cut in one straight pass. Set aside finished parts and offcuts outside this pass. Measurements: ${c.segments.map((s) => `${s.workpiece}: ${n(s.offset)} mm from ${s.axis === 'x' ? 'left' : 'top'} edge`).join('; ')}. Ready after step ${c.prerequisite}.`,
    `將 ${c.segments.map((s) => s.workpiece).join('、')} 按原板材位置對齊，一次直線切過；先移開本刀以外已完成嘅零件及餘料。各板件量度：${c.segments.map((s) => `${s.workpiece}：由${s.axis === 'x' ? '左' : '上'}邊量 ${n(s.offset)} 毫米`).join('；')}。先完成第 ${c.prerequisite} 刀。`) + shared + released;
  return choose(lang, `Workpiece ${c.workpiece} (${n(c.w)} × ${n(c.h)} mm) → ${c.first}${c.second ? ' + ' + c.second : ' + kerf waste'}. ${c.prerequisite ? 'Available after step ' + c.prerequisite + '.' : 'Start from the trimmed sheet.'}`, `板件 ${c.workpiece}（${n(c.w)} × ${n(c.h)} 毫米）→ ${c.first}${c.second ? ' ＋ ' + c.second : ' ＋ 鋸縫廢料'}。${c.prerequisite ? '先完成第 ' + c.prerequisite + ' 刀。' : '由修邊後嘅整張板開始。'}`) + shared + released;
}
export function cutRetain(c, lang = getLanguage()) {
  if (c.segments?.length > 1) return c.segments.map((segment) => `${segment.workpiece}: ${cutRetain(segment, lang)}`).join(' ');
  const w = c.axis === 'x' ? c.offset : c.w, h = c.axis === 'y' ? c.offset : c.h;
  const secondW = c.axis === 'x' ? c.w - c.offset - c.kerf : c.w;
  const secondH = c.axis === 'y' ? c.h - c.offset - c.kerf : c.h;
  if (c.secondPartCount > 0 && c.firstPartCount > 0) return choose(lang,
    `Keep both workpieces: ${c.first} (${n(w)} × ${n(h)} mm) and ${c.second} (${n(secondW)} × ${n(secondH)} mm). Saw kerf: ${n(c.kerf)} mm between them.`,
    `兩邊板件都保留：${c.first}（${n(w)} × ${n(h)} 毫米）及 ${c.second}（${n(secondW)} × ${n(secondH)} 毫米）；中間鋸縫 ${n(c.kerf)} 毫米。`);
  if (c.secondPartCount > 0 && c.firstPartCount === 0) return choose(lang,
    `Keep the ${c.axis === 'x' ? 'right' : 'bottom'} workpiece ${c.second} (${n(secondW)} × ${n(secondH)} mm). ${c.first} is an offcut; saw kerf is ${n(c.kerf)} mm between them.`,
    `保留${c.axis === 'x' ? '右邊' : '下邊'}板件 ${c.second}（${n(secondW)} × ${n(secondH)} 毫米）；${c.first} 為餘料，中間鋸縫 ${n(c.kerf)} 毫米。`);
  return choose(lang, `Retain ${n(w)} × ${n(h)} mm as ${c.first}. Saw kerf: ${n(c.kerf)} mm on the ${c.axis === 'x' ? 'right' : 'bottom'} waste side.`, `保留 ${n(w)} × ${n(h)} 毫米，標記 ${c.first}。鋸縫 ${n(c.kerf)} 毫米留喺${c.axis === 'x' ? '右側' : '下側'}廢料邊。`);
}
export function trimGuide(sheet, settings, lang = getLanguage()) {
  const trim = settings.trim;
  if (trim) return choose(lang, `Prepare first: trim ${n(trim)} mm from each of the four raw edges, including kerf in the removed strip. Finished starting panel: ${n(sheet.root.w)} × ${n(sheet.root.h)} mm. Label it S${sheet.number}; stock grain runs along its length →.`, `準備：四邊各修去 ${n(trim)} 毫米，鋸縫包括喺修走嘅邊條內。完成後起始板材尺寸為 ${n(sheet.root.w)} × ${n(sheet.root.h)} 毫米，標記 S${sheet.number}；木紋沿長度方向 →。`);
  return choose(lang, `Start with the full ${n(sheet.stock.length)} × ${n(sheet.stock.width)} mm panel, labelled S${sheet.number}. Stock grain runs along its length →.`, `由完整 ${n(sheet.stock.length)} × ${n(sheet.stock.width)} 毫米板材開始，標記 S${sheet.number}；木紋沿長度方向 →。`);
}

export function cutEfficiency(sheet, lang = getLanguage()) {
  const shared = sheet.cuts.filter((c) => c.segments?.length > 1).length;
  const saved = sheet.cutReduction || 0;
  if (sheet.saw === 'hybrid') {
    const panel = sheet.cuts.filter((c) => c.saw === 'panel').length, table = sheet.cuts.length - panel;
    return choose(lang, `Hybrid · ${panel} panel-saw passes break the sheet down, then ${table} table-saw steps with ${sheet.fenceSettings ?? table} fence settings.`, `混合 · 先用板鋸切 ${panel} 刀拆開大板，再用檯鋸做 ${table} 步，只需設定鋸導尺 ${sheet.fenceSettings ?? table} 次。`);
  }
  if (sheet.cuts[0]?.saw === 'table') {
    const feeds = sheet.cuts.reduce((n, c) => n + (c.segments?.length || 1), 0);
    const settings = sheet.fenceSettings ?? sheet.cuts.length;
    return choose(lang, `Table saw · ${feeds} pieces fed through the saw with ${settings} fence settings. Steps that list several pieces use one setting for all of them.`, `檯鋸 · 共推 ${feeds} 次，只需設定鋸導尺 ${settings} 次。一步有多件時，全部用同一設定。`);
  }
  return choose(lang,
    `Fewer cuts first · ${shared} shared passes across aligned workpieces.${saved ? ` ${saved} redundant cuts removed from the initial placement sequence.` : ''}`,
    `優先減少切割 · ${shared} 刀共用直線切割，指定板件需按原位置對齊。${saved ? `較原本逐件排位次序減少 ${saved} 刀。` : ''}`);
}
