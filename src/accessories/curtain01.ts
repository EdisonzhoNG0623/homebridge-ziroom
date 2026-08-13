import type { CharacteristicValue } from 'homebridge';
import type { ZiroomDeviceInfo } from '../types';
import { BaseAccessory } from './base';
import { clamp, elementText, findToggleValue, scaleValue } from './utils';

const POSITION_ALIASES = ['curtain_position', 'set_position'] as const;
const STOP_ALIASES = ['curtain_stop', 'set_stop', 'curtain_pause', 'set_pause'] as const;

export class Curtain01 extends BaseAccessory {
  private currentPosition = 0;
  private targetPosition?: number;
  private previousPosition?: number;
  private hasCurrentPosition = false;
  private movementStartedAt = 0;
  private movementTimer?: NodeJS.Timeout;

  init() {
    const service = this.setServices('curtain', this.platform.Service.WindowCovering);
    service.getCharacteristic(this.Characteristic.CurrentPosition).onGet(this.getCurrentPosition.bind(this));
    service
      .getCharacteristic(this.Characteristic.TargetPosition)
      .onGet(this.getTargetPosition.bind(this))
      .onSet(this.setTargetPosition.bind(this));
    service.getCharacteristic(this.Characteristic.PositionState).onGet(this.getPositionState.bind(this));

    const stopGroup = this.getGroupInfo('curtain_stop', STOP_ALIASES);
    if (stopGroup && findToggleValue(stopGroup, true) !== undefined) {
      service.getCharacteristic(this.Characteristic.HoldPosition).onSet(this.holdPosition.bind(this));
    }
  }

  onDeviceInfoChange(_deviceInfo: ZiroomDeviceInfo) {
    const rawPosition = Number(this.getDevicePropsSync('curtain_opening', POSITION_ALIASES));
    if (!Number.isFinite(rawPosition)) {
      return;
    }

    this.previousPosition = this.hasCurrentPosition ? this.currentPosition : undefined;
    this.currentPosition = this.fromDevicePosition(rawPosition);
    this.hasCurrentPosition = true;
    const state = this.calculatePositionState();
    const service = this.services.curtain;
    if (!service) {
      return;
    }
    service.getCharacteristic(this.Characteristic.CurrentPosition).updateValue(this.currentPosition);
    service
      .getCharacteristic(this.Characteristic.TargetPosition)
      .updateValue(this.targetPosition ?? this.currentPosition);
    service.getCharacteristic(this.Characteristic.PositionState).updateValue(state);
  }

  public override destroy() {
    super.destroy();
    if (this.movementTimer) {
      clearTimeout(this.movementTimer);
    }
  }

  async getCurrentPosition() {
    const rawPosition = Number(await this.getDeviceProps('curtain_opening', POSITION_ALIASES));
    if (!Number.isFinite(rawPosition)) {
      throw this.communicationError(new Error('窗帘位置无效'));
    }
    return this.fromDevicePosition(rawPosition);
  }

  async getTargetPosition() {
    return this.targetPosition ?? this.getCurrentPosition();
  }

  getPositionState() {
    return this.calculatePositionState();
  }

  async setTargetPosition(value: CharacteristicValue) {
    const requestedPosition = Math.round(clamp(Number(value), 0, 100));
    const position = this.supportsIntermediatePositions() ? requestedPosition : requestedPosition > 0 ? 100 : 0;
    this.targetPosition = position;
    this.movementStartedAt = Date.now();
    this.services.curtain
      .getCharacteristic(this.Characteristic.PositionState)
      .updateValue(
        position >= this.currentPosition
          ? this.Characteristic.PositionState.INCREASING
          : this.Characteristic.PositionState.DECREASING,
      );
    await this.setPosition(this.toDevicePosition(position));
    this.startMovementMonitor();
  }

