import type { CharacteristicValue, Service } from 'homebridge';
import type { ZiroomDeviceInfo, ZiroomGroupInfo } from '../types';
import { BaseAccessory } from './base';
import {
  elementText,
  enumValueToPercentage,
  findToggleValue,
  isAutoElement,
  orderedElements,
  percentageToEnumValue,
  scaleValue,
} from './utils';

enum AcOperationMode {
  HEAT = 'heat',
  COOL = 'cool',
  AUTO = 'auto',
  DEHUM = 'dehum',
  WIND = 'wind',
}

const FAN_SPEED_ALIASES = ['set_wind_speed', 'set_wind', 'set_air_speed', 'set_fan_speed', 'set_speed'] as const;
const SWING_ALIASES = [
  'set_wind_up_down',
  'set_swing',
  'set_sweep',
  'set_wind_direction',
  'set_up_down',
  'set_swing_on_off',
] as const;
const SLEEP_ALIASES = ['set_sleep', 'set_sleep_mode'] as const;
const ECO_ALIASES = ['set_eco', 'set_energy_saving', 'set_energy_save'] as const;
const SCREEN_LIGHT_ALIASES = ['conditioner_screenlight', 'set_screenlight', 'set_display'] as const;
const OUTDOOR_TEMPERATURE_ALIASES = ['conditioner_outdoortempre', 'show_outside_tem'] as const;

export class Conditioner02 extends BaseAccessory {
  init() {
    const thermostat = this.setServices('thermostat', this.platform.Service.Thermostat);

    thermostat
      .getCharacteristic(this.Characteristic.CurrentHeatingCoolingState)
      .onGet(this.getCurrentHeatingCoolingState.bind(this));
    const targetState = thermostat
      .getCharacteristic(this.Characteristic.TargetHeatingCoolingState)
      .onGet(this.getTargetHeatingCoolingState.bind(this))
      .onSet(this.setTargetHeatingCoolingState.bind(this));
    thermostat.getCharacteristic(this.Characteristic.CurrentTemperature).onGet(this.getCurrentTemperature.bind(this));
    const targetTemperature = thermostat
      .getCharacteristic(this.Characteristic.TargetTemperature)
      .onGet(this.getTargetTemperature.bind(this))
      .onSet(this.setTargetTemperature.bind(this));
    thermostat
      .getCharacteristic(this.Characteristic.TemperatureDisplayUnits)
      .onGet(() => this.Characteristic.TemperatureDisplayUnits.CELSIUS);

    const supportedTargetStates = this.getSupportedTargetStates();
    targetState.setProps({ validValues: supportedTargetStates });

    const temperatureElement = this.getGroupInfo('set_tem')?.devElementList[0];
    if (temperatureElement) {
      const currentTarget = Number(this.getDevicePropsSync('set_tem'));
      if (Number.isFinite(currentTarget)) {
        targetTemperature.updateValue(currentTarget);
      }
      targetTemperature.setProps({
        minValue: temperatureElement.minValue ?? 16,
        maxValue: temperatureElement.maxValue ?? 30,
        minStep: 1,
      });
    }

    if (this.hasDeviceProps('show_inside_hum')) {
      thermostat
        .getCharacteristic(this.Characteristic.CurrentRelativeHumidity)
        .onGet(this.getCurrentRelativeHumidity.bind(this));
    }

    this.configureAirflowService();
    this.configureModeSwitch('dryMode', '除湿模式', AcOperationMode.DEHUM);
    this.configureModeSwitch('windMode', '送风模式', AcOperationMode.WIND);
    this.configureToggleSwitch('sleepMode', '睡眠模式', 'sleep', SLEEP_ALIASES);
    this.configureToggleSwitch('ecoMode', '节能模式', 'eco', ECO_ALIASES);
    this.configureToggleSwitch('screenLight', '屏显', 'screen_light', SCREEN_LIGHT_ALIASES);
    this.configureOutdoorTemperatureService();
  }

