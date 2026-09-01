# news-notion-map

產生 `notion-map.json`，內容是「新聞 id → 該篇補充內容在 Notion 上的公開網址」，發布到 GitHub Pages 讓前端直接讀。

這個 repo 存在的理由只有一個：讓編輯在 Notion 新增一篇補充內容之後，前端不用重新部署就能看到連結。

## 網址

```
https://qrioai.github.io/news-notion-map/notion-map.json
```

內容長這樣：

```json
{
  "652": "https://flicker-scissor-072.notion.site/3ce3e4bfe89c80eaaea6c009f3a62bfe"
}
```

只包含已經填好 News ID、而且已經發布到網頁的那些頁面。沒補充內容的新聞不會出現在裡面。

## 建立步驟

repo 要設成 public。私有 repo 的 GitHub Pages 需要 Team 以上方案，而且這份檔案本來就只有公開網址，沒有機密。

**1. Settings → Pages**，Source 選 GitHub Actions。

**2. Settings → Secrets and variables → Actions**

| 分頁 | 名稱 | 值 |
|---|---|---|
| Secrets | `NOTION_TOKEN` | Notion integration 的 Internal Integration Secret，`ntn_` 開頭 |
| Variables | `NOTION_DATABASE_ID` | database 網址裡問號前面那 32 碼 |
| Variables | `NOTION_ID_PROPERTY` | 選填，預設 `News ID` |

token 一定要放 Secrets 那一頁，不要放 Variables，Variables 的值在執行紀錄裡看得到。

**3. Notion 那邊**確認 integration 的 Content access 有包含這個 database，否則 API 會回 404。

**4.** 推上 main 就會跑第一次。之後每小時自動更新，也可以在 Actions 分頁按 Run workflow 立刻更新。

## 編輯的操作

在 Notion 的 News For Kids Teaching Prompt 建一頁，填 News ID，寫內容，然後按「共用」→「發布到網頁」。最多一小時後前端就會出現連結。等不及就請人到 Actions 分頁按一下 Run workflow。

沒有按發布到網頁的頁面不會被收進來，這是刻意的，草稿不會外流。

## 本機測試

```bash
NOTION_TOKEN=ntn_xxx NOTION_DATABASE_ID=xxx node script/fetch-notion-map.mjs
```

預設輸出到 `dist-notion-map/notion-map.json`，用 `OUT=` 可以改。

## 刻意的行為

讀到零筆對照時會讓流程失敗，不發布。因為零筆幾乎都代表權限或設定壞掉，直接發布一份空的檔案會讓站上所有連結一次消失。

輸出的鍵會排序，所以沒有實際變動時檔案位元組一致。

同一個 News ID 在 Notion 有多列時只留最後一列，執行紀錄會印出是哪些 id。

## 前端怎麼用

GitHub Pages 的回應帶 `access-control-allow-origin: *`，跨網域 fetch 沒問題。快取是 `max-age=600`，所以瀏覽器端最多會慢十分鐘拿到新的內容。

fetch 失敗就當作沒有補充內容、不顯示按鈕，不要跳錯誤訊息。
