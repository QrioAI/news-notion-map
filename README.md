# news-notion-map

產生 `notion-map.json`，內容是「新聞 id → 該篇補充內容在 Notion 上的公開網址」，發布到 GitHub Pages 讓前端直接讀。

這個 repo 存在的理由只有一個：讓編輯在 Notion 新增一篇補充內容之後，前端不用重新部署就能看到連結。

## 網址

```
https://qrioai.github.io/news-notion-map/notion-map.json
```

內容長這樣，第一層是新聞編號，第二層是語言：

```json
{
  "652": {
    "en": "https://flicker-scissor-072.notion.site/xxx",
    "zh-TW": "https://flicker-scissor-072.notion.site/yyy"
  }
}
```

只收錄同時滿足四個條件的頁面：填了 News ID、填了 Language、Status 是 Publish、而且已經按過「發布到網頁」。任何一項不成立就完全不寫進來，網址也不會出現在這個檔案裡。

前端只要決定拿哪一個語言、找不到時退回哪一個，不用再判斷狀態。這份檔案裡的每一筆都是可以上線的。

## 建立步驟

repo 要設成 public。私有 repo 的 GitHub Pages 需要 Team 以上方案，而且這份檔案本來就只有公開網址，沒有機密。

**1. Settings → Pages**，Source 選 GitHub Actions。

**2. Settings → Secrets and variables → Actions**

| 分頁 | 名稱 | 值 |
|---|---|---|
| Secrets | `NOTION_TOKEN` | Notion integration 的 Internal Integration Secret，`ntn_` 開頭 |
| Variables | `NOTION_DATABASE_ID` | database 網址裡問號前面那 32 碼 |
| Variables | `NOTION_ID_PROPERTY` | 選填，預設 `News ID` |
| Variables | `NOTION_LANG_PROPERTY` | 選填，預設 `Language` |
| Variables | `NOTION_STATUS_PROPERTY` | 選填，預設 `Status` |
| Variables | `NOTION_READY_STATUS` | 選填，預設 `Publish`。只有這個狀態會進清單 |

token 一定要放 Secrets 那一頁，不要放 Variables，Variables 的值在執行紀錄裡看得到。

**3. Notion 那邊**確認 integration 的 Content access 有包含這個 database，否則 API 會回 404。

**4.** 推上 main 就會跑第一次。之後每小時自動更新，也可以在 Actions 分頁按 Run workflow 立刻更新。

## 編輯的操作

在 Notion 的 News For Kids Teaching Prompt 建一頁，填 News ID、Language 與 Status，寫內容，然後按「共用」→「發布到網頁」。Status 要是 Publish 才會進清單，其他狀態一律不寫出去，站上看不到，網址也不會外流。最多一小時後前端就會出現連結。等不及就請人到 Actions 分頁按一下 Run workflow。

同一則新聞的兩個語言版本是兩列，News ID 都填一樣的數字，Language 各選各的。Language 用 Select 欄位，選項就寫站上的語言代碼：`en`、`zh-TW`、`zh-CN`、`ja`。

換掉一份素材時，用同一個 News ID 與 Language 重新建一頁就好，網址變了前端會跟著換。舊那頁刪掉之後、清單還沒更新之前，站上的入口會暫時指向已經不存在的頁面。

沒有按發布到網頁的頁面不會被收進來，這是刻意的，草稿不會外流。

## 本機測試

```bash
NOTION_TOKEN=ntn_xxx NOTION_DATABASE_ID=xxx node script/fetch-notion-map.mjs
```

預設輸出到 `dist-notion-map/notion-map.json`，用 `OUT=` 可以改。

## 刻意的行為

讀到零筆對照時會讓流程失敗，不發布。因為零筆幾乎都代表權限或設定壞掉，直接發布一份空的檔案會讓站上所有連結一次消失。

輸出的鍵會排序，所以沒有實際變動時檔案位元組一致。

同一個 News ID 加同一個 Language 在 Notion 有多列時只留最後一列，執行紀錄會印出是哪幾組。沒填 Language 的列會被跳過並計入統計。

Status 不是 Publish 的列在腳本這一端就被擋掉，不會寫進檔案。執行紀錄會印出被擋掉幾筆，用來確認 Notion 那邊沒有漏標。

過濾放在腳本而不是前端，是因為這份檔案是公開的。放在前端的話，還沒要上線的那些頁面網址一樣會出現在檔案裡，任何人打開就看得到。

## 前端怎麼用

GitHub Pages 的回應帶 `access-control-allow-origin: *`，跨網域 fetch 沒問題。快取是 `max-age=600`，所以瀏覽器端最多會慢十分鐘拿到新的內容。

fetch 失敗就當作沒有補充內容、不顯示按鈕，不要跳錯誤訊息。
