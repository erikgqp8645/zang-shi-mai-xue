# 鸿蒙端上手手册

**一句话**：HAP 已经出好了（9.1 MB），剩下全是「在 DevEco Studio 里点几下」的事。

---

## 0. 先搞清楚三个目录

| 路径 | 是什么 | 能不能改 |
|---|---|---|
| `~/AiCoding/臧氏脉学/pulse-record/harmony/` | **工程的唯一真源**（配置与资源，入库了） | ✅ 改配置改这里 |
| `~/AiCoding/harmony-pulse-record/` | **编译镜像**（纯 ASCII 路径，hvigor 只认这个） | ❌ 别手改，会被 rsync 覆盖 |
| `~/AiCoding/臧氏脉学/pulse-record/taro/` | **Taro 源码**（小程序和鸿蒙共用） | ✅ 改界面逻辑改这里 |

> **为什么要有镜像**：hvigor 拒绝含中文的工程路径（错误码 `00306003`），
> 而仓库就躺在 `~/AiCoding/臧氏脉学/` 下面 —— 仓库路径本身带中文。
> 符号链接也绕不过（node 的 `process.cwd()` 解析成真实路径）。**所以必须镜像到纯 ASCII 路径。**

**在 DevEco 里要打开的是镜像目录 `~/AiCoding/harmony-pulse-record`，不是仓库里那份。**

---

## 1. 出包（命令行，一条命令）

```bash
cd ~/AiCoding/臧氏脉学/pulse-record
node scripts/harmony-build.mjs              # 全流程（改了 Taro 源码后跑这个）
node scripts/harmony-build.mjs --skip-taro  # 只重编（没改 .ets 时快很多）
```

产物：`~/AiCoding/harmony-pulse-record/entry/build/default/outputs/default/default-default-unsigned.hap`

流程：rsync 工程配置 → 写 `local.properties` → 挂 DevEco 自带的 hvigor → Taro 构建 →
ArkTS 补丁 → rawfile 资源对齐 → `ohpm install` → `assembleHap`。

---

## 2. 在 DevEco Studio 里跑起来

### 2.1 打开工程

启动页点 **「打开项目」**，选 **`~/AiCoding/harmony-pulse-record`**。

> ⚠️ **别选仓库里那份** `pulse-record/harmony/` —— 路径带中文，hvigor 会拒。

### 2.2 登录华为开发者账号

**右上角头像图标 → 登录**。模拟器镜像下载和自动签名**都要账号**。

### 2.3 同步依赖

打开工程后会弹 **「Sync Now / 同步依赖」** → 点同步（等价于 `ohpm install`）。

### 2.4 配置签名

**File → Project Structure → Signing Configs 标签页** → 勾上 **Automatically generate signature**（自动签名）→ Apply。

- 自动签名需要一个**华为账号下已创建的应用**（包名 `com.zangshimai.pulserecord`）。
- 应用没创建的话，去 [AppGallery Connect](https://developer.huawei.com/consumer/cn/service/josp/agc/index.html) 建一个。
- **模拟器也要签名** —— 没签名会在 Run 时报 `The signing is not configured`。

### 2.5 下载模拟器镜像

**顶部工具栏的设备下拉框 → Device Manager**（或 **Tools → Device Manager**）：

1. 左侧选 **Virtual devices / 本地设备**
2. 右侧列表选一台（如 **Huawei_Phone**），选一个 **API 版本 ≥ 12** 的镜像
3. 点 **Download / 下载** —— 几个 G，下完才能起模拟器

> 本机目前**没有镜像、也没有 hdc** —— 这一步是第一次跑的前置条件。

### 2.6 Run

工具栏 **▶ Run 'entry'**（`Shift+F10`）。

第一次会：编译 → 装 HAP 到模拟器 → 自动拉起。左侧 **Run** 面板看日志。

---

## 3. 进去以后验什么

底部四个 tab：**病例／就诊／用方／我的**。

重点验 **「就诊」工作台里的四档页内 tab**：

| 档 | 该看到什么 |
|---|---|
| **摸脉** | 宽表录入（部位列 ＋ 浮/中/沉 ＋ 左/右），有「一次一屏」切换 |
| **体质** | ①判体质 ＋ 参考判据 |
| **疗法** | ②定疗法 ＋ 随体质带出的提示 |
| **方药** | ③开方药清单 ＋ **用药记录** |

**「摸脉」档不该有**三部曲导航头（`.pr-triad-head`）—— 那是「体质/疗法」才有的。

---

## 4. 连不上后端？改 API 地址

鸿蒙端和小程序端**共用同一个后端**。默认地址是 `http://127.0.0.1:5178`，
**但在模拟器里 127.0.0.1 指的是模拟器自己**，不是你的开发机 → 连不上。

**在 app 的「我的」页 → 服务器 → 填 `http://192.168.18.181:5178` → 保存 → 测试连接**。

（`192.168.18.181` 是开发机的局域网 IP；换网络了要改。单机模式的后端不用登录。）

---

## 5. 两个容易踩的坑

### 5.1 别在 IDE 里「重新生成」Taro 产物

IDE 不认识 Taro —— 它只会编译**已经存在的** `entry/src/main/ets/`。

- ✅ 在 IDE 里改 `.ets` / 跑 Run → 可以
- ❌ 想改 Taro 源码（`taro/src/**`）→ **回命令行跑 `node scripts/harmony-build.mjs`**
- ❌ 删掉 `entry/src/main/ets/` → 产物没了，IDE 编不出来（重新跑脚本即可恢复）

> 脚本里有两步是 IDE 不会替你做的：
> **① ArkTS 严格模式补丁**（上游模板的 `let levelRes: number` 用了才赋值 → ArkTS 报错）；
> **② rawfile 资源对齐**（tabBar 图标 Taro 放在 `ets/assets/`，但 ArkUI 只认 `resources/rawfile/`）。
> 少任何一步，**编译照过但四个 tab 没图标**，或者**编译直接失败**。

### 5.2 出的是 unsigned 包

`build-profile.json5` 里 `signingConfigs` 为空 → 命令行出的包**没签名**。

- 模拟器：装得上（但 §2.4 的签名配置还是建议配好，IDE 的 Run 需要它）
- 真机：**必须签名**，用自动签名生成的 debug 证书即可

---

## 6. 还没验证的

- **关系图（寸关尺）在鸿蒙上的渲染** —— 小程序侧是自绘 canvas，鸿蒙侧走 C-API 的 canvas，**可能有坑**。
  关系图在**病例详情页**（不是就诊页）。
- 微信小程序的三个导出功能（存相册／复制）在鸿蒙上**没有**（小程序那边已经去掉了，鸿蒙跟着同一套代码）。
