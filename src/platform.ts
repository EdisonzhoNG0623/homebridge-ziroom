import type { API, Characteristic, DynamicPlatformPlugin, Logger, PlatformConfig, Service } from 'homebridge';
import { Conditioner02, Curtain01, Light03, Light04 } from './accessories';
import type { BaseAccessory } from './accessories/base';
import { ZiroomRequest, type ZiroomRequestOptions } from './request';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import type {
  ZiroomDeviceInfo,
  ZiroomPlatformAccessory,
  ZiroomPlatformAccessoryContext,
  ZiroomPlatformConfig,
} from './types';

export class ZiroomHomebridgePlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;

  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

  public readonly accessories: ZiroomPlatformAccessory[] = [];

  public readonly request: ZiroomRequest;
  public readonly options: ZiroomPlatformConfig;
  private readonly accessoryHandlers = new Map<string, BaseAccessory>();

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.options = this.config as ZiroomPlatformConfig;
    this.request = new ZiroomRequest(this.log, this.options as ZiroomRequestOptions);
    this.api.on('didFinishLaunching', () => {
      void this.discoverDevices();
    });
    this.api.on('shutdown', () => {
      this.accessoryHandlers.forEach((handler) => handler.destroy());
    });
  }

  configureAccessory(accessory: ZiroomPlatformAccessory) {
    this.log.info('从缓存中获取设备', accessory.displayName);
    this.accessories.push(accessory);
    const device = accessory.context.deviceInfo;
    if (!device) {
      this.log.warn(`缓存设备缺少设备信息，等待重新发现: ${accessory.displayName}`);
      return;
    }
    const AccessoryClass = this.getAccessoryClass(device);
    if (AccessoryClass) {
      this.accessoryHandlers.set(accessory.UUID, new AccessoryClass(this, accessory));
    }
  }

  async discoverDevices() {
    try {
      const devices = await this.request.getDeviceList();
      const discoveredUuids = new Set<string>();
      for (const device of devices) {
        discoveredUuids.add(this.api.hap.uuid.generate(device.devUuid));
        this.handleAccessory(device);
      }

      const staleAccessories = this.accessories.filter((accessory) => !discoveredUuids.has(accessory.UUID));
      if (staleAccessories.length > 0) {
        for (const accessory of staleAccessories) {
          this.accessoryHandlers.get(accessory.UUID)?.destroy();
          this.accessoryHandlers.delete(accessory.UUID);
        }
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, staleAccessories);
        const staleUuids = new Set(staleAccessories.map((accessory) => accessory.UUID));
        const activeAccessories = this.accessories.filter((accessory) => !staleUuids.has(accessory.UUID));
        this.accessories.splice(0, this.accessories.length, ...activeAccessories);
        this.log.info(`移除 ${staleAccessories.length} 个已不存在的缓存设备`);
      }
    } catch (error) {
      this.log.error('发现自如设备失败', error);
    }
  }

  private handleAccessory(device: ZiroomDeviceInfo) {
    const AccessoryClass = this.getAccessoryClass(device);
    if (!AccessoryClass) {
      this.log.warn(`不支持的设备类型: ${device.modelCode}`);
      return;
    }
    const uuid = this.api.hap.uuid.generate(device.devUuid);
    const existingAccessory = this.accessories.find((accessory) => accessory.UUID === uuid);

    if (existingAccessory) {
      this.log.info('从缓存中获取设备', existingAccessory.displayName);
      const existingHandler = this.accessoryHandlers.get(uuid);
      const sameModel =
        existingAccessory.context.deviceInfo.modelCode.trim().toLowerCase() === device.modelCode.trim().toLowerCase();
      existingAccessory.context.deviceInfo = {
        ...existingAccessory.context.deviceInfo,
        ...device,
        devStateMap: { ...existingAccessory.context.deviceInfo.devStateMap, ...device.devStateMap },
        groupInfoMap: { ...existingAccessory.context.deviceInfo.groupInfoMap, ...device.groupInfoMap },
      };
      this.api.updatePlatformAccessories([existingAccessory]);
      if (existingHandler && sameModel) {
        existingHandler.updateDeviceInfo(existingAccessory.context.deviceInfo);
      } else {
        existingHandler?.destroy();
        this.accessoryHandlers.set(uuid, new AccessoryClass(this, existingAccessory));
      }
    } else {
      const displayName = this.getDeviceName(device);
      this.log.info('添加新设备', displayName);
      const accessory = new this.api.platformAccessory<ZiroomPlatformAccessoryContext>(displayName, uuid);
      accessory.context = {
        deviceInfo: device,
      };
      this.accessoryHandlers.set(uuid, new AccessoryClass(this, accessory));
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      this.accessories.push(accessory);
    }
    return device.devUuid;
  }

  private getAccessoryClass(device: ZiroomDeviceInfo) {
    switch (device.modelCode.trim().toLowerCase()) {
      case 'light03':
        return Light03;
      case 'light04':
        return Light04;
      case 'conditioner02':
        return Conditioner02;
      case 'curtain01':
        return Curtain01;
      default:
        return null;
    }
  }

  private getDeviceName(device: ZiroomDeviceInfo) {
    return `${device.rname} - ${device.devName}`;
  }
}
