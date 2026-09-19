import type { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { DataSource, type EntityManager, type Repository } from 'typeorm';
import { ErrorCode } from '../../common/constants/error-code.js';
import { AppLogger } from '../../common/logger/app-logger.service.js';
import { AccountService } from '../account/account.service.js';
import { AssessmentService } from '../assessment/assessment.service.js';
import { AnswerSheetEntity } from '../assessment/entities/answer-sheet.entity.js';
import type { ReusableSingleSheet } from '../assessment/assessment.types.js';
import { AuditAction, AuditLogService } from '../audit/audit-log.service.js';
import { JobTaskService } from '../queue/job-task.service.js';
import { RedisService } from '../redis/redis.service.js';
import { ReportEntity } from '../report/entities/report.entity.js';
import { DoubleReportRenderService } from '../report/double-report-render.service.js';
import { ReportRecordService } from '../report/report-record.service.js';
import { ReportTemplateService } from '../report/report-template.service.js';
import { ScaleQueryService } from '../scale/scale-query.service.js';
import { ExclusiveCardEntity } from '../topic/entities/exclusive-card.entity.js';
import { WechatService } from '../wechat/wechat.service.js';
import { ConsentLogService } from './consent-log.service.js';
import { AnswerSnapshotEntity } from './entities/answer-snapshot.entity.js';
import { CONSENT_TYPE_INVITE_DATA } from './entities/consent-log.entity.js';
import { InviteEntity } from './entities/invite.entity.js';
import {
  INVITE_DATA_CONSENT_REQUIRED_MESSAGE,
  INVITE_DATA_CONSENT_VERSION,
  INVITE_STATUS,
} from './invite.constants.js';
import { InviteService } from './invite.service.js';
import type { CreateInviteDto } from './dto/invite.dto.js';
import type { ReportGenerateJob } from './invite.types.js';

const INVITE_ID = 55;
const INITIATOR_ID = 7;
const INVITEE_ID = 9;
const OUTSIDER_ID = 99;
const SCALE_VERSION_ID = 100;
/** 32 位小写十六进制邀请码（INVITE_CODE_PATTERN 口径） */
const CODE = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const FIXED_NOW = new Date('2026-09-19T00:00:00.000Z');

function makeInvite(overrides: Partial<InviteEntity> = {}): InviteEntity {
  return {
    id: INVITE_ID,
    code: CODE,
    initiatorUid: INITIATOR_ID,
    inviteeUid: INVITEE_ID,
    scaleVersionId: SCALE_VERSION_ID,
    status: INVITE_STATUS.OPENED,
    amount: '0.00',
    reuseAllowed: 1,
    renewedCount: 0,
    replacedFromInviteId: null,
    remindCount: 0,
    remindAt: null,
    expireAt: new Date(FIXED_NOW.getTime() + 30 * 24 * 60 * 60 * 1000),
    openedAt: FIXED_NOW,
    completedAt: null,
    declinedAt: null,
    cancelledAt: null,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  } as InviteEntity;
}

/** 发起方历史单人答卷（创建前置：同版本已交卷） */
function makeReusableSheet(): ReusableSingleSheet {
  return {
    sheetId: 900,
    submittedAt: FIXED_NOW.toISOString(),
    answers: { Q1: 3 },
    cache: {
      dimensions: [],
      baseline: { triggered: false },
      quality: 'ok',
      styleAnswer: null,
      p16: null,
      skipped: [],
      skippedQuestions: [],
      supplemented: [],
      computedAt: FIXED_NOW.toISOString(),
    } as unknown as ReusableSingleSheet['cache'],
    durationSec: 300,
    qualityFlag: null,
  };
}

function createMockRepository() {
  return {
    findOne: vi.fn(),
    find: vi.fn(),
    count: vi.fn(),
    create: vi.fn((input: unknown) => ({ ...(input as object) })),
    save: vi.fn((input: unknown) => Promise.resolve(input)),
    update: vi.fn(),
    delete: vi.fn(),
  };
}

/**
 * 邀请域服务（ADR-011 配对数据删除 / ADR-012 同意留证）
 *
 * 这两份 ADR 的断言保护的是**不可逆后果**，跑起来看不出问题：
 *   - 同意没留证就生效（合规缺口，事后无法举证）；
 *   - 删除越权（第三人删别人的配对）或删不干净（残留答案 / 报告）；
 *   - 把单人专属卡（`invite_id = 0`）误删。
 */
describe('InviteService 配对数据删除与同意留证', () => {
  const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };

  const inviteRepository = createMockRepository();
  const snapshotRepository = createMockRepository();
  const txInviteRepository = createMockRepository();
  const txSnapshotRepository = createMockRepository();
  const txSheetRepository = createMockRepository();
  const txReportRepository = createMockRepository();
  const txCardRepository = createMockRepository();

  const assessment = {
    findReusableSingleSheet: vi.fn(),
    getInviteDetail: vi.fn(),
  };
  const scaleQuery = { findActiveVersionByScaleCode: vi.fn(), getVersionOrFail: vi.fn() };
  const reportRecord = { findByInviteId: vi.fn() };
  const reportTemplate = { loadDoubleTemplate: vi.fn() };
  const render = { renderReport: vi.fn() };
  const account = { findNicknames: vi.fn() };
  const wechat = { sendSubscribeMessage: vi.fn() };
  const redis = { allowBySlidingWindow: vi.fn() };
  const config = { get: vi.fn() };
  const jobs = { create: vi.fn() };
  const consentLog = { record: vi.fn() };
  const audit = { record: vi.fn() };
  const reportQueue = { add: vi.fn() };

  const manager = { getRepository: vi.fn() };
  const dataSource = { transaction: vi.fn() };

  const buildService = (): InviteService =>
    new InviteService(
      inviteRepository as unknown as Repository<InviteEntity>,
      snapshotRepository as unknown as Repository<AnswerSnapshotEntity>,
      dataSource as unknown as DataSource,
      assessment as unknown as AssessmentService,
      scaleQuery as unknown as ScaleQueryService,
      reportRecord as unknown as ReportRecordService,
      reportTemplate as unknown as ReportTemplateService,
      render as unknown as DoubleReportRenderService,
      account as unknown as AccountService,
      wechat as unknown as WechatService,
      redis as unknown as RedisService,
      config as unknown as ConfigService,
      jobs as unknown as JobTaskService,
      consentLog as unknown as ConsentLogService,
      audit as unknown as AuditLogService,
      logger as unknown as AppLogger,
      reportQueue as unknown as Queue<ReportGenerateJob>,
    );

  function installDefaults(): void {
    inviteRepository.findOne.mockResolvedValue(null);
    inviteRepository.count.mockResolvedValue(0);
    inviteRepository.update.mockResolvedValue({ affected: 1 });
    inviteRepository.delete.mockResolvedValue({ affected: 1 });

    txInviteRepository.findOne.mockResolvedValue(null);
    txInviteRepository.save.mockImplementation((input: unknown) =>
      Promise.resolve(makeInvite(input as Partial<InviteEntity>)),
    );
    txInviteRepository.update.mockResolvedValue({ affected: 1 });
    txInviteRepository.delete.mockResolvedValue({ affected: 1 });
    txSnapshotRepository.save.mockImplementation((input: unknown) => Promise.resolve(input));
    txSheetRepository.delete.mockResolvedValue({ affected: 1 });
    txReportRepository.delete.mockResolvedValue({ affected: 1 });
    txCardRepository.delete.mockResolvedValue({ affected: 1 });

    assessment.findReusableSingleSheet.mockResolvedValue(makeReusableSheet());
    assessment.getInviteDetail.mockResolvedValue(null);
    scaleQuery.findActiveVersionByScaleCode.mockResolvedValue({
      id: SCALE_VERSION_ID,
      version: '1.0',
    });
    scaleQuery.getVersionOrFail.mockResolvedValue({ id: SCALE_VERSION_ID, version: '1.0' });
    reportRecord.findByInviteId.mockResolvedValue(null);
    account.findNicknames.mockResolvedValue(new Map());
    redis.allowBySlidingWindow.mockResolvedValue({ allowed: true });
    config.get.mockReturnValue({});
    consentLog.record.mockResolvedValue(undefined);
    audit.record.mockResolvedValue(undefined);

    manager.getRepository.mockImplementation((entity: unknown) => {
      if (entity === InviteEntity) return txInviteRepository;
      if (entity === AnswerSnapshotEntity) return txSnapshotRepository;
      if (entity === AnswerSheetEntity) return txSheetRepository;
      if (entity === ReportEntity) return txReportRepository;
      if (entity === ExclusiveCardEntity) return txCardRepository;
      throw new Error('未预期的实体');
    });
    dataSource.transaction.mockImplementation(
      async (run: (entityManager: unknown) => Promise<unknown>) => run(manager),
    );
  }

  beforeEach(() => {
    vi.resetAllMocks();
    installDefaults();
  });

  describe('ADR-012：创建邀请的发起方同意', () => {
    it('缺 dataConsentAgreed（undefined）→ 10001，且不开事务、不写留证', async () => {
      const dto = {} as CreateInviteDto;

      await expect(buildService().create(INITIATOR_ID, dto)).rejects.toMatchObject({
        response: { code: ErrorCode.PARAM_INVALID, message: INVITE_DATA_CONSENT_REQUIRED_MESSAGE },
      });

      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(consentLog.record).not.toHaveBeenCalled();
    });

    it('dataConsentAgreed=false → 10001（不做「缺省视为同意」）', async () => {
      const dto = { dataConsentAgreed: false } as CreateInviteDto;

      await expect(buildService().create(INITIATOR_ID, dto)).rejects.toMatchObject({
        response: { code: ErrorCode.PARAM_INVALID },
      });

      expect(consentLog.record).not.toHaveBeenCalled();
    });

    it('dataConsentAgreed=true → 同事务写发起方留证（role=initiator, agreed=true）', async () => {
      const dto = { dataConsentAgreed: true } as CreateInviteDto;

      const result = await buildService().create(INITIATOR_ID, dto, {
        ip: '1.2.3.4',
        userAgent: 'wx',
      });

      expect(result.inviteId).toBe(INVITE_ID);
      expect(consentLog.record).toHaveBeenCalledTimes(1);
      expect(consentLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: INITIATOR_ID,
          consentType: CONSENT_TYPE_INVITE_DATA,
          inviteId: INVITE_ID,
          role: 'initiator',
          policyVersion: INVITE_DATA_CONSENT_VERSION,
          agreed: true,
          ip: '1.2.3.4',
          userAgent: 'wx',
        }),
        // 必须与业务写入同一事务
        manager,
      );
    });

    it('留证写入失败 → 整个创建失败（无留证的同意等于没有同意）', async () => {
      consentLog.record.mockRejectedValue(new Error('留证写失败'));
      const dto = { dataConsentAgreed: true } as CreateInviteDto;

      await expect(buildService().create(INITIATOR_ID, dto)).rejects.toThrow('留证写失败');

      expect(consentLog.record).toHaveBeenCalledTimes(1);
    });
  });

  describe('ADR-012：被邀请方知情同意留证', () => {
    it('同意（agreed=true）→ 状态置 consent_given 并写一条 role=invitee 的留证', async () => {
      inviteRepository.findOne.mockResolvedValue(makeInvite({ status: INVITE_STATUS.OPENED }));

      await buildService().consent(INVITEE_ID, CODE, { agreed: true }, { ip: '5.6.7.8' });

      expect(txInviteRepository.update).toHaveBeenCalledWith(
        { id: INVITE_ID, status: INVITE_STATUS.OPENED },
        { status: INVITE_STATUS.CONSENT_GIVEN },
      );
      expect(consentLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: INVITEE_ID,
          inviteId: INVITE_ID,
          role: 'invitee',
          policyVersion: INVITE_DATA_CONSENT_VERSION,
          agreed: true,
          ip: '5.6.7.8',
        }),
        manager,
      );
    });

    it('拒绝（agreed=false）→ 状态置 declined 且同样留证（C7 争议需能举证）', async () => {
      inviteRepository.findOne.mockResolvedValue(makeInvite({ status: INVITE_STATUS.OPENED }));

      await buildService().consent(INVITEE_ID, CODE, { agreed: false });

      expect(consentLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'invitee', agreed: false }),
        manager,
      );
      expect(txInviteRepository.update).toHaveBeenCalledWith(
        { id: INVITE_ID, status: INVITE_STATUS.OPENED },
        expect.objectContaining({ status: INVITE_STATUS.DECLINED }),
      );
    });

    it('重复同意（已 consent_given）→ 幂等返回，不重复写留证', async () => {
      inviteRepository.findOne.mockResolvedValue(
        makeInvite({ status: INVITE_STATUS.CONSENT_GIVEN }),
      );

      await buildService().consent(INVITEE_ID, CODE, { agreed: true });

      expect(consentLog.record).not.toHaveBeenCalled();
    });

    it('并发重复同意（条件更新 affected=0）→ 不补写留证（只记首次那一笔）', async () => {
      inviteRepository.findOne.mockResolvedValue(makeInvite({ status: INVITE_STATUS.OPENED }));
      txInviteRepository.update.mockResolvedValue({ affected: 0 });

      await buildService().consent(INVITEE_ID, CODE, { agreed: true });

      expect(consentLog.record).not.toHaveBeenCalled();
    });

    it('发起方不是同意主体 → 40004，且不写留证', async () => {
      inviteRepository.findOne.mockResolvedValue(makeInvite({ status: INVITE_STATUS.OPENED }));

      await expect(
        buildService().consent(INITIATOR_ID, CODE, { agreed: true }),
      ).rejects.toMatchObject({ response: { code: ErrorCode.INVITE_STATUS_INVALID } });
      expect(consentLog.record).not.toHaveBeenCalled();
    });
  });

  describe('ADR-011：删除本次配对数据', () => {
    it('发起方可删：物理删 invite + 级联删四张子表，并写 audit_log 留痕', async () => {
      txInviteRepository.findOne.mockResolvedValue(makeInvite());

      await buildService().deletePairingData(INITIATOR_ID, CODE, {
        ip: '1.2.3.4',
        userAgent: 'wx',
      });

      expect(txInviteRepository.delete).toHaveBeenCalledWith({ id: INVITE_ID });
      expect(txSheetRepository.delete).toHaveBeenCalledWith({ inviteId: INVITE_ID });
      expect(txSnapshotRepository.delete).toHaveBeenCalledWith({ inviteId: INVITE_ID });
      expect(txReportRepository.delete).toHaveBeenCalledWith({ inviteId: INVITE_ID });
      // 单人专属卡 invite_id = 0 不在 { inviteId: 55 } 范围内，天然不受影响（ADR-008 决策 5）
      expect(txCardRepository.delete).toHaveBeenCalledWith({ inviteId: INVITE_ID });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorType: 'user',
          actorId: INITIATOR_ID,
          action: AuditAction.INVITE_DATA_DELETED,
          targetType: 'invite',
          targetId: String(INVITE_ID),
          detail: { code: CODE, role: 'initiator', status: INVITE_STATUS.OPENED },
          ip: '1.2.3.4',
          userAgent: 'wx',
        }),
      );
    });

    it('被邀请方同样可删（任一方均有数据控制权）', async () => {
      txInviteRepository.findOne.mockResolvedValue(makeInvite());

      await buildService().deletePairingData(INVITEE_ID, CODE);

      expect(txInviteRepository.delete).toHaveBeenCalledWith({ id: INVITE_ID });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ actorId: INVITEE_ID, detail: expect.objectContaining({ role: 'invitee' }) }),
      );
    });

    it('非参与者（第三人）→ 404，且不删任何数据、不写留痕', async () => {
      txInviteRepository.findOne.mockResolvedValue(makeInvite());

      await expect(
        buildService().deletePairingData(OUTSIDER_ID, CODE),
      ).rejects.toMatchObject({ response: { code: ErrorCode.RESOURCE_NOT_FOUND } });

      expect(txInviteRepository.delete).not.toHaveBeenCalled();
      expect(txSheetRepository.delete).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('已删除后再删（行不存在）→ 404（与越权同码，不区分）', async () => {
      txInviteRepository.findOne.mockResolvedValue(null);

      await expect(
        buildService().deletePairingData(INITIATOR_ID, CODE),
      ).rejects.toMatchObject({ response: { code: ErrorCode.RESOURCE_NOT_FOUND } });

      expect(txInviteRepository.delete).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('并发双删（抢权 affected=0）→ 404，且不再级联删子表', async () => {
      txInviteRepository.findOne.mockResolvedValue(makeInvite());
      txInviteRepository.delete.mockResolvedValue({ affected: 0 });

      await expect(
        buildService().deletePairingData(INITIATOR_ID, CODE),
      ).rejects.toMatchObject({ response: { code: ErrorCode.RESOURCE_NOT_FOUND } });

      expect(txSheetRepository.delete).not.toHaveBeenCalled();
      expect(txReportRepository.delete).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('邀请码格式非法 → 直接 404，不打库（不拿任意串当查询条件）', async () => {
      await expect(
        buildService().deletePairingData(INITIATOR_ID, 'not-a-code'),
      ).rejects.toMatchObject({ response: { code: ErrorCode.RESOURCE_NOT_FOUND } });

      expect(dataSource.transaction).not.toHaveBeenCalled();
    });
  });
});
