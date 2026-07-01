# Flutter TTS bridge — enable Play / Pause / Resume / Stop in the APK

The web app talks to the Android wrapper through the **`FLSpeak`** JavaScript
channel. The recipe voice reader (Diet page) and Word-of-the-Day pronounce both
use it via `src/lib/speak.ts`.

There are two tiers, auto-detected by the web app — nothing breaks if you don't
upgrade, you just don't get pause/resume/stop:

- **Legacy (current APK):** `FLSpeak` receives a plain **text** string → speak it.
  Play only.
- **Upgraded (this doc):** also set `window.__FLSpeakV2 = true` and handle **JSON
  commands**. Unlocks pause / resume / stop and resets the UI when speech ends.

## What the web app sends (upgraded)

```jsonc
{ "a": "speak", "text": "…", "lang": "te-IN", "rate": 0.92 }   // start
{ "a": "pause"  }                                              // pause
{ "a": "resume" }                                              // resume
{ "a": "stop"   }                                              // stop
```

`lang` is a BCP-47 locale (`en-IN`, `hi-IN`, `te-IN`, `ta-IN`, `kn-IN`,
`ml-IN`, `mr-IN`, `bn-IN`, `gu-IN`, `pa-IN`). When speech finishes on its own,
the wrapper should call `window.__flSpeakEnded()` so the button returns to
"Listen".

## Flutter side (webview_flutter + flutter_tts)

```dart
import 'dart:convert';
import 'package:flutter_tts/flutter_tts.dart';
import 'package:webview_flutter/webview_flutter.dart';

final FlutterTts _tts = FlutterTts();
late final WebViewController _web;

Future<void> _initTts() async {
  await _tts.awaitSpeakCompletion(true);
  // tell the device when a phrase finishes so the web UI resets to "Listen"
  _tts.setCompletionHandler(() {
    _web.runJavaScript('window.__flSpeakEnded && window.__flSpeakEnded();');
  });
}

void _registerBridge(WebViewController controller) {
  _web = controller;
  controller.addJavaScriptChannel(
    'FLSpeak',
    onMessageReceived: (JavaScriptMessage m) async {
      final raw = m.message.trim();

      // Legacy plain-text calls (e.g. Word of the Day) still just speak.
      if (!raw.startsWith('{')) {
        await _tts.stop();
        await _tts.speak(raw);
        return;
      }

      final cmd = jsonDecode(raw) as Map<String, dynamic>;
      switch (cmd['a']) {
        case 'speak':
          await _tts.stop();
          if (cmd['lang'] is String) await _tts.setLanguage(cmd['lang']);
          if (cmd['rate'] is num) await _tts.setSpeechRate((cmd['rate'] as num).toDouble());
          await _tts.speak(cmd['text'] as String);
          break;
        case 'pause':  await _tts.pause(); break;   // falls back to stop if unsupported
        case 'resume': await _tts.speak(cmd['text'] as String? ?? ''); break;
        case 'stop':   await _tts.stop(); break;
      }
    },
  );

  // announce upgraded capabilities to the web app on every page load
  controller.setNavigationDelegate(NavigationDelegate(
    onPageFinished: (_) => controller.runJavaScript('window.__FLSpeakV2 = true;'),
  ));
}
```

### Notes
- Android TTS has no true `pause`/`resume`; `flutter_tts.pause()` exists on
  Android 8+ but behaves like stop on some devices. If `resume` is unreliable,
  keep resume speaking the remaining text (the web app resends nothing today —
  simplest is to treat pause as stop and hide Resume; the web UI already hides
  controls when `window.__FLSpeakV2` is absent).
- Make sure the device has the Telugu/Hindi/Tamil TTS voices installed
  (Android → Settings → Accessibility → Text-to-speech → install voice data),
  otherwise it falls back to English pronunciation.
- Set `rate` once (~0.9) for a comfortable pace.
