# Antumnmark+ 代码复核报告：19 项存在代码缺陷

> 复核日期：2026-11-24  
> 复核方式：只读静态审查 + `tsx` / `node` 最小复现（未修改源码）  
> 复核范围：用户提供的 20 项问题清单（P1 6 项、P2 14 项）  
> 路径基准：仓库根目录；`desktop` = `packages/desktop/src/`，`muya` = `packages/muya/src/`

---

## 1. 结论概览

| 分类 | 数量 | 编号 | 备注 |
| --- | --- | --- | --- |
| P1 确认存在 | 5 | #1–#5 | 阻断级；#2/#3/#4 已实测复现 |
| P2 确认存在 | 11 | #6 #8 #9 #10 #11 #12 #14 #15 #18 #19 #20 | 功能缺陷 / 资源泄漏 / 安全边界；#6 触发条件受限（仅异常 state / 公开 API） |
| 确认缺陷（触发条件受限） | 3 | #13 #16 #17 | 代码缺陷真实，但常规事件流或解析路径下被其他逻辑缓解 |
| 不存在 | 1 | #7 | 设置窗口通过全局 `update-dialog` 间接订阅，状态可刷新 |
| **合计** | **20** | — | **19 项存在代码缺陷** |

**本次未提交改动引入**：#1（更新设置分组不可达）、#9（多选语义不一致，5 个子项全部成立）。  
其余 17 项为既有问题。

---

## 2. P1 阻断级问题（5 项）

| # | 位置 | 问题与证据 | 影响 |
| --- | --- | --- | --- |
| **1** | `desktop/renderer/prefComponents/categories.ts:19-24`<br>`desktop/renderer/prefComponents/general/index.vue:207-227`<br>`desktop/renderer/prefComponents/categoryPage.vue:9-14`<br>`desktop/renderer/prefComponents/registry.ts:86-95` | `generalGroups` 仅含 `general/appearance/files/images`，无 `updates`；新增开关用 `v-if="show('updates')"`，而 `categoryPage.vue` 传 `:groups="generalGroups[category]"`，`show()` 只认 `'all'` 或传入分组。`registry` 注册只影响搜索索引，`revealSetting` 依赖的 DOM 节点不存在。**本次改动引入** | 更新提示与在线更新开关永不可见，用户只能手改 `preference.json` |
| **2** | `desktop/renderer/commands/fileEncoding.ts:48-62`<br>`desktop/renderer/components/commandPalette/index.vue:198,304-311` | `subcommands.unshift(item)` 把当前编码插到下标 0，但 `subcommandSelectedIndex` 仍赋值循环变量 `i`（原 map 下标）。只有 `utf8`（i=0）吻合 | 非 utf8 文件直接回车选错编码，实测 GBK→`gb18030`、big5→`gbk`，可导致乱码 |
| **3** | `muya/state/stateToMarkdown.ts:58-60,546-549`<br>`muya/state/markdownToState.ts:438-451` | `escapeText` 用负向后顾判断“竖线前已有反斜杠”，但单元格模型保存的是**已解码**文本。实测两类输入均被错误写出，完整数据见 §4 复现记录 | 反斜杠语义丢失，表格整块降级为段落 |
| **4** | `muya/block/content/paragraphContent/index.ts:792-802`<br>`muya/block/base/treeNode.ts:174-184,248-261` | `REPLACEMENT` 分支只 `clone()` 段落；`listItem.isOnlyChild()` 为真时执行 `list.remove()`，连带摘除整个子树 | 对 `- - a` 下嵌 `- b` 的 `a` 按 Shift+Tab，`b` 被删除；实测 markdown 从 `- - a\n    - b\n` 变为 `- a\n` |
| **5** | `desktop/main/applicationState/sessionHost.ts:1145-1237,1045-1063`<br>`desktop/main/applicationState/checkpointService.ts:79-81,117-124,417-434`<br>`desktop/main/applicationState/documentRegistry.ts:322-341` | `moveResource` / `_moveResourceNow` 只重定向调用窗口文档，无 `moveSidebarItem` 的 `openElsewhere` 跨窗口检查，且 `document-relocated` 不发广播；`saveDocument` 在 `current.exists === false` 时 `changed=false`，跳过冲突确认框 | A 窗口移走 P→Q 后，B 窗口仍持旧路径；下次保存静默重建 P，形成“幽灵副本” |

---

## 3. P2 确认存在（11 项）