  onDeviceInfoChange(_deviceInfo: ZiroomDeviceInfo) {
    const thermostat = this.services.thermostat;
    if (thermostat) {
      thermostat
        .getCharacteristic(this.Characteristic.CurrentHeatingCoolingState)
        .updateValue(this.currentHeatingCoolingStateSync());
      thermostat
        .getCharacteristic(this.Characteristic.TargetHeatingCoolingState)
        .updateValue(this.targetHeatingCoolingStateSync());
      this.updateNumericCharacteristic(thermostat, this.Characteristic.CurrentTemperature, 'show_inside_tem');
      this.updateNumericCharacteristic(thermostat, this.Characteristic.TargetTemperature, 'set_tem');
      if (this.hasDeviceProps('show_inside_hum')) {
        this.updateNumericCharacteristic(thermostat, this.Characteristic.CurrentRelativeHumidity, 'show_inside_hum');
      }
    }

    this.updateAirflowService();
    this.updateModeSwitch('dryMode', AcOperationMode.DEHUM);
    this.updateModeSwitch('windMode', AcOperationMode.WIND);
    this.updateToggleSwitch('sleepMode', 'sleep', SLEEP_ALIASES);
    this.updateToggleSwitch('ecoMode', 'eco', ECO_ALIASES);
    this.updateToggleSwitch('screenLight', 'screen_light', SCREEN_LIGHT_ALIASES);
    const outdoorTemperature = this.services.outdoorTemperature;
    if (outdoorTemperature) {
      this.updateNumericCharacteristic(
        outdoorTemperature,
        this.Characteristic.CurrentTemperature,
        'outdoor_temperature',
        OUTDOOR_TEMPERATURE_ALIASES,
      );
    }
  }

  async getCurrentHeatingCoolingState() {
    await this.getDeviceProps('set_on_off');
    return this.currentHeatingCoolingStateSync();
  }

  async getTargetHeatingCoolingState() {
    await this.getDeviceProps('set_on_off');
    return this.targetHeatingCoolingStateSync();
  }

  async setTargetHeatingCoolingState(value: CharacteristicValue) {
    const { TargetHeatingCoolingState } = this.Characteristic;
    if (value === TargetHeatingCoolingState.OFF) {
      await this.setPower(false);
      return;
    }

    const mode = new Map<number, AcOperationMode>([
      [TargetHeatingCoolingState.HEAT, AcOperationMode.HEAT],
      [TargetHeatingCoolingState.COOL, AcOperationMode.COOL],
      [TargetHeatingCoolingState.AUTO, AcOperationMode.AUTO],
    ]).get(Number(value));
    if (!mode || !this.supportsMode(mode)) {
      throw this.communicationError(new Error(`空调不支持目标模式: ${value}`));
    }
    if (!this.isPoweredOn()) {
      await this.setPower(true);
    }
    await this.setMode(mode);
  }

  async getCurrentTemperature() {
    return this.getNumericProperty('show_inside_tem');
  }

  async getTargetTemperature() {
    return this.getNumericProperty('set_tem');
  }

  async setTargetTemperature(value: CharacteristicValue) {
    await this.setDeviceProps('set_tem', Number(value).toString());
  }

  async getCurrentRelativeHumidity() {
    return this.getNumericProperty('show_inside_hum');
  }

