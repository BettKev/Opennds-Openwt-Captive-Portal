#!/bin/sh

# File location /usr/bin/authentication_list.sh

# --- Configuration ---
GATEWAY="bhscyber"
BASE_URL="https://mpesa-wifi-portal.prodigy4614.workers.dev"
POLL_URL="${BASE_URL}/login?auth_get=view&gateway=${GATEWAY}"
HEARTBEAT_URL="${BASE_URL}/heartbeat"

RELOAD_THRESHOLD=120
COUNTER=0
HEARTBEAT_THRESHOLD=4 
HB_COUNTER=0

logger -t auth_poller "Birir WiFi Poller: Starting V3.6 (Persistent Client Recovery)..."

# --- 1. WAIT FOR SERVICES ---
while ! pgrep opennds >/dev/null; do sleep 5; done
sleep 5

# --- FUNCTION: RECOVER SESSIONS ---
recover_sessions() {
    # Get all PAID sessions (processed or not) for this gateway
    RECOVERY_DATA=$(uclient-fetch -q -T 15 -O - "${POLL_URL}&recovery=true" 2>/dev/null)
    
    if [ -n "$RECOVERY_DATA" ] && [ "$RECOVERY_DATA" != "*" ]; then
        echo "$RECOVERY_DATA" | while read -r line; do
            if [ "$(echo "$line" | cut -c1)" = "*" ]; then
                MINS=$(echo "$line" | awk '{print $3}')
                MAC=$(echo "$line" | awk '{print $8}' | tr -d '\r\n ' | tr '[:upper:]' '[:lower:]')
                
                if [ -n "$MAC" ] && [ "$MAC" != "n/a" ]; then
                    # Check if client is on WiFi AND NOT already authenticated
                    # We check 'ndsctl json' because it's the most accurate way to see 'state'
                    CLIENT_INFO=$(ndsctl json "$MAC" 2>/dev/null)
                    
                    if echo "$CLIENT_INFO" | grep -q "$MAC"; then
                        if ! echo "$CLIENT_INFO" | grep -qi "\"state\":\"authenticated\""; then
                            logger -t auth_poller "RECONNECT: $MAC re-joined WiFi. Restoring $MINS mins."
                            ndsctl auth "$MAC" "$MINS" 0 0 0 0 >/dev/null 2>&1
                        fi
                    fi
                fi
            fi
        done
    fi
}

# --- MAIN LOOP ---
while true; do
    # 2. HEARTBEAT (Cloud time tracking)
    HB_COUNTER=$((HB_COUNTER + 1))
    if [ "$HB_COUNTER" -ge "$HEARTBEAT_THRESHOLD" ]; then
        uclient-fetch -q -T 10 --post-data="{\"gateway_hash\": \"$GATEWAY\"}" \
            --header="Content-Type: application/json" -O - "$HEARTBEAT_URL" > /dev/null 2>&1
        HB_COUNTER=0
    fi

    # 3. HOURLY MAINTENANCE
    COUNTER=$((COUNTER + 1))
    if [ "$COUNTER" -ge "$RELOAD_THRESHOLD" ]; then
        /etc/init.d/opennds restart
        sleep 10
        COUNTER=0
    fi

    # 4. RECOVERY (Check for re-connecting clients EVERY 30 SECONDS)
    recover_sessions

    # 5. NEW PAYMENTS (Immediate ACK)
    RAW_DATA=$(uclient-fetch -q -T 10 -O - "$POLL_URL" 2>/dev/null)
    if [ -n "$RAW_DATA" ] && [ "$RAW_DATA" != "*" ]; then
        echo "$RAW_DATA" | while read -r line; do
            if [ "$(echo "$line" | cut -c1)" = "*" ]; then
                RHID=$(echo "$line" | awk '{print $2}')
                MINS=$(echo "$line" | awk '{print $3}')
                MAC=$(echo "$line" | awk '{print $8}' | tr -d '\r\n ' | tr '[:upper:]' '[:lower:]')

                if [ -n "$MAC" ] && [ "$MAC" != "n/a" ]; then
                    if ndsctl status | grep -i "$MAC" >/dev/null 2>&1; then
                        logger -t auth_poller "NEW AUTH: $MAC found. Sending ACK for $RHID"
                        ndsctl auth "$MAC" "$MINS" 0 0 0 0 >/dev/null 2>&1
                        uclient-fetch -q -O - "${POLL_URL}&payload=%2a%20${RHID}" > /dev/null 2>&1
                    else
                        logger -t auth_poller "WAITING: $MAC paid but not connected to WiFi."
                    fi
                fi
            fi
        done
    fi
    sleep 30
done