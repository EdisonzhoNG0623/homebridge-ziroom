import { BaseAccessory } from './base';

// API 对该设备只下发型号信息，无任何状态或操作组，仅注册占位让配件可见。
export class Toiletseat extends BaseAccessory {
  init() {}

  onDeviceInfoChange() {}
}