  private configureAirflowService() {
    const speedGroup = this.getFanSpeedGroup();
    const swingGroup = this.getSwingGroup();
    if (!speedGroup && !swingGroup) {
      this.removeService('airflow');
      return;
    }

    const fan = this.setServices('airflow', this.platform.Service.Fanv2, '风速与摆风');
    fan
      .getCharacteristic(this.Characteristic.Active)
      .onGet(this.getFanActive.bind(this))
      .onSet(this.setFanActive.bind(this));
    fan
      .getCharacteristic(this.Characteristic.CurrentFanState)
      .onGet(() =>
        this.isPoweredOn()
          ? this.Characteristic.CurrentFanState.BLOWING_AIR
          : this.Characteristic.CurrentFanState.INACTIVE,
      );

    if (speedGroup) {
      const manualSpeeds = orderedElements(speedGroup, true);
      if (manualSpeeds.length > 0) {
        const rotationSpeed = fan
          .getCharacteristic(this.Characteristic.RotationSpeed)
          .onGet(this.getFanSpeed.bind(this))
          .onSet(this.setFanSpeed.bind(this));
        rotationSpeed.setProps({
          minValue: 0,
          maxValue: 100,
          minStep: Math.max(1, Math.round(100 / manualSpeeds.length)),
        });
      }

      if (manualSpeeds.length > 0 && speedGroup.devElementList.some(isAutoElement)) {
        fan
          .getCharacteristic(this.Characteristic.TargetFanState)
          .onGet(this.getTargetFanState.bind(this))
          .onSet(this.setTargetFanState.bind(this));
      }
    }

    if (swingGroup) {
      fan
        .getCharacteristic(this.Characteristic.SwingMode)
        .onGet(this.getSwingMode.bind(this))
        .onSet(this.setSwingMode.bind(this));
    }
  }

  private async getFanActive() {
    await this.getDeviceProps('set_on_off');
    return this.isPoweredOn() ? this.Characteristic.Active.ACTIVE : this.Characteristic.Active.INACTIVE;
  }

  private async setFanActive(value: CharacteristicValue) {
    await this.setPower(Number(value) === this.Characteristic.Active.ACTIVE);
  }

  private async getFanSpeed() {
    const group = this.getFanSpeedGroup();
    if (!group) {
      return 0;
    }
    const value = await this.getDeviceProps('fan_speed', FAN_SPEED_ALIASES);
    return this.fanSpeedToPercentage(group, value ?? '');
  }

  private async setFanSpeed(value: CharacteristicValue) {
    const group = this.getFanSpeedGroup();
    if (!group) {
      throw this.communicationError(new Error('空调不支持风速控制'));
    }
    const percentage = Number(value);
    if (percentage <= 0) {
      await this.setPower(false);
      return;
    }
    if (!this.isPoweredOn()) {
      await this.setPower(true);
    }

    let deviceValue: string | undefined;
    if (group.groupType === 1) {
      deviceValue = percentageToEnumValue(group, percentage);
    } else {
      const element = group.devElementList[0];
      deviceValue = Math.round(
        scaleValue(percentage, 1, 100, element?.minValue ?? 1, element?.maxValue ?? 100),
      ).toString();
    }
    if (!deviceValue) {
      throw this.communicationError(new Error('无法映射空调风速'));
    }
    await this.setDeviceProps('fan_speed', deviceValue, FAN_SPEED_ALIASES);
  }

  private async getTargetFanState() {
    const group = this.getFanSpeedGroup();
    const value = await this.getDeviceProps('fan_speed', FAN_SPEED_ALIASES);
    const current = group?.devElementList.find((element) => element.value === value);
    return current && isAutoElement(current)
      ? this.Characteristic.TargetFanState.AUTO
      : this.Characteristic.TargetFanState.MANUAL;
  }

  private async setTargetFanState(value: CharacteristicValue) {
    const group = this.getFanSpeedGroup();
    if (!group) {
      throw this.communicationError(new Error('空调不支持自动风速'));
    }
    const auto = group.devElementList.find(isAutoElement);
    const manual = orderedElements(group, true);
    const currentValue = this.getDevicePropsSync('fan_speed', FAN_SPEED_ALIASES);
    const current = group.devElementList.find((element) => element.value === currentValue);
    if (Number(value) === this.Characteristic.TargetFanState.MANUAL && current && !isAutoElement(current)) {
      return;
    }
    const target =
      Number(value) === this.Characteristic.TargetFanState.AUTO ? auto : manual[Math.floor((manual.length - 1) / 2)];
    if (!target) {
      throw this.communicationError(new Error('无法映射空调自动风速'));
    }
    await this.setDeviceProps('fan_speed', target.value, FAN_SPEED_ALIASES);
  }

