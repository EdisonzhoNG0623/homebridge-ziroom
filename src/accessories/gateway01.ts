import type { CharacteristicValue } from 'homebridge';
import { BaseAccessory } from './base';

export class Gateway01 extends BaseAccessory {
  init() {
    this.setServices('switch', this.platform.Service.Switch, '网关指示灯')
      .getCharacteristic(this.Characteristic.On)
      .onGet(this.getOn.bind(this))
      .onSet(this.setOn.bind(this));
  }

  onDeviceInfoChange() {
    this.services.switch?.getCharacteristic(this.Characteristic.On).updateValue(this.isOn());
  }

  private isOn() {
    return this.deviceInfo.devStateMap.max_light === '1';
  }

  getOn() {
    return this.isOn();
  }

  async setOn(value: CharacteristicValue) {
    await this.setDeviceProps('light', value ? '1' : '0');
  }
}
