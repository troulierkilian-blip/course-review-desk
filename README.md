# 课程复习助手 · Course Review Desk

把本地 HTML 课件放进一个书架，继续上次阅读，按掌握程度安排下一次复习。Windows 公开版内置原创示例 **《记忆练习室》**：两章分别演示如何出自测题、核对答案和设置复习日期。

[下载 Windows x64 免安装版](https://github.com/troulierkilian-blip/course-review-desk/releases/download/v1.2.1/CourseReviewDesk-v1.2.1-win-x64.exe) · [发布说明与校验值](https://github.com/troulierkilian-blip/course-review-desk/releases/tag/v1.2.1)

![公开版首次打开时的课程书架](docs/home.png)

## 使用

1. 双击 EXE，等待运行组件解包。阅读、勾选、复习记录不需要联网或账号。
2. 在「我的课程 → 添加课程」选择课程文件夹或 HTML 文件。检查章节顺序和资源提示后导入。资料会复制到本机书架；建议把图片、样式等附件和 HTML 放在同一课程目录下。
3. 阅读页的「完成本次复习」用于选择掌握程度和下次日期。勾选状态与阅读位置单独保存。在「设置与备份」可导出或恢复课程与记录。
4. 需要 AI 时，在「设置与备份 → AI 服务」填写兼容 Chat Completions 的基础地址、模型和自己的 API Key。保存并测试后，在阅读页点「AI 伴侣」，或选中文字后右键询问。左右拖动分隔栏调宽，双击复位。
   
提问会把当前章节的文字或节选、引用、问题和近期本章对话发给你选择的服务商；打开面板本身不会发送请求。密钥使用 Electron safeStorage 在本机加密，不随备份导出。公开版使用独立的 `%APPDATA%\CourseReviewDeskPublic` 资料目录。

## 从源码构建

使用 Windows x64、Node.js 24 LTS 和 npm。在仓库根目录执行：

```powershell
npm ci
npx electron-builder install-app-deps
npm run typecheck
npm test
npm run build
npm start
```

用 `npm run pack` 生成单文件 EXE，输出位于 `release/v1.2.1/`。首次构建需要联网下载 Electron、原生模块和打包工具。示例课程已包含在仓库内，无需另行取材。可通过 `npm run test:desktop` 测试导入与重启恢复，`npm run test:ai` 使用本机模拟接口；构建 EXE 后运行 `npm run test:portable` 验证外层文件。上述测试在独立临时资料库运行。

## 许可

软件源代码采用 [MIT](LICENSE)。[原创示例的授权](bundled/recall-lab/NOTICE.txt) 单独列明；使用者导入的课程和第三方依赖各自保留原有权利及许可。