  private async getSwingMode() {
    const group = this.getSwingGroup();
    const value = await this.getDeviceProps('swing', SWING_ALIASES);
    const enabledValue = group ? this.getSwingValue(group, true) : undefined;
    return value === enabledValue
      ? this.Characteristic.SwingMode.SWING_ENABLED
      : this.Characteristic.SwingMode.SWING_DISABLED;
  }

  private async setSwingMode(value: CharacteristicValue) {
    const group = this.getSwingGroup();
    const enabled = Number(value) === this.Characteristic.SwingMode.SWING_ENABLED;
    const deviceValue = group ? this.getSwingValue(group, enabled) : undefined;
    if (!group || deviceValue === undefined) {
      throw this.communicationError(new Error('无法映射空调摆风状态'));
    }
    await this.setDeviceProps('swing', deviceValue, SWING_ALIASES);
  }

  private configureModeSwitch(key: string, name: string, mode: AcOperationMode) {
    if (!this.supportsMode(mode)) {
      this.removeService(key);
      return;
    }
    this.setServices(key, this.platform.Service.Switch, name)
      .getCharacteristic(this.Characteristic.On)
      .onGet(async () => {
        await this.getDeviceProps('set_mode');
        return this.isPoweredOn() && this.isModeActive(mode);
      })
      .onSet((value) => this.setModeSwitch(mode, Boolean(value)));
  }

  private async setModeSwitch(mode: AcOperationMode, enabled: boolean) {
    if (enabled) {
      if (!this.isPoweredOn()) {
        await this.setPower(true);
      }
      await this.setMode(mode);
    } else if (this.isPoweredOn() && this.isModeActive(mode)) {
      await this.setPower(false);
    }
  }

  private updateModeSwitch(key: string, mode: AcOperationMode) {
    this.services[key]
      ?.getCharacteristic(this.Characteristic.On)
      .updateValue(this.isPoweredOn() && this.isModeActive(mode));
  }

  private configureToggleSwitch(key: string, name: string, property: string, aliases: readonly string[]) {
    const group = this.getGroupInfo(property, aliases);
    if (!group || findToggleValue(group, true) === undefined || findToggleValue(group, false) === undefined) {
      this.removeService(key);
      return;
    }
    this.setServices(key, this.platform.Service.Switch, name)
      .getCharacteristic(this.Characteristic.On)
      .onGet(async () => {
        const value = await this.getDeviceProps(property, aliases);
        return value === findToggleValue(group, true);
      })
      .onSet((value) => this.setToggle(property, aliases, Boolean(value)));
  }

  private async setToggle(property: string, aliases: readonly string[], enabled: boolean) {
    const group = this.getGroupInfo(property, aliases);
    const value = group ? findToggleValue(group, enabled) : undefined;
    if (!group || value === undefined) {
      throw this.communicationError(new Error(`无法映射开关能力: ${property}`));
    }
    await this.setDeviceProps(property, value, aliases);
  }

  private updateToggleSwitch(key: string, property: string, aliases: readonly string[]) {
    const group = this.getGroupInfo(property, aliases);
    const enabledValue = group ? findToggleValue(group, true) : undefined;
    if (enabledValue !== undefined) {
      this.services[key]
        ?.getCharacteristic(this.Characteristic.On)
        .updateValue(this.getDevicePropsSync(property, aliases) === enabledValue);
    }
  }

