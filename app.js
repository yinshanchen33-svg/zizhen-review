'use strict';
const { analyze, SOURCES, LIMIT, checkedAt } = globalThis.Compliance;
const { getEvidence, buildReport, copyReportText } = globalThis.ComplianceReport;
const $ = id => document.getElementById(id);
const samples = {
  claims: '这款收纳盒，全网第一的收纳神器！采用独家专利设计，100%无毒无害。经检测，收纳效率提升50%。仅限今日，买一送一！',
  plain: '这款桌面收纳盒采用可叠放设计，可用于整理文具、钥匙等小物。尺寸为20厘米×15厘米×10厘米，请根据实际空间选择。',
  special: '这款保健食品，帮助你开启活力每一天。'
};
let lastReport = null;
let modelAvailable = false;
let reviewController = null;
let maxInput = LIMIT;
const DEMO_TEXT = '这款收纳盒采用最佳设计，收纳效率提升50%，还搭载量子收纳技术。';
const initialResults = $('results').innerHTML;
// 所有用户文字只以 textContent / Text 节点渲染，禁止当作 HTML 执行。
function el(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}
function sourceLink(id, reference) {
  const source = SOURCES[id];
  if (!source) return el('p', 'muted', '需要人工核对：尚未确认相关官方依据。');
  const link = el('a', 'source-link', source.name + ' ↗');
  link.href = source.url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.referrerPolicy = 'no-referrer';
  link.append(el('small', '', reference));
  return link;
}
function resetResults() {
  reviewController?.abort();
  reviewController = null;
  lastReport = null;
  $('results').innerHTML = initialResults;
  $('result-status').replaceChildren();
  $('result-count').hidden = true;
  $('export').disabled = true;
  $('copy-report').disabled = true;
  $('copy-feedback').hidden = true;
  $('copy-feedback').textContent = '';
  $('export-text').value = '';
  if ($('export-dialog').open) $('export-dialog').close();
  updateMode();
}
function edited() {
  const length = Array.from($('copy').value).length;
  $('count').textContent = length.toLocaleString() + ' / '+maxInput.toLocaleString()+' 字符';
  $('count').classList.toggle('over-limit', length > maxInput);
  $('input-error').hidden = true;
  if (lastReport) {
    // 文案变化后删除旧结果，避免将旧结论误当作新结果，也禁止旧结果导出。
    resetResults();
    $('result-status').append(el('p', 'stale', '文案或商品范围已修改，请重新开始自查。'));
  }
}
function showError(message) {
  $('input-error').textContent = message;
  $('input-error').hidden = false;
  $('copy').focus();
}
function snippet(text, match) {
  const start = Math.max(0, match.start - 32), end = Math.min(text.length, match.end + 45);
  const quote = el('div', 'fragment');
  const position = Array.from(text.slice(0, match.start)).length + 1;
  quote.append(el('small', '', '原文片段 · 第 ' + position + ' 字符起'));
  quote.append(document.createTextNode((start ? '…' : '') + text.slice(start, match.start)));
  quote.append(el('mark', '', match.text));
  quote.append(document.createTextNode(text.slice(match.end, end) + (end < text.length ? '…' : '')));
  return quote;
}
function findingCard(finding, text, index) {
  const evidence = getEvidence(finding);
  const card = el('article', 'panel finding');
  card.classList.toggle('needs-manual', evidence.needsManual);
  const heading = el('div', 'finding-top');
  const title = el('div', 'finding-title');
  title.append(el('span', 'finding-kicker', '提示 ' + String(index + 1).padStart(2, '0') + ' · 风险类型'), el('h3', '', finding.type));
  heading.append(title, el('span', 'risk-tag', evidence.needsManual ? '需要人工核对' : '待人工核实'));
  card.append(heading);
  card.append(el('h4', 'detail-label', '对应原文'));
  finding.matches.forEach(match => card.append(snippet(text, match)));
  card.append(el('h4', 'detail-label explanation-label', '解释'));
  card.append(el('p', 'explanation', finding.explanation));
  const columns = el('div', 'finding-columns'), sources = el('div', 'evidence-section'), questions = el('div', 'questions-section');
  sources.append(el('h4', 'detail-label', '依据来源'));
  if (evidence.needsManual) {
    const notice = el('div', 'evidence-warning');
    notice.append(el('strong', '', '需要人工核对'), el('p', '', '未确认完整、可靠的对应依据。本项仅提示核查，不生成法规结论，不提供推测条文或链接。'));
    sources.append(notice);
  }
  evidence.sources.forEach(source => {
    sources.append(sourceLink(source.id, source.reference), el('p', 'source-meta', source.publisher + ' · ' + source.version));
  });
  if (evidence.sources.length) sources.append(el('p', 'source-caveat', '链接核对：' + checkedAt + ' · 仅供定位，具体适用性仍需人工核对。'));
  questions.append(el('h4', 'detail-label', '人工核查问题'));
  const list = el('ul', 'questions');
  finding.questions.forEach(question => list.append(el('li', '', question)));
  questions.append(list);
  columns.append(sources, questions);
  const rewrite = el('div', 'rewrite');
  rewrite.append(el('h4', 'detail-label', '更谨慎的改写建议'), el('p', '', finding.rewrite), el('small', '', '改写是方向提示；请先核实事实，勿直接发布含占位符的文字。'));
  card.append(columns, rewrite);
  return card;
}
function renderReport(report) {
  updateMode();
  const { result, text } = report;
  $('results').replaceChildren();
  $('result-status').replaceChildren();
  const modeLabels = {
    demo:'本次结果：本地规则演示 · 未调用大语言模型',
    'model-pending':'本地规则已完成，正在等待模型补充。尚未收到模型结果。',
    'model-assisted':'本次结果：规则初筛 + 模型辅助 · 模型补充项需要人工核对',
    'demo-fallback':'模型调用未完成或输出未通过校验，已回退本地规则。以下不包含模型结果。'
  };
  $('result-status').append(el('p','report-mode',modeLabels[report.mode] || modeLabels.demo));
  if(report.modelMessage) $('result-status').append(el('p','result-summary',report.modelMessage));
  if(report.modelStatus === 'unavailable') $('result-status').append(el('p','muted','模型暂不可用，本次使用本地规则。'));
  $('result-count').hidden = result.status !== 'complete';
  $('result-count').textContent = result.findings.length + ' 类';
  if (result.status === 'out-of-scope') {
    const block = el('div', 'blocked');
    block.append(el('h3', '', '请先确认商品范围，本次未执行普通商品自查。'));
    block.append(el('p', '', '选择的类别或文字中出现了特殊品类线索。本原型不能判断其真实类别，也不对特殊商品给出普通商品改写建议。'));
    result.specialMatches.forEach(match => block.append(snippet(text, match)));
    block.append(el('p', '', '请依据产品标签、许可或注册资料确认类别，并转交相应专业人员。关键词可能来自否定或引用，请人工确认；不要为绕过提示删除真实品类信息。'));
    $('results').append(block);
    $('result-status').append(el('p', 'sr-only', '本次文案超出范围或分类不明确，未执行自查。'));
    return;
  }
  const total = result.findings.reduce((sum, f) => sum + f.matches.length, 0);
  const message = total ? '发现 ' + result.findings.length + ' 类待核查提示，共 ' + total + ' 处匹配（同一片段可能关联多类）。这不代表违法认定。' : '未命中当前规则，不代表文案合规。请继续人工核实商品事实、证据和适用规则。';
  $('result-status').append(el('p', 'result-summary', message));
  if (!total) {
    const empty = el('div', 'empty-state');
    empty.append(el('h3', '', '仍然需要完成一次人工复核'), el('p', '', '确认材质、尺寸、价格、用途等与实际一致，并核对是否属于本工具的适用范围。'));
    $('results').append(empty);
  }
  const preview = el('details', 'original-preview');
  preview.append(el('summary', '', '查看本次自查的完整原文'), el('pre', '', text));
  $('results').append(preview);
  result.findings.forEach((finding, index) => $('results').append(findingCard(finding, text, index)));
  if (total) $('results').append(el('p', 'muted', '关键词规则可能误报或漏报，无法核实证明材料。其他未被标记的内容也需要复核。以上依据仅作定位参考，具体适用及现行有效性需要人工核对。'));
}
$('copy').addEventListener('input', edited);
$('category').addEventListener('change', edited);
$('clear').addEventListener('click', () => {
  $('copy').value = '';
  $('category').value = 'ordinary';
  resetResults(); edited(); $('copy').focus();
});
document.querySelectorAll('[data-sample]').forEach(button => button.addEventListener('click', () => {
  $('copy').value = samples[button.dataset.sample];
  $('category').value = 'ordinary';
  edited(); $('copy').focus();
}));
$('check-form').addEventListener('submit', async event => {
  event.preventDefault();
  const text = $('copy').value, category = $('category').value;
  const result = analyze(text, category);
  resetResults();
  if(Array.from(text).length>maxInput) return showError('单次最多 '+maxInput+' 个字符，请缩短后重试。');
  const errors = { empty: '请先输入需要自查的中文宣传文案。', 'too-long': '文案超过 5,000 字符，请缩短后重试；不会截断文案或给出不完整结果。', 'unsupported-language': '本原型仅处理包含中文的文字宣传文案，请确认输入内容。' };
  if (errors[result.status]) return showError(errors[result.status]);
  $('input-error').hidden = true;
  lastReport = { text, category, result, mode:'demo' };
  renderReport(lastReport);
  $('export').disabled = false;
  $('copy-report').disabled = false;
  if(!$('use-model').checked || !modelAvailable || result.status !== 'complete') return;
  const snapshot=lastReport;
  snapshot.mode='model-pending';
  renderReport(snapshot);
  $('export').disabled=true;
  $('copy-report').disabled=true;
  const controller=new AbortController();reviewController=controller;
  const timer=setTimeout(()=>controller.abort(),25000);
  try {
    const response=await fetch('/api/analyze', {method:'POST',credentials:'same-origin',
      headers:{'Content-Type':'application/json','X-Review-Client':'zizhen'},
      body:JSON.stringify({text,category,useModel:true}),signal:controller.signal});
    const report=await response.json();
    if(lastReport!==snapshot) return;
    if(!response.ok) {
      const messages={busy:'已有模型请求处理中，请等待后再试。',invalid_input:'输入超过限制或格式不正确，请检查文案。'};
      const error=new Error('request_failed');error.userMessage=messages[report.code] || '服务暂时不可用，请稍后再试。';throw error;
    }
    if(report.text!==text || !Array.isArray(report.result?.findings) || !['demo','demo-fallback','model-assisted'].includes(report.mode)) throw new Error('invalid_report');
    if(lastReport!==snapshot) return;
    lastReport=report;
  } catch(error) {
    if(lastReport!==snapshot) return;
    lastReport={text,category,result,mode:'demo-fallback',modelStatus:'failed',modelMessage:error.userMessage || '网络中断或请求超时，未取得模型结果。已保留规则提示；如请求已送出，供应商可能已计费，不会自动重试。'};
  } finally {clearTimeout(timer);if(reviewController===controller) reviewController=null;}
  if(lastReport.text!==text || lastReport.category!==category) return;
  renderReport(lastReport);
  $('export').disabled=false;
  $('copy-report').disabled=false;
});
function updateMode() {
  const enabled=modelAvailable && $('use-model').checked;
  const resultMode=lastReport?.mode;
  $('runtime-mode').textContent=enabled ? resultMode==='demo-fallback'?'当前结果：本地规则（模型未完成）':resultMode==='model-assisted'?'当前模式：规则初筛 + 模型辅助':resultMode==='model-pending'?'当前模式：等待模型响应':'当前选项：模型辅助复核（待调用）' : '当前模式：本地规则演示';
  $('privacy-note').textContent=enabled?'文案将发送至外部模型服务，请勿提交敏感信息。':'文案仅在本页处理，不上传。';
}
$('use-model').addEventListener('change',()=>{edited();updateMode();});
$('load-demo').addEventListener('click',()=>{
  $('use-model').checked=false;updateMode();
  $('copy').value=DEMO_TEXT;$('category').value='ordinary';edited();$('copy').focus();
});
async function loadMode() {
  if(location.protocol==='file:') {updateMode();return;}
  try {
    const response=await fetch('/api/config',{cache:'no-store',signal:AbortSignal.timeout(5000)});
    if(!response.ok) throw new Error();
    const config=await response.json();modelAvailable=config.mode==='model-available';
    if(Number.isInteger(config.maxInput) && config.maxInput>0 && config.maxInput<=LIMIT) maxInput=config.maxInput;
    $('input-hint').textContent='最多 '+maxInput.toLocaleString()+' 字符';
    edited();
  } catch {
    modelAvailable=false;
    $('service-status').textContent='暂时无法连接在线服务，仍可使用本地规则演示。';
  }
  $('use-model').disabled=!modelAvailable;updateMode();
}
loadMode();
function openReportDialog(report, message = '') {
  $('export-text').value = buildReport(report);
  $('export-feedback').textContent = message;
  if (!$('export-dialog').open) $('export-dialog').showModal();
}
$('export').addEventListener('click', () => {
  if (lastReport) openReportDialog(lastReport);
});
async function copyCurrentReport() {
  if (!lastReport) return;
  const snapshot = lastReport;
  $('copy-report').disabled = true;
  $('copy-dialog-report').disabled = true;
  const copied = await copyReportText(buildReport(snapshot), navigator.clipboard);
  // 用户在等待系统剪贴板期间改了文案，不能让旧报告的状态覆盖新页面。
  $('copy-dialog-report').disabled = false;
  if (lastReport !== snapshot) return;
  $('copy-report').disabled = false;
  $('copy-feedback').hidden = false;
  $('copy-feedback').textContent = copied ? '报告已复制，包含原文、核查提示、依据链接和人工核查问题。' : '无法自动复制，已打开报告，请全选后手动复制。';
  if (copied && $('export-dialog').open) $('export-feedback').textContent = '报告已复制。';
  if (!copied) {
    openReportDialog(snapshot, '浏览器未允许自动复制。已全选，请按 ⌘C（Mac）或 Ctrl+C（Windows）复制。');
    $('export-text').focus();
    $('export-text').select();
  }
}
$('copy-report').addEventListener('click', copyCurrentReport);
$('copy-dialog-report').addEventListener('click', copyCurrentReport);
$('close-export').addEventListener('click', () => $('export-dialog').close());
$('select-report').addEventListener('click', () => {
  $('export-text').focus();
  $('export-text').select();
  $('export-feedback').textContent = '已全选，请按 ⌘C（Mac）或 Ctrl+C（Windows）复制。';
});
$('download-report').addEventListener('click', () => {
  const blob = new Blob(['\uFEFF' + $('export-text').value], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob), a = el('a');
  a.href = url; a.download = '字斟-文案自查清单.txt';
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  $('export-feedback').textContent = '已发起下载。若没有收到文件，可点击“全选清单”后复制。';
});
Object.entries(SOURCES).forEach(([id, source]) => {
  const card = el('article', 'panel source-card');
  card.append(el('h2', '', source.name), el('p', '', source.publisher + ' · ' + source.version), el('small', '', '官方页面人工核对于 ' + checkedAt));
  card.append(sourceLink(id, '打开原始发布页面，请结合完整文本核对适用性。'));
  $('source-list').append(card);
});
function navigate() {
  const view = ['check','sources','guide'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'check';
  document.querySelectorAll('.view').forEach(section => section.hidden = section.id !== 'view-' + view);
  document.querySelectorAll('.nav-link').forEach(link => {
    const active = link.dataset.view === view;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  });
}
window.addEventListener('hashchange', navigate);
navigate();
