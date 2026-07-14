# FocusLion TURN relay — two ways to get cross-carrier calls working

Cross-carrier calls (Jio↔Airtel↔Vi) go through carrier-grade NAT on both ends,
so they can **only** connect via a TURN relay. Pick ONE option below. Both are
free. After either, tell me the values and I wire them into the app + rebuild.

---

## Option A — Metered.ca (managed, ~2 minutes, easiest) ✅ recommended

1. Sign up free at **https://dashboard.metered.ca/signup** (email + password, no card).
2. In the dashboard open **TURN Server → Credentials** (or **API Keys**).
3. Copy the **username** and **credential (password)** it shows.
4. Paste both to me. Free tier is 50 GB/month — plenty for calls.

I'll drop them into `MANAGED_TURN` in `src/components/Together.tsx`
(or the `VITE_TURN_*` env vars) and rebuild.

---

## Option B — Self-hosted Coturn (free forever, needs a VM)

Best truly-free host: **Oracle Cloud Always Free** (ARM VM, permanent, no
charge). Any VPS with a public IP works.

### 1. Create a small VM
- Ubuntu 22.04+, public IPv4.
- Open these ports in the cloud firewall / security list, **both TCP and UDP**:
  - `3478`, `5349`, and the UDP range `49152-65535`.

### 2. Install Docker + deploy
```bash
sudo apt update && sudo apt install -y docker.io docker-compose-plugin
# copy this coturn/ folder to the VM (scp or git clone)
cd coturn
# edit turnserver.conf: set <PUBLIC_IP> and a <STRONG_PASSWORD>
sudo docker compose up -d
sudo docker logs -f coturn         # watch for "Relay allocations" on a test call
```

### 3. Tell me
- the VM's **public IP**, and
- the **password** you set (`user=focuslion:<STRONG_PASSWORD>`).

I'll set the app's relay to:
```
urls: ['turn:<IP>:3478', 'turn:<IP>:3478?transport=tcp', 'turns:<IP>:5349?transport=tcp']
username: 'focuslion'
credential: '<STRONG_PASSWORD>'
```

### Verify the server yourself (optional)
Paste your server into https://icetest.info or Trickle-ICE
(https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/) —
you should see `relay` candidates appear. That confirms it's working before I
even wire it in.

---

## What happens after you give me the values (either option)
1. I put them in the ICE config and **rebuild + redeploy the website**.
2. I **rebuild the APK** and ship it.
3. I run the automated **relay-only connection test** over the real internet
   and show you it connects (this is the exact path Jio↔Airtel uses).
4. You do the final real-phone checks from `TEST_CHECKLIST` (I'll provide it) —
   two phones on Jio and Airtel data — and it connects.
