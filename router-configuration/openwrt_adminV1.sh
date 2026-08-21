cat << 'EOF' > /www/cgi-bin/admin.cgi
#!/bin/sh

ADMIN_PASS="admin123"
CODES_FILE="/tmp/portal_codes.txt"

# Ensure storage file exists
touch "$CODES_FILE"

echo "Content-Type: text/html"
echo ""

# Parse POST form data
INPUT_PASS=""
ACTION=""
REVOKE_CODE=""
SINGLE_USE="1"

if [ "$REQUEST_METHOD" = "POST" ] && [ -n "$CONTENT_LENGTH" ]; then
    READ_DATA=$(dd bs=1 count="$CONTENT_LENGTH" 2>/dev/null)
    INPUT_PASS=$(echo "$READ_DATA" | sed -n 's/.*pass=\([^&]*\).*/\1/p' | sed 's/+/ /g; s/%/\\x/g' | xargs -0 printf "%b" 2>/dev/null)
    ACTION=$(echo "$READ_DATA" | sed -n 's/.*action=\([^&]*\).*/\1/p')
    REVOKE_CODE=$(echo "$READ_DATA" | sed -n 's/.*code=\([^&]*\).*/\1/p')
fi

AUTHENTICATED=0
[ "$INPUT_PASS" = "$ADMIN_PASS" ] && AUTHENTICATED=1

MESSAGE=""
STATUS_CLASS=""

# Handle Actions when authenticated
if [ "$AUTHENTICATED" -eq 1 ]; then
    case "$ACTION" in
        generate)
            # Generate random 6-digit PIN using awk
            NEW_CODE=$(awk 'BEGIN{srand(); printf "%06d", int(rand()*1000000)}')
            
            # Save code to RAM file
            echo "$NEW_CODE" >> "$CODES_FILE"
            MESSAGE="Generated New Access Code: <strong>$NEW_CODE</strong>"
            STATUS_CLASS="success"
            ;;
        revoke)
            if [ -n "$REVOKE_CODE" ]; then
                sed -i "/^$REVOKE_CODE$/d" "$CODES_FILE"
                MESSAGE="Revoked Code: <strong>$REVOKE_CODE</strong>"
                STATUS_CLASS="success"
            fi
            ;;
        clear_all)
            > "$CODES_FILE"
            MESSAGE="Cleared all active access codes."
            STATUS_CLASS="error"
            ;;
    esac
elif [ "$REQUEST_METHOD" = "POST" ]; then
    MESSAGE="Invalid Admin Password."
    STATUS_CLASS="error"
fi

cat <<HTML
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Portal Admin Dashboard</title>
    <style>
        * { box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background-color: #0f172a; color: #f8fafc; display: flex; justify-content: center; padding: 2rem 1rem; margin: 0; }
        .card { background-color: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 2rem; width: 100%; max-width: 480px; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5); }
        h2 { margin-top: 0; color: #38bdf8; text-align: center; }
        .message { padding: 0.75rem; border-radius: 6px; margin-bottom: 1rem; font-size: 0.9rem; text-align: center; }
        .success { background-color: rgba(34, 197, 94, 0.2); border: 1px solid #22c55e; color: #4ade80; }
        .error { background-color: rgba(239, 68, 68, 0.2); border: 1px solid #ef4444; color: #f87171; }
        input[type="password"] { width: 100%; padding: 0.75rem; margin-bottom: 1rem; border: 1px solid #475569; border-radius: 6px; background-color: #0f172a; color: #fff; text-align: center; font-size: 1rem; }
        button { width: 100%; padding: 0.75rem; background-color: #0284c7; border: none; border-radius: 6px; color: #fff; font-weight: 600; cursor: pointer; margin-bottom: 0.5rem; }
        button.danger { background-color: #dc2626; }
        .code-list { margin-top: 1.5rem; border-top: 1px solid #334155; padding-top: 1rem; }
        .code-item { display: flex; justify-content: space-between; align-items: center; background-color: #0f172a; padding: 0.5rem 1rem; border-radius: 6px; margin-bottom: 0.5rem; font-family: monospace; font-size: 1.2rem; letter-spacing: 0.1em; }
        .code-item form { margin: 0; }
        .code-item button { padding: 0.25rem 0.5rem; margin: 0; font-size: 0.8rem; background-color: #b91c1c; }
    </style>
</head>
<body>
    <div class="card">
        <h2>Portal Admin Panel</h2>

        $([ -n "$MESSAGE" ] && echo "<div class=\"message $STATUS_CLASS\">$MESSAGE</div>")

        $([ "$AUTHENTICATED" -eq 0 ] && echo '
        <form method="POST">
            <input type="password" name="pass" placeholder="Enter Admin Password" required autofocus />
            <button type="submit">Login to Dashboard</button>
        </form>
        ' || echo "
        <form method=\"POST\">
            <input type=\"hidden\" name=\"pass\" value=\"$ADMIN_PASS\" />
            <input type=\"hidden\" name=\"action\" value=\"generate\" />
            <button type=\"submit\">+ Generate New 6-Digit Code</button>
        </form>

        <div class=\"code-list\">
            <h3>Active Codes in Memory (/tmp)</h3>
            $(if [ -s "$CODES_FILE" ]; then
                while read -r code; do
                    [ -z "$code" ] && continue
                    echo "<div class=\"code-item\"><span>$code</span>
                          <form method=\"POST\"><input type=\"hidden\" name=\"pass\" value=\"$ADMIN_PASS\" /><input type=\"hidden\" name=\"action\" value=\"revoke\" /><input type=\"hidden\" name=\"code\" value=\"$code\" /><button type=\"submit\">Revoke</button></form></div>"
                done < "$CODES_FILE"
            else
                echo "<p style=\"color:#64748b; text-align:center;\">No active codes. Generate one above.</p>"
            fi)
        </div>

        <form method=\"POST\" style=\"margin-top: 1.5rem;\">
            <input type=\"hidden\" name=\"pass\" value=\"$ADMIN_PASS\" />
            <input type=\"hidden\" name=\"action\" value=\"clear_all\" />
            <button type=\"submit\" class=\"danger\">Clear All Codes</button>
        </form>
        ")
    </div>
</body>
</html>
HTML
EOF

chmod +x /www/cgi-bin/admin.cgi