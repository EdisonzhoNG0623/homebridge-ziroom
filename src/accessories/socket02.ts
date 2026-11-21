import type { CharacteristicValue } from 'homebridge';
import { BaseAccessory } from './base';

const AC_ON = '11';
const USB_ON = '21';

export class Socket02 extends BaseAccessory {
  init() {
    const outlet = this.setServices('outlet', this.platform.Service.Outlet);

    outlet.getCharacteristic(this.Characteristic.On).onGet(this.getOn.bind(this)).onSet(this.setOn.bind(this));
    outlet.getCharacteristic(this.Characteristic.OutletInUse).onGet(this.getOutletInUse.bind(this));
  }

  onDeviceInfoChange() {
    this.services.outlet?.getCharacteristic(this.Characteristic.On).updateValue(this.isOn());
    this.services.outlet?.getCharacteristic(this.Characteristic.OutletInUse).updateValue(this.outletInUse());
  }

  private isOn() {
    const states = this.deviceInfo.devStateMap;
    return states.hongyanUSB_jiaoliu_switchstatus === AC_ON || states.hongyanUSB_zhiliu_switchstatus === USB_ON;
  }

  private outletInUse() {
    return Number(this.deviceInfo.devStateMap.hongyanUSB_powerstatus) > 0;
  }

  getOn() {
    return this.isOn();
  }

  async setOn(value: CharacteristicValue) {
    await this.setDeviceProps('set_on_off', value ? AC_ON : '10');
  }

  private getOutletInUse() {
    return this.outletInUse();
  }
}
