import { t } from './locale.js?v=0.33.1';
const retained = [];
function feedback(text, link = null) {
  let box = document.getElementById('download-feedback');
  if (!box) { box = document.createElement('div'); box.id = 'download-feedback'; box.className = 'download-feedback'; box.setAttribute('role', 'status'); const main = document.querySelector('main'); if (main) main.before(box); else document.body.prepend(box); }
  box.hidden = false; box.replaceChildren();
  const message = document.createElement('span'); message.textContent = text; box.append(message);
  if (link) box.append(link);
  const close = document.createElement('button'); close.type = 'button'; close.textContent = '×'; close.setAttribute('aria-label', t('Dismiss download message', '關閉下載提示')); close.onclick = () => { box.hidden = true; }; box.append(close);
  return box;
}
// Inside a claude.ai artifact the page may not start downloads itself; the viewer's
// `downloads` capability offers the file instead (the viewer confirms each save).
// Elsewhere window.claude does not exist and nothing changes.
const ALLOWED = /\.(gif|png|jpe?g|webp|mp4|webm|txt|json|md|docx|pptx|epub|csv|ttf|html|svg|pdf|xlsx|zip)$/i;
let artifactDownloads;
// A .zip holding one file, stored without compression (any unzip tool opens it).
const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
export function zipOne(name, bytes) {
  let crc = 0xffffffff;
  for (const b of bytes) crc = CRC[(crc ^ b) & 0xff] ^ (crc >>> 8);
  crc = (crc ^ 0xffffffff) >>> 0;
  const file = new TextEncoder().encode(name), size = bytes.length;
  const local = new DataView(new ArrayBuffer(30)), central = new DataView(new ArrayBuffer(46)), end = new DataView(new ArrayBuffer(22));
  const now = new Date(), time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1), date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); local.setUint16(8, 0, true);
  local.setUint16(10, time, true); local.setUint16(12, date, true); local.setUint32(14, crc, true); local.setUint32(18, size, true); local.setUint32(22, size, true);
  local.setUint16(26, file.length, true); local.setUint16(28, 0, true);
  central.setUint32(0, 0x02014b50, true); central.setUint16(4, 20, true); central.setUint16(6, 20, true); central.setUint16(8, 0x0800, true); central.setUint16(10, 0, true);
  central.setUint16(12, time, true); central.setUint16(14, date, true); central.setUint32(16, crc, true); central.setUint32(20, size, true); central.setUint32(24, size, true);
  central.setUint16(28, file.length, true); central.setUint32(42, 0, true);
  const centralOffset = 30 + file.length + size;
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, 1, true); end.setUint16(10, 1, true); end.setUint32(12, 46 + file.length, true); end.setUint32(16, centralOffset, true);
  return new Blob([local, file, bytes, central, file, end], { type: 'application/zip' });
}
function viewerDownloads() {
  if (artifactDownloads === undefined) artifactDownloads = typeof window !== 'undefined' && typeof window.claude?.use === 'function' ? window.claude.use('downloads').catch(() => null) : Promise.resolve(null);
  return artifactDownloads;
}
export async function saveFile(contents, name, type, { picker = true, handle = null } = {}) {
  const blob = contents instanceof Blob ? contents : new Blob([contents], { type });
  const downloads = handle ? null : await viewerDownloads();
  if (downloads) {
    // The viewer only saves certain formats; a file in any other (e.g. .dxf) goes out
    // inside a .zip, which opens to the file under its own name and extension.
    const direct = ALLOWED.test(name);
    const filename = direct ? name : name.replace(/\.[^.]*$/, '') + '.zip';
    try {
      const data = direct ? blob : zipOne(name, new Uint8Array(await blob.arrayBuffer()));
      await downloads.save({ filename, data });
      feedback(direct ? t(`Saved ${name}`, `已儲存 ${name}`) : t(`Saved ${filename}. Open it to get ${name}.`, `已儲存 ${filename}，打開即可取得 ${name}。`));
      return { method: 'viewer', name: filename };
    } catch (error) {
      if (error?.code === 'declined') { feedback(t('Download cancelled.', '已取消下載。')); return { method: 'cancelled', name }; }
      if (error?.code === 'rate_limited') { feedback(t('A save prompt is already open. Try again in a moment.', '已經有一個儲存視窗，請稍後再試。')); return { method: 'cancelled', name }; }
      // Any other code: fall through to the ordinary download below.
    }
  }
  if (handle || (picker && typeof window.showSaveFilePicker === 'function')) {
    try {
      handle ||= await window.showSaveFilePicker({ suggestedName: name });
      const writer = await handle.createWritable(); await writer.write(blob); await writer.close();
      feedback(t(`Saved ${name}`, `已儲存 ${name}`)); return { method: 'picker', name };
    } catch (error) { if (error.name === 'AbortError') return { method: 'cancelled', name }; }
  }
  try {
    const url = URL.createObjectURL(blob); retained.push(url);
    // Keep the URL and its visible link alive; some browsers defer navigation.
    while (retained.length > 8) URL.revokeObjectURL(retained.shift());
    const link = document.createElement('a'); link.href = url; link.download = name; link.textContent = t(`Download ${name}`, `下載 ${name}`); link.dataset.downloadFile = '';
    const box = feedback(t('Your file is ready. If it did not save automatically, click the download link.', '檔案已準備好；如果未有自動儲存，請點選下載連結。'), link);
    const browser = document.createElement('a'); browser.href = window.location.href; browser.target = '_blank'; browser.rel = 'noopener'; browser.textContent = t('Open workspace in a browser tab', '在瀏覽器新分頁開啟工作區'); box.insertBefore(browser, box.lastChild);
    link.click(); return { method: 'download', name, url };
  } catch (error) {
    feedback(t(`Could not download the file: ${error.message}`, `未能下載檔案：${error.message}`)); return { method: 'error', name };
  }
}
if (typeof window !== 'undefined') window.addEventListener('pagehide', () => { for (const url of retained) URL.revokeObjectURL(url); retained.length = 0; });
