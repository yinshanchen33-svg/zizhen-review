/* 页面、复制与下载共用报告格式；只引用已登记的官方来源。 */
(function (root) {
  'use strict';
  const engine = typeof module !== 'undefined' && module.exports ? require('./rules.js') : root.Compliance;
  const { SOURCES, checkedAt } = engine;

  function getEvidence(finding, registry = SOURCES) {
    const refs = Array.isArray(finding.refs) ? finding.refs : [];
    const sources = refs.flatMap(([id, reference]) => {
      const source = registry[id];
      if (!source || !source.name || !reference) return [];
      // F04 防护：仅凭官方域名不够，来源文件必须经过人工逐条核对（具有 verifiedRefs 核对清单）。
      if (!Array.isArray(source.verifiedRefs) || !source.verifiedRefs.length) return [];
      try {
        const url = new URL(source.url);
        if (url.protocol !== 'https:' || url.hostname !== 'www.samr.gov.cn') return [];
      } catch { return []; }
      // F05 防护：引用条号必须落在人工核对过的范围内，防止真实来源下的虚构条号通过。
      const parts = String(reference).split('、');
      if (!parts.every(part => source.verifiedRefs.includes(part))) return [];
      const { verifiedRefs, ...publicFields } = source;
      return [{ ...publicFields, id, reference }];
    });
    // 登记来源不代表已核实个案适用性；缺失或不完整引用必须明确提示。
    return { sources, needsManual: !sources.length || sources.length !== refs.length };
  }

  function buildReport(report) {
    const { text, result } = report;
    const lines = [
      '字斟 · 商品宣传文案自查报告',
      '运行模式：' + (report.mode === 'model-assisted' ? '规则初筛 + 模型辅助；模型补充项需要人工核对' : report.mode === 'demo-fallback' ? '模型调用未完成，已回退本地规则（不含模型结果）' : '本地规则演示（未调用大语言模型）'),
      ...(report.modelMessage ? ['调用提示：'+report.modelMessage] : []),
      '仅限普通日用商品中文文字；仅为自查提示，不认定违法、不预测处罚。',
      '参考链接核对日期：' + checkedAt + '。具体适用性及现行有效性需要人工核对。',
      '', '完整原文：', text, ''
    ];
    if (result.status === 'out-of-scope') {
      lines.push('商品范围需要人工确认，未执行普通商品自查。请核对产品标签、许可或注册资料，转交相应专业人员。');
    } else {
      lines.push('待核查类型：' + result.findings.length + '；未命中不等于合规。');
      result.findings.forEach((finding, index) => {
        const evidence = getEvidence(finding);
        lines.push('', '提示 ' + (index + 1), '风险类型：' + finding.type,
          '依据状态：' + (evidence.needsManual ? '需要人工核对' : '有登记参考来源，具体适用性仍需人工核对'),
          '对应原文：');
        finding.matches.forEach(match => {
          const position = Array.from(text.slice(0, match.start)).length + 1;
          lines.push('「' + match.text + '」（第 ' + position + ' 字符起）');
        });
        lines.push('解释：' + finding.explanation, '依据来源：');
        evidence.sources.forEach(source => lines.push(
          source.name + ' / ' + source.reference,
          source.publisher + ' · ' + source.version,
          source.url
        ));
        if (evidence.needsManual) lines.push('需要人工核对：未确认完整、可靠的对应依据，不生成法规结论，不提供推测条文或链接。');
        lines.push('人工核查问题：', ...finding.questions.map((question, i) => (i + 1) + '. ' + question), '改写建议：' + finding.rewrite);
      });
    }
    lines.push('', '规则可能误报或漏报，无法验证商品与证据真实性。改写不保证合规，含占位符的文字不能直接发布。');
    return lines.join('\n');
  }

  async function copyReportText(text, clipboard) {
    if (!clipboard || typeof clipboard.writeText !== 'function') return false;
    try { await clipboard.writeText(text); return true; }
    catch { return false; }
  }

  const api = { getEvidence, buildReport, copyReportText };
  root.ComplianceReport = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
