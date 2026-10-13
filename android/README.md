# CrisisCore — Android Mobile Subsystem

[![Platform](https://img.shields.io/badge/Platform-Android_14_%2B-3DDC84?style=flat-square&logo=android)](https://developer.android.com/)
[![Runtime](https://img.shields.io/badge/Runtime-Capacitor_7-119EFF?style=flat-square&logo=capacitor)](https://capacitorjs.com/)
[![Package](https://img.shields.io/badge/Package-org.crisiscore.app-blue?style=flat-square)](android/app/build.gradle)

The `android/` directory contains the production Android client for **CrisisCore**, packaged using Capacitor. It provides dedicated mobile experiences for **Field Responders** (Tactical Terminal) and **Civilian Requesters** (Emergency SOS Portal) with native hardware integrations.

---

## 1. System Architecture

The Android application operates as a native shell around the CrisisCore responsive client, connecting to the central Node.js / Socket.IO dispatch gateway:

```
┌─────────────────────────────────┐           ┌─────────────────────────────────┐
│        Android Application      │           │      Desktop Command Center     │
│    (Field Responder / Civilian) │           │    (Coordinator / Dispatcher)   │
└────────────────┬────────────────┘           └────────────────┬────────────────┘
                 │                                             │
                 │ WebSocket (Socket.IO)                       │ WebSocket (Socket.IO)
                 │ REST API (HTTP/JSON)                        │ REST API (HTTP/JSON)
                 ▼                                             ▼
        ┌──────────────────────────────────────────────────────────────┐
        │            Central CrisisCore Dispatch Gateway               │
        │             Node.js + Express + Socket.IO                    │
        └──────────────────────────────┬───────────────────────────────┘
                                       │
                                       ▼
                          Central Database (SQLite / Postgres)
```

### Key Capabilities
- **Real-Time Dispatch Synchronization**: Instant bidirectional event streaming (`incident:new`, `assignment:new`, `assignment:responder_action`) with sub-50ms latency.
- **Dual-Channel In-App Comms**: Scoped Socket.IO channels for closed tactical coordinator-responder orders (`OPS`) and direct civilian-responder guidance (`CIVILIAN`).
- **Hardware GPS Telemetry**: Real-time position tracking (`navigator.geolocation.watchPosition`) streamed to dispatch during active rescue missions, with automated cessation upon resolution.
- **Interactive Offline Fallback**: Draggable Leaflet pin-drop fallback when satellite signals are obstructed or indoors.

---

## 2. Hardware Permissions & Security

Declared in [`AndroidManifest.xml`](app/src/main/AndroidManifest.xml):

| Permission | Purpose |
|---|---|
| `android.permission.INTERNET` | Communication with central dispatch gateway and map tile servers. |
| `android.permission.ACCESS_FINE_LOCATION` | High-precision GPS tracking for emergency victim location and responder routing. |
| `android.permission.ACCESS_COARSE_LOCATION` | Cellular/Wi-Fi triangulation fallback for indoor or low-signal scenarios. |
| `android.hardware.location.gps` | GPS hardware detection (optional requirement to support diverse hardware). |
| `android:usesCleartextTraffic="true"` | Permits local unencrypted HTTP/WS development on Android 9+ (API 28+). |

---

## 3. Network Configuration & Host Routing

Inside the Android Emulator (AVD), the virtual device uses `10.0.2.2` as the loopback alias to reach the host development machine:

- **Emulator Host**: Automatically maps to `http://10.0.2.2:3001` via dynamic environment detection in `src/apiConfig.js`.
- **Physical Device**: Set the host PC's local network IP (e.g. `http://192.168.1.50:3001`) via client configuration or `localStorage.setItem('crisiscore_api_url', 'http://<LAN_IP>:3001')`.
- **Production**: Configured to point directly to the deployed cloud gateway URL.

---

## 4. Build & Development Guide

### Prerequisites
- [Android Studio Iguana+](https://developer.android.com/studio) (2023.2.1 or newer)
- Android SDK (API Level 34 recommended)
- Java Development Kit (JDK 17 or newer)
- Node.js 18+

### Step 1: Synchronize Web Assets
Before building native binaries, compile the web assets and sync them to Android:
```bash
# From project root:
npm run android:sync
```
*This executes `vite build` and copies production bundles into `android/app/src/main/assets/public`.*

### Step 2: Open in Android Studio
```bash
# From project root:
npm run android:open
```
*Alternatively, launch Android Studio and select the `android/` directory.*

### Step 3: Run on Emulator or Physical Device
1. Wait for Gradle sync to complete.
2. Select target device in the device manager dropdown.
3. Click **▶ Run ('app')** (`Shift + F10`).

### Step 4: Building Standalone Debug APK
```bash
cd android
./gradlew assembleDebug
```
The compiled package will be generated at:
```
android/app/build/outputs/apk/debug/app-debug.apk
```

---

## 5. Testing GPS Telemetry in Emulator

The Android Studio Emulator includes an **Extended Controls** location mock injector:
1. Start the Android Emulator.
2. Click the **`...` (Extended Controls)** button on the emulator side toolbar.
3. Navigate to the **Location** tab.
4. Input latitude and longitude (e.g. `28.6139, 77.2090` for New Delhi) and click **Send Location**.
5. The CrisisCore mobile app detects the coordinate update immediately and plots the position on the tactical rescue map.

---

## 6. Push Notification Architecture (Optional Extension)

For background wake alerts when the device screen is off, the package (`org.crisiscore.app`) supports **Firebase Cloud Messaging (FCM)**:
1. Register `org.crisiscore.app` in the [Firebase Console](https://console.firebase.google.com/).
2. Place the generated `google-services.json` in `android/app/`.
3. The build configuration automatically binds the Google Services Gradle plugin for background push dispatch.
