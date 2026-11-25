# AutumnMark+ BUG 修复记录：2026-11-24

> 日期：2026-11-24
> 来源：两轮全量代码审计（第一轮见 `docs/issue-review-2026-11-24.md`，第二轮覆盖其未审范围）
> 状态：全部修复完成，改动均未提交
> 路径基准：仓库根目录；`desktop` = `packages/desktop/src/`，`muya` = `packages/muya/src/`

---

## 1. 总览

| 批次 | 修复项 | 说明 |
| --- | --- | --- |
| 第一轮 | 16 | 复核报告确认的 #1–#5（P1）、#6、#8–#12、#14、#15、#18–#20（P2） |
| 第二轮 | 13 组 | 新覆盖 muya ui/editor/selection、desktop common/preload/scripts、website |
| 回归自纠 | 2 | 第一轮修复自身引入：`_unindentListItem` 游标错位、`escapeText` lint 格式 |

未纳入修复的既有项：`#7`（复核确认不存在）、`#13/#16/#17`（缺陷真实但触发条件受限，见复核报告 §5）；muya 全量测试中 11 个失败文件为既有 prism mock 缺 `languageTitle` 导出问题，与本次改动无关。

---

## 2. 第一轮修复（复核报告 16 项）

### P1

| # | 位置 | 修复内容 |
| --- | --- | --- |
| 1 | `desktop/renderer/prefComponents/categories.ts` | `generalGroups.general` 加入 `'updates'`，更新设置区块恢复可见 |
| 2 | `desktop/renderer/commands/fileEncoding.ts` | `unshift` 后固定 `subcommandSelectedIndex = 0`，删除错位的循环下标 `i` |
| 3 | `muya/state/stateToMarkdown.ts` | `escapeText` 改为按“竖线前连续反斜杠奇偶”补转义：偶数补 `\|`，奇数保持原样；实测 1/3/5 反斜杠 + 竖线往返无损 |
| 4 | `muya/block/content/paragraphContent/index.ts` | `_unindentListItem` REPLACEMENT 分支改为搬运 list-item 全部子节点（段落 + 嵌套列表），不再丢子列表 |
| 5 | `desktop/main/applicationState/sessionHost.ts` | `_moveResourceNow` 增加与 `moveSidebarItem` 一致的跨窗口 `openElsewhere` / `destinationOpen` 守卫，杜绝“幽灵副本” |

### P2

| # | 位置 | 修复内容 |
| --- | --- | --- |
| 6 | `muya/state/stateToMarkdown.ts` | `generate()` 重置 `_listType`；`_serializeListItemBlock` / `_serializeListItem` 栈空时兜底，不再抛 TypeError |
| 8 | `desktop/main/applicationState/sessionHost.ts` | `_tabClosePending` 由实例级布尔改为 `Set<windowId>`，窗口间关闭互不吞没 |
| 9 | `desktop/renderer/src/store/project.ts`、`components/sideBar/tree.vue` | 多选语义统一：取消选中后焦点迁移；Delete 作用于整个多选并清理 `selectedPaths`；重命名同步选中与锚点；根路径在 toggle/range/paths 三层排除；Ctrl+点击根不再清空多选 |
| 10 | `desktop/main/ipc/ripgrep.ts` | 每个 webContents 仅注册一次 destroyed 监听（WeakMap 去重）；`mt::rg::start` 返回 `{ searchId }` 兑现契约 |
| 11 | `desktop/renderer/src/components/sideBar/treeFile.vue`、`treeFolder.vue` | `onBeforeUnmount` 注销 bus 监听与 contextmenu 监听 |
| 12 | `desktop/main/applicationState/atomicJsonFile.ts` | `unreadable` 保护态可重试，写入前重新读取，瞬时错误不再永久禁用写入 |
| 14 | `desktop/main/app/index.ts` | macOS 截图回调 send 前检查 `win.isDestroyed()` |
| 15 | `muya/src/state/htmlToMarkdown.ts` | 修正 `??` 优先级括号，`startLen/endLen` 首尾换行处理恢复生效 |
| 18 | `desktop/main/ipc/uploader.ts`、`ipc/index.ts`、`main/index.ts` | `cliScript`/`currentUploader` 不再信任渲染进程请求，改由主进程从 DataCenter 读取；空脚本拒绝执行 |
| 19 | `desktop/renderer/src/store/editor.ts` | 当前文件/重命名/删除三处路径比较改用 `isSamePathSync` |
| 20 | `desktop/main/app/windowManager.ts` | `mt::window-add-file-path` 按契约接收 `windowId` 并校验 sender 归属（全仓库无发送方，安全） |

---

## 3. 第二轮修复（新发现 13 组）

### P1

| # | 位置 | 修复内容 |
| --- | --- | --- |
| 1 | `muya/ui/paragraphQuickInsertMenu/index.ts`、`ui/baseScrollFloat/index.ts`、`ui/codeBlockLanguageSelector/index.ts` | 空搜索结果时 `renderData` setter 清空 `activeItem`；`step()` 空列表直接返回；`selectItem` 加空值守卫，方向键/回车不再崩溃或插入陈旧项 |

### P2

