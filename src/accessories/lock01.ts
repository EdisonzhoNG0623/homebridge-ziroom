import type { CharacteristicValue } from 'homebridge';
import { BaseAccessory } from './base';
import { batteryService, clamp } from './utils';

// Ziroom 门锁仅上报状态（锁状态/防撬/电量），云端 API 不提供开锁/上锁操作码。
// lock_state 枚举未完整公开，仅确认: 12=虚掩, 14=已锁（实测）；其余按 Unknown 上报。
const SECURED_VALUES = new Set(['14']);
const UNSECURED_VALUES = new Set(['11', '12', '13']);

export class Lock01 extends BaseAccessory {
  init() {
    const lock = this.setServices('lock', this.platform.Service.LockMechanism);

    lock.getCharacteristic(this.Characteristic.LockCurrentState).onGet(this.getCurrentState.bind(this));
    lock
      .getCharacteristic(this.Characteristic.LockTargetState)
      .onGet(this.getTargetState.bind(this))
      .onSet(this.setTargetState.bind(this));

    this.setServices('battery', batteryService(this.platform.Service), '电量')
      .getCharacteristic(this.Characteristic.BatteryLevel)
      .onGet(() => clamp(Number.parseInt(this.state('battery_state'), 10) || 0, 0, 100));
    this.services.battery
      .getCharacteristic(this.Characteristic.StatusLowBattery)
      .onGet(() => (this.batteryLevel() < 20 ? 1 : 0));
    this.services.battery
      .getCharacteristic(this.Characteristic.ChargingState)
      .onGet(() => this.Characteristic.ChargingState.NOT_CHARGEABLE);
  }

  onDeviceInfoChange() {
    const state = this.currentState();
    this.services.lock?.getCharacteristic(this.Characteristic.LockCurrentState).updateValue(state);
    this.services.lock?.getCharacteristic(this.Characteristic.LockTargetState).updateValue(this.targetState(state));
    this.services.battery?.getCharacteristic(this.Characteristic.BatteryLevel).updateValue(this.batteryLevel());
  }

  private state(key: string) {
    return this.deviceInfo.devStateMap[key];
  }

  private batteryLevel() {
    return clamp(Number.parseInt(this.state('battery_state'), 10) || 0, 0, 100);
  }

  private currentState() {
    const value = this.state('lock_state');
    if (value !== undefined && SECURED_VALUES.has(value)) {
      return this.Characteristic.LockCurrentState.SECURED;
    }
    if (value !== undefined && UNSECURED_VALUES.has(value)) {
      return this.Characteristic.LockCurrentState.UNSECURED;
    }
    return this.Characteristic.LockCurrentState.UNKNOWN;
  }

  private targetState(current = this.currentState()) {
    return current === this.Characteristic.LockCurrentState.SECURED
      ? this.Characteristic.LockTargetState.SECURED
      : this.Characteristic.LockTargetState.UNSECURED;
  }

  private getCurrentState() {
    return this.currentState();
  }

  private getTargetState() {
    return this.targetState();
  }

  private setTargetState(_value: CharacteristicValue) {
    this.platform.log.warn(`${this.accessory.displayName} 不支持远程开锁/上锁，仅同步状态`);
    setTimeout(() => {
      this.services.lock?.getCharacteristic(this.Characteristic.LockTargetState).updateValue(this.targetState());
    }, 100);
  }
}
