import { randomUUID } from 'node:crypto';
import { URL } from 'node:url';
import type { Logger } from 'homebridge';
import type { ZiroomDeviceInfo } from '../types';
import { decodeDes, encodeDes } from './crypto';
import { login } from './login';

export interface ZiroomRequestOptions {
  token?: string;
  account?: string;
  password?: string;
  hid?: string;
  requestTimeout?: number;
}

interface ZiroomResponse<T> {
  code: string;
  data: T;
  message?: string;
}

interface ZiroomDeviceListResponse {
  deviceData?: {
    deviceList?: Array<{
      deviceList?: ZiroomDeviceInfo[];
    }>;
  };
}

export class ZiroomRequest {
  private static readonly MAX_CONCURRENT_REQUESTS = 3;

  private hid = '';

  private token = '';
  private tokenExpiredAt = Number.POSITIVE_INFINITY;
  private loginPromise: Promise<void> | null = null;
  private activeRequests = 0;
  private readonly requestWaiters: Array<() => void> = [];

  constructor(
    public readonly log: Logger,
    private readonly options: ZiroomRequestOptions,
  ) {
    this.hid = options.hid ?? '';
    this.token = options.token ?? '';
  }

  private async getToken() {
    if (this.token && this.tokenExpiredAt > Date.now()) {
      return this.token;
    }
    await this.login();
    return this.token;
  }

  private async login() {
    const { account, password } = this.options;
    if (!account || !password) {
      throw new Error('自如 Token 已失效，且未配置账号和密码用于自动登录');
    }

    if (!this.loginPromise) {
      this.loginPromise = (async () => {
        const token = await login(account, password);
        if (!token) {
          throw new Error('自如登录成功但未返回 Token');
        }
        this.token = token;
        this.tokenExpiredAt = Date.now() + 1000 * 60 * 60 * 24 * 3;
      })().finally(() => {
        this.loginPromise = null;
      });
    }
    await this.loginPromise;
  }

  private async createHeaders(timestamp: number) {
    const token = await this.getToken();
    const headers = new Headers({
      token,
      'User-Agent': 'ZiroomerProject/7.14.7 (iPhone; iOS 18.5; Scale/3.00)',
      'Content-Type': 'application/json',
      appType: '1',
      sys: 'app',
      timestamp: timestamp.toString(),
      'Request-Id': `${randomUUID().slice(0, 8)}:${Math.floor(timestamp / 1000)}`,
      'Client-Type': 'ios',
      phoneName: 'iPhone',
      osType: 'iOS',
      osVersion: '18.5',
    });

    return headers;
  }

  private getJwtPayload() {
    const [, payload] = this.token.split('.');
    try {
      const payloadString = Buffer.from(payload, 'base64').toString('utf8');
      return JSON.parse(payloadString);
    } catch (error) {
      this.log.error(String(error));
      return null;
    }
  }

  get uid() {
    return this.getJwtPayload()?.uid;
  }

  private async getUid() {
    await this.getToken();
    const uid = this.uid;
    if (!uid) {
      throw new Error('无法从自如 Token 中解析 uid');
    }
    return uid;
  }

  async getHid() {
    if (this.hid) {
      return this.hid;
    }
    const resp = await this.request<{ hid: string }[]>('/homeapi/v10/home/queryHomeList', {
      uid: await this.getUid(),
    });
    this.hid = resp?.[0]?.hid ?? '';
    if (!this.hid) {
      throw new Error('自如账号下没有可用的 HID');
    }
    return this.hid;
  }

  public async request<T = unknown>(path: string, data: Record<string, unknown>, authRetryCount = 0): Promise<T> {
    const timestamp = Date.now();
    const body = encodeDes(JSON.stringify(data));
    const url = new URL(path, 'https://ztoread.ziroom.com/');
    const headers = await this.createHeaders(timestamp);
    const timeout = Math.max(1000, this.options.requestTimeout ?? 15_000);

    try {
      const resp = await this.withRequestSlot(() =>
        fetch(url, {
          method: 'POST',
          headers,
          body,
          signal: AbortSignal.timeout(timeout),
        }),
      );

      if (!resp.ok) {
        const error = new Error(`请求失败: ${resp.status} ${resp.statusText}`);
        this.log.error(error.message);
        throw error;
      }

      const text = await resp.text();
      const dataString = decodeDes(text);

      const respData = JSON.parse(dataString) as ZiroomResponse<T>;
      if (respData.code === '200') {
        return respData.data;
      }
      if (respData.code === '40005') {
        const maxRetries = 3;
        if (authRetryCount >= maxRetries) {
          throw new Error(`自如登录重试 ${maxRetries} 次后仍然失败`);
        }
        this.token = '';
        this.tokenExpiredAt = 0;
        this.log.warn(`Token 已失效，正在进行第 ${authRetryCount + 1} 次重新登录`);
        await this.login();
        return this.request(path, data, authRetryCount + 1);
      }
      throw new Error(`[${path}] ${respData.code}: ${respData.message ?? '未知错误'}`);
    } catch (error) {
      if (error instanceof SyntaxError) {
        const err = new Error(`响应解析失败: ${error.message}`);
        this.log.error(err.message);
        throw err;
      }
      this.log.error(String(error));
      throw error;
    }
  }

  private async withRequestSlot<T>(operation: () => Promise<T>): Promise<T> {
    if (this.activeRequests >= ZiroomRequest.MAX_CONCURRENT_REQUESTS) {
      await new Promise<void>((resolve) => this.requestWaiters.push(resolve));
    }
    this.activeRequests += 1;
    try {
      return await operation();
    } finally {
      this.activeRequests -= 1;
      this.requestWaiters.shift()?.();
    }
  }

  public async getDeviceList() {
    const hid = await this.getHid();
    const resp = await this.request<ZiroomDeviceListResponse>('/homeapi/v4/homePageDevice/queryAreaDeviceListNew', {
      uid: await this.getUid(),
      hid,
      type: 0,
      version: 25,
    });
    if (!Array.isArray(resp.deviceData?.deviceList)) {
      throw new Error('自如设备列表响应结构无效');
    }
    const devices = new Map<string, ZiroomDeviceInfo>();
    for (const category of resp.deviceData.deviceList) {
      for (const device of category.deviceList ?? []) {
        devices.set(device.devUuid, device);
      }
    }
    return Array.from(devices.values());
  }

  public async getDeviceDetail(devUuid: string) {
    const hid = await this.getHid();
    const resp = await this.request<ZiroomDeviceInfo>('/homeapi/v3/device/deviceDetailPage', {
      uid: await this.getUid(),
      hid,
      version: 19,
      devUuid,
    });
    return resp;
  }

  public async setDeviceState(devUuid: string, prodOperCode: string, param: string) {
    const hid = await this.getHid();
    const resp = await this.request('/homeapi/v2/device/controlDeviceByOperCode', {
      uid: await this.getUid(),
      hid,
      devUuid,
      prodOperCode,
      param,
    });
    return resp;
  }
}
