import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppLogger } from '../../common/logger/app-logger.service.js';
import type { ScaleVersionSeed } from '../../engines/scale/scale.types.js';
import { ScaleDimensionEntity } from './entities/scale-dimension.entity.js';
import { ScaleEntity } from './entities/scale.entity.js';
import { ScaleQuestionEntity } from './entities/scale-question.entity.js';
import { ScaleVersionEntity } from './entities/scale-version.entity.js';
import { ScoringRuleEntity } from './entities/scoring-rule.entity.js';
import { ScaleSeedService } from './scale-seed.service.js';

/** 种子样例：2 维度 2 题（1 题带 options 与 note，1 题为底线题） */
function buildSeed(overrides: Partial<ScaleVersionSeed> = {}): ScaleVersionSeed {
  return {
    scaleCode: 'SCALE-PRE',
    scaleName: '婚前评估',
    scaleDescription: '仅供自我了解',
    version: '1.0',
    itemCount: 2,
    introText: '请按第一感觉作答',
    baselineIntroText: '以下几题关于婚前的事实确认',
    dimensions: [
      { code: 'FINANCE', name: '财务观与婚俗财务', orderNo: 1, isSensitive: false, isScored: true },
      { code: 'BASELINE', name: '底线题组', orderNo: 2, isSensitive: true, isScored: false },
    ],
    questions: [
      {
        code: 'Q1',
        orderNo: 1,
        dimensionCode: 'FINANCE',
        type: 'scale',
        title: '我们对财务的态度一致',
        reverse: true,
        isStyle: false,
        isBaseline: false,
        options: null,
        note: '透明度（反向）',
      },
      {
        code: 'Q72',
        orderNo: 2,
        dimensionCode: null,
        type: 'choice',
        title: '你更倾向哪种财务安排',
        reverse: false,
        isStyle: false,
        isBaseline: true,
        options: [
          { key: '1', label: '一起管' },
          { key: '2', label: '各管各' },
        ],
      },
    ],
    ...overrides,
  };
}

function createMockRepository() {
  return {
    findOne: vi.fn(),
    create: vi.fn(),
    save: vi.fn(),
    count: vi.fn(),
    delete: vi.fn(),
    update: vi.fn(),
  };
}

