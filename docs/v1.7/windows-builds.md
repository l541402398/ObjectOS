# ProjectOS V1.7 — Windows x64 / x86 双架构打包

日期：2026-10-20  
版本：`1.7.0`

## 为什么分开发布

- Windows x64：适用于 64 位 Windows 10/11。
- Windows ia32（x86）：适用于 32 位 Windows，或需要在 32 位环境运行的用户。
- 当前使用的 Electron 44 已不再提供 `win32-ia32` 二进制。
- 为同时保留 Node 22 内置 `node:sqlite`，将 Electron 固定为 `43.8.2`：
  - Electron 43 仍提供 Windows ia32。
  - 仍包含 Node 22 / `node:sqlite`。
  - x64 与 ia32 使用同一套业务代码。

## 产物

| 架构 | 便携版 | 安装版 |
|---|---|---|
| x64 | `ProjectOS-1.7.0-win-x64-portable.exe` | `ProjectOS-1.7.0-win-x64-setup.exe` |
| x86 | `ProjectOS-1.7.0-win-ia32-portable.exe` | `ProjectOS-1.7.0-win-ia32-setup.exe` |

安装版为 NSIS，可选择安装目录，创建桌面和开始菜单快捷方式。

## SHA256

```text
26BE771BFD0843CDBE3D2FA842E74E9F1993A98710A47649A9C120412B613431  ProjectOS-1.7.0-win-x64-portable.exe
A18BA5E0E5CB57FB37BDB05CDC0C417B16122B2EC28914EB36CF652A304BCEEE  ProjectOS-1.7.0-win-x64-setup.exe
EC8D761685103ED357A7CBFBB1E194FA3DBFBD7289A8378064F6784683A36C11  ProjectOS-1.7.0-win-ia32-portable.exe
D696E54E33D761CF590077ED6CB61652F26EA7E69A7D21D685F47EAA821EA749  ProjectOS-1.7.0-win-ia32-setup.exe
3CFB18301343FFED258CE4CFEE419136365D4D5E1E1744AAFD871B1C899E3EE1  ProjectOS-1.7.0-linux-x86_64.AppImage
```

## 验证

```text
x64 unpacked package smoke → PASS
ia32 unpacked package smoke → PASS
x64 portable clean launch   → window + DB created
ia32 portable clean launch  → window + DB created
x64 setup silent install    → exit 0, window + DB created
ia32 setup silent install   → exit 0, window + DB created
```

## 启动失败诊断

此前 `bootstrap()` 失败会直接 `app.quit()`，用户看不到原因。现在：

- 启动失败弹窗显示错误、数据目录、日志路径。
- 检测到已有实例时弹窗提示从系统托盘打开，而不是静默退出。
- 第二个实例会调用 `showMainWindow()`，窗口被隐藏时也能恢复。

日志位置：

```text
<数据目录>/main.log
<数据目录>/logs/desktop.log
<数据目录>/logs/runtime.log
```

## 便携版打不开的常见原因

1. 32 位系统运行了 x64 版本 → 改用 `win-ia32`。
2. 旧 ProjectOS 实例仍在系统托盘 → 托盘退出旧实例，或使用新版本提示。
3. 启动数据/目录错误 → 新版本会弹窗并给出日志路径。
4. 浏览器/杀软对未签名便携包拦截 → 优先使用 setup 安装版，或对文件解除锁定。
