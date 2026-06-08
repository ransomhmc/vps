#!/bin/bash
# Ubuntu 雲端主機：部署 ipcam 監測服務
# 先把本專案 scp 到主機，然後 sudo 執行此腳本

set -e

SRC="$(dirname "$0")"
DEST_DIR="/opt/vps"
SERVICE_USER="${SUDO_USER:-$USER}"

if [ "$EUID" -ne 0 ]; then
  echo "請用 sudo 執行"
  exit 1
fi

# 1. 複製腳本到 /opt/vps
mkdir -p "$DEST_DIR"
cp "$SRC/../record_monitor.py" "$DEST_DIR/"
chown -R "$SERVICE_USER:$SERVICE_USER" "$DEST_DIR"

# 2. 建立 env 檔（僅供 systemd 讀取，權限 600）
if [ ! -f "$DEST_DIR/.env" ]; then
  cat > "$DEST_DIR/.env" << EOF
# 請填入 VPS_WORKER_API_KEY
VPS_WORKER_API_KEY=
VPS_WORKER_URL=https://vps-api.selfcloud.workers.dev
EOF
  chmod 600 "$DEST_DIR/.env"
  chown "$SERVICE_USER:$SERVICE_USER" "$DEST_DIR/.env"
fi

# 3. systemd service（oneshot，定時執行）
cat > /etc/systemd/system/vps-monitor.service << 'EOF'
[Unit]
Description=VPS host monitor (ipcam-74~81)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/bin/python3 /opt/vps/record_monitor.py
WorkingDirectory=/opt/vps
EnvironmentFile=/opt/vps/.env
EOF

# 4. systemd timer（每 5 分鐘）
cat > /etc/systemd/system/vps-monitor.timer << 'EOF'
[Unit]
Description=Run VPS monitor every 5 minutes

[Timer]
OnCalendar=*:0/5
Persistent=true
RandomizedDelaySec=10

[Install]
WantedBy=timers.target
EOF

# 5. 啟用
systemctl daemon-reload
systemctl enable vps-monitor.timer
systemctl start vps-monitor.timer

echo "=== 部署完成 ==="
echo ""
echo "下一步："
echo "  vi /opt/vps/.env    # 填入 VPS_WORKER_API_KEY"
echo "  sudo systemctl restart vps-monitor.service  # 測試執行"
echo "  sudo journalctl -u vps-monitor.service -f   # 看日誌"
echo ""
echo "=== Timer 狀態 ==="
systemctl status vps-monitor.timer --no-pager -l
