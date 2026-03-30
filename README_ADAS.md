# ADAS PC CAN Receiver — Setup & Integration Guide

## 1. Hardware Wiring
You need **two** USBCAN adapters (iTEK / ZLG or similar).
1. **Adapter #1** → plug into the **Simulator PC** (USB)
2. **Adapter #2** → plug into the **ADAS PC** (USB)
3. Wire the green screw terminals together:
   - **CAN-H** (Adapter 1) ↔ **CAN-H** (Adapter 2)
   - **CAN-L** (Adapter 1) ↔ **CAN-L** (Adapter 2)

---

## 2. Installation (Windows — No Install Needed!)
Everything is bundled. No Python or driver install required.
1. Copy `ADAS_PC_CAN_Receiver.zip` to the ADAS PC
2. Right-click → **Extract All...**
3. Confirm you have: `can_receiver.py`, `kerneldlls/`, `python32/`

---

## 3. Running the Receiver (Windows)
Open **Command Prompt** in the extracted folder and run:
```bash
python32\python.exe can_receiver.py
```
You will see a live scrolling table:
```
Time         ID       DLC   Data (Hex)                 Decoded
================================================================================
10:30:01     0x180    8     13 88 00 00 00 00 00 00    SPEED: 50.0 km/h
10:30:01     0x1A0    8     FF 9C 00 00 00 00 00 00    STEERING: -10.0 deg
10:30:01     0x200    8     03 00 00 00 00 00 00 00    GEAR: DRIVE
```

---

## 4. Running on Linux
On Linux, the adapter appears as `can0`. Use SocketCAN:
```bash
sudo ip link set can0 up type can bitrate 500000
pip install python-can
```
```python
import can
bus = can.interface.Bus(channel='can0', bustype='socketcan')
for msg in bus:
    print(f"ID: {hex(msg.arbitration_id)}  Data: {msg.data.hex()}")
```

---

## 5. CAN Data Dictionary (Protocol)
Baud Rate: **500 kbps** | Frame: **Standard 11-bit ID** | Byte Order: **Big-Endian**

| Signal | CAN ID | Rate | Byte Layout |
|:---|:---:|:---:|:---|
| **Speed** | `0x180` | 50 Hz | Bytes 0-1: `UInt16` × 0.01 = km/h |
| **Steering** | `0x1A0` | 50 Hz | Bytes 0-1: `Int16` × 0.1 = degrees |
| **Pedals** | `0x1E0` | 50 Hz | Byte 0: Flags (Bit0=Brake, Bit1=Gas) · Byte 1: Brake% · Byte 2: Gas% |
| **Lights** | `0x1C0` | 10 Hz | Byte 0: Flags (Bit0=Left, Bit1=Right, Bit2=Head, Bit3=HighBeam) |
| **Gear** | `0x200` | 10 Hz | Byte 0: `0`=Park `1`=Rev `2`=Neutral `3`=Drive |
| **Doors** | `0x220` | 10 Hz | Byte 0: Flags (Bit0=Door Open, Bit5=Seatbelt) |
| **BSM/Radar** | `0x240` | 10 Hz | Byte 0: Flags (Bit0=Left Alert, Bit1=Right Alert) |

---

## 6. Integrating into Your ADAS Code (Windows C++)
Link against `kerneldlls/usbcan.dll` and call `VCI_Receive()`.
Use the Data Dictionary above to decode raw bytes into signals.