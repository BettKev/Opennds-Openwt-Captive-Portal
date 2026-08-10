cat << 'EOF' > /usr/bin/authentication_list.sh
#!/bin/sh

GATEWAY="bhscyber"
BASE_URL="https://mpesa-wifi-portal.prodigy4614.workers.dev"
POLL_URL="${BASE_URL}/login?auth_get=view&gateway=${GATEWAY}"
CACHE_FILE="/tmp/active_sessions.txt"

RELOAD_THRESHOLD=120
COUNTER=0
CACHE_COUNTER=0
CACHE_REFRESH_CYCLES=30 # Refresh local cache every ~5 minutes (30 * 10s)

logger -t auth_poller "Birir WiFi Poller: Starting V4.3 (Cached Local Recovery)..."

while ! pgrep opennds >/dev/null; do sleep 5; done
sleep 5

fetch_and_cache_sessions() {
    logger -t auth_poller "Refreshing local session cache from Worker..."
    uclient-fetch -q -T 5 -O "$CACHE_FILE" "${POLL_URL}&recovery=true" 2>/dev/null
}

process_recovery_cache() {
    if [ -f "$CACHE_FILE" ]; then
        cat "$CACHE_FILE" | while read -r line; do
            if [ "$(echo "$line" | cut -c1)" = "*" ]; then
                MINS=$(echo "$line" | awk '{print $3}')
                UP=$(echo "$line" | awk '{print $4}')
                DOWN=$(echo "$line" | awk '{print $5}')
                MAC=$(echo "$line" | awk '{print $8}' | tr -d '\r\n ' | tr '[:upper:]' '[:lower:]')
                
                if [ -n "$MAC" ] && [ "$MAC" != "n/a" ]; then
                    CLIENT_INFO=$(ndsctl json "$MAC" 2>/dev/null)
                    if echo "$CLIENT_INFO" | grep -q "$MAC"; then
                        if ! echo "$CLIENT_INFO" | grep -qi "\"state\":\"authenticated\""; then
                            logger -t auth_poller "CACHED RECONNECT: $MAC (Speed: $UP/$DOWN). Restoring $MINS mins."
                            ndsctl auth "$MAC" "$MINS" "$UP" "$DOWN" 0 0 >/dev/null 2>&1
                        fi
                    fi
                fi
            fi
        done
    fi
}

# Initial fetch to populate local cache on startup
fetch_and_cache_sessions

while true; do
    COUNTER=$((COUNTER + 1))
    CACHE_COUNTER=$((CACHE_COUNTER + 1))

    if [ "$COUNTER" -ge "$RELOAD_THRESHOLD" ]; then
        /etc/init.d/opennds restart
        sleep 10
        COUNTER=0
    fi

    # Periodically refresh the local cache file from the server
    if [ "$CACHE_COUNTER" -ge "$CACHE_REFRESH_CYCLES" ]; then
        fetch_and_cache_sessions
        CACHE_COUNTER=0
    fi

    # Process session recovery locally using the cached file
    process_recovery_cache

    # Poll for real-time new payments
    RAW_DATA=$(uclient-fetch -q -T 5 -O - "$POLL_URL" 2>/dev/null)
    if [ -n "$RAW_DATA" ] && [ "$RAW_DATA" != "*" ]; then
        echo "$RAW_DATA" | while read -r line; do
            if [ "$(echo "$line" | cut -c1)" = "*" ]; then
                RHID=$(echo "$line" | awk '{print $2}')
                MINS=$(echo "$line" | awk '{print $3}')
                UP=$(echo "$line" | awk '{print $4}')
                DOWN=$(echo "$line" | awk '{print $5}')
                MAC=$(echo "$line" | awk '{print $8}' | tr -d '\r\n ' | tr '[:upper:]' '[:lower:]')

                if [ -n "$MAC" ] && [ "$MAC" != "n/a" ]; then
                    if ndsctl status | grep -i "$MAC" >/dev/null 2>&1; then
                        logger -t auth_poller "NEW AUTH: $MAC (Speed: $UP/$DOWN). Sending ACK for $RHID"
                        ndsctl auth "$MAC" "$MINS" "$UP" "$DOWN" 0 0 >/dev/null 2>&1
                        uclient-fetch -q -O - "${POLL_URL}&payload=%2a%20${RHID}" > /dev/null 2>&1
                    else
                        logger -t auth_poller "WAITING: $MAC paid but not connected to WiFi."
                    fi
                fi
            fi
        done
    fi
    sleep 10
done
EOF
chmod +x /usr/bin/authentication_list.sh