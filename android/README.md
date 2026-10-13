# CrisisCore — Android Application & Cross-Platform Sync

This directory contains the dedicated native Android application for **CrisisCore**, configured to run across smartphones and tablets for **Field Responders** and **Civilian Requesters**.

---

## 1. Cross-Platform Real-Time Synchronization

```
┌─────────────────────────────────┐           ┌─────────────────────────────────┐
│        Android Application      │           │      Desktop Web Dashboard      │
│  (Responder / Civilian Mobile)  │           │   (Coordinator Command Center)  │
└────────────────┬────────────────┘           └────────────────┬────────────────┘
                 │                                             │
                 │ WebSocket (Socket.IO)                       │ WebSocket (Socket.IO)
                 │ REST API (HTTPS)                            │ REST API (HTTPS)
                 ▼                                             ▼
        ┌──────────────────────────────────────────────────────────────┐
        │            Central CrisisCore Backend Gateway                │
        │             Node.js + Express + Socket.IO                    │
        └──────────────────────────────┬───────────────────────────────┘
                                       │
                                       ▼
                           Central SQLite / PostgreSQL
```

### How Synchronization Works (Zero Setup Required Right Now):
1. **Single Source of Truth**: Both the Android app and the Desktop web portal connect to the centralized backend server (`http://<SERVER_IP>:3001`).
2. **Instant WebSocket Push**:
   - When a civilian submits an SOS from an Android phone, the `incident:new` event triggers on the Coordinator's desktop in `<50ms`.
   - When a coordinator clicks **Dispatch**, the Android phone running the Responder terminal immediately sounds an alarm and displays the incoming mission banner with **Accept** or **Decline**.
   - When a respondent accepts, the coordinator's monitor displays the real-time prompt toast: *"Carlos Vance ACCEPTED dispatch"*.
3. **Dual-Channel Live Chat**:
   - **Tactical Ops**: Coordinator on desktop chats with field unit on Android.
   - **Civilian Line**: Field respondent on Android chats directly with the civilian.

---

## 2. When Do You Need Firebase?

### Right Now: **NO Firebase is needed!**
- All live chat, telemetry streaming, dispatch alerts, and status prompts run in real-time over **Socket.IO** while the app is active or in the foreground.

### When You DO Need Firebase:
You only need to step in and add Firebase when you want **Background Push Notifications (Firebase Cloud Messaging - FCM)**:
- Specifically, when the phone is locked, screen is off in a responder's pocket, and the app is sleeping or terminated, but a critical emergency alert needs to wake the screen up with a loud alarm tone.

### Steps to Add Firebase (When you are ready):
1. Go to the [Firebase Console](https://console.firebase.google.com/).
2. Create a project named `CrisisCore`.
3. Click **Add App** -> **Android**.
4. Set Android package name to: **`org.crisiscore.app`**.
5. Download **`google-services.json`**.
6. Place `google-services.json` inside this directory:
   ```
   android/app/google-services.json
   ```
7. That's it! The build script will automatically detect the Google services configuration.

---

## 3. Developer Workflow

### Sync Web Updates to Android:
Whenever you update code in the frontend, run:
```bash
npm run android:sync
```
*(Builds the Vite production bundle and updates `android/app/src/main/assets/public`)*

### Open in Android Studio:
```bash
npm run android:open
```
*(Opens the Gradle project in Android Studio for emulator testing, USB device debugging, or APK generation)*

### Generate Debug APK:
```bash
cd android
./gradlew assembleDebug
```
The compiled APK will be created at:
`android/app/build/outputs/apk/debug/app-debug.apk`
