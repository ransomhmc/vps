#!/bin/bash
# 在 ipcam-74~81 上各自執行 curl 下載測速，反映網際網路速度
# 用法：SPEED_CMD=./speed_test.sh python3 record_speed.py

HOSTS="ipcam-74 ipcam-75 ipcam-76 ipcam-77 ipcam-78 ipcam-79 ipcam-80 ipcam-81"
TEST_URL="https://speed.cloudflare.com/__down?bytes=10485760"
SSH_OPTS="-p 2222 -o ConnectTimeout=15 -o StrictHostKeyChecking=no"

i=0
for host in $HOSTS; do
  i=$((i + 1))
  result=$(ssh $SSH_OPTS mesh@$host \
    "curl -o /dev/null -s -w '%{speed_download}' --max-time 60 '$TEST_URL'" 2>/dev/null)
  if [[ "$result" =~ ^[0-9]+(\.[0-9]+)?$ ]]; then
    speed=$(echo "scale=2; $result / 1048576" | bc)
  else
    speed=0
  fi
  printf "%d. %s — %.2f MiB/s\n" "$i" "$host" "$speed"
done