describe('ScaleSeedService 量表种子幂等导入', () => {
  let service: ScaleSeedService;

  const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const scaleRepository = createMockRepository();
  const versionRepository = createMockRepository();
  const dimensionRepository = createMockRepository();
  const questionRepository = createMockRepository();
  const scoringRuleRepository = createMockRepository();
  const manager = { getRepository: vi.fn() };
  const dataSource = { transaction: vi.fn() };

  /** resetAllMocks 会清掉实现，故默认行为集中在此重装 */
  function installDefaults(): void {
    const identity = (input: unknown): unknown => input;

    scaleRepository.findOne.mockResolvedValue(null);
    scaleRepository.create.mockImplementation(identity);
    scaleRepository.save.mockResolvedValue({
      id: 1,
      code: 'SCALE-PRE',
      name: '婚前评估',
      description: '仅供自我了解',
      latestVersionId: null,
    });
    scaleRepository.update.mockResolvedValue({ affected: 1 });

    versionRepository.findOne.mockResolvedValue(null);
    versionRepository.create.mockImplementation(identity);
    versionRepository.save.mockResolvedValue({
      id: 10,
      scaleId: 1,
      version: '1.0',
      status: 'frozen',
      itemCount: 2,
      frozenAt: new Date(),
    });
    versionRepository.update.mockResolvedValue({ affected: 1 });
    versionRepository.count.mockResolvedValue(2);

    dimensionRepository.create.mockImplementation(identity);
    dimensionRepository.save.mockImplementation(async (input: unknown) =>
      (input as Array<{ code: string }>).map((row, index) => ({ ...row, id: 100 + index })),
    );
    dimensionRepository.delete.mockResolvedValue({ affected: 0 });

    questionRepository.create.mockImplementation(identity);
    questionRepository.save.mockImplementation(async (input: unknown) => input);
    questionRepository.count.mockResolvedValue(0);
    questionRepository.delete.mockResolvedValue({ affected: 0 });

    scoringRuleRepository.findOne.mockResolvedValue(null);
    scoringRuleRepository.create.mockImplementation(identity);
    scoringRuleRepository.save.mockImplementation(async (input: unknown) => input);

    manager.getRepository.mockImplementation((entity: unknown) => {
      if (entity === ScaleEntity) return scaleRepository;
      if (entity === ScaleVersionEntity) return versionRepository;
      if (entity === ScaleDimensionEntity) return dimensionRepository;
      if (entity === ScaleQuestionEntity) return questionRepository;
      if (entity === ScoringRuleEntity) return scoringRuleRepository;
      throw new Error('未预期的实体');
    });
    dataSource.transaction.mockImplementation(
      async (run: (entityManager: unknown) => Promise<unknown>) => run(manager),
    );
  }

  beforeEach(async () => {
    vi.resetAllMocks();
    installDefaults();

    const moduleRef = await Test.createTestingModule({
      providers: [
        ScaleSeedService,
        { provide: DataSource, useValue: dataSource },
        { provide: AppLogger, useValue: logger },
      ],
    }).compile();
    service = moduleRef.get(ScaleSeedService);
  });

  it('首次导入：创建版本/维度/题目，并把 latest_version_id 指向新版本', async () => {
    const result = await service.seedVersion(buildSeed());

    expect(result).toEqual({ created: true, skipped: false, questionCount: 2 });
    expect(versionRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        scaleId: 1,
        version: '1.0',
        status: 'frozen',
        itemCount: 2,
        // ADR-004：卷首文案两列必须落库（P5 可配置），否则后台改了文案也读不到
        introText: '请按第一感觉作答',
        baselineIntroText: '以下几题关于婚前的事实确认',
      }),
    );
    expect(dimensionRepository.save).toHaveBeenCalledTimes(1);
    expect(questionRepository.save).toHaveBeenCalledTimes(1);
    expect(scaleRepository.update).toHaveBeenCalledWith({ id: 1 }, { latestVersionId: 10 });
  });

  it('重复导入（未 force）：不产生任何写入，返回 skipped 与已有题目数', async () => {
    // 真实场景：version 行存在则其所属 scale 行必然存在
    scaleRepository.findOne.mockResolvedValue({
      id: 1,
      code: 'SCALE-PRE',
      name: '婚前评估',
      description: null,
      latestVersionId: 10,
    });
    versionRepository.findOne.mockResolvedValue({
      id: 10,
      scaleId: 1,
      version: '1.0',
      status: 'frozen',
      itemCount: 2,
      frozenAt: new Date(),
    });
    questionRepository.count.mockResolvedValue(2);

    const result = await service.seedVersion(buildSeed());

    expect(result).toEqual({ created: false, skipped: true, questionCount: 2 });
    expect(questionRepository.count).toHaveBeenCalledWith({ where: { scaleVersionId: 10 } });
    // 幂等核心：只读，不写
    expect(scaleRepository.save).not.toHaveBeenCalled();
    expect(scaleRepository.update).not.toHaveBeenCalled();
    expect(versionRepository.save).not.toHaveBeenCalled();
    expect(versionRepository.update).not.toHaveBeenCalled();
    expect(dimensionRepository.create).not.toHaveBeenCalled();
    expect(dimensionRepository.save).not.toHaveBeenCalled();
    expect(questionRepository.create).not.toHaveBeenCalled();
    expect(questionRepository.save).not.toHaveBeenCalled();
    expect(questionRepository.delete).not.toHaveBeenCalled();
    expect(dimensionRepository.delete).not.toHaveBeenCalled();
  });

  it('force 重建已冻结版本：告警后先删本版本题目与维度、再重建', async () => {
    versionRepository.findOne.mockResolvedValue({
      id: 10,
      scaleId: 1,
      version: '1.0',
      status: 'frozen',
      itemCount: 2,
      frozenAt: new Date(),
    });

    const result = await service.seedVersion(buildSeed(), { force: true });

    expect(result).toEqual({ created: true, skipped: false, questionCount: 2 });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0]?.[0]).toContain('已冻结');
    expect(logger.warn.mock.calls[0]?.[0]).toContain('B8/G1');
    expect(questionRepository.delete).toHaveBeenCalledWith({ scaleVersionId: 10 });
    expect(dimensionRepository.delete).toHaveBeenCalledWith({ scaleVersionId: 10 });
    expect(questionRepository.delete.mock.invocationCallOrder[0]).toBeLessThan(
      questionRepository.save.mock.invocationCallOrder[0],
    );
    expect(versionRepository.update).toHaveBeenCalledWith(
      { id: 10 },
      expect.objectContaining({ status: 'frozen', itemCount: 2 }),
    );
    // force 重建不夺走 latest_version_id 指向
    expect(scaleRepository.update).not.toHaveBeenCalled();
  });

  it('题目数与 itemCount 不一致：抛错且不开启事务、不写入', async () => {
    await expect(service.seedVersion(buildSeed({ itemCount: 3 }))).rejects.toThrow(
      '题目数与 itemCount 不一致',
    );

    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(scaleRepository.save).not.toHaveBeenCalled();
    expect(versionRepository.save).not.toHaveBeenCalled();
    expect(questionRepository.save).not.toHaveBeenCalled();
  });

  it('note 序列化进 ext_json，无 note 时写 null；options 落 options_json', async () => {
    await service.seedVersion(buildSeed());

    const rows = questionRepository.create.mock.calls.map(([input]) => input);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        code: 'Q1',
        dimensionId: 100,
        reverse: 1,
        isBaseline: 0,
        optionsJson: null,
        extJson: { note: '透明度（反向）' },
        status: 'on',
      }),
    );
    expect(rows[1]).toEqual(
      expect.objectContaining({
        code: 'Q72',
        dimensionId: null,
        optionsJson: [
          { key: '1', label: '一起管' },
          { key: '2', label: '各管各' },
        ],
        extJson: null,
      }),
    );
  });

  it('ensureDefaultScoringRule：无计分行时写入默认值（含中文分级命名）', async () => {
    await service.ensureDefaultScoringRule(10);

    expect(scoringRuleRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        scaleVersionId: 10,
        aggregateMethod: 'mean_normalized',
        diffThresholdHigh: 15,
        diffThresholdMid: 30,
        qualityMinSec: 180,
        version: '1.0',
        status: 'on',
        labelsJson: { high: '高共识', mid: '待沟通', low: '重点待沟通' },
      }),
    );
  });

  it('ensureDefaultScoringRule：已存在同版本计分行时跳过，且可传入自定义命名', async () => {
    scoringRuleRepository.findOne.mockResolvedValue({ id: 1, scaleVersionId: 10 });

    await service.ensureDefaultScoringRule(10, { high: 'A', mid: 'B', low: 'C' });

    expect(scoringRuleRepository.findOne).toHaveBeenCalledWith({
      where: { scaleVersionId: 10, version: '1.0' },
    });
    expect(scoringRuleRepository.save).not.toHaveBeenCalled();
    expect(scoringRuleRepository.create).not.toHaveBeenCalled();
  });
});
