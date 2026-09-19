import { SCALE_CODE_16P, SCALE_VERSION_1_0 } from '../../../engines/scale/scale.constants.js';
import type { ReportTemplateSeed } from '../report-seed.types.js';

/**
 * 报告模板种子 · 16 型人格图谱（SINGLE-16P-LITE-1.0）
 *
 * 规格唯一真源：
 * - docs/constitution.md 第 423-490 行：16 型人格图谱 = 4 维度 × 6 题（A/B 二选一），
 *   四维度端点组合映射自研类型名（UI 不出现官方代号，规格 2.2）
 * - docs/constitution.md 第 73-75 行（2.3 必备文案）：**每个**报告页脚固定免责声明
 * - docs/spec 增补 v0.3 §二：16 型类型是双人专属卡 prompt 的输入之一
 *
 * ⚠️ 刻意**只承载一句话开场 + 页脚免责声明**：
 *   规格只定义了 16 型的**类型命名表**，未定义各类型的解读文案。为遵守铁律 #1
 *   （不得自行添加规格未写的规则/内容），此处不发明类型解读；类型名与四维度端点由
 *   引擎结果（p16.typeName / p16.dimensions）直接呈现给用户。
 *
 * 无付费墙占位块：P1 全额免费，16 型不涉及双人解锁（定价规范 §价格体系）。
 */
export const SINGLE_16P_TEMPLATE: ReportTemplateSeed = {
  code: 'SINGLE-16P-LITE',
  scaleCode: SCALE_CODE_16P,
  scaleVersion: SCALE_VERSION_1_0,
  audience: 'single',
  level: 'L1',
  disclaimer:
    '本测评基于自评量表，结果仅供自我了解与伴侣沟通参考，不构成心理学诊断、心理咨询或婚姻法律建议。',
  version: SCALE_VERSION_1_0,
  blocks: [
    {
      blockKey: 'INTRO',
      orderNo: 10,
      minChars: null,
      templateText: '你的 16 型人格图谱结果是：{类型名}。四个维度分别偏向如下。',
    },
  ],
};
