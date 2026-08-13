# Homebridge Ziroom Platform

自如智能硬件 Homebridge 插件，可通过 HomeKit Device 将设备接入 Home Assistant。

## 安装

```shell
npm install -g --unsafe-perm homebridge homebridge-ziroom
```

## 配置

使用 Token，或者同时填写自如账号和密码。账号密码模式可以在 Token 失效后自动登录。

推荐在内存较小的 Homebridge 主机上使用 Token。账号密码自动登录需要另外安装 Playwright WebKit；插件不会在安装时强制下载浏览器。

```jsonc
{
  "platforms": [
    {
      "platform": "ZiroomHomebridgePlugin",
      "name": "Ziroom",
      "token": "YOUR_TOKEN",
      "hid": "YOUR_HID",
      "pollInterval": 30,
      "requestTimeout": 15000,
      "devConfig": {
        "CURTAIN_DEVICE_UUID": {
          "reversePosition": true
        }
      }
    }
  ]
}
```

- `hid` 可选；留空时使用账号中的第一个自如之家。
- `pollInterval` 默认 30 秒，用于同步自如 App 或遥控器产生的状态变化；设为 `0` 可关闭。
- `requestTimeout` 默认 15000 毫秒。
- `reversePosition` 用于位置方向与 Home Assistant 相反的窗帘。

不要将包含账号、密码或 Token 的配置提交到 Git 仓库。

## Home Assistant 接入

1. 在 Homebridge 中安装和配置本插件并重启 Homebridge。
2. 在 Home Assistant 的“设置 → 设备与服务”中添加 **HomeKit Device**。
3. 选择 Homebridge，并输入 Homebridge 显示的配对码。
4. 空调会生成 `climate` 实体；检测到风速或摆风能力时还会生成 `fan` 实体。窗帘生成 `cover` 实体。

Home Assistant 找不到 Homebridge 时，请确认 Homebridge 使用 `ciao` mDNS advertiser，并确保两者位于可互通的网络中。

## 支持能力

### 空调（`conditioner02`）

- 开关
- 制热、制冷、自动
- 除湿和送风（作为独立开关，仅在设备报告能力时出现）
- 当前温度、目标温度、当前湿度
- 风速和自动风（仅在设备报告能力时出现）
- 摆风（仅在设备报告能力时出现）
- 睡眠、节能（仅在设备报告能力时出现）

### 窗帘（`curtain01`）

- 打开、关闭
- 0–100% 位置控制（设备仅提供开/关操作码时，非零目标会映射为完全打开）
- 打开中、关闭中、停止状态
- 反转位置方向
- 停止（仅在设备报告独立停止操作时出现）

### 灯

- `light03`：开关、亮度、色温
- `light04`：开关

## 特殊型号属性映射

插件会从自如 API 的 `groupInfoMap` 自动检测能力。若设备使用了不同的属性组名称，可以按 `devUuid` 覆盖逻辑属性：

```jsonc
{
  "devConfig": {
    "DEVICE_UUID": {
      "propertyMap": {
        "fan_speed": "设备实际的风速属性组",
        "swing": "设备实际的摆风属性组",
        "sleep": "设备实际的睡眠属性组",
        "eco": "设备实际的节能属性组",
        "curtain_opening": "设备实际的位置属性组",
        "curtain_stop": "设备实际的停止属性组"
      }
    }
  }
}
```

不要凭猜测填写操作码；这里只填写设备详情中已经存在的属性组键名。

## 开发与验证

```shell
npm ci
npm run check
```

`npm run check` 会执行格式和静态检查、单元/配件契约测试以及生产构建。
