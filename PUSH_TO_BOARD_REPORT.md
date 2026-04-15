# PinCopy - 推送到画板功能调试报告

## 项目背景

PinCopy 是一个 Chrome 扩展（MV3），用于收藏 Pinterest 图片到侧边栏。
现在要实现：**一键将已收藏的所有 pin 批量重新保存到指定 Pinterest 画板**。

---

## 已知的 Pinterest 内部 API（通过 XHR 拦截确认）

### 1. 保存 Pin 到画板（已确认可用）

```
POST https://www.pinterest.com/resource/RepinResource/create/
Content-Type: application/x-www-form-urlencoded

source_url=/pin/4151824653138280/
data={"options":{"pin_id":"4151824653138280","board_id":"433119757853598249","description":"","title":"","carousel_slot_index":0,"is_buyable_pin":false,"is_promoted":false,"is_removable":false,"aux_data":{"source":"deep_linking"}},"context":{}}
```

**必要 Headers：**
```
X-Requested-With: XMLHttpRequest
Accept: application/json, text/javascript, */*; q=0.01
X-APP-VERSION: dcca8dd
Content-Type: application/x-www-form-urlencoded
X-CSRFToken: <从 csrftoken cookie 读取>
X-Pinterest-AppState: active
X-Pinterest-Source-Url: /pin/<pin_id>/
```

### 2. 获取用户画板列表（一直返回 403）

```
GET /resource/BoardPickerBoardsResource/get/?source_url=/pin/<id>/&data={"options":{"field_set_key":"board_picker"},"context":{}}
```

**问题**：此接口始终返回 403，无论从：
- Content Script（isolated world）发起
- `chrome.scripting.executeScript` + `world: 'MAIN'` 发起
- 首页或 pin 详情页上下文发起

---

## 当前实现方案（background.js）

```
1. chrome.tabs.create({ url: firstPinUrl })  // 打开第一张 pin 页面
2. 等待页面加载完成
3. chrome.cookies.get('csrftoken') 读取 token
4. chrome.scripting.executeScript({ world: 'MAIN', func: fetchBoardList })  → HTTP 403
5. 如果成功：循环调用 repinToBoard 逐个保存
```

---

## 核心问题

**`BoardPickerBoardsResource` 始终 403**，无法通过程序获取用户画板列表（board_id）。

`RepinResource` 本身调用格式是正确的，缺少的唯一参数是 `board_id`。

---

## 数据结构

每张收藏的 pin 对象：
```json
{
  "id": "abc123",
  "imageUrl": "https://i.pinimg.com/736x/xxx.jpg",
  "pageUrl": "https://www.pinterest.com/pin/4151824653138280/",
  "title": "",
  "timestamp": 1700000000000
}
```

`pin_id` 从 `pageUrl` 正则提取：`/\/pin\/(\d+)/`

---

## 可能的解决方向

1. **换一个获取画板列表的 API endpoint**
   - `UserBoardsResource`、`ProfileBoardsResource` 等其他端点？

2. **让用户直接输入 board_id**（从 Pinterest 画板 URL 中提取）
   - 画板 URL 格式：`https://www.pinterest.com/username/board-name/`
   - board_id 是数字，不能从 URL 直接获得

3. **捕获画板选择请求**
   - 让用户手动点一次 Save 并选择目标画板，捕获其中的 `board_id`，之后全部用这个 id

4. **用 Pinterest OAuth API**（需要申请开发者权限）

---

## 相关文件

- `background.js`：推送核心逻辑（`executePush`、`fetchBoardList`、`repinToBoard`）
- `content.js`：Pinterest 页面的收藏按钮注入
- `assets/js/sidepanel.js`：侧边栏 UI 逻辑
- `manifest.json`：权限：`storage, sidePanel, downloads, tabs, cookies, scripting`

---

## 建议

最简单可行的方案可能是方案 3：
用户在扩展里点「推送到画板」→ 系统弹一个提示让用户在 Pinterest 上随便 Save 一次到目标画板 → 扩展自动捕获这次操作中的 `board_id` → 然后用这个 id 批量调用 `RepinResource`。
