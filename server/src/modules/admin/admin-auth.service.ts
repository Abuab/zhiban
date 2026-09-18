import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { compare as bcryptCompare, hash as bcryptHash } from 'bcryptjs';
import { generateSecret, generateURI, verify as verifyTotp } from 'otplib';
import { randomBytes } from 'node:crypto';
import { Repository } from 'typeorm';
import { ErrorCode } from '../../common/constants/error-code.js';
import { BusinessException } from '../../common/exceptions/business.exception.js';
import { AppLogger } from '../../common/logger/app-logger.service.js';
import type { AdminUser } from '../../common/types/request-context.js';
import { RedisService } from '../redis/redis.service.js';
import { AdminSessionService } from './admin-session.service.js';
import {
  ADMIN_TOKEN_TYPE,
  type AdminJwtPayload,
  type AdminLoginResult,
  type AdminProfileResult,
  type AdminRequestMeta,
  type AdminTotpSetupResult,
} from './admin.types.js';
import { AuditAction, AuditLogService } from './audit-log.service.js';
import { AdminUserEntity } from './entities/admin-user.entity.js';

/** bcrypt 代价因子：12 轮约 250ms，兼顾暴力破解成本与登录体验（调整需重算既有哈希，勿随意改） */
const BCRYPT_ROUNDS = 12;

/** TOTP 绑定密钥在 Redis 中的暂存键前缀与有效期（绑定成功前不落库） */
const TOTP_SETUP_KEY_PREFIX = 'admin_totp_setup:';
const TOTP_SETUP_TTL_SECONDS = 600;

/** TOTP 校验容差：±1 个时间步（30s），容忍手机与服务器的时钟漂移 */
const TOTP_EPOCH_TOLERANCE_SECONDS = 30;

/** 账号不存在时用于「陪跑」比对的哈希，避免响应时间暴露账号是否存在 */
let dummyPasswordHash: string | null = null;

/**
 * 后台鉴权服务（ADR-003 决策 2 / 决策 4）
 *
 * 安全设计（恶意用户视角自查）：
 *   1. 口令比对：bcrypt；账号不存在时也做一次等价耗时的比对，防账号枚举
 *   2. 账号枚举防护：账号不存在 / 口令错误对外统一返回 20010「账号或密码错误」，
 *      仅审计内部区分（'account_not_found' / 'password_mismatch'）；
 *      账号停用返回 20008 —— 该分支在**口令校验通过之后**才可达，
 *      即只有已掌握正确口令的人才能看到，不构成枚举通道
 *   3. 二次验证：totp_secret 已绑定时必须校验动态码；未绑定时登录后仅可访问绑定接口
 *   4. 失败留痕：所有失败写 audit_log，配合 IP 限流定位爆破来源
 *   5. 密钥不落日志：任何日志与响应都不输出 password_hash / totp_secret / 完整 token
 */
@Injectable()
export class AdminAuthService {
  constructor(
    @InjectRepository(AdminUserEntity)
    private readonly adminRepository: Repository<AdminUserEntity>,
    private readonly sessionService: AdminSessionService,
    private readonly auditLog: AuditLogService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly redis: RedisService,
    private readonly logger: AppLogger,
  ) {}

