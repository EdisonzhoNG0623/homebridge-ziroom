import type { ZiroomDevElementInfo, ZiroomGroupInfo } from '../types';

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const scaleValue = (
  value: number,
  sourceMin: number,
  sourceMax: number,
  targetMin: number,
  targetMax: number,
) => {
  if (sourceMax <= sourceMin) {
    return targetMin;
  }
  const ratio = (clamp(value, sourceMin, sourceMax) - sourceMin) / (sourceMax - sourceMin);
  return targetMin + ratio * (targetMax - targetMin);
};

export const elementText = (element: ZiroomDevElementInfo) =>
  `${element.elementCode} ${element.elementName} ${element.prodStateName}`.toLowerCase();

export const isAutoElement = (element: ZiroomDevElementInfo) => /auto|自动/.test(elementText(element));

export const findToggleValue = (group: ZiroomGroupInfo, enabled: boolean) => {
  const preferredValue = enabled ? '1' : '0';
  const preferredValues = enabled ? ['1', 'true'] : ['0', 'false'];
  const exact = group.devElementList.find((element) => preferredValues.includes(element.value.toLowerCase()));
  if (exact) {
    return exact.value;
  }

  const pattern = enabled
    ? /(?:^|\W)(?:on|open|enable)(?:$|\W)|开启|打开|启动/
    : /(?:^|\W)(?:off|close|disable)(?:$|\W)|关闭|停止/;
  const named = group.devElementList.find((element) => pattern.test(elementText(element)));
  if (named) {
    return named.value;
  }

  if (group.devElementList.length === 1) {
    return group.devElementList[0].value || preferredValue;
  }
  return undefined;
};

export const orderedElements = (group: ZiroomGroupInfo, excludeAuto = false) => {
  const elements = excludeAuto
    ? group.devElementList.filter((element) => !isAutoElement(element))
    : group.devElementList;
  return [...elements].sort((left, right) => {
    const speedRank = (element: ZiroomDevElementInfo) => {
      const text = elementText(element);
      if (/(?:^|\W)(?:low|small)(?:$|\W)|低|小风/.test(text)) {
        return 1;
      }
      if (/(?:^|\W)(?:medium|mid)(?:$|\W)|中风|中档/.test(text)) {
        return 2;
      }
      if (/(?:^|\W)(?:high|large|strong)(?:$|\W)|高|大风|强风/.test(text)) {
        return 3;
      }
      return undefined;
    };
    const leftRank = speedRank(left);
    const rightRank = speedRank(right);
    if (leftRank !== undefined && rightRank !== undefined) {
      return leftRank - rightRank;
    }
    const leftValue = Number(left.value);
    const rightValue = Number(right.value);
    return Number.isFinite(leftValue) && Number.isFinite(rightValue) ? leftValue - rightValue : 0;
  });
};

export const enumValueToPercentage = (group: ZiroomGroupInfo, value: string) => {
  const elements = orderedElements(group, true);
  const index = elements.findIndex((element) => element.value === value);
  if (index < 0 || elements.length === 0) {
    return 0;
  }
  return Math.round(((index + 1) / elements.length) * 100);
};

export const percentageToEnumValue = (group: ZiroomGroupInfo, percentage: number) => {
  const elements = orderedElements(group, true);
  if (elements.length === 0) {
    return undefined;
  }
  const index = Math.min(
    elements.length - 1,
    Math.max(0, Math.ceil((clamp(percentage, 1, 100) / 100) * elements.length) - 1),
  );
  return elements[index].value;
};
