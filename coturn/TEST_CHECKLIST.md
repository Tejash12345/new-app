# Call verification checklist

## Machine-verified (I run these here, over the real internet)
- [ ] `node _shot-webrtc.mjs` shows a **relay** candidate from the new server
- [ ] Forced **relay-only** RTCPeerConnection reaches `connected` (this is the
      exact path Jio↔Airtel uses — if it connects here, it connects on carriers)
- [ ] Two-account signaling + video/screen E2E (`node _shot-video.mjs`) green
- [ ] 360px overflow walk clean

## Real-device (needs your phones — I can't hold SIMs from a dev box)
Install the new APK on two phones and, for each pair, start a call and confirm
audio both ways + video appears:

| # | Scenario | Result |
|---|----------|--------|
| 1 | APK ↔ APK, same Wi-Fi | |
| 2 | APK ↔ APK, different Wi-Fi (e.g. home ↔ office) | |
| 3 | APK ↔ APK, **Jio mobile data ↔ Airtel mobile data** | |
| 4 | APK ↔ APK, **Jio ↔ Vi** | |
| 5 | APK (data) ↔ Website/PWA (laptop Wi-Fi) | |
| 6 | Website ↔ Website (two laptops) | |
| 7 | APK ↔ Chrome browser | |

Tip: to prove the relay is actually carrying a call, open
`chrome://webrtc-internals` on the desktop side during scenario 5/6 — the
selected candidate pair should show `relay` when both sides are on cellular.
