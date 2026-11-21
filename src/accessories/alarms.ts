import { BaseAccessory } from './base';
import { batteryService, clamp } from './utils';

// 报警器只上报 devStateMap（无 groupInfoMap 操作组），key 带产品型号前缀，按后缀匹配。
abstract class AlarmBase extends BaseAccessory {
  private state(suffix: string) {
    const key = Object.keys(this.deviceInfo.devStateMap).find((k) => k.endsWith(suffix));
    return key ? this.deviceInfo.devStateMap[key] : undefined;
  }

  protected alarmed() {
    const value = this.state('_alarmed');
    return value !== undefined && value !== '0';
  }

  protected fault() {
    return this.state('_trouble_change') === '1';
  }

  protected lowBattery() {
    return this.state('low_battery_change') === '1';
  }

  protected batteryLevel() {
    return clamp(Number.parseInt(this.state('_batterystate') ?? '', 10) || 0, 0, 100);
  }

  protected setupBattery() {
    if (this.state('_batterystate') === undefined && this.state('low_battery_change') === undefined) {
      return;
    }
    const battery = this.setServices('battery', batteryService(this.platform.Service), '电量');
    battery.getCharacteristic(this.Characteristic.BatteryLevel).onGet(() => this.batteryLevel());
    battery.getCharacteristic(this.Characteristic.StatusLowBattery).onGet(() => (this.lowBattery() ? 1 : 0));
    battery
      .getCharacteristic(this.Characteristic.ChargingState)
      .onGet(() => this.Characteristic.ChargingState.NOT_CHARGEABLE);
  }
}

export class Smokealarm01 extends AlarmBase {
  init() {
    const sensor = this.setServices('smoke', this.platform.Service.SmokeSensor);
    sensor
      .getCharacteristic(this.Characteristic.SmokeDetected)
      .onGet(() =>
        this.alarmed()
          ? this.Characteristic.SmokeDetected.SMOKE_DETECTED
          : this.Characteristic.SmokeDetected.SMOKE_NOT_DETECTED,
      );
    sensor.getCharacteristic(this.Characteristic.StatusFault).onGet(() => (this.fault() ? 1 : 0));
    this.setupBattery();
  }

  onDeviceInfoChange() {
    this.services.smoke
      ?.getCharacteristic(this.Characteristic.SmokeDetected)
      .updateValue(
        this.alarmed()
          ? this.Characteristic.SmokeDetected.SMOKE_DETECTED
          : this.Characteristic.SmokeDetected.SMOKE_NOT_DETECTED,
      );
    this.services.smoke?.getCharacteristic(this.Characteristic.StatusFault).updateValue(this.fault() ? 1 : 0);
    this.services.battery?.getCharacteristic(this.Characteristic.BatteryLevel).updateValue(this.batteryLevel());
    this.services.battery
      ?.getCharacteristic(this.Characteristic.StatusLowBattery)
      .updateValue(this.lowBattery() ? 1 : 0);
  }
}

export class Gasalarm01 extends AlarmBase {
  init() {
    const sensor = this.setServices('gas', this.platform.Service.CarbonMonoxideSensor);
    sensor
      .getCharacteristic(this.Characteristic.CarbonMonoxideDetected)
      .onGet(() =>
        this.alarmed()
          ? this.Characteristic.CarbonMonoxideDetected.CO_LEVELS_ABNORMAL
          : this.Characteristic.CarbonMonoxideDetected.CO_LEVELS_NORMAL,
      );
    sensor.getCharacteristic(this.Characteristic.StatusFault).onGet(() => (this.fault() ? 1 : 0));
    this.setupBattery();
  }

  onDeviceInfoChange() {
    this.services.gas
      ?.getCharacteristic(this.Characteristic.CarbonMonoxideDetected)
      .updateValue(
        this.alarmed()
          ? this.Characteristic.CarbonMonoxideDetected.CO_LEVELS_ABNORMAL
          : this.Characteristic.CarbonMonoxideDetected.CO_LEVELS_NORMAL,
      );
    this.services.gas?.getCharacteristic(this.Characteristic.StatusFault).updateValue(this.fault() ? 1 : 0);
    this.services.battery?.getCharacteristic(this.Characteristic.BatteryLevel).updateValue(this.batteryLevel());
    this.services.battery
      ?.getCharacteristic(this.Characteristic.StatusLowBattery)
      .updateValue(this.lowBattery() ? 1 : 0);
  }
}