| # | 位置 | 问题与证据 | 影响 |
| --- | --- | --- | --- |
| **6** | `muya/state/stateToMarkdown.ts:151-152,331-338,71,86,291-293,638`<br>`muya/state/types.ts:225-237` | `generate()` 不重置 `_listType`；根级 `list-item` 分发时栈为空，`const { loose } = this._listType[this._listType.length - 1]` 解构 `undefined` | 抛 `TypeError`。实测可复现，但正常 Markdown 解析不会产生裸 `list-item` 根块，需外部/手工构造非法 state；故由 P1 降为 P2 |
| **8** | `desktop/main/applicationState/sessionHost.ts:91,1361-1366,1402-1404,1530-1539`<br>`desktop/renderer/services/windowSession.ts:558-565`<br>`desktop/renderer/src/store/editor.ts:735-739` | `_tabClosePending` 是实例级布尔，不按 `windowId` 区分；渲染侧 `_close()` / `CLOSE_TAB` 不检查返回状态 | A 窗口保存对话框期间，B 窗口关闭标签被静默取消，无提示 |
| **9** | `desktop/store/project.ts:389-432,580-598,710-737`<br>`desktop/components/sideBar/tree.vue:120-133,347-351`<br>`desktop/components/sideBar/selectionRange.ts:3-12` | a) `TOGGLE_SELECTION` 取消选中后仍写 `activeItem`，Delete 继续操作该行；b) `SIDEBAR::remove` 只清 `activeItem`，`selectedPaths` 残留；c) `RENAME_IN_SIDEBAR` 只同步 `activeItem`；d) `handleRootClick` 无 Ctrl 分支，Ctrl+点击根走 `SELECT_SINGLE` 清空多选；e) 根行模板带 `data-tree-path`（`tree.vue:125`），`visibleTreeRows` 不去除根行，Shift 区间可把根路径写进隐藏列表。**本次改动引入，5/5 成立** | 多选隐藏/删除行为与用户预期不一致，可能隐藏项目根 |
| **10** | `desktop/main/ipc/ripgrep.ts:31-42,190-221,448-455`<br>`desktop/shared/types/ipc.ts:166` | 每次 `mt::rg::start` 新建闭包 `sender.once('destroyed')`，正常结束只删 `activeSearches`，不注销监听；handler `return true`，契约为 `ret: { searchId: string }` | 监听器随搜索次数累积；IPC 契约违背（渲染侧暂未使用返回值） |
| **11** | `desktop/components/sideBar/treeFile.vue:38,124-136`<br>`desktop/components/sideBar/treeFolder.vue:69,155-167`<br>对照 `tree.vue:644-652` | `onMounted` 注册 `bus.on('SIDEBAR::show-rename-input')` / `bus.on('SIDEBAR::show-new-input')`，无 `onBeforeUnmount` / `onUnmounted` 注销 | 节点重挂载后监听泄漏，回调持有已销毁组件 |
| **12** | `desktop/main/applicationState/atomicJsonFile.ts:38-44,46-58,76-85` | 非 ENOENT 读取错误即置 `_protectedReason='unreadable'`；`_read()` 遇该字段直接短路，类中无任何重置/重试恢复路径 | EACCES/EBUSY/EMFILE 等瞬时错误导致进程生命周期内所有 `write()` 抛错 |
| **14** | `desktop/main/app/index.ts:523-556`（send 在 547 行） | macOS `screencapture -i -c` 的 `exec` 异步回调内有多个 await，直接 `win.webContents.send('mt::screenshot-captured', ...)`，无 `isDestroyed()` 检查；仓库其他模块有此防护 | 用户截图期间关闭窗口，回调 send 抛 “Object has been destroyed” |
| **15** | `muya/state/htmlToMarkdown.ts:6,19-31,32-53,62` | `node.nodeValue ?? ''.replace(...).replace(...)`：`.` 优先级高于 `??`，右侧 replace 链被短路且操作数是空串，`startLen/endLen` 恒为 0 | 首尾换行处理成死代码，粘贴时首尾被转换成软换行 `<span>` |
| **18** | `desktop/main/ipc/uploader.ts:83-92,148-166`<br>`desktop/preload/index.ts:236-238,304`<br>`desktop/shared/types/ipc.ts:174` | handler 首参 `_event` 忽略来源；`cliScript` 完全来自渲染请求 `req.preferences`，无窗口类型/偏好白名单/路径校验，直接 `execFile(cliScript, [localPath])` | 任意渲染窗口可让主进程执行任意可执行文件（renderer→main 权限提升面）；参数无 shell 注入风险 |
| **19** | `desktop/store/editor.ts:338,401`（另见 637-638,646,1014,1347）<br>`desktop/preload/index.ts:154-169`<br>`desktop/common/filesystem/paths.ts:124-144` | 查找 tab 用 `isSamePathSync`（normalize + 大小写不敏感），判断“当前文件”用原始字符串 `===` | Windows 大小写/分隔符差异时，tab 已更新但编辑器不发 `file-changed`，显示旧内容 |
| **20** | `desktop/main/app/windowManager.ts:313-321,396-403`<br>`desktop/shared/types/ipc.ts:270,283` | 契约声明 `(windowId, filePath)`，实现 `ipcMain.on('mt::window-add-file-path', (e, filePath) => ...)` 忽略 `windowId`，用 `sender` 推导窗口；`mt::rg::start` 返回 `true` 同 #10 | 全仓库无调用方，属潜在契约陷阱：将来按契约传参会错位 |

