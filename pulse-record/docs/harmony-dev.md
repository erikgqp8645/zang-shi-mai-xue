# 鸿蒙端上手手册

**一句话**：HAP 已经出好了（9.1 MB），装到模拟器上只剩**一件事**：登录。

> **2026-11-06 更新**：DevEco 的官方命令行工具 `@deveco/deveco-cli` 装上之后，
> **整条路都能走 CLI 了** —— 建模拟器、启动、签名、装机、截图、UI 自动化，全都能脚本化。
> 下面的「路线 A（CLI，推荐）」就是这条。

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

流程：rsync 工程配置 → 写 `local.properties` → Taro 构建 → ArkTS 补丁 →
rawfile 资源对齐 → `ohpm install` → `devecocli build`。

> **为什么最后一步用 `devecocli build` 而不是自己调 `hvigorw`**：
> 手工调 hvigorw 要自己拼三样 —— **hvigor 软链**（`@ohos/hvigor` 不在 npmjs 上）、
> **`DEVECO_SDK_HOME`**（SDK 根目录，不是版本目录）、**`JAVA_HOME`**（打包要 Java，本机只有 DevEco 自带的 JBR）。
> 缺一样就一次编译失败。`devecocli build` 三样都自己解析好了 —— 实测**把软链移走也能构建成功**。

---

## 路线 A · 全 CLI（推荐）

前置两条：

```bash
npm install -g @deveco/deveco-cli@stable   # 官方命令行工具（1.3.0-stable）
devecocli auth login                        # ★ 必须登录，见下
```

### 为什么必须登录

两样东西都要向华为服务器申请，**没登录就都拿不到**：

| 要什么 | 谁在要 | 没登录时的报错 |
|---|---|---|
| **签名材料** | `devecocli signature generate` | `Failed to automatically generate signatures.Run devecocli auth login to sign in.` |
| **模拟器设备身份（SN）** | 模拟器启动 | 实例日志里 `can not read sn` / `can not read uuid file` → 模拟器起不来，**没有任何报错提示** |

`devecocli auth login` 会提示「Press Enter to open browser for login」——
**必须按回车**（不按就不动），然后浏览器里确认授权。
在 IDE 里登录过华为账号的话，浏览器里可能已经是登录态，点一下就行。

> ⚠️ **IDE 的登录态和 `devecocli` 的不通用** —— 两边各存各的凭证
> （CLI 存 `~/.deveco/` 的加密 token，IDE 存自己的）。
> 已经在 IDE 里登录了，**还是要单独跑一次 `devecocli auth login`**。

### 三个脚本

```bash
node scripts/harmony-run.mjs doctor     # 体检：登录 / 镜像 / 实例 / 设备
node scripts/harmony-run.mjs emulator   # 确保镜像与实例就位，并启动模拟器
node scripts/harmony-run.mjs deploy     # 签名 → 构建 → 装机 → 截图
node scripts/harmony-run.mjs --download # 全流程（顺便把模拟器镜像下了，几个 G）
```

### devecocli 还能干什么

| 命令 | 用途 |
|---|---|
| `devecocli emulator image list/download` | 模拟器系统镜像（**不需要登录**） |
| `devecocli emulator create/start/list/stop` | 模拟器实例 |
| `devecocli device list` | 在线设备 |
| `devecocli signature generate` | 生成签名并写进工程配置 |
| `devecocli build` / `run` | 构建 / 构建并装机 |
| `devecocli ui screenshot/layout/click/text/swipe` | **设备上的 UI 自动化**（可做回归） |
| `devecocli log` | 设备日志 |
| `devecocli check lint` / `compat` | ArkTS 代码检查 / 兼容性检查 |
| `devecocli skills list` | **53 个鸿蒙开发技能**（可装给 AI agent） |
| `devecocli docs search/read` | **本地 HarmonyOS 文档**（开发指南／API参考／最佳实践／FAQ／版本说明） |

### 模拟器实例的三个坑（都踩过）

1. **实例名不能有连字符** —— `pulse-phone` 会被拒：`The virtual device name can only contain letters, spaces, numbers, and underscores (_).` → 用 `pulse_phone`。
2. **`-instancePath` 要传父目录**，不是实例目录本身 —— 传实例目录会报
   `"pulse_phone" is not found. Please create the device(folder): …/pulse_phone/pulse_phone`。
3. **`-bootMode cold` 不被接受** —— 报 `Command bootmode invalid! Use default.` → 别传这个参数。

---

---

## 2. 路线 B · 在 DevEco Studio 里跑（GUI）

> 适合不想用 CLI、或者 CLI 卡在登录上的情况。
> **实测过**：IDE 登录态与 `devecocli` 不通用，但 IDE 自己能签发 SN 与签名材料。

### 2.1 打开工程

启动页点 **「打开项目」**，选 **`~/AiCoding/harmony-pulse-record`**。

> ⚠️ **别选仓库里那份** `pulse-record/harmony/` —— 路径带中文，hvigor 会拒。

### 2.2 登录华为开发者账号

**右上角头像图标 → 登录**。模拟器镜像下载和自动签名**都要账号**。
（截图里显示已登录 ✓）

### 2.3 同步依赖

打开工程后会弹 **「Sync Now / 同步依赖」** → 点同步（等价于 `ohpm install`）。

### 2.4 配置签名

**File → Project Structure → Signing Configs 标签页** → 勾上 **Automatically generate signature**（自动签名）→ Apply。

- 自动签名需要一个**华为账号下已创建的应用**（包名 `com.zangshimai.pulserecord`）。
- 应用没创建的话，去 [AppGallery Connect](https://developer.huawei.com/consumer/cn/service/josp/agc/index.html) 建一个。
- **模拟器也要签名** —— 没签名会在 Run 时报 `The signing is not configured`。

### 2.5 下载模拟器镜像

> ✅ **镜像已经下好了**（用 `devecocli emulator image download` 下的）：
> `HarmonyOS 7.0.0(26.0.0)` phone，落在 `~/Library/Huawei/Sdk/system-image/`。
> 所以这一步**可以跳过**，直接在 Device Manager 里选它建实例即可。

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