| # | 位置 | 修复内容 |
| --- | --- | --- |
| 2 | `muya/ui/tooltip/index.ts` | 稳定 handler + WeakMap 记录 timer/监听器，`_mouseLeave` 统一清理；重复悬停不再累积 300ms 轮询与监听器 |
| 3 | `muya/ui/imageEditTool/index.ts` | `imageAction` 加 try/catch；失败时把 `loading-N` 占位恢复为用户编辑后的 alt/src/title |
| 4 | `desktop/preload/index.ts` | `isSamePathSync` 归一化后剥离尾分隔符（保留盘符根），与主进程 node path 语义对齐 |
| 5 | `packages/website/src/middleware.ts` | matcher 负向断言移除 `docs/`、`assets/`，www→apex 301 覆盖全站 |

### P3

| # | 位置 | 修复内容 |
| --- | --- | --- |
| 6 | `scripts/postinstall.ts` | 第 5/6 步按包管理器分支：npm 环境直接调用本地 tsx/tsc 二进制，不再硬编码 pnpm |
| 7 | `scripts/postinstall.ts` | pnpm add 后恢复被改写的 `packages/desktop/package.json`，保住 optionalDependencies 语义 |
| 8 | `muya/ui/footnoteTool/index.ts`、`ui/linkTools/index.ts` | `_showTimer` 跟踪延迟 show；`hide()` 与 null 分支取消排队；回调校验 `reference.isConnected`，弹窗不再“复活” |
| 9 | `muya/ui/linkTools/index.ts` | unlink 前比对 `block.text` 区间与缓存 `raw`，文档被编辑后跳过陈旧 range |
| 10 | `muya/editor/dragDropImage.ts`、`muya/src/assets/styles/index.css` | ghost 改为每实例 WeakMap 持有；`#mu-dragover-ghost` 改 class；新增 `dragend` 兜底清理 |
| 11 | `desktop/common/filesystem/paths.ts` | 危险扩展名守卫剥离最后一个路径段内的 NTFS ADS 后缀（`x.exe::$DATA`），URL/盘符冒号不受影响 |
| 12 | `desktop/preload/index.ts` | send/sendSync/invoke/on/once/removeAllListeners 统一 `assertChannel`：拒绝非字符串与 `newListener`/`removeListener`/`__proto__`（完整 allow-list 需运行时镜像类型契约，未重复维护） |
| 13a | `scripts/thirdPartyChecker.ts` | `@marktext/file-icons` 排除项从安装目录解析实际版本号，匹配恢复生效 |
| 13b | `desktop/common/filesystem/index.ts` | `isFile` 改用 `statSync`（跟随符号链接），符号链接图片不再被拒；已核实全部调用方语义兼容 |
| 13c | `muya/ui/tableChessboard/index.ts` | 行列输入封顶 `MAX_CHESSBOARD_SIZE = 50` |
| 13d | `muya/selection/dom.ts` | `getTextContent` 图片容器判空，渲染中间态不再崩溃 |
| 13e | `muya/editor/index.ts`、`muya/muya.ts` | rxjs `fromEvent` 订阅记录到 `_domEventSubscriptions`，`muya.destroy()` 经 `disposeEvents()` 统一 unsubscribe |

### 回归自纠

| 项 | 位置 | 说明 |
| --- | --- | --- |
| 游标错位 | `muya/block/content/paragraphContent/index.ts` | 第一轮 #4 修复曾把游标定位写成“第一个段落克隆”；宽松列表多段落时会落错段落，已改为跟踪 `parent` 对应克隆 |
| lint 格式 | `muya/state/stateToMarkdown.ts` | `escapeText` 回调换行触发 `antfu/consistent-list-newline`，已改写 |

---

## 4. 验证记录

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| desktop 类型 | `vue-tsc --noEmit -p tsconfig.json`（packages/desktop） | 通过 |
| muya 类型 | `tsc -p tsconfig.build.json`（packages/muya） | 通过 |
| desktop 单测 | `vitest run test/unit` | 169 文件通过，6 skipped |
| muya 全量 | `vitest run` | 363 文件通过；11 个失败文件为既有 prism mock 问题（`languageTitle` 未入 mock），与本次改动无关 |
| lint | `eslint`（两轮全部改动文件） | 干净 |
| 专项实测 | 表格反斜杠/竖线往返、Shift+Tab 嵌套列表、根级 list-item 序列化 | 均符合预期 |

配套测试调整：`test/unit/specs/uploader-temp-file.spec.ts`、`picgo-discovery.spec.ts` 适配 `registerUploaderHandlers` 新签名。

---

## 5. 遗留事项

1. **muya 既有测试 mock 过时**：11 个 spec 的 `../utils/prism/index` mock 缺 `languageTitle` 导出，建议单独修复。
2. **#12 完整通道 allow-list**：当前仅拦截 EventEmitter 保留名与非法类型；彻底方案需要为 `shared/types/ipc.ts` 建立运行时镜像，属架构决策。
3. **`#13/#16/#17`（第一轮编号）**：触发条件受限的既有缺陷未改动，见复核报告 §5。
4. 所有改动未提交，等待人工复核后自行决定提交策略。
