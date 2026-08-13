import type { Service } from 'homebridge';
import type { ZiroomHomebridgePlatform } from '../platform';
import type {
  ZiroomDevElementInfo,
  ZiroomDeviceConfig,
  ZiroomDeviceInfo,
  ZiroomGroupInfo,
  ZiroomPlatformAccessory,
} from '../types';

const SERVICE_COMMUNICATION_FAILURE = -70402;

export abstract class BaseAccessory {
  public services: Record<string, Service> = {};

  private getDeviceDetailPromise: Promise<ZiroomDeviceInfo> | null = null;
  private writeQueue: Promise<void> = Promise.resolve();
  private pollTimer?: NodeJS.Timeout;
  private initialized = false;
  private destroyed = false;

  constructor(
    public readonly platform: ZiroomHomebridgePlatform,
    readonly accessory: ZiroomPlatformAccessory,
  ) {
    this.initializeAccessory();
  }

  abstract init(): void;

  abstract onDeviceInfoChange(deviceInfo: ZiroomDeviceInfo): void;

  private async initializeAccessory() {
    let deviceInfo: ZiroomDeviceInfo | undefined;
    try {
      deviceInfo = await this.loadDeviceInfo();
      const infoService = this.accessory.getService(this.platform.Service.AccessoryInformation);

      const accessoryInformationMap = {
        Manufacturer: this.validAccessoryInformation(deviceInfo.brandName, 'Ziroom'),
        Model: this.validAccessoryInformation(deviceInfo.modelName, deviceInfo.modelCode),
        Name: deviceInfo.prodTypeName,
        SerialNumber: deviceInfo.prodTypeId,
      } as const;
      Object.entries(accessoryInformationMap).forEach(([key, value]) => {
        if (value) {
          infoService
            ?.getCharacteristic(this.platform.Characteristic[key as keyof typeof accessoryInformationMap])
            .onGet(() => value);
        }
      });
    } catch (error) {
      this.platform.log.error(`设备初始化失败: ${this.accessory.displayName}`, error);
    }
    try {
      this.init();
      this.initialized = true;
      if (deviceInfo) {
        this.onDeviceInfoChange(deviceInfo);
      }
    } catch (error) {
      this.platform.log.error(`注册设备服务失败: ${this.accessory.displayName}`, error);
    }
    this.schedulePoll();
  }

  private async getDeviceDetail() {
    if (!this.getDeviceDetailPromise) {
      this.getDeviceDetailPromise = this.platform.request.getDeviceDetail(this.deviceInfo.devUuid).finally(() => {
        this.getDeviceDetailPromise = null;
      });
    }
    return this.getDeviceDetailPromise;
  }

  protected async loadDeviceInfo() {
    const deviceInfo = await this.getDeviceDetail();
    if (!deviceInfo) {
      throw new Error(`无法获取设备详情: ${this.deviceInfo.devUuid}`);
    }
    const newDeviceInfo = { ...this.deviceInfo, ...deviceInfo };
    this.accessory.context.deviceInfo = newDeviceInfo;
    if (this.initialized) {
      this.onDeviceInfoChange(newDeviceInfo);
    }
    return newDeviceInfo;
  }

  private schedulePoll() {
    const pollInterval = this.platform.options.pollInterval ?? 30;
    if (this.destroyed || pollInterval <= 0) {
      return;
    }
    this.pollTimer = setTimeout(async () => {
      try {
        await this.loadDeviceInfo();
      } catch (error) {
        this.platform.log.warn(`刷新设备状态失败: ${this.accessory.displayName}`, String(error));
      } finally {
        this.schedulePoll();
      }
    }, Math.max(10, pollInterval) * 1000);
    this.pollTimer.unref();
  }