  /**
   * 后台登录
   * TOTP 已绑定时必须提交 totpCode；未绑定时可省略（登录后强制进入绑定流程）
   */
  async login(
    input: { username: string; password: string; totpCode?: string },
    meta: AdminRequestMeta,
  ): Promise<AdminLoginResult> {
    const admin = await this.adminRepository.findOne({ where: { username: input.username } });

    const passwordMatched = await this.verifyPassword(input.password, admin?.passwordHash);
    if (!admin || !passwordMatched) {
      await this.auditLog.record({
        actorType: 'admin',
        actorId: admin?.id ?? null,
        action: AuditAction.ADMIN_LOGIN_FAILED,
        targetType: 'admin_user',
        targetId: input.username,
        detail: { reason: admin ? 'password_mismatch' : 'account_not_found' },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      throw new BusinessException(
        ErrorCode.ADMIN_CREDENTIAL_INVALID,
        undefined,
        HttpStatus.UNAUTHORIZED,
      );
    }

    if (admin.status !== 'active') {
      await this.auditLog.record({
        actorType: 'admin',
        actorId: admin.id,
        action: AuditAction.ADMIN_LOGIN_FAILED,
        targetType: 'admin_user',
        targetId: admin.username,
        detail: { reason: 'account_disabled' },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      throw new BusinessException(ErrorCode.ACCOUNT_DISABLED, undefined, HttpStatus.FORBIDDEN);
    }

    // 已绑定二次验证 → 动态码必须正确，否则不发令牌（防止口令泄漏即失守）
    if (admin.totpSecret) {
      const totpValid = await this.verifyTotpCode(admin.totpSecret, input.totpCode);
      if (!totpValid) {
        await this.auditLog.record({
          actorType: 'admin',
          actorId: admin.id,
          action: AuditAction.ADMIN_LOGIN_FAILED,
          targetType: 'admin_user',
          targetId: admin.username,
          detail: { reason: 'totp_invalid' },
          ip: meta.ip,
          userAgent: meta.userAgent,
        });
        throw new BusinessException(
          ErrorCode.ADMIN_TOTP_INVALID,
          undefined,
          HttpStatus.UNAUTHORIZED,
        );
      }
    }

    const { sessionId, expiresIn } = await this.sessionService.create({
      adminId: admin.id,
      username: admin.username,
      role: admin.role,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    const token = await this.signToken({
      sub: String(admin.id),
      username: admin.username,
      role: admin.role,
      sid: sessionId,
      typ: ADMIN_TOKEN_TYPE,
    });

    await this.adminRepository.update({ id: admin.id }, { lastLoginAt: new Date() });
    await this.auditLog.record({
      actorType: 'admin',
      actorId: admin.id,
      action: AuditAction.ADMIN_LOGIN,
      targetType: 'admin_user',
      targetId: admin.username,
      detail: { totpEnabled: Boolean(admin.totpSecret) },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return {
      token,
      expiresIn,
      admin: {
        id: admin.id,
        username: admin.username,
        role: admin.role,
        totpEnabled: Boolean(admin.totpSecret),
      },
    };
  }

  /** 退出登录：撤销当前会话（其他设备会话不受影响） */
  async logout(current: AdminUser, meta: AdminRequestMeta): Promise<{ revoked: boolean }> {
    await this.sessionService.revoke(current.sessionId);
    await this.auditLog.record({
      actorType: 'admin',
      actorId: current.id,
      action: AuditAction.ADMIN_LOGOUT,
      targetType: 'admin_user',
      targetId: current.username,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return { revoked: true };
  }

  /**
   * 生成 TOTP 密钥（尚未落库）
   * 密钥暂存 Redis 10 分钟，待 enable 校验通过后才写入 admin_user.totp_secret，
   * 避免「绑了一半」把管理员锁在门外
   */
  async setupTotp(current: AdminUser): Promise<AdminTotpSetupResult> {
    const admin = await this.findAdminOrFail(current.id);
    if (admin.totpSecret) {
      throw new BusinessException(
        ErrorCode.ADMIN_TOTP_ALREADY_ENABLED,
        undefined,
        HttpStatus.CONFLICT,
      );
    }

    const secret = generateSecret();
    await this.redis.set(this.totpSetupKey(current.id), secret, TOTP_SETUP_TTL_SECONDS);

    // issuer 用固定工程标识（不随品牌配置变化），避免管理员换绑设备后无法辨认来源
    const otpauthUrl = generateURI({
      issuer: 'zhiban-admin',
      label: admin.username,
      secret,
    });

    return { secret, otpauthUrl };
  }

  /** 校验一次动态码并完成绑定（校验通过才落库） */
  async enableTotp(current: AdminUser, code: string): Promise<{ totpEnabled: true }> {
    const admin = await this.findAdminOrFail(current.id);
    if (admin.totpSecret) {
      throw new BusinessException(
        ErrorCode.ADMIN_TOTP_ALREADY_ENABLED,
        undefined,
        HttpStatus.CONFLICT,
      );
    }

    const pendingSecret = await this.redis.get(this.totpSetupKey(current.id));
    if (!pendingSecret) {
      throw new BusinessException(ErrorCode.ADMIN_TOTP_NOT_SETUP, undefined, HttpStatus.BAD_REQUEST);
    }

    const valid = await this.verifyTotpCode(pendingSecret, code);
    if (!valid) {
      throw new BusinessException(
        ErrorCode.ADMIN_TOTP_INVALID,
        undefined,
        HttpStatus.UNAUTHORIZED,
      );
    }

    await this.adminRepository.update({ id: current.id }, { totpSecret: pendingSecret });
    await this.redis.del(this.totpSetupKey(current.id));
    await this.auditLog.record({
      actorType: 'admin',
      actorId: current.id,
      action: AuditAction.ADMIN_TOTP_ENABLED,
      targetType: 'admin_user',
      targetId: admin.username,
    });

    return { totpEnabled: true };
  }

  /** 取当前管理员资料（不回传任何密钥字段） */
  async getProfile(current: AdminUser): Promise<AdminProfileResult> {
    const admin = await this.findAdminOrFail(current.id);
    return {
      id: admin.id,
      username: admin.username,
      role: admin.role,
      totpEnabled: Boolean(admin.totpSecret),
      lastLoginAt: admin.lastLoginAt,
    };
  }

  /** 使用后台独立密钥签发令牌（与小程序 JWT 完全隔离） */
  private signToken(payload: AdminJwtPayload): Promise<string> {
    return this.jwtService.signAsync(payload, {
      secret: this.config.get<string>('admin.jwtSecret'),
      expiresIn: this.config.get<string>('admin.jwtExpiresIn') as JwtSignOptions['expiresIn'],
    });
  }

  /**
   * 口令比对
   * 账号不存在（hash 为 undefined）时仍执行一次等价耗时的比对，使「账号不存在」与「口令错误」
   * 的响应时间不可区分，阻断账号枚举
   */
  private async verifyPassword(password: string, hash: string | undefined): Promise<boolean> {
    if (!hash) {
      await bcryptCompare(password, await this.getDummyHash());
      return false;
    }
    return bcryptCompare(password, hash);
  }

  private async getDummyHash(): Promise<string> {
    if (!dummyPasswordHash) {
      dummyPasswordHash = await bcryptHash(randomBytes(32).toString('hex'), BCRYPT_ROUNDS);
    }
    return dummyPasswordHash;
  }

  /** TOTP 校验：格式非法或密钥异常一律视为校验失败，不向外抛第三方异常细节 */
  private async verifyTotpCode(secret: string, code?: string): Promise<boolean> {
    const token = (code ?? '').trim();
    if (!/^\d{6}$/.test(token)) return false;
    try {
      const result = await verifyTotp({
        secret,
        token,
        epochTolerance: TOTP_EPOCH_TOLERANCE_SECONDS,
      });
      return result.valid === true;
    } catch (error) {
      this.logger.warn(
        `TOTP 校验异常：${error instanceof Error ? error.message : String(error)}`,
        'AdminAuthService',
      );
      return false;
    }
  }

  private async findAdminOrFail(id: number): Promise<AdminUserEntity> {
    const admin = await this.adminRepository.findOne({ where: { id } });
    if (!admin || admin.status !== 'active') {
      throw new BusinessException(
        ErrorCode.ADMIN_CREDENTIAL_INVALID,
        undefined,
        HttpStatus.UNAUTHORIZED,
      );
    }
    return admin;
  }

  private totpSetupKey(adminId: number): string {
    return `${TOTP_SETUP_KEY_PREFIX}${adminId}`;
  }
}
