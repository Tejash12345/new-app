# FocusLion Flutter wrapper — media upgrade (voice calls, YouTube, watch together)

The website now has WebRTC voice calls, synced YouTube playback and watch-together
video. These all work in Chrome, but the **Flutter WebView wrapper blocks them
until it grants media permissions and playback settings**. This doc is the exact
wrapper change, in the same spirit as `FLUTTER_TTS_BRIDGE.md`.

Symptoms in the current APK:
- Voice call button → stuck on "Calling…" or "Microphone is blocked"
- YouTube watch-together → black player / never starts
- Muted autoplay of the partner's video → doesn't start

## 1) AndroidManifest.xml — add permissions

`android/app/src/main/AndroidManifest.xml`, next to the existing INTERNET permission:

```xml
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
<uses-permission android:name="android.permission.CAMERA" />      <!-- future video calls; safe to add now -->
<uses-feature android:name="android.hardware.microphone" android:required="false" />
```

## 2) Ask the user for mic permission at runtime

Add [`permission_handler`](https://pub.dev/packages/permission_handler) to
`pubspec.yaml`, then before loading the WebView (or on first call attempt):

```dart
import 'package:permission_handler/permission_handler.dart';

Future<void> ensureMediaPermissions() async {
  await [Permission.microphone].request();
}
```

## 3) WebView settings + grant WebRTC requests

### If the wrapper uses `webview_flutter` (v4+):

```dart
import 'package:webview_flutter_android/webview_flutter_android.dart';

final controller = WebViewController()
  ..setJavaScriptMode(JavaScriptMode.unrestricted)
  ..setMediaPlaybackRequiresUserGesture(false); // muted autoplay for watch-together

// grant mic (and camera later) to the page — without this, getUserMedia
// silently fails and calls can never connect
final androidController = controller.platform as AndroidWebViewController;
await androidController.setOnPlatformPermissionRequest((request) {
  request.grant();
});
```

### If the wrapper uses `flutter_inappwebview`:

```dart
InAppWebView(
  initialSettings: InAppWebViewSettings(
    javaScriptEnabled: true,
    mediaPlaybackRequiresUserGesture: false, // muted autoplay
    allowsInlineMediaPlayback: true,
    iframeAllow: "camera; microphone; autoplay; encrypted-media; fullscreen",
    useHybridComposition: true,              // YouTube iframe rendering
  ),
  onPermissionRequest: (controller, request) async {
    return PermissionResponse(
      resources: request.resources,
      action: PermissionResponseAction.GRANT,
    );
  },
)
```

## 4) YouTube iframe notes

- `useHybridComposition: true` (inappwebview) or the default display mode in
  webview_flutter v4 renders YouTube correctly; older texture mode shows a
  black box.
- Ask users to keep **Android System WebView** updated (Play Store) — YouTube
  requires a reasonably recent engine.

## 5) Rebuild + ship

```
flutter build apk --release
```

Replace `public/focuslion.apk` with the new build so the in-app "Get App"
page serves it.

## Quick test matrix after rebuilding

| Test | Expected |
| --- | --- |
| Chat → Together menu → Voice call | partner's phone rings; audio both ways |
| Watch YouTube together | video renders and plays on both phones |
| Partner presses play | your side auto-starts muted + "🔊 Tap for sound" |
| Voice message (existing feature) | still records fine |

Until the new APK ships, everything works in phone Chrome (or the installed
PWA) — that's the quickest way to verify the website side is healthy.
