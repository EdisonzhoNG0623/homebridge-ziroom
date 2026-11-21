import type { CharacteristicValue } from 'homebridge';
import type { ZiroomDevElementInfo } from '../types';
import { BaseAccessory } from './base';

interface ToggleGroup {
  name: string;
  on: ZiroomDevElementInfo;
  off: ZiroomDevElementInfo;
}

// 智控面板的功能项统一是「开/关」双元素组（elementType 1=开, 2=关，均带 prodOperCode）。
// 语言枚举、息屏时间等其他类型不属于开关，自动排除。
export class Fullscreen extends BaseAccessory {
  private toggleGroups: Record<string, ToggleGroup> = {};

  init() {
    for (const [key, group] of Object.entries(this.deviceInfo.groupInfoMap ?? {})) {
      if (group.groupType !== 1) {
        continue;
      }
      const on = group.devElementList.find((el) => el.elementType === 1 && el.prodOperCode);
      const off = group.devElementList.find((el) => el.elementType === 2 && el.prodOperCode);
      if (!on || !off) {
        continue;
      }
      this.toggleGroups[key] = { name: group.groupName, on, off };
      this.setServices(`sw:${key}`, this.platform.Service.Switch, group.groupName)
        .getCharacteristic(this.Characteristic.On)
        .onGet(() => this.isOn(key))
        .onSet((value: CharacteristicValue) => this.setOn(key, value));
    }
  }

  onDeviceInfoChange() {
    for (const key of Object.keys(this.toggleGroups)) {
      this.services[`sw:${key}`]?.getCharacteristic(this.Characteristic.On).updateValue(this.isOn(key));
    }
  }

  private isOn(key: string) {
    const group = this.toggleGroups[key];
    return group ? this.deviceInfo.devStateMap[group.on.prodStateCode] === group.on.value : false;
  }

  private async setOn(key: string, value: CharacteristicValue) {
    const group = this.toggleGroups[key];
    if (!group) {
      return;
    }
    await this.setDeviceProps(key, value ? group.on.value : group.off.value);
  }
}