  async holdPosition(value: CharacteristicValue) {
    if (!value) {
      return;
    }
    const group = this.getGroupInfo('curtain_stop', STOP_ALIASES);
    const stopValue = group ? findToggleValue(group, true) : undefined;
    if (!group || stopValue === undefined) {
      throw this.communicationError(new Error('窗帘不支持停止'));
    }
    await this.setDeviceProps('curtain_stop', stopValue, STOP_ALIASES);
    this.targetPosition = this.currentPosition;
    this.movementStartedAt = 0;
    this.services.curtain
      .getCharacteristic(this.Characteristic.PositionState)
      .updateValue(this.Characteristic.PositionState.STOPPED);
  }

  private getPositionRange() {
    const element = this.getGroupInfo('curtain_opening', POSITION_ALIASES)?.devElementList[0];
    return {
      min: element?.minValue ?? 0,
      max: element?.maxValue ?? 100,
    };
  }

  private fromDevicePosition(value: number) {
    const { min, max } = this.getPositionRange();
    const normalized = scaleValue(value, min, max, 0, 100);
    return Math.round(this.deviceConfig.reversePosition ? 100 - normalized : normalized);
  }

  private toDevicePosition(value: number) {
    const { min, max } = this.getPositionRange();
    const normalized = this.deviceConfig.reversePosition ? 100 - value : value;
    return Math.round(scaleValue(normalized, 0, 100, min, max));
  }

  private async setPosition(devicePosition: number) {
    const controlGroup = this.getGroupInfo('set_on_off');
    if (controlGroup) {
      const openElement = controlGroup.devElementList.find((element) =>
        /open|窗帘开|打开|开启/.test(elementText(element)),
      );
      const closeElement = controlGroup.devElementList.find((element) =>
        /close|窗帘关|关闭/.test(elementText(element)),
      );
      if (devicePosition <= 0 && closeElement) {
        await this.setDeviceState(closeElement, closeElement.value || '1');
        return;
      }
      if (devicePosition > 0 && openElement) {
        await this.setDeviceState(openElement, devicePosition.toString());
        return;
      }
    }
    await this.setDeviceProps('curtain_opening', devicePosition.toString(), POSITION_ALIASES);
  }

  private supportsIntermediatePositions() {
    const positionElement = this.getGroupInfo('curtain_opening', POSITION_ALIASES)?.devElementList[0];
    return positionElement?.elementType !== 0 || !this.getGroupInfo('set_on_off');
  }

  private calculatePositionState() {
    const { PositionState } = this.Characteristic;
    if (
      this.targetPosition !== undefined &&
      Date.now() - this.movementStartedAt < 120_000 &&
      Math.abs(this.targetPosition - this.currentPosition) > 1
    ) {
      return this.targetPosition > this.currentPosition ? PositionState.INCREASING : PositionState.DECREASING;
    }
    if (this.previousPosition !== undefined && Math.abs(this.previousPosition - this.currentPosition) > 0.5) {
      return this.currentPosition > this.previousPosition ? PositionState.INCREASING : PositionState.DECREASING;
    }
    return PositionState.STOPPED;
  }

  private startMovementMonitor() {
    if (this.movementTimer) {
      clearTimeout(this.movementTimer);
    }
    const poll = async () => {
      try {
        await this.loadDeviceInfo();
      } catch (error) {
        this.platform.log.warn(`刷新窗帘运动状态失败: ${this.accessory.displayName}`, String(error));
      }
      const isMoving =
        this.targetPosition !== undefined &&
        Math.abs(this.targetPosition - this.currentPosition) > 1 &&
        Date.now() - this.movementStartedAt < 120_000;
      if (isMoving) {
        this.movementTimer = setTimeout(poll, 3000);
        this.movementTimer.unref();
      } else {
        this.movementStartedAt = 0;
        this.targetPosition = this.currentPosition;
        this.services.curtain
          .getCharacteristic(this.Characteristic.PositionState)
          .updateValue(this.Characteristic.PositionState.STOPPED);
      }
    };
    this.movementTimer = setTimeout(poll, 3000);
    this.movementTimer.unref();
  }
}
