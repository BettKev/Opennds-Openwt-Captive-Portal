cat << 'EOF' > /usr/bin/heartbeat_tunnel.sh
#!/bin/sh

# Configuration
WORKER_URL="https://remote.prodigy4614.workers.dev/"
GATEWAY_HASH="bhscyber"
IDLE_INTERVAL=60   # 1 minute when idle (safe for Cloudflare free tier)
ACTIVE_INTERVAL=5  # 5 seconds when active/connected

# Global variable to safely pass large sleep intervals past shell exit-code limits
GLOBAL_INTERVAL=60

log() {
    echo "[gateway-reporter] $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

get_tunnel_status() {
    if ip link show wg0 2>/dev/null | grep -q "UP"; then
        echo 2 # CONNECTED state
    else
        echo 0 # OFFLINE state
    fi
}

run_heartbeat() {
    log "------------------------------------------------------------------"
    log "Starting heartbeat loop iteration..."
    
    TUNNEL_STATUS=$(get_tunnel_status)
    log "Local tunnel status check (wg0): $TUNNEL_STATUS"
    
    RESPONSE_MSG="testing connection to worker successful"
    
    PAYLOAD=$(printf '{"gateway_hash":"%s","tunnel_status":%d,"response":"%s"}' \
        "$GATEWAY_HASH" "$TUNNEL_STATUS" "$RESPONSE_MSG")

    log "Sending POST request to worker URL: $WORKER_URL"
    log "Payload: $PAYLOAD"

    RESPONSE=$(uclient-fetch -qO- --timeout=10 \
        --header="Content-Type: application/json" \
        --post-data="$PAYLOAD" \
        "$WORKER_URL" 2>/dev/null)

    if [ $? -eq 0 ] && [ -n "$RESPONSE" ]; then
        log "Worker response received successfully: $RESPONSE"

        SERVER_TUNNEL_STATUS=$(echo "$RESPONSE" | grep -o '"tunnel_status":[0-9]*' | cut -d':' -f2)
        log "Server returned tunnel_status: $SERVER_TUNNEL_STATUS"

        if [ "$SERVER_TUNNEL_STATUS" = "1" ]; then
            log "[ALERT] Remote access requested by UI! Accepting connection..."

            ACCEPT_PAYLOAD=$(printf '{"gateway_hash":"%s","tunnel_status":2,"response":"Tunnel connection accepted by router"}' \
                "$GATEWAY_HASH")

            log "Sending acceptance payload: $ACCEPT_PAYLOAD"
            uclient-fetch -qO- --timeout=10 \
                --header="Content-Type: application/json" \
                --post-data="$ACCEPT_PAYLOAD" \
                "$WORKER_URL" >/dev/null 2>&1

            log "Tunnel status successfully updated to 2 (CONNECTED) on worker."
            SERVER_TUNNEL_STATUS=2
        fi

        CMD=$(echo "$RESPONSE" | grep -o '"pending_command":"[^"]*"' | cut -d'"' -f4)
        log "Parsed pending_command: '$CMD'"

        if [ -n "$CMD" ] && [ "$CMD" != "null" ]; then
            log "Executing remote command: $CMD"
            
            OUTPUT=$(eval "$CMD" 2>&1)
            EXIT_CODE=$?
            
            log "Command executed with exit code: $EXIT_CODE"
            log "Command raw output:\n$OUTPUT"

            CLEAN_OUTPUT=$(echo "$OUTPUT" | tr '\n' ' ' | sed 's/"/\\"/g')

            RESULT_PAYLOAD=$(printf '{"gateway_hash":"%s","pending_output":"%s"}' \
                "$GATEWAY_HASH" "$CLEAN_OUTPUT")
            
            log "Sending execution output back to worker..."
            uclient-fetch -qO- --timeout=10 \
                --header="Content-Type: application/json" \
                --post-data="$RESULT_PAYLOAD" \
                "$WORKER_URL" >/dev/null 2>&1
            
            log "Command output sent back to worker successfully."
        else
            log "No pending commands found."
        fi

        if [ "$SERVER_TUNNEL_STATUS" = "1" ] || [ "$SERVER_TUNNEL_STATUS" = "2" ]; then
            log "Tunnel is ACTIVE. Switching to fast polling (${ACTIVE_INTERVAL}s)."
            GLOBAL_INTERVAL=$ACTIVE_INTERVAL
        else
            log "Tunnel is IDLE. Switching to slow polling (${IDLE_INTERVAL}s)."
            GLOBAL_INTERVAL=$IDLE_INTERVAL
        fi
    else
        log "Error: Failed to reach Cloudflare worker endpoint. Falling back to IDLE interval (${IDLE_INTERVAL}s)."
        GLOBAL_INTERVAL=$IDLE_INTERVAL
    fi
}

# Main Adaptive Loop
log "Starting adaptive heartbeat daemon loop..."
while true; do
    run_heartbeat
    log "Waiting for next check-in (${GLOBAL_INTERVAL}s)..."
    echo "------------------------------------------------------------------"
    echo ""
    sleep "$GLOBAL_INTERVAL"
done
EOF

chmod +x /usr/bin/heartbeat_tunnel.sh