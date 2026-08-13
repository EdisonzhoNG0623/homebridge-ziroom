import hap from 'hap-nodejs';
import { describe, expect, it, vi } from 'vitest';
import { Conditioner02 } from '../src/accessories/conditioner02';
import { Curtain01 } from '../src/accessories/curtain01';
import type { ZiroomHomebridgePlatform } from '../src/platform';
import type { ZiroomDeviceInfo, ZiroomGroupInfo, ZiroomPlatformAccessory } from '../src/types';

const { Accessory, Characteristic, Service, uuid } = hap;

const enumGroup = (groupCode: string, stateCode: string, values: Array<[string, string]>): ZiroomGroupInfo => ({
  groupName: groupCode,
  groupType: 1,
  isAggregate: 0,
  groupCode,
  devElementList: values.map(([value, name]) => ({
    prodOperCode: `${groupCode}_${value}`,
    prodStateName: groupCode,
    elementCode: `${groupCode}_${value}`,
    elementName: name,
    prodStateCode: stateCode,
    elementType: 1,
    value,
  })),
});

const rangeGroup = (groupCode: string, stateCode: string, minValue: number, maxValue: number): ZiroomGroupInfo => ({
  groupName: groupCode,
  groupType: 2,
  isAggregate: 0,
  groupCode,
  devElementList: [
    {
      prodOperCode: `${groupCode}_set`,
      prodStateName: groupCode,
      elementCode: `${groupCode}_set`,
      elementName: groupCode,
      prodStateCode: stateCode,
      elementType: 2,
      value: '',
      minValue,
      maxValue,
    },
  ],
});

const baseDevice = (overrides: Partial<ZiroomDeviceInfo>): ZiroomDeviceInfo => ({
  devUuid: 'device-1',
  devName: '测试设备',
  rname: '客厅',
  devStateMap: {},
  isOnline: 1,
  modelCode: 'conditioner02',
  brandName: 'Ziroom',
  prodTypeId: 'test-product',
  modelName: 'Test',
  prodTypeName: '测试设备',
  firstLevelTypeName: '家电',
  secondLevelTypeName: '测试',
  groupInfoMap: {},
  ...overrides,
});

const createHarness = (device: ZiroomDeviceInfo, devConfig: Record<string, unknown> = {}) => {
  const mutableDevice = structuredClone(device);
  const setDeviceState = vi.fn(async (_devUuid: string, prodOperCode: string, param: string) => {
    for (const group of Object.values(mutableDevice.groupInfoMap)) {
      const element = group.devElementList.find((candidate) => candidate.prodOperCode === prodOperCode);
      if (element) {
        mutableDevice.devStateMap[element.prodStateCode] = param;
        return {};
      }
    }
    throw new Error(`unknown operation: ${prodOperCode}`);
  });
  const request = {
    getDeviceDetail: vi.fn(async () => structuredClone(mutableDevice)),
    setDeviceState,
  };
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const platform = {
    Service,
    Characteristic,
    api: { hap },
    request,
    log: logger,
    options: { pollInterval: 0, devConfig },
  } as unknown as ZiroomHomebridgePlatform;
  const accessory = new Accessory(device.devName, uuid.generate(device.devUuid)) as unknown as ZiroomPlatformAccessory;
  accessory.context = { deviceInfo: structuredClone(device) };
  return { accessory, mutableDevice, platform, request };
};

const waitForService = async (accessory: ZiroomPlatformAccessory, service: typeof Service.Thermostat) => {
  await vi.waitFor(() => expect(accessory.getService(service)).toBeDefined());
  const createdService = accessory.getService(service);
  if (!createdService) {
    throw new Error('service was not created');
  }
  return createdService;
};

