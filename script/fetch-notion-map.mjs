#!/usr/bin/env node
// 從 Notion database 讀出「新聞 id → 補充內容公開網址」的對照表，輸出成 JSON。
// 由 GitHub Actions 定時執行，token 存在 repo secrets，不會進到前端 bundle。
// 無外部相依，Node 20+ 直接執行。

import fs from 'node:fs';
import path from 'node:path';

const API = 'https://api.notion.com/v1';
const VERSION_LEGACY = '2022-06-28';
const VERSION_DATA_SOURCE = '2025-09-03';

const TOKEN = process.env.NOTION_TOKEN;
const DATABASE_ID = process.env.NOTION_DATABASE_ID;
const ID_PROPERTY = process.env.NOTION_ID_PROPERTY || 'News ID';
const LANG_PROPERTY = process.env.NOTION_LANG_PROPERTY || 'Language';
const OUT = process.env.OUT || path.join(process.cwd(), 'dist-notion-map', 'notion-map.json');

function die(message, hint) {
  console.error(`錯誤：${message}`);
  if (hint) console.error(`怎麼修：${hint}`);
  process.exit(1);
}

if (!TOKEN) die('沒有 NOTION_TOKEN。', '在 repo 的 Settings → Secrets and variables → Actions 新增。');
if (!DATABASE_ID) die('沒有 NOTION_DATABASE_ID。', '同上，用 repository variable 存即可，它不是機密。');

// ------------------------------------------------------------------ 請求

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 429 與 5xx 重試，其餘直接回傳讓呼叫端判斷。
async function call(method, endpoint, { version = VERSION_LEGACY, body, attempt = 0 } = {}) {
  const res = await fetch(`${API}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Notion-Version': version,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if ((res.status === 429 || res.status >= 500) && attempt < 4) {
    const retryAfter = Number(res.headers.get('retry-after'));
    const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 1000;
    console.log(`  HTTP ${res.status}，${Math.round(wait / 1000)} 秒後重試（第 ${attempt + 1} 次）`);
    await sleep(wait);
    return call(method, endpoint, { version, body, attempt: attempt + 1 });
  }

  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

// 把 Notion 的 property 物件壓成字串，讀不出來就回空字串。
function readProperty(property) {
  if (!property) return '';
  switch (property.type) {
    case 'title':
    case 'rich_text':
      return (property[property.type] || []).map((t) => t.plain_text).join('');
    case 'number':
      return property.number == null ? '' : String(property.number);
    case 'select':
      return property.select?.name || '';
    case 'url':
      return property.url || '';
    case 'unique_id': {
      const { prefix, number } = property.unique_id || {};
      return number == null ? '' : `${prefix ? prefix + '-' : ''}${number}`;
    }
    case 'formula':
      return String(property.formula?.string ?? property.formula?.number ?? '');
    default:
      return '';
  }
}

// ------------------------------------------------------------------ 讀取

// 新版把 database 拆成 database 與 data source 兩層，端點不同，這裡自己判斷。
async function resolveQueryTarget() {
  const { ok, status, json } = await call('GET', `/databases/${DATABASE_ID}`, {
    version: VERSION_DATA_SOURCE,
  });
  if (status === 401) die('token 無效或已被撤銷。', '重新產生 Internal Integration Secret 並更新 secret。');
  if (status === 404) {
    die(
      'Notion 找不到這個 database。',
      'database id 抄錯，或 integration 的 Content access 沒有包含這個 database。',
    );
  }
  if (!ok) die(`讀取 database 失敗（HTTP ${status}）：${json.message || ''}`);

  const properties = Object.keys(json.properties || {});
  for (const [name, envName] of [[ID_PROPERTY, 'NOTION_ID_PROPERTY'], [LANG_PROPERTY, 'NOTION_LANG_PROPERTY']]) {
    if (properties.length && !properties.includes(name)) {
      die(
        `database 裡沒有叫「${name}」的欄位，現有欄位是 ${properties.join('、')}。`,
        `改 Notion 的欄位名稱，或改 ${envName} 這個變數。`,
      );
    }
  }

  const dataSourceId = json.data_sources?.[0]?.id;
  return dataSourceId
    ? { endpoint: `/data_sources/${dataSourceId}/query`, version: VERSION_DATA_SOURCE }
    : { endpoint: `/databases/${DATABASE_ID}/query`, version: VERSION_LEGACY };
}

async function fetchRows({ endpoint, version }) {
  const rows = [];
  let cursor;
  do {
    const { ok, status, json } = await call('POST', endpoint, {
      version,
      body: { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) },
    });
    if (!ok) die(`查詢失敗（HTTP ${status}）：${json.message || ''}`);
    rows.push(...(json.results || []));
    cursor = json.has_more ? json.next_cursor : null;
  } while (cursor);
  return rows;
}

// ------------------------------------------------------------------ 主流程

const target = await resolveQueryTarget();
const rows = await fetchRows(target);
console.log(`讀到 ${rows.length} 列`);

const map = {};
let missingId = 0;
let missingLang = 0;
let notPublished = 0;
const duplicated = [];

for (const row of rows) {
  const newsId = readProperty(row.properties?.[ID_PROPERTY]).trim();
  const lang = readProperty(row.properties?.[LANG_PROPERTY]).trim();
  if (!newsId) {
    missingId += 1;
    continue;
  }
  if (!lang) {
    missingLang += 1;
    continue;
  }
  if (!row.public_url) {
    notPublished += 1;
    continue;
  }
  if (map[newsId]?.[lang]) duplicated.push(`${newsId} ${lang}`);
  (map[newsId] ||= {})[lang] = row.public_url;
}

// 兩層都排序，讓每次輸出的位元組一致，沒有實際變動時 git 就看得出來沒變。
const sorted = {};
for (const newsId of Object.keys(map).sort()) {
  sorted[newsId] = Object.fromEntries(Object.keys(map[newsId]).sort().map((l) => [l, map[newsId][l]]));
}
const newsCount = Object.keys(sorted).length;
const pageCount = Object.values(sorted).reduce((n, langs) => n + Object.keys(langs).length, 0);

console.log(`可用對照 ${newsCount} 則新聞、共 ${pageCount} 個語言版本`);
console.log(`沒填 ${ID_PROPERTY} ${missingId} 筆，沒填 ${LANG_PROPERTY} ${missingLang} 筆，還沒發布 ${notPublished} 筆`);
if (duplicated.length) {
  console.log(`注意：同一個新聞編號的同一個語言有超過一列，只會留最後一列：${[...new Set(duplicated)].join('、')}`);
}

// 讀到零筆通常代表權限或設定壞了，不是真的沒有補充內容。
// 這種時候寧可讓流程失敗，也不要把一份空的對照表發布出去，把所有連結一次清空。
if (pageCount === 0) {
  die(
    '一筆可用的對照都沒有，不發布。',
    `確認 Notion 那邊的頁面有填 ${ID_PROPERTY} 與 ${LANG_PROPERTY}，而且已經按過「共用」→「發布到網頁」。`,
  );
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(sorted, null, 2) + '\n');
console.log(`已寫出 ${OUT}`);