  private updateAirflowService() {
    const fan = this.services.airflow;
    if (!fan) {
      return;
    }
    const on = this.isPoweredOn();
    fan
      .getCharacteristic(this.Characteristic.Active)
      .updateValue(on ? this.Characteristic.Active.ACTIVE : this.Characteristic.Active.INACTIVE);
    fan
      .getCharacteristic(this.Characteristic.CurrentFanState)
      .updateValue(on ? this.Characteristic.CurrentFanState.BLOWING_AIR : this.Characteristic.CurrentFanState.INACTIVE);

    const speedGroup = this.getFanSpeedGroup();
    if (speedGroup && orderedElements(speedGroup, true).length > 0) {
      const value = this.getDevicePropsSync('fan_speed', FAN_SPEED_ALIASES) ?? '';
      fan
        .getCharacteristic(this.Characteristic.RotationSpeed)
        .updateValue(this.fanSpeedToPercentage(speedGroup, value));
      const current = speedGroup.devElementList.find((element) => element.value === value);
      if (speedGroup.devElementList.some(isAutoElement)) {
        fan
          .getCharacteristic(this.Characteristic.TargetFanState)
          .updateValue(
            current && isAutoElement(current)
              ? this.Characteristic.TargetFanState.AUTO
              : this.Characteristic.TargetFanState.MANUAL,
          );
      }
    }

    const swingGroup = this.getSwingGroup();
    if (swingGroup) {
      const enabledValue = this.getSwingValue(swingGroup, true);
      fan
        .getCharacteristic(this.Characteristic.SwingMode)
        .updateValue(
          this.getDevicePropsSync('swing', SWING_ALIASES) === enabledValue
            ? this.Characteristic.SwingMode.SWING_ENABLED
            : this.Characteristic.SwingMode.SWING_DISABLED,
        );
    }
  }

  private getSupportedTargetStates() {
    const { TargetHeatingCoolingState } = this.Characteristic;
    const states = [TargetHeatingCoolingState.OFF];
    if (this.supportsMode(AcOperationMode.HEAT)) {
      states.push(TargetHeatingCoolingState.HEAT);
    }
    if (this.supportsMode(AcOperationMode.COOL)) {
      states.push(TargetHeatingCoolingState.COOL);
    }
    if (this.supportsMode(AcOperationMode.AUTO)) {
      states.push(TargetHeatingCoolingState.AUTO);
    }
    return states;
  }

  private currentHeatingCoolingStateSync() {
    const { CurrentHeatingCoolingState } = this.Characteristic;
    if (!this.isPoweredOn()) {
      return CurrentHeatingCoolingState.OFF;
    }
    if (this.isModeActive(AcOperationMode.COOL)) {
      return CurrentHeatingCoolingState.COOL;
    }
    if (this.isModeActive(AcOperationMode.HEAT)) {
      return CurrentHeatingCoolingState.HEAT;
    }
    if (!this.isModeActive(AcOperationMode.AUTO)) {
      return CurrentHeatingCoolingState.OFF;
    }
    const target = Number(this.getDevicePropsSync('set_tem'));
    const current = Number(this.getDevicePropsSync('show_inside_tem'));
    if (!Number.isFinite(target) || !Number.isFinite(current) || Math.abs(target - current) < 0.5) {
      return CurrentHeatingCoolingState.OFF;
    }
    return current > target ? CurrentHeatingCoolingState.COOL : CurrentHeatingCoolingState.HEAT;
  }

  private targetHeatingCoolingStateSync() {
    const { TargetHeatingCoolingState } = this.Characteristic;
    if (!this.isPoweredOn()) {
      return TargetHeatingCoolingState.OFF;
    }
    if (this.isModeActive(AcOperationMode.HEAT)) {
      return TargetHeatingCoolingState.HEAT;
    }
    if (this.isModeActive(AcOperationMode.COOL)) {
      return TargetHeatingCoolingState.COOL;
    }
    if (this.isModeActive(AcOperationMode.AUTO)) {
      return TargetHeatingCoolingState.AUTO;
    }
    return TargetHeatingCoolingState.OFF;
  }

  private supportsMode(mode: AcOperationMode) {
    return this.getModeValue(mode) !== undefined;
  }

