import type { EntityManager, Repository } from 'typeorm';
import { ErrorCode } from '../../common/constants/error-code.js';
import { AppLogger } from '../../common/logger/app-logger.service.js';
import { CONSENT_LOG_FAILED_MESSAGE, ConsentLogService, type ConsentLogInput } from './consent-log.service.js';
import { CONSENT_TYPE_INVITE_DATA, ConsentLogEntity } from './entities/consent-log.entity.js';

/**
 * 同意留证服务（ADR-012）
 *
 * 这份断言保护的核心只有一条：**写失败必须抛错**（与 audit_log 的旁路语义相反）。
 * 若被改成 try/catch 吞异常，「同意」就会在没有任何证据的情况下生效，本表也就失去意义。
 */
describe('ConsentLogService 同意留证', () => {
  const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const repository = {
    create: vi.fn((input: unknown) => ({ ...(input as object) })),
    save: vi.fn((input: unknown) => Promise.resolve(input)),
  };

  const buildService = (): ConsentLogService =>
    new ConsentLogService(
      repository as unknown as Repository<ConsentLogEntity>,
      logger as unknown as AppLogger,
    );

  const baseInput: ConsentLogInput = {
    userId: 7,
    consentType: CONSENT_TYPE_INVITE_DATA,
    inviteId: 33,
    role: 'invitee',
    policyVersion: '1.0',
    agreed: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    repository.create.mockImplementation((input: unknown) => ({ ...(input as object) }));
    repository.save.mockImplementation((input: unknown) => Promise.resolve(input));
  });

  it('同意写 1、拒绝写 0，并落库类型 / 角色 / 版本（append-only 一表多类型）', async () => {
    await buildService().record({ ...baseInput, agreed: true });

    expect(repository.save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        userId: 7,
        consentType: CONSENT_TYPE_INVITE_DATA,
        inviteId: 33,
        role: 'invitee',
        policyVersion: '1.0',
        agreed: 1,
      }),
    );

    await buildService().record({ ...baseInput, agreed: false });

    expect(repository.save).toHaveBeenLastCalledWith(expect.objectContaining({ agreed: 0 }));
  });

  it('ip 截断到 64、user_agent 截断到 256（对齐列长，防超长插入报错）', async () => {
    await buildService().record({
      ...baseInput,
      ip: '1'.repeat(80),
      userAgent: 'u'.repeat(300),
    });

    const saved = repository.save.mock.calls.at(-1)?.[0] as { ip: string; userAgent: string };
    expect(saved.ip).toHaveLength(64);
    expect(saved.userAgent).toHaveLength(256);
  });

  it('账号级留证（无 inviteId / role / ip / userAgent）写 null，不为空就直接落库', async () => {
    await buildService().record({
      userId: 7,
      consentType: 'privacy_policy',
      policyVersion: '1.0',
      agreed: true,
    });

    expect(repository.save).toHaveBeenLastCalledWith(
      expect.objectContaining({ inviteId: null, role: null, ip: null, userAgent: null }),
    );
  });

  it('写入失败必须抛错阻断业务（无留证的同意等于没有同意）', async () => {
    repository.save.mockRejectedValue(new Error('db down'));

    await expect(buildService().record(baseInput)).rejects.toMatchObject({
      response: { code: ErrorCode.INTERNAL_ERROR, message: CONSENT_LOG_FAILED_MESSAGE },
    });
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('传入事务 EntityManager 时用事务内的 Repository（留证与业务同一事务）', async () => {
    const txRepository = {
      create: vi.fn((input: unknown) => ({ ...(input as object) })),
      save: vi.fn((input: unknown) => Promise.resolve(input)),
    };
    const manager = { getRepository: vi.fn(() => txRepository) };

    await buildService().record(baseInput, manager as unknown as EntityManager);

    expect(manager.getRepository).toHaveBeenCalledWith(ConsentLogEntity);
    expect(txRepository.save).toHaveBeenCalledTimes(1);
    // 未传 manager 时会走注入的 repository；传了就必须走事务内的那一个
    expect(repository.save).not.toHaveBeenCalled();
  });
});
