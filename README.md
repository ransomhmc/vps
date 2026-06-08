# VPS Monitoring

## 管理架構

| 角色 | 主機 | 說明 |
|------|------|------|
| **管理中心** | oracle6 | 執行所有監控排程，透過 SSH 存取各主機 |
| **受管主機** | ipcam-74 ~ ipcam-81 | 8 台 Ubuntu 20.04 機器 |

所有資料寫入 Cloudflare D1（`vps-records`），透過 Cloudflare Worker（`vps-api`）提供 REST API。

## 排程（systemd timer）

| Timer | 觸發時間 | 執行內容 |
|-------|----------|----------|
| `vps-speedtest.timer` | 每天 **23:00** | 測速 + 登入檢查 |
| `vps-monitor.timer` | 每 **5 分鐘** | TCP 連通性檢查 |

## 排程執行流程

### vps-speedtest.service

1. 由 `speed_test.sh` 對每台 ipcam SSH 執行 `curl` 從 Cloudflare 下載 10MB 測速檔案
2. `record_speed.py` 解析輸出，寫入 D1（collection: `speed_test`）
3. 同支 script 再對每台 ipcam 執行 `last -i -F -s "-7 days"`，過濾非 `100.x` 來源 IP 的登入記錄，寫入 D1（collection: `login_record`）

### vps-monitor.service

1. `record_monitor.py` 對每台 ipcam 執行 `nc -z -w 1` 檢查 port 2222 TCP 連通性
2. 結果寫入 D1（collection: `host_monitor`）

## 資料庫結構

所有資料統一儲存在 `records` 資料表，以 `collection` 區分種類，`data` 欄位存放 JSON。

```sql
CREATE TABLE IF NOT EXISTS records (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    collection TEXT NOT NULL,
    data       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_records_collection ON records(collection);
CREATE INDEX IF NOT EXISTS idx_records_collection_created ON records(collection, created_at);
```

### `speed_test`
| 欄位 | 說明 |
|------|------|
| `hostname` | 主機名稱 |
| `download_mbps` | 下載速度（MiB/s） |
| `tested_at` | 測試時間 (UTC) |

### `login_record`
| 欄位 | 說明 |
|------|------|
| `hostname` | 主機名稱 |
| `username` | 登入使用者 |
| `source_ip` | 來源 IP |
| `login_time` | 登入時間 |

### `host_monitor`
| 欄位 | 說明 |
|------|------|
| `hostname` | 主機名稱 |
| `response_time_ms` | 回應時間（ms），無法連線為 `-1` |
| `checked_at` | 檢查時間 |

## 監控儀表板

Cloudflare Pages 託管，Pages Function 代理 API 請求（藏 API key），透過 Chart.js 呈現圖表。

**網址：** https://vps-dashboard-5ph.pages.dev

| 圖表 | 資料範圍 | 說明 |
|------|----------|------|
| Uptime 折線圖 | 最近 2 天 | 每條線代表一台主機，Y 軸為 response time（ms），斷點為不可連線 |
| 測速柱狀圖 | 最近 7 天 | 每組為一天，每台主機一根柱子 |
| 登入記錄表 | 最近 5 筆 | 過濾掉 source IP 為 `100.x` 的記錄 |

## 查詢工具

`query.py` 透過 Worker API 查詢 D1，需經 Infisical 注入 API Key：

```bash
# 查看各 collection 最新一筆
./infisical-run.sh python3 query.py latest

# 查看特定 collection 最新一筆
./infisical-run.sh python3 query.py latest speed_test
./infisical-run.sh python3 query.py latest host_monitor
./infisical-run.sh python3 query.py latest login_record

# 列出記錄（可指定數量，預設 10 筆）
./infisical-run.sh python3 query.py list speed_test
./infisical-run.sh python3 query.py list host_monitor 20

# 趨勢圖（取樣 interval 小時內的平均值）
./infisical-run.sh python3 query.py trend speed_test 24

# 匯出 CSV
./infisical-run.sh python3 query.py export login_record

# 查看所有 collection
./infisical-run.sh python3 query.py collections
```

## 憑證管理

所有敏感資訊（`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`、`VPS_WORKER_API_KEY`）儲存在 **Infisical**（path: `/vps`）。本機執行時透過 `infisical-run.sh` 注入；oracle6 上直接寫入 `/opt/vps/.env`。

## 部署結構（oracle6）

```
/opt/vps/
├── .env                     # 環境變數（API key、SPEED_CMD）
├── record_speed.py          # 測速 + 登入檢查
├── record_monitor.py        # TCP 連通性檢查
├── speed_test.sh            # curl 測速腳本
└── deploy/
    └── monitor.sh           # systemd timer/service 安裝腳本
```

## 本機開發目錄

```
├── src/index.js              # Cloudflare Worker (API)
├── wrangler.jsonc            # Worker 部署設定
├── dashboard/                # Cloudflare Pages 儀表板
│   ├── index.html
│   ├── script.js
│   └── functions/api/[[path]].js   # Pages Function (代理 API 請求)
├── record_speed.py           # 測速 + 登入檢查
├── record_monitor.py         # TCP 連通性檢查
├── speed_test.sh             # curl 測速腳本
├── query.py                  # CLI 查詢工具
├── infisical-run.sh          # Infisical secret 注入包裝
└── deploy/
    └── monitor.sh            # systemd timer/service 安裝腳本
```
