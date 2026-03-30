# 🚗 ADAS Car Simulator

A premium real-time cockpit simulator for ADAS testing — featuring a futuristic dark/neon dashboard, realistic vehicle physics at 50 Hz, full CAN bus output via SocketCAN, and an integrated music player.

---

## 📁 Project Structure

```
car_simulator/
├── simulator.py              ← Flask + SocketIO backend + physics engine + CAN bus
├── simulator/
│   ├── simulator.js          ← AWS IoT telemetry publisher (reads from Flask)
│   ├── package.json
│   └── setup-aws.sh
├── templates/
│   └── dashboard.html        ← Cockpit UI (BSM corners, gauge, panels)
├── static/
│   ├── styles.css            ← Dark neon glassmorphism theme
│   ├── script.js             ← SVG gauge, keyboard, music, SocketIO render
│   └── music/
│       └── song1.mp3         ← Add your own MP3 here
├── requirements.txt
├── start-all.sh              ← Combined startup (Unix/Linux/Mac)
├── start-all.bat             ← Combined startup (Windows)
└── README.md
```

---

## ⚡ Quick Start (Local Dashboard Only)

### 1. Install Python dependencies

```bash
pip install -r requirements.txt
```

### 2. (Optional) Set up CAN interface

```bash
sudo ip link set can0 type can bitrate 500000
sudo ip link set up can0
```

> If `can0` is unavailable, the simulator automatically enters **Demo Mode** — all UI features remain fully functional.

### 3. Add a music file

Place an MP3 file at:
```
static/music/song1.mp3
```

### 4. Run the simulator

```bash
python simulator.py
```

Then open your browser at: **http://localhost:5000**

---

## 🌐 AWS IoT Integration (Flask + Node.js)

Send real vehicle telemetry from the Flask simulator directly to **AWS IoT Core**.

### Prerequisites

- Python 3.8+
- Node.js 14+
- AWS IoT Core credentials (certificate, private key, root CA) in `simulator/certs/`

### 1. Configure AWS IoT

Place your AWS certificates in the `simulator/certs/` folder:
```
simulator/certs/
├── certificate.pem.crt     ← From AWS IoT Core
├── private.pem.key         ← From AWS IoT Core  
└── AmazonRootCA1.pem       ← Download from AWS
```

Update the AWS endpoint in [simulator/simulator.js](simulator/simulator.js):
```javascript
host: 'your-iot-endpoint-ats.iot.region.amazonaws.com'
```

### 2. One-Command Startup (Recommended)

**On Windows:**
```cmd
start-all.bat
```

**On Linux/Mac:**
```bash
bash start-all.sh
```

This will:
- ✅ Start Flask simulator on `http://localhost:5000`
- ✅ Install Node.js dependencies
- ✅ Start AWS IoT publisher (reads from Flask, publishes to AWS)

### 3. Manual Startup (Separate Terminals)

**Terminal 1 — Flask Simulator:**
```bash
python simulator.py
```

**Terminal 2 — AWS IoT Publisher:**
```bash
cd simulator
npm install
npm start
```

### 4. Publish with Custom VIN

```bash
cd simulator
npm start "YOURVIN123456"
```

AWS topic: `vehicle/YOURVIN123456/telemetry`

### AWS IoT Payload Format

Every message published to AWS contains:
```json
{
  "timestamp": "2026-03-23T12:34:56.789Z",
  "running": {
    "speed": 45.2,
    "rpm": 2100,
    "gear": "D",
    "driveMode": "Comfort",
    "throttle": 0.45,
    "brake": 0.0,
    "steering": -15.3
  },
  "controls": {
    "leftBlinker": false,
    "rightBlinker": false,
    "headlight": true,
    "highBeam": false,
    "emergencyBrake": false
  },
  "safety": {
    "driverDoor": false,
    "seatbelt": true,
    "leftBSM": false,
    "rightBSM": true
  },
  "canBus": {
    "connected": false,
    "demoMode": true,
    "messagesPerSec": 0
  }
}
```

---



## 🎮 Keyboard Controls

| Key         | Action              |
|-------------|---------------------|
| `W` / `↑`   | Accelerate          |
| `S` / `↓`   | Brake               |
| `A` / `←`   | Steer Left          |
| `D` / `→`   | Steer Right         |
| `Space`     | Emergency Brake     |
| `Q`         | Left Blinker        |
| `E`         | Right Blinker       |
| `P`         | Park                |
| `R`         | Reverse             |
| `N`         | Neutral             |
| `G`         | Drive               |
| `1`         | Toggle Driver Door  |
| `2`         | Toggle Seatbelt     |
| `3`         | Toggle Left BSM     |
| `4`         | Toggle Right BSM    |
| `L`         | Headlights          |
| `H`         | High Beam           |
| `M`         | Play / Pause Music  |

---

## 🔌 CAN Bus Messages

| ID     | Signal   | Rate  | Encoding                              |
|--------|----------|-------|---------------------------------------|
| `0x180`| SPEED    | 50 Hz | `uint16` (km/h / 0.01), Big-Endian   |
| `0x1A0`| STEERING | 50 Hz | `int16` signed (deg / 0.1), Big-Endian|
| `0x1C0`| LIGHTS   | 10 Hz | Byte 0: bit0=L, bit1=R, bit2=Head, bit3=High |
| `0x1E0`| PEDALS   | 50 Hz | Byte 0: gas/brake bits. Bytes 1&2: scaled 0-255 |
| `0x200`| GEAR     | 10 Hz | Byte 0 bit 0-2: 0=P 1=R 2=N 3=D      |
| `0x220`| DOORS    | 10 Hz | Byte 0: bit0=driver door, bit5=seatbelt|
| `0x240`| BSM      | 10 Hz | Byte 0: bit0=left BSM, bit1=right BSM|

---

## 🎨 UI Features

- **Premium Wood & Leather Dashboard** — hyper-realistic cabin view with custom background images
- **Dual Canvas Gauges** — dynamic Speedometer (L) and RPM (R) with neon color bands and animated glowing needles
- **Steering wheel** — works with A/D keys and mouse dragging, showing exact dynamic angle
- **Pedal bars** — real-time brake (red) and gas (green) level bars mapped W/S
- **BSM badges** — active Blind Spot Monitoring indicators right in the side view
- **Gear selector** — P / R / N / D physical-style dashboard buttons
- **Music player** — center console unit with track title, audio visualizer, and volume
- **Seatbelt & Door** — visual animated warning icons
- **Status bar** — CAN connection dot + messages/sec counter

---

## 🧠 Physics Engine (50 Hz)

- Realistic acceleration ramp with gear-based multiplier
- Braking with ABS-style force application
- Passive friction / rolling resistance at speed
- Steering return-to-center on key release
- Emergency brake: instant speed reduction

---

## 🛠 Tech Stack

| Layer     | Technology                          |
|-----------|-------------------------------------|
| Backend   | Python 3.10+, Flask, Flask-SocketIO |
| CAN bus   | python-can (SocketCAN / can0)       |
| Frontend  | Vanilla HTML5 + CSS3 + ES6 JS       |
| Fonts     | Orbitron, Share Tech Mono, Rajdhani |
| Realtime  | Socket.IO 4.x (WebSocket)           |