  private isPoweredOn() {
    const group = this.getGroupInfo('set_on_off');
    const enabledValue = group ? findToggleValue(group, true) : undefined;
    return enabledValue !== undefined && this.getDevicePropsSync('set_on_off') === enabledValue;
  }

  private async setPower(on: boolean) {
    const group = this.getGroupInfo('set_on_off');
    const value = group ? findToggleValue(group, on) : undefined;
    if (value === undefined) {
      throw this.communicationError(new Error(`无法映射空调${on ? '开机' : '关机'}操作`));
    }
    await this.setDeviceProps('set_on_off', value);
  }

  private async getNumericProperty(property: string, aliases: readonly string[] = []) {
    const value = Number(await this.getDeviceProps(property, aliases));
    if (!Number.isFinite(value)) {
      throw this.communicationError(new Error(`设备返回了无效数值: ${property}`));
    }
    return value;
  }

  private updateNumericCharacteristic(
    service: Service,
    characteristic: typeof this.Characteristic.CurrentTemperature,
    property: string,
    aliases: readonly string[] = [],
  ) {
    const value = Number(this.getDevicePropsSync(property, aliases));
    if (Number.isFinite(value)) {
      service.getCharacteristic(characteristic).updateValue(value);
    }
  }

  private getFanSpeedGroup() {
    return this.getGroupInfo('fan_speed', FAN_SPEED_ALIASES);
  }

  private getSwingGroup() {
    return this.getGroupInfo('swing', SWING_ALIASES);
  }

  private configureOutdoorTemperatureService() {
    if (!this.hasDeviceProps('outdoor_temperature', OUTDOOR_TEMPERATURE_ALIASES)) {
      this.removeService('outdoorTemperature');
      return;
    }
    this.setServices('outdoorTemperature', this.platform.Service.TemperatureSensor, '室外温度')
      .getCharacteristic(this.Characteristic.CurrentTemperature)
      .onGet(() => this.getNumericProperty('outdoor_temperature', OUTDOOR_TEMPERATURE_ALIASES));
  }

  private getModeValue(mode: AcOperationMode) {
    const patterns: Record<AcOperationMode, RegExp> = {
      [AcOperationMode.HEAT]: /heat|制热|暖风/,
      [AcOperationMode.COOL]: /cool|制冷/,
      [AcOperationMode.AUTO]: /auto|自动/,
      [AcOperationMode.DEHUM]: /dry|dehum|除湿/,
      [AcOperationMode.WIND]: /(?:^|\W)(?:fan|wind)(?:$|\W)|送风/,
    };
    return this.getGroupInfo('set_mode')?.devElementList.find((element) => patterns[mode].test(elementText(element)))
      ?.value;
  }

  private isModeActive(mode: AcOperationMode) {
    const value = this.getModeValue(mode);
    return value !== undefined && this.getDevicePropsSync('set_mode') === value;
  }

  private async setMode(mode: AcOperationMode) {
    const value = this.getModeValue(mode);
    if (value === undefined) {
      throw this.communicationError(new Error(`无法映射空调模式: ${mode}`));
    }
    await this.setDeviceProps('set_mode', value);
  }

  private getSwingValue(group: ZiroomGroupInfo, enabled: boolean) {
    const direct = findToggleValue(group, enabled);
    if (direct !== undefined) {
      return direct;
    }
    const pattern = enabled ? /swing|摆风|自动/ : /off|disable|解除|关闭|停止|固定/;
    return group.devElementList.find((element) => pattern.test(elementText(element)))?.value;
  }

  private fanSpeedToPercentage(group: ZiroomGroupInfo, value: string) {
    if (group.groupType === 1) {
      const current = group.devElementList.find((element) => element.value === value);
      return current && isAutoElement(current) ? 100 : enumValueToPercentage(group, value);
    }
    const element = group.devElementList[0];
    return Math.round(scaleValue(Number(value), element?.minValue ?? 1, element?.maxValue ?? 100, 1, 100));
  }
}
