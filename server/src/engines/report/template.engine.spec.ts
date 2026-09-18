import {
  collectPlaceholders,
  renderBlocks,
  renderTemplate,
} from './template.engine.js';
import type { TemplateBlock } from './report.types.js';

describe('report/template.engine · renderTemplate', () => {
  describe('基本替换', () => {
    it('单个占位符', () => {
      const result = renderTemplate('你好，{昵称A}', { 昵称A: '小明' });
      expect(result.text).toBe('你好，小明');
      expect(result.missingKeys).toEqual([]);
    });

    it('多个占位符', () => {
      const result = renderTemplate('你和{昵称B}在{维度名}上的分差是{差值}分', {
        昵称B: '小红',
        维度名: '财务观与婚俗财务',
        差值: 18,
      });
      expect(result.text).toBe('你和小红在财务观与婚俗财务上的分差是18分');
      expect(result.missingKeys).toEqual([]);
    });

    it('同一占位符多次出现都被替换', () => {
      const result = renderTemplate('{昵称A}与{昵称A}的共识区', { 昵称A: '小明' });
      expect(result.text).toBe('小明与小明的共识区');
    });

    it('英文/数字/下划线键名同样支持', () => {
      const result = renderTemplate('{score} 分（{user_name} / {tag2}）', {
        score: 88,
        user_name: 'u1',
        tag2: 't',
      });
      expect(result.text).toBe('88 分（u1 / t）');
    });
  });

  describe('值类型', () => {
    it('数字与字符串都能渲染', () => {
      expect(renderTemplate('{n}分', { n: 75 }).text).toBe('75分');
      expect(renderTemplate('{s}', { s: '高共识' }).text).toBe('高共识');
    });

    it('数字 0 与空字符串视为已提供（仅 undefined / null 缺失）', () => {
      expect(renderTemplate('{n}', { n: 0 }).text).toBe('0');
      expect(renderTemplate('[{s}]', { s: '' }).text).toBe('[]');
    });
  });

  describe('缺失占位符', () => {
    it('默认原样保留，并记录缺失键', () => {
      const result = renderTemplate('你和{昵称B}在{维度名}上的分差是{差值}分', {
        昵称B: '小红',
      });
      expect(result.text).toBe('你和小红在{维度名}上的分差是{差值}分');
      expect(result.missingKeys).toEqual(['维度名', '差值']);
    });

    it('missingKeys 去重（同一缺失占位符多次出现只记一次）', () => {
      const result = renderTemplate('{x}-{x}-{y}-{x}', {});
      expect(result.text).toBe('{x}-{x}-{y}-{x}');
      expect(result.missingKeys).toEqual(['x', 'y']);
    });

    it('null 视为缺失，undefined 视为缺失', () => {
      const result = renderTemplate('{a}{b}', {
        a: null as unknown as string,
        b: undefined as unknown as number,
      });
      expect(result.text).toBe('{a}{b}');
      expect(result.missingKeys).toEqual(['a', 'b']);
    });
  });

  describe('strict 模式', () => {
    it('遇到缺失占位符抛错，错误信息包含缺失键名', () => {
      expect(() => renderTemplate('你和{昵称B}测的{维度名}', { 昵称B: '小红' }, { strict: true })).toThrow(
        /维度名/,
      );
    });

    it('参数齐全时不抛错', () => {
      expect(() => renderTemplate('{a}{b}', { a: '1', b: '2' }, { strict: true })).not.toThrow();
    });
  });

  describe('替换语法注入防护', () => {
    it('值中含 $& / $1 / $` / $\' / $$ 时必须完全原样', () => {
      const special = "A$&B$1C$`D$'E$$F";
      const result = renderTemplate('值={v};', { v: special });
      expect(result.text).toBe(`值=${special};`);
      expect(result.missingKeys).toEqual([]);
    });

    it('值中的 $& 不会被当成「整个匹配」回填', () => {
      expect(renderTemplate('{v}', { v: '$&' }).text).toBe('$&');
    });

    it('值中的 $1 不会被当成「捕获组」回填', () => {
      expect(renderTemplate('{v}', { v: '$1' }).text).toBe('$1');
    });

    it('同一模板里普通值 + 特殊值混合仍正确', () => {
      const result = renderTemplate('{名}的答案是{v}', { 名: '小明', v: "$'$&" });
      expect(result.text).toBe("小明的答案是$'$&");
    });
  });

  describe('容错（不抛错、原样保留）', () => {
    it('未闭合的 { 原样保留', () => {
      const result = renderTemplate('正在编辑 {维度名 未闭合', {});
      expect(result.text).toBe('正在编辑 {维度名 未闭合');
      expect(result.missingKeys).toEqual([]);
    });

    it('空 {} 原样保留', () => {
      const result = renderTemplate('空占位{}也不报错', {});
      expect(result.text).toBe('空占位{}也不报错');
      expect(result.missingKeys).toEqual([]);
    });

    it('纯文本模板原样返回', () => {
      const result = renderTemplate('先给共识区，再给待沟通区', {});
      expect(result.text).toBe('先给共识区，再给待沟通区');
      expect(result.missingKeys).toEqual([]);
    });

    it('含非法键字符（空格 / 标点）的括号不匹配', () => {
      const result = renderTemplate('{昵称 A} 与 {a-b} 不视为占位符', {});
      expect(result.text).toBe('{昵称 A} 与 {a-b} 不视为占位符');
      expect(result.missingKeys).toEqual([]);
    });
  });
});