  public destroy() {
    this.destroyed = true;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
    }
  }

  public updateDeviceInfo(deviceInfo: ZiroomDeviceInfo) {
    const current = this.deviceInfo;
    const mergedDeviceInfo = {
      ...current,
      ...deviceInfo,
      devStateMap: { ...current.devStateMap, ...deviceInfo.devStateMap },
      groupInfoMap: { ...current.groupInfoMap, ...deviceInfo.groupInfoMap },
    };
    this.accessory.context.deviceInfo = mergedDeviceInfo;
    if (this.initialized) {
      this.onDeviceInfoChange(mergedDeviceInfo);
    }
  }

  protected setServices<T extends typeof Service>(key: string, service: T, name?: string): InstanceType<T> {
    // 检查服务是否已存在
    const existingService = this.accessory.getService(key);
    if (existingService) {
      this.services[key] = existingService;
      return existingService as InstanceType<T>;
    }

    // 创建新服务
    const serviceName = name ? `${this.accessory.displayName} - ${name}` : this.accessory.displayName;

    const newService = this.accessory.addService(service as typeof Service, serviceName, key);
    newService.setCharacteristic(this.Characteristic.Name, serviceName);
    this.services[key] = newService;

    return newService as InstanceType<T>;
  }

  protected removeService(key: string) {
    const existingService = this.accessory.getService(key);
    if (existingService) {
      this.accessory.removeService(existingService);
    }
    delete this.services[key];
  }

  protected get Characteristic() {
    return this.platform.Characteristic;
  }

  protected get deviceInfo() {
    return this.accessory.context.deviceInfo;
  }

  protected get deviceConfig(): ZiroomDeviceConfig {
    return this.platform.options.devConfig?.[this.deviceInfo.devUuid] ?? {};
  }

  protected resolveProperty(prop: string, aliases: readonly string[] = []) {
    const configured = this.deviceConfig.propertyMap?.[prop];
    const candidates = [configured, prop, ...aliases].filter((candidate): candidate is string => Boolean(candidate));
    return candidates.find((candidate) => this.deviceInfo.groupInfoMap[candidate]);
  }

  protected getGroupInfo(prop: string, aliases: readonly string[] = []): ZiroomGroupInfo | undefined {
    const resolved = this.resolveProperty(prop, aliases);
    return resolved ? this.deviceInfo.groupInfoMap[resolved] : undefined;
  }

  protected hasDeviceProps(prop: string, aliases: readonly string[] = []) {
    return Boolean(this.getGroupInfo(prop, aliases));
  }

  protected getDevicePropsSync(prop: string, aliases: readonly string[] = []) {
    const element = this.getGroupInfo(prop, aliases)?.devElementList?.[0];
    return element ? this.deviceInfo.devStateMap[element.prodStateCode] : undefined;
  }

  protected async getDeviceProps(prop: string, aliases: readonly string[] = []) {
    this.assertOnline();
    return this.getDevicePropsSync(prop, aliases);
  }

  private validAccessoryInformation(value: string | undefined, fallback: string) {
    const normalized = value?.trim() ?? '';
    return normalized.length > 1 ? normalized : fallback;
  }

  protected async setDeviceProps(prop: string, value: string, aliases: readonly string[] = []) {
    const groupInfo = this.getGroupInfo(prop, aliases);
    if (!groupInfo) {
      throw new Error(`无法找到属性组: ${prop}`);
    }
    return this.enqueueWrite(async () => {
      this.assertOnline();
      switch (groupInfo.groupType) {
        case 1: {
          const element =
            groupInfo.devElementList.find((item) => item.value === value.toString()) ??
            (groupInfo.devElementList.length === 1 ? groupInfo.devElementList[0] : undefined);
          if (!element) {
            throw new Error(`无法找到元素: ${prop}=${value}`);
          }
          await this.setDeviceState(element, value.toString());
          break;
        }
        case 2: {
          const element = groupInfo.devElementList[0];
          if (!element) {
            throw new Error(`属性组没有可用元素: ${prop}`);
          }
          const numericValue = Number(value);
          const { maxValue = Number.MAX_SAFE_INTEGER, minValue = Number.MIN_SAFE_INTEGER } = element;
          if (!Number.isFinite(numericValue) || numericValue < minValue || numericValue > maxValue) {
            throw new Error(`值超出范围: ${prop}=${value}`);
          }
          await this.setDeviceState(element, value.toString());
          break;
        }
        default:
          throw new Error(`不支持的组类型: ${prop} (${groupInfo.groupType})`);
      }
    });
  }

  protected async setDeviceState(element: ZiroomDevElementInfo, value: string) {
    this.platform.log.debug('设置', this.accessory.displayName, element.elementName, value);
    try {
      await this.platform.request.setDeviceState(this.deviceInfo.devUuid, element.prodOperCode, value);
      this.platform.log.info('设置成功', this.accessory.displayName, element.elementName, value);
      await this.loadDeviceInfo();
    } catch (error) {
      this.platform.log.error('设置失败', this.accessory.displayName, element.elementName, value, error);
      throw this.communicationError(error);
    }
  }

  protected communicationError(error?: unknown) {
    if (error instanceof this.platform.api.hap.HapStatusError) {
      return error;
    }
    return new this.platform.api.hap.HapStatusError(SERVICE_COMMUNICATION_FAILURE);
  }

  private assertOnline() {
    if (this.deviceInfo.isOnline === 0) {
      throw this.communicationError(new Error('设备离线'));
    }
  }

  private enqueueWrite<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.writeQueue.then(operation, operation);
    this.writeQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