---

## 4. 关键复现记录

**#2 编码下标错位**（node，复用真实 `ENCODING_NAME_MAP`）：

```text
utf8    -> subcommandSelectedIndex=0,  selectedId=utf8,    firstId=utf8
gbk     -> subcommandSelectedIndex=29, selectedId=gb18030, firstId=gbk
gb2312  -> subcommandSelectedIndex=27, selectedId=cp1254,  firstId=gb2312
big5    -> subcommandSelectedIndex=30, selectedId=gbk,      firstId=big5
latin6  -> subcommandSelectedIndex=35, selectedId=euckr,    firstId=latin6
```

**#3 表格序列化**（tsx，`ExportMarkdown` / `MarkdownToState`）：

```text
stored="a|b"    | md="| a\|b | x   |"  | hasTable=true  | parsedCells=["a|b","x"]
stored="a\|b"   | md="| a\|b | x   |"  | hasTable=true  | parsedCells=["a|b","x"]   ← 反斜杠丢失
stored="a\\|b"  | md="| a\\|b | x   |" | hasTable=false | parsedCells=null          ← 表格结构被破坏
```

**#4 Shift+Tab**（Muya + happy-dom，事务 flush 后）：

```text
before: "- - a\n    - b\n"   found a=true, found b=true
after:  "- a\n"              state 只剩 paragraph a，b 子列表整体消失
```

**#6 根级 list-item**（tsx，该问题已由 P1 降为 P2，正常解析路径不触发）：

```text
generate([{ name: 'list-item', children: [{ name: 'paragraph', text: 'x' }] }])
THREW: TypeError: Cannot destructure property 'loose' of 'this._listType[...]' as it is undefined.
    at ExportMarkdown._serializeListItemBlock (stateToMarkdown.ts:338:17)
```

---

## 5. 未纳入 P1/P2 的 4 项（排除说明）

| # | 结论 | 理由 |
| --- | --- | --- |
| **7** | **不存在** | 设置窗口入口 `settings.ts:13-25` → `createRenderer(routes)` → `createRenderer.ts:7` 使用 `Main.vue`；`Main.vue:5-9` 无条件渲染 `<update-dialog />`，`updateDialog.vue:99-101` 在 setup 即调用 `updates.listen()`。`publish()` 向所有订阅者广播，Pinia store 同窗口共享，设置页的 `updateChecking` / `updateStatus` 能正常刷新 |
| **13** | **确认缺陷，触发条件受限** | `watcher.ts:482-488,494-535` 的条目只在匹配 `add/change` 事件时 splice，`unwatchByWindowId` 不清；会话内数组会持续增长，只靠进程退出时的全局 `close()`（`watcher.ts:472-476`）清空。副作用是数组增长与可能的旧 mtime 误判，故列为触发条件受限 |
| **16** | **确认缺陷，触发条件受限** | `scrollPage/index.ts:207-219` 未判空属实（`!` 非空断言）。常规空文件走 `markdownToState.ts:104` 兜底 `[{ name: 'paragraph', text: '' }]`，不会触发；但 `Muya.setContent([])` → `editor/index.ts:711-722` → `state/index.ts:62-72` 的 `_setState` 直接 `deepClone`，无兜底，空数组可产生无子节点文档，点击空白仍抛 `TypeError`。公开 API 路径可达，故列为触发条件受限 |
| **17** | **确认缺陷，触发条件受限** | `sessionHost.ts:1327-1358` 的 `_statuses` 在 `add/change` 未清 `diskMissing` 属实，但 `store/editor.ts:1364-1379` 在 add/change 时置 `tab.diskMissing = false`，且 `loadChange`（`store/editor.ts:355-357,379`）过滤 `file_changed` 通知，常规事件流下不显示“文件已删除”；残留会在窗口重新初始化时重新带入 |

---

## 6. 建议修复顺序

1. **#1**（本次引入）：在 `categories.ts` 的 `general` 分组或新增分类中纳入 `updates`，让开关可见。
2. **#9**（本次引入）：统一多选操作目标，清理 `remove/rename` 后的 `selectedPaths`，根行不再进入隐藏范围。
3. **#2 / #3 / #4 / #5**：数据与功能完整性，优先于其他 P2。
4. **#18**：安全边界，限制 `cliScript` 来源与调用窗口。
5. **#6 / #8 / #10–#12 / #14 / #15 / #19 / #20**：按模块批量修复。

> 本报告仅为复核记录，未对源码做任何修改。当前工作区改动均未提交。
