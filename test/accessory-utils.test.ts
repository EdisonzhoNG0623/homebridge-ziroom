import { describe, expect, it } from 'vitest';
import {
  enumValueToPercentage,
  findToggleValue,
  isAutoElement,
  percentageToEnumValue,
  scaleValue,
} from '../src/accessories/utils';
import type { ZiroomGroupInfo } from '../src/types';

const enumGroup: ZiroomGroupInfo = {
  groupName: '风速',
  groupType: 1,
  isAggregate: 0,
  groupCode: 'fan_speed',
  devElementList: [
    {
      prodOperCode: 'low',
      prodStateName: '风速',
      elementCode: 'fan_low',
      elementName: '低风',
      prodStateCode: 'fan_state',
      elementType: 1,
      value: '1',
    },
    {
      prodOperCode: 'medium',
      prodStateName: '风速',
      elementCode: 'fan_medium',
      elementName: '中风',
      prodStateCode: 'fan_state',
      elementType: 1,
      value: '2',
    },
    {
      prodOperCode: 'high',
      prodStateName: '风速',
      elementCode: 'fan_high',
      elementName: '高风',
      prodStateCode: 'fan_state',
      elementType: 1,
      value: '3',
    },
    {
      prodOperCode: 'auto',
      prodStateName: '风速',
      elementCode: 'fan_auto',
      elementName: '自动',
      prodStateCode: 'fan_state',
      elementType: 1,
      value: '4',
    },
  ],
};

describe('accessory capability helpers', () => {
  it('scales and clamps device ranges', () => {
    expect(scaleValue(50, 0, 100, 10, 90)).toBe(50);
    expect(scaleValue(-10, 0, 100, 10, 90)).toBe(10);
    expect(scaleValue(110, 0, 100, 10, 90)).toBe(90);
  });

  it('maps discrete fan speeds while excluding auto', () => {
    expect(enumValueToPercentage(enumGroup, '1')).toBe(33);
    expect(enumValueToPercentage(enumGroup, '2')).toBe(67);
    expect(enumValueToPercentage(enumGroup, '3')).toBe(100);
    expect(percentageToEnumValue(enumGroup, 1)).toBe('1');
    expect(percentageToEnumValue(enumGroup, 50)).toBe('2');
    expect(percentageToEnumValue(enumGroup, 100)).toBe('3');
    expect(isAutoElement(enumGroup.devElementList[3])).toBe(true);
  });

  it('detects conventional toggle values', () => {
    const toggleGroup: ZiroomGroupInfo = {
      ...enumGroup,
      devElementList: enumGroup.devElementList.slice(0, 2).map((element, index) => ({
        ...element,
        value: index.toString(),
      })),
    };
    expect(findToggleValue(toggleGroup, false)).toBe('0');
    expect(findToggleValue(toggleGroup, true)).toBe('1');
  });
});
