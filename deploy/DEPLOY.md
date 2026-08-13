# Boardsy — deploy notes for this batch

## What's in this folder
Drop-in replacements (same paths as the repo):

    server/server.js        # single central WS upgrade router (fixes Reconnecting…)
    server/board.js         # WSS -> noServer + audio on/off relay
    server/lesson-live.js   # WSS -> noServer
    public/board.html       # loads livekit-client, adds 🎤 Audio button, v=boardsy14
    public/board.js         # whiteboard audio module + connection diagnostics
    public/app.js           # lesson audio: URL normalize + preflight + clear errors
    public/app.html         # v=boardsy14 cache bump
    deploy/nginx-livekit.conf
    deploy/DEPLOY.md         # this file

## Deploy the code
    cd /opt/apps/athena
    git pull            # or unzip these files over the tree
    pm2 restart athenabot
    # then hard-refresh the browser (Cmd/Ctrl+Shift+R)

That alone fixes:
  1. "Reconnecting…" loop on the whiteboard  (server-side, no infra needed)
  2. The 🎤 Audio button now appears on the whiteboard for the owner while live

Audio will still show "can't reach the audio server…" until the LiveKit
signal server below is reachable. That message is the new, honest diagnostic —
it names the host it couldn't reach.

---

## Make audio actually connect (the "Failed to fetch" fix)

The app already mints LiveKit tokens (your LIVEKIT_* env is set). What's
missing is a reachable signal server at LIVEKIT_URL. Set it up once:

### 1. Run a LiveKit server on the EC2 box (Docker is simplest)
    # Generate a keypair if you don't have one:
    docker run --rm livekit/livekit-server generate-keys
    # -> prints API key + secret. These MUST match your app's .env:
    #    LIVEKIT_API_KEY / LIVEKIT_API_SECRET

Create /opt/livekit/livekit.yaml:

    port: 7880
    rtc:
      tcp_port: 7881
      port_range_start: 50000
      port_range_end: 60000
      use_external_ip: true
    keys:
      # key: secret   (same pair as your app .env)
      APIxxxxxxxx: your_secret_here

Run it (host networking so WebRTC UDP works):

    docker run -d --restart unless-stopped --name livekit \
      --network host \
      -v /opt/livekit/livekit.yaml:/livekit.yaml \
      livekit/livekit-server --config /livekit.yaml

Sanity check locally:
    curl -s http://127.0.0.1:7880/  # LiveKit responds (non-empty)

### 2. DNS + TLS for the subdomain
    # A record: livekit.athenabot.ai -> <EC2 public IP>
    sudo cp deploy/nginx-livekit.conf /etc/nginx/sites-available/livekit
    sudo ln -s /etc/nginx/sites-available/livekit /etc/nginx/sites-enabled/
    sudo certbot --nginx -d livekit.athenabot.ai   # issues the cert
    sudo nginx -t && sudo systemctl reload nginx

### 3. EC2 Security Group — open the media ports
    TCP  443            (already, for HTTPS)
    TCP  7881           (LiveKit RTC over TCP fallback)
    UDP  50000-60000    (WebRTC media — REQUIRED or audio connects then goes silent)

### 4. App .env — confirm these
    LIVEKIT_URL=wss://livekit.athenabot.ai
    LIVEKIT_API_KEY=APIxxxxxxxx
    LIVEKIT_API_SECRET=your_secret_here
    # optional, auto-derived from LIVEKIT_URL if omitted:
    # LIVEKIT_HTTP_URL=https://livekit.athenabot.ai

Then `pm2 restart athenabot` and hard-refresh.

---

## Verifying end to end
1. Open a whiteboard as owner -> "Go live" -> the 🎤 Audio button appears.
2. Click 🎤 Audio -> browser asks for mic -> button turns red "Audio on".
3. In a second browser (a rostered/shared viewer), open the live board ->
   you should hear the teacher. No "Reconnecting…" pill on either side.
4. If audio fails, the toast now names the exact host it couldn't reach —
   check DNS, the cert, the UDP range, and that the livekit container is up
   (`docker logs livekit`).

## Quick browser-console probe (optional)
Run in the teacher tab if audio won't connect — pinpoints DNS/TLS vs. app:
    fetch('https://livekit.athenabot.ai', {mode:'no-cors'})
      .then(()=>console.log('LiveKit host reachable'))
      .catch(e=>console.log('NOT reachable:', e.message));
