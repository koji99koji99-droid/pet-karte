import { decodeSummary, renderSharedHtml } from './share.js';

const app = document.querySelector('#app');
async function render() {
  const match = location.hash.match(/^#d=([A-Za-z0-9_-]+)$/);
  if (!match) {
    app.innerHTML = '<h1>共有されたカルテを開けません</h1><p>リンクが空か、形式が正しくありません。飼い主にもう一度QRを見せてもらってください。</p>';
    return;
  }
  try {
    app.innerHTML = renderSharedHtml(await decodeSummary(match[1]));
  } catch (error) {
    app.innerHTML = '<h1>共有されたカルテを開けません</h1><p>リンクのデータが壊れているか、対応していない形式です。飼い主にもう一度QRを見せてもらってください。</p>';
  }
}
window.addEventListener('hashchange', render);
render();
