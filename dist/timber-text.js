import { getLanguage } from './locale.js?v=0.23.0';
const n = (value) => Number(value.toFixed(2)).toLocaleString('en-GB', { maximumFractionDigits: 2 });
const choose = (lang, en, zh) => lang === 'zh-Hant' ? zh : en;
export function cutDescription(c, lang = getLanguage()) {
  return choose(lang, `${c.axis === 'x' ? 'Crosscut' : 'Rip cut'} at ${n(c.offset)} mm from ${c.axis === 'x' ? 'left' : 'top'} edge`, `${c.axis === 'x' ? '橫紋切割' : '順紋切割'}：由${c.axis === 'x' ? '左邊' : '上邊'}量 ${n(c.offset)} 毫米`);
}
export function cutDetail(c, lang = getLanguage()) {
  const edgeList = c.edgeParts?.slice(0, 6).join(', ') + (c.edgeParts?.length > 6 ? choose(lang, ` … (+${c.edgeParts.length - 6} more)`, `…（另有 ${c.edgeParts.length - 6} 件）`) : '');
  const shared = c.edgeParts?.length > 1 ? choose(lang, ` One straight cut sets matching edges for ${edgeList}.`, ` 一刀直線切割，同時完成 ${edgeList} 嘅對齊邊。`) : '';
  const released = c.releasedParts?.length > 1 ? choose(lang, ` This cut releases ${c.releasedParts.join(' + ')} together.`, ` 呢一刀同時分出 ${c.releasedParts.join(' ＋ ')}。`) : '';
  return choose(lang, `Workpiece ${c.workpiece} (${n(c.w)} × ${n(c.h)} mm) → ${c.first}${c.second ? ' + ' + c.second : ' + kerf waste'}. ${c.prerequisite ? 'Available after step ' + c.prerequisite + '.' : 'Start from the trimmed sheet.'}`, `板件 ${c.workpiece}（${n(c.w)} × ${n(c.h)} 毫米）→ ${c.first}${c.second ? ' ＋ ' + c.second : ' ＋ 鋸縫廢料'}。${c.prerequisite ? '先完成第 ' + c.prerequisite + ' 刀。' : '由修邊後嘅整張板開始。'}`) + shared + released;
}
export function cutRetain(c, lang = getLanguage()) {
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
  const shared = sheet.cuts.filter((c) => c.edgeParts?.length > 1).length;
  const saved = sheet.cutReduction || 0;
  return choose(lang,
    `Fewer cuts first · ${shared} straight cuts serve matching part edges.${saved ? ` ${saved} redundant cuts removed from the initial placement sequence.` : ''}`,
    `優先減少切割 · ${shared} 刀直線切割共用對齊邊。${saved ? `較原本逐件排位次序減少 ${saved} 刀。` : ''}`);
}