describe('Conditioner02', () => {
  it('maps the real conditioner protocol and exposes all discovered services', async () => {
    const device = baseDevice({
      devStateMap: {
        power: 'true',
        mode: '1',
        target: '26',
        indoor: '28',
        humidity: '55',
        speed: '3',
        swing: '2',
        sleep: '0',
        eco: '1',
        screen: 'true',
        outdoor: '28',
      },
      groupInfoMap: {
        set_on_off: enumGroup('set_on_off', 'power', [
          ['true', '空调开'],
          ['false', '空调关'],
        ]),
        set_mode: enumGroup('set_mode', 'mode', [
          ['0', '自动'],
          ['1', '制冷'],
          ['2', '除湿'],
          ['4', '制热'],
          ['6', '送风'],
        ]),
        set_tem: rangeGroup('set_tem', 'target', 16, 30),
        show_inside_tem: rangeGroup('show_inside_tem', 'indoor', -20, 60),
        show_inside_hum: rangeGroup('show_inside_hum', 'humidity', 0, 100),
        set_wind_speed: enumGroup('set_wind_speed', 'speed', [
          ['5', '自动风'],
          ['3', '小风'],
          ['2', '中风'],
          ['1', '大风'],
        ]),
        set_wind_up_down: enumGroup('set_wind_up_down', 'swing', [
          ['8', '空调上下摆风'],
          ['0', '空调上下摆风解除'],
        ]),
        set_sleep: enumGroup('set_sleep', 'sleep', [
          ['0', '关闭'],
          ['1', '开启'],
        ]),
        set_eco: enumGroup('set_eco', 'eco', [
          ['0', '关闭'],
          ['1', '开启'],
        ]),
        conditioner_screenlight: enumGroup('conditioner_screenlight', 'screen', [
          ['true', '打开屏显'],
          ['false', '关闭屏显'],
        ]),
        conditioner_outdoortempre: rangeGroup('conditioner_outdoortempre', 'outdoor', -20, 60),
      },
    });
    const { accessory, mutableDevice, platform, request } = createHarness(device);
    const conditioner = new Conditioner02(platform, accessory);
    const thermostat = await waitForService(accessory, Service.Thermostat);
    const detailRequestsAfterInitialization = request.getDeviceDetail.mock.calls.length;

    expect(await conditioner.getCurrentHeatingCoolingState()).toBe(Characteristic.CurrentHeatingCoolingState.COOL);
    expect(accessory.getService('airflow')).toBeDefined();
    expect(accessory.getService('dryMode')).toBeDefined();
    expect(accessory.getService('windMode')).toBeDefined();
    expect(accessory.getService('sleepMode')).toBeDefined();
    expect(accessory.getService('ecoMode')).toBeDefined();
    expect(accessory.getService('screenLight')).toBeDefined();
    expect(accessory.getService('outdoorTemperature')).toBeDefined();
    expect(await thermostat.getCharacteristic(Characteristic.CurrentRelativeHumidity).handleGetRequest()).toBe(55);
    expect(
      await accessory.getService('airflow')?.getCharacteristic(Characteristic.RotationSpeed).handleGetRequest(),
    ).toBe(33);
    expect(request.getDeviceDetail).toHaveBeenCalledTimes(detailRequestsAfterInitialization);

    await conditioner.setTargetHeatingCoolingState(Characteristic.TargetHeatingCoolingState.HEAT);
    expect(mutableDevice.devStateMap.mode).toBe('4');
    await conditioner.setTargetHeatingCoolingState(Characteristic.TargetHeatingCoolingState.OFF);
    expect(mutableDevice.devStateMap.power).toBe('false');

    conditioner.destroy();
  });

  it('changes HVAC mode and verifies the resulting state', async () => {
    const device = baseDevice({
      devStateMap: { power: '0', mode: '2', target: '24', indoor: '20' },
      groupInfoMap: {
        set_on_off: enumGroup('set_on_off', 'power', [
          ['0', '关闭'],
          ['1', '开启'],
        ]),
        set_mode: enumGroup('set_mode', 'mode', [
          ['0', '制热'],
          ['1', '制冷'],
          ['2', '自动'],
        ]),
        set_tem: rangeGroup('set_tem', 'target', 16, 30),
        show_inside_tem: rangeGroup('show_inside_tem', 'indoor', -20, 60),
      },
    });
    const { accessory, mutableDevice, platform, request } = createHarness(device);
    const conditioner = new Conditioner02(platform, accessory);
    await waitForService(accessory, Service.Thermostat);

    await conditioner.setTargetHeatingCoolingState(Characteristic.TargetHeatingCoolingState.HEAT);
    expect(mutableDevice.devStateMap.power).toBe('1');
    expect(mutableDevice.devStateMap.mode).toBe('0');
    expect(request.setDeviceState).toHaveBeenCalledTimes(2);
    expect(await conditioner.getCurrentHeatingCoolingState()).toBe(Characteristic.CurrentHeatingCoolingState.HEAT);

    conditioner.destroy();
  });

  it('propagates device control failures as HomeKit communication errors', async () => {
    const device = baseDevice({
      devStateMap: { power: '1', mode: '1', target: '24', indoor: '26' },
      groupInfoMap: {
        set_on_off: enumGroup('set_on_off', 'power', [
          ['0', '关闭'],
          ['1', '开启'],
        ]),
        set_mode: enumGroup('set_mode', 'mode', [['1', '制冷']]),
        set_tem: rangeGroup('set_tem', 'target', 16, 30),
        show_inside_tem: rangeGroup('show_inside_tem', 'indoor', -20, 60),
      },
    });
    const { accessory, platform, request } = createHarness(device);
    const conditioner = new Conditioner02(platform, accessory);
    await waitForService(accessory, Service.Thermostat);
    request.setDeviceState.mockRejectedValueOnce(new Error('network failure'));

    await expect(conditioner.setTargetTemperature(23)).rejects.toMatchObject({ hapStatus: -70402 });

    conditioner.destroy();
  });
});

