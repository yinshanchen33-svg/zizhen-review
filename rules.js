/* 可维护的本地规则库。无网络请求；规则命中只表示需要复核。 */
(function (root) {
  'use strict';

  // normalizeForMatch：剥离空白与零宽字符后返回归一化文本，并保留每个归一化字符
  // 到原文的起始索引映射，以便把归一化文本上的匹配还原到原文位置。
  // 目的：防止"最 佳""最\u200b佳"等插入空白/零宽字符绕过规则匹配（R14/R15）。
  function normalizeForMatch(text) {
    const out = [];
    const map = [];
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (/\s/.test(ch) || ch === '\u200b' || ch === '\u200c' || ch === '\u200d' || ch === '\ufeff') continue;
      out.push(ch);
      map.push(i);
    }
    return { text: out.join(''), map };
  }

  // mapBack：将归一化文本上的 [start,end) 还原为原文的 [start,end) 闭开区间。
  function mapBack(map, start, end) {
    if (start >= map.length) return null;
    const s = map[start];
    const e = end < map.length ? map[end] : (map[map.length - 1] + 1);
    return [s, e];
  }

  // verifiedRefs：2026-10-14 人工打开官方文件逐条核对的条项（见 evaluation/SOURCE_AUDIT.md）。
  // getEvidence 仅接受核对清单内的条号，防止虚构条号或仅凭域名通过。
  const SOURCES = {
    ad: { name: '中华人民共和国广告法', version: '2021 年修正文本', publisher: '国家市场监督管理总局', url: 'https://www.samr.gov.cn/zw/zfxxgk/fdzdgknr/fgs/art/2023/art_5474cf75173c45d6a0379730fb4e8d97.html', verifiedRefs: ['第四条', '第八条', '第九条第二项', '第九条第三项', '第十一条', '第十二条', '第十三条', '第十七条', '第二十八条', '第三十三条', '第三十八条'] },
    absolute: { name: '广告绝对化用语执法指南', version: '2023 年第 6 号公告', publisher: '国家市场监督管理总局', url: 'https://www.samr.gov.cn/zw/zfxxgk/fdzdgknr/ggjgs/art/2023/art_64279265c896452f8f638f2de12b8003.html', verifiedRefs: ['第二、五至七项'] },
    citation: { name: '广告引证内容执法指南', version: '2026 年第 20 号公告', publisher: '国家市场监督管理总局', url: 'https://www.samr.gov.cn/zw/zfxxgk/fdzdgknr/ggjgs/art/2026/art_8962fc1e4eb44a87b93d265af43b6940.html', verifiedRefs: ['第三至九、十二至十八项'] }
  };
  const RULES = [
    { id: 'absolute', type: '绝对化与比较表述', pattern: /国家级|最高级|最佳|最[好强优]|顶级|全网第一|销量第一|排名第一|全国第一|第一品牌|全网最低|最低价|独一无二|全球唯一|行业领先/g,
      explanation: '这类表述需要结合指向、比较范围和语境核查，不能仅凭一个词作出判断。', refs: [['ad', '第九条第三项'], ['absolute', '第二、五至七项']],
      questions: ['比较的是哪些商品，时间和地域范围是什么？', '是否属于同品牌自我比较、消费提示或其他特定语境？是否有真实材料支持？'],
      rewrite: '删除无依据的最高程度或排名表达，改为已核实的具体特点：采用［已核实的结构或材质］，适用于［实际用途］。' },
    { id: 'promise', type: '效果与安全保证', pattern: /(?<![0-9０-９])100\s*[%％]|(?<![0-9０-９])１００\s*[%％]|百分之百|绝对安全|零风险|零刺激|无毒无害|永不|永久|终身不坏|终身|彻底|保证有效|立刻见效|一用就|完全无害/g,
      explanation: '无条件的效果或安全承诺可能让消费者忽略实际限制，应复核证据与使用条件。', refs: [['ad', '第四条、第八条、第二十八条']],
      questions: ['承诺能覆盖哪些使用条件、人群和期限？', '是否有足以支持该表述的证据？“100%”是成分比例还是效果保证？'],
      rewrite: '删除无法证实的保证；仅在证据支持时描述具体功能，并清楚说明使用方法、适用范围与限制。' },
    { id: 'data', type: '数据与引证依据', pattern: /[0-9０-９]+(?:[.．][0-9０-９]+)?\s*[%％]|百分之[零一二三四五六七八九十百千万]+|(?:提升|提高|降低|减少|增长)[^，。！？；\n]{0,8}[0-9一二三四五六七八九十]+倍|研究表明|实验表明|检测证实|经检测|销量第[一二三]|销量全网第[一二三]|[0-9]+万(?:人|用户|销量)|好评率/g,
      explanation: '数字和研究结论需要核实来源与适用条件；区分第三方引证与广告主自证，不能只看有无出处。', refs: [['ad', '第十一条、第二十八条'], ['citation', '第三至九、十二至十八项']],
      questions: ['是第三方或受委托机构出具，还是自行取得的数据？材料是否真实、可验证？', '样品、方法、时间和适用范围是否支持文案？引证是否清楚标明出处及限制？'],
      rewrite: '无材料时删除数字和研究结论。有材料时按原结论表述，并补充实际适用条件；第三方引证请标明可查询的出处。' },
    { id: 'medical', type: '疾病治疗相关表述', pattern: /治疗|治愈|根治|疗效|药效|消炎|抗炎|止痛|降血压|降血糖|预防疾病|改善失眠|缓解关节炎/g,
      explanation: '普通日用品出现治疗功能或医疗用语，需要重点核实商品类别及宣传边界。', refs: [['ad', '第十七条']],
      questions: ['商品实际类别是什么，是否已超出普通日用品范围？', '是否将日常使用体验描述成疾病治疗作用？'],
      rewrite: '请先核对商品类别：普通日用品不应宣传疾病治疗作用（否定性说明除外），仅保留可核实的日常用途；若实际为特殊商品，请转交相应专业审查。' },
    { id: 'authority', type: '机关名义与认证表述', pattern: /国家认证|国家推荐|国家机关推荐|政府推荐|官方指定|官方认证|权威认证|专家推荐|免检产品/g,
      explanation: '机关名义、认证或推荐容易被理解为背书，需要核实主体、性质及实际授权范围。', refs: [['ad', '第九条第二项、第四条、第二十八条'], ['ad', '第三十八条']],
      questions: ['具体由谁认证或推荐？证书、授权及有效范围能否核实？', '是否涉及国家机关名义？普通检测是否被扩大表述为认证或推荐？'],
      rewrite: '删除无依据的背书；确有适用证明时，仅准确说明证明名称、出具主体和范围，且仍需核对能否用于宣传。' },
    { id: 'promotion', type: '价格与促销条件', pattern: /原价|现价|限时|仅限今日|最后[一二三四五六七八九十0-9]+件|买[一二三0-9]+送[一二三0-9]+|免费|赠送|全场[一二三四五六七八九0-9.]+折|到手价/g,
      explanation: '优惠、赠品与价格描述需要清楚对应实际活动，避免遗漏重要条件。', refs: [['ad', '第八条、第二十八条']],
      questions: ['活动期限、适用商品、门槛、库存及赠品规格是否清楚？', '价格和库存是否真实、有记录可查？是否另需核对专门价格规则？'],
      rewrite: '按真实活动写明：［商品］在［开始与结束时间］按［条件］享受［实际优惠］；赠品为［品种、规格、数量及领取方式］。' },
    { id: 'patent', type: '专利信息', pattern: /专利|独家专利/g,
      explanation: '涉及专利的宣传，需要核对权利状态和展示信息。', refs: [['ad', '第十二条']],
      questions: ['是已授权专利还是申请？是否仍有效并覆盖该商品？', '是否正确标明专利号和专利种类？'],
      rewrite: '核实授权和有效状态后，准确列明专利种类、专利号及对应技术；没有有效授权依据时删除专利宣传。' },
    { id: 'disparage', type: '贬低其他商品', pattern: /同行都不行|其他品牌.{0,4}(垃圾|劣质|不行|差)|比竞品强百倍|吊打同行|碾压同行|竞品.{0,5}(垃圾|劣质)|别家.{0,8}(垃圾|劣质|不行)/g,
      explanation: '对其他商品的贬低性表达需要复核；提及其他品牌不等于贬低，需结合语境判断。', refs: [['ad', '第十三条']],
      questions: ['是否贬低了其他经营者的商品？', '能否改为介绍自身已核实的具体特点？'], rewrite: '若确属贬低其他商品，请改为陈述本商品有依据的材质、尺寸或使用方法；若属于否定引用或反例说明，请保留原意并注明语境。' },
    { id: 'uncertain', type: '概念性主张 · 需要人工核对', pattern: /量子|能量场|负能量|磁场养生|细胞激活|黑科技|纳米共振|气场|宇宙频率|充能/g,
      explanation: '规则识别到概念性表达，但无法确认与该具体主张相匹配的依据，需要人工核对。', refs: [],
      questions: ['概念具体指什么？是否有可验证的产品事实和适用规范？', '能否用清楚、可核实的普通语言解释？'], rewrite: '无法证实时删除该概念；改用已核实的结构、材质或使用方式，不补写未知功效。' }
  ];
  // 胶囊/药品仅在外观或包装语境以外才视为特殊商品线索（S03 胶囊形文具、S04 药品包装空盒）。
  const SPECIAL = /医疗器械|医用|医疗服务|处方药|非处方药|药品(?!包装)|保健食品|保健品|蓝帽子|国药准字|械注准|OTC|阿莫西林|布洛芬|胶囊(?![形状])|降压药|降糖药|特医食品|特殊医学用途|消毒液|消毒剂|消字号|化妆品|面霜|精华液|防晒霜|奶粉|营养补充剂|农药|兽药|香烟|电子烟|白酒|啤酒|饼干|饮料|血压计/gi;
  const LIMIT = 5000;
  function analyze(text, category = 'ordinary') {
    if (typeof text !== 'string' || !text.trim()) return { status: 'empty', findings: [] };
    if (Array.from(text).length > LIMIT) return { status: 'too-long', findings: [] };
    if (!/[\u3400-\u9fff]/.test(text)) return { status: 'unsupported-language', findings: [] };
    // 在剥离空白与零宽字符的归一化文本上匹配，再把位置还原到原文，
    // 防止"最 佳""最\u200b佳"等插入字符绕过初筛（R14/R15），同时保留原文片段。
    const { text: norm, map } = normalizeForMatch(text);
    const toOriginal = m => {
      const span = mapBack(map, m.index, m.index + m[0].length);
      return span ? { text: text.slice(span[0], span[1]), start: span[0], end: span[1] } : null;
    };
    const specialMatches = Array.from(norm.matchAll(new RegExp(SPECIAL.source, SPECIAL.flags)), toOriginal).filter(Boolean);
    if (category !== 'ordinary' || specialMatches.length) return { status: 'out-of-scope', findings: [], specialMatches };
    const findings = RULES.flatMap(rule => {
      const matches = Array.from(norm.matchAll(new RegExp(rule.pattern.source, rule.pattern.flags)), toOriginal).filter(Boolean);
      return matches.length ? [{ ...rule, pattern: undefined, matches }] : [];
    });
    return { status: 'complete', findings };
  }
  const api = { analyze, SOURCES, RULES, LIMIT, checkedAt: '2026-10-14' };
  root.Compliance = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
