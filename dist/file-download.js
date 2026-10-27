import { t } from './locale.js?v=0.32.2';
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
function viewerDownloads() {
  if (artifactDownloads === undefined) artifactDownloads = typeof window !== 'undefined' && typeof window.claude?.use === 'function' ? window.claude.use('downloads').catch(() => null) : Promise.resolve(null);
  return artifactDownloads;
}
export async function saveFile(contents, name, type, { picker = true, handle = null } = {}) {
  const blob = contents instanceof Blob ? contents : new Blob([contents], { type });
  const downloads = handle ? null : await viewerDownloads();
  if (downloads) {
    // Formats the viewer does not accept (e.g. .dxf) are offered as text: rename after saving.
    const filename = ALLOWED.test(name) ? name : name + '.txt';
    try {
      await downloads.save({ filename, data: blob });
      feedback(filename === name ? t(`Saved ${name}`, `已儲存 ${name}`) : t(`Saved as ${filename}. Remove ".txt" from the name to open it as ${name}.`, `已儲存為 ${filename}。將檔名尾嘅「.txt」刪走，就係 ${name}。`));
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