describe('Curtain01', () => {
  it('maps position, writes target position and supports per-device reversal', async () => {
    const device = baseDevice({
      modelCode: 'curtain01',
      devStateMap: { position: '25' },
      groupInfoMap: {
        curtain_opening: rangeGroup('curtain_opening', 'position', 0, 100),
        set_on_off: enumGroup('set_on_off', 'position', [
          ['100', '窗帘开'],
          ['1', '窗帘关'],
        ]),
      },
    });
    const { accessory, mutableDevice, platform, request } = createHarness(device, {
      [device.devUuid]: { reversePosition: true },
    });
    const curtain = new Curtain01(platform, accessory);
    const service = await waitForService(accessory, Service.WindowCovering);

    expect(await curtain.getCurrentPosition()).toBe(75);
    await service.getCharacteristic(Characteristic.TargetPosition).handleSetRequest(80);
    expect(mutableDevice.devStateMap.position).toBe('20');
    expect(request.setDeviceState).toHaveBeenCalledWith(device.devUuid, 'set_on_off_100', '20');
    expect(await curtain.getCurrentPosition()).toBe(80);

    curtain.destroy();
  });

  it('maps binary curtain hardware to full open and full close', async () => {
    const positionGroup = rangeGroup('curtain_opening', 'position', 0, 100);
    positionGroup.devElementList[0].elementType = 0;
    const device = baseDevice({
      modelCode: 'curtain01',
      devStateMap: { position: '0' },
      groupInfoMap: {
        curtain_opening: positionGroup,
        set_on_off: enumGroup('set_on_off', 'position', [
          ['100', '窗帘开'],
          ['1', '窗帘关'],
        ]),
      },
    });
    const { accessory, platform, request } = createHarness(device);
    const curtain = new Curtain01(platform, accessory);
    const service = await waitForService(accessory, Service.WindowCovering);

    await service.getCharacteristic(Characteristic.TargetPosition).handleSetRequest(20);
    expect(request.setDeviceState).toHaveBeenLastCalledWith(device.devUuid, 'set_on_off_100', '100');
    expect(await service.getCharacteristic(Characteristic.TargetPosition).handleGetRequest()).toBe(100);

    await service.getCharacteristic(Characteristic.TargetPosition).handleSetRequest(0);
    expect(request.setDeviceState).toHaveBeenLastCalledWith(device.devUuid, 'set_on_off_1', '1');
    curtain.destroy();
  });

  it('only advertises stop when a stop capability exists', async () => {
    const withoutStop = baseDevice({
      modelCode: 'curtain01',
      devStateMap: { position: '50' },
      groupInfoMap: { curtain_opening: rangeGroup('curtain_opening', 'position', 0, 100) },
    });
    const first = createHarness(withoutStop);
    const firstCurtain = new Curtain01(first.platform, first.accessory);
    const firstService = await waitForService(first.accessory, Service.WindowCovering);
    expect(firstService.testCharacteristic(Characteristic.HoldPosition)).toBe(false);
    firstCurtain.destroy();

    const withStop = baseDevice({
      modelCode: 'curtain01',
      devStateMap: { position: '50', stop: '0' },
      groupInfoMap: {
        curtain_opening: rangeGroup('curtain_opening', 'position', 0, 100),
        curtain_stop: enumGroup('curtain_stop', 'stop', [['', '停止']]),
      },
    });
    const second = createHarness(withStop);
    const secondCurtain = new Curtain01(second.platform, second.accessory);
    const secondService = await waitForService(second.accessory, Service.WindowCovering);
    expect(secondService.testCharacteristic(Characteristic.HoldPosition)).toBe(true);
    await secondService.getCharacteristic(Characteristic.HoldPosition).handleSetRequest(true);
    expect(second.mutableDevice.devStateMap.stop).toBe('1');
    secondCurtain.destroy();
  });
});