describe('report/template.engine · renderBlocks', () => {
  const block = (over: Partial<TemplateBlock> & Pick<TemplateBlock, 'blockKey'>): TemplateBlock => ({
    orderNo: 0,
    templateText: '',
    ...over,
  });

  it('按 orderNo 升序渲染', () => {
    const blocks: TemplateBlock[] = [
      block({ blockKey: 'c', orderNo: 30, templateText: 'C' }),
      block({ blockKey: 'a', orderNo: 10, templateText: 'A' }),
      block({ blockKey: 'b', orderNo: 20, templateText: 'B' }),
    ];
    const rendered = renderBlocks(blocks, {});
    expect(rendered.map((r) => r.blockKey)).toEqual(['a', 'b', 'c']);
    expect(rendered.map((r) => r.text)).toEqual(['A', 'B', 'C']);
  });

  it('orderNo 相同时保持输入顺序（确定性）', () => {
    const blocks: TemplateBlock[] = [
      block({ blockKey: 'first', orderNo: 5, templateText: '1' }),
      block({ blockKey: 'second', orderNo: 5, templateText: '2' }),
      block({ blockKey: 'third', orderNo: 5, templateText: '3' }),
    ];
    expect(renderBlocks(blocks, {}).map((r) => r.blockKey)).toEqual(['first', 'second', 'third']);
  });

  it('不修改入参数组顺序', () => {
    const blocks: TemplateBlock[] = [
      block({ blockKey: 'b', orderNo: 2 }),
      block({ blockKey: 'a', orderNo: 1 }),
    ];
    renderBlocks(blocks, {});
    expect(blocks.map((r) => r.blockKey)).toEqual(['b', 'a']);
  });

  it('渲染使用同一上下文，并把缺失键聚合到各区块自身结果', () => {
    const blocks: TemplateBlock[] = [
      block({ blockKey: 'k1', orderNo: 1, templateText: '{共有}/{缺失A}' }),
      block({ blockKey: 'k2', orderNo: 2, templateText: '{共有}/{缺失B}' }),
    ];
    const rendered = renderBlocks(blocks, { 共有: 'X' });
    expect(rendered[0].text).toBe('X/{缺失A}');
    expect(rendered[0].missingKeys).toEqual(['缺失A']);
    expect(rendered[1].text).toBe('X/{缺失B}');
    expect(rendered[1].missingKeys).toEqual(['缺失B']);
  });

  it('strict 模式下任区块缺失即抛错', () => {
    const blocks: TemplateBlock[] = [
      block({ blockKey: 'k1', orderNo: 1, templateText: '{缺失}' }),
    ];
    expect(() => renderBlocks(blocks, {}, { strict: true })).toThrow(/缺失/);
  });

  describe('minChars 判定', () => {
    it('未设置下限（undefined / null）时为 true', () => {
      const rendered = renderBlocks(
        [
          block({ blockKey: 'k1', orderNo: 1, templateText: '短' }),
          block({ blockKey: 'k2', orderNo: 2, templateText: '短', minChars: null }),
        ],
        {},
      );
      expect(rendered[0].meetsMinChars).toBe(true);
      expect(rendered[1].meetsMinChars).toBe(true);
    });

    it('渲染后长度达标为 true、不达标为 false', () => {
      const rendered = renderBlocks(
        [
          block({ blockKey: 'ok', orderNo: 1, templateText: '你和{昵称B}的分差是{差值}分', minChars: 10 }),
          block({ blockKey: 'bad', orderNo: 2, templateText: '分差{差值}分', minChars: 10 }),
        ],
        { 昵称B: '小红', 差值: 18 },
      );
      expect(rendered[0].text).toBe('你和小红的分差是18分');
      expect(rendered[0].meetsMinChars).toBe(true);
      expect(rendered[1].text).toBe('分差18分');
      expect(rendered[1].meetsMinChars).toBe(false);
    });

    it('按 Unicode 码点计数：emoji 记 1 个字符', () => {
      // '😀😀' 码点数为 2（若按 UTF-16 长度会算成 4）
      const rendered = renderBlocks([block({ blockKey: 'k', orderNo: 1, templateText: '😀😀', minChars: 3 })], {});
      expect([...'😀😀'].length).toBe(2);
      expect(rendered[0].meetsMinChars).toBe(false);

      const rendered2 = renderBlocks([block({ blockKey: 'k', orderNo: 1, templateText: '😀😀', minChars: 2 })], {});
      expect(rendered2[0].meetsMinChars).toBe(true);
    });

    it('minChars 与占位符替换后的长度比较（而非模板原文长度）', () => {
      const rendered = renderBlocks(
        [block({ blockKey: 'k', orderNo: 1, templateText: '{v}', minChars: 5 })],
        { v: '12345' },
      );
      expect(rendered[0].meetsMinChars).toBe(true);
    });
  });
});

describe('report/template.engine · collectPlaceholders', () => {
  it('提取全部占位符，去重且按首次出现顺序', () => {
    expect(
      collectPlaceholders('{昵称A} 与 {昵称B} 在 {维度名} 上：{昵称A} 的 {差值}'),
    ).toEqual(['昵称A', '昵称B', '维度名', '差值']);
  });

  it('忽略未闭合 / 空括号 / 非法键名', () => {
    expect(collectPlaceholders('{ok} {没闭合 {  {} {a b}')).toEqual(['ok']);
  });

  it('纯文本返回空数组', () => {
    expect(collectPlaceholders('无占位符')).toEqual([]);
  });
});
