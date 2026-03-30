"""
CAN Receiver Script for ADAS PC
Reads CAN frames from a USBCAN adapter (iTEK / ZLG compatible)
and displays them in real-time.

Usage:
  1. Copy this file + kerneldlls/ folder + python32/ folder to the ADAS PC
  2. Run:  python32\python.exe can_receiver.py
"""
import ctypes
import os
import time

# ─── USBCAN Structures ────────────────────────────────────────────────────────
class VCI_INIT_CONFIG(ctypes.Structure):
    _fields_ = [
        ("AccCode",  ctypes.c_uint32),
        ("AccMask",  ctypes.c_uint32),
        ("Reserved", ctypes.c_uint32),
        ("Filter",   ctypes.c_ubyte),
        ("Timing0",  ctypes.c_ubyte),
        ("Timing1",  ctypes.c_ubyte),
        ("Mode",     ctypes.c_ubyte),
    ]

class VCI_CAN_OBJ(ctypes.Structure):
    _fields_ = [
        ("ID",          ctypes.c_uint32),
        ("TimeStamp",   ctypes.c_uint32),
        ("TimeFlag",    ctypes.c_ubyte),
        ("SendType",    ctypes.c_ubyte),
        ("RemoteFlag",  ctypes.c_ubyte),
        ("ExternFlag",  ctypes.c_ubyte),
        ("DataLen",     ctypes.c_ubyte),
        ("Data",        ctypes.c_ubyte * 8),
        ("Reserved",    ctypes.c_ubyte * 3),
    ]

# ─── Signal Decoders ──────────────────────────────────────────────────────────
def decode_frame(msg):
    """Decode known CAN IDs into human-readable values."""
    arb_id = msg.ID
    data = bytes([msg.Data[i] for i in range(msg.DataLen)])

    if arb_id == 0x180:
        speed = ((data[0] << 8) | data[1]) * 0.01
        return f"SPEED: {speed:.1f} km/h"
    elif arb_id == 0x1A0:
        raw = (data[0] << 8) | data[1]
        if raw > 32767: raw -= 65536  # signed
        angle = raw * 0.1
        return f"STEERING: {angle:.1f} deg"
    elif arb_id == 0x1E0:
        brake = "ON" if (data[0] & 0x01) else "OFF"
        gas   = "ON" if (data[0] & 0x02) else "OFF"
        return f"PEDALS: Brake={brake}, Gas={gas}, BrakePct={data[1]}, GasPct={data[2]}"
    elif arb_id == 0x1C0:
        left  = "ON" if (data[0] & 0x01) else "OFF"
        right = "ON" if (data[0] & 0x02) else "OFF"
        head  = "ON" if (data[0] & 0x04) else "OFF"
        high  = "ON" if (data[0] & 0x08) else "OFF"
        return f"LIGHTS: L-Blink={left}, R-Blink={right}, Head={head}, High={high}"
    elif arb_id == 0x200:
        gears = {0: "PARK", 1: "REVERSE", 2: "NEUTRAL", 3: "DRIVE"}
        return f"GEAR: {gears.get(data[0], '?')}"
    elif arb_id == 0x220:
        door = "OPEN" if (data[0] & 0x01) else "CLOSED"
        belt = "ON" if (data[0] & 0x20) else "OFF"
        return f"DOOR: {door}, Seatbelt: {belt}"
    elif arb_id == 0x240:
        left  = "ALERT" if (data[0] & 0x01) else "clear"
        right = "ALERT" if (data[0] & 0x02) else "clear"
        return f"BSM: Left={left}, Right={right}"
    else:
        return ""

# ─── Main ─────────────────────────────────────────────────────────────────────
def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))

    # Find usbcan.dll
    search = [
        os.path.join(script_dir, "kerneldlls"),
        script_dir,
    ]
    can_dll = None
    for path in search:
        dll = os.path.join(path, "usbcan.dll")
        if os.path.exists(dll):
            if hasattr(os, 'add_dll_directory'):
                os.add_dll_directory(path)
            can_dll = ctypes.windll.LoadLibrary(dll)
            print(f"[OK] Loaded usbcan.dll from {path}")
            break

    if can_dll is None:
        print("[ERROR] usbcan.dll not found! Make sure kerneldlls/ folder is present.")
        return

    # Open device (try type 4 first, then 3)
    dev_type = None
    for t in [4, 3]:
        if can_dll.VCI_OpenDevice(t, 0, 0) == 1:
            dev_type = t
            print(f"[OK] Device opened (type {t})")
            break

    if dev_type is None:
        print("[ERROR] Cannot open USBCAN device. Is it plugged in? Is CANalyst closed?")
        return

    # Init CAN channel 0 at 500 kbps
    cfg = VCI_INIT_CONFIG()
    cfg.AccCode  = 0
    cfg.AccMask  = 0xFFFFFFFF
    cfg.Reserved = 0
    cfg.Filter   = 0
    cfg.Timing0  = 0x00
    cfg.Timing1  = 0x1C
    cfg.Mode     = 0

    if can_dll.VCI_InitCAN(dev_type, 0, 0, ctypes.byref(cfg)) != 1:
        print("[ERROR] VCI_InitCAN failed")
        can_dll.VCI_CloseDevice(dev_type, 0)
        return

    if can_dll.VCI_StartCAN(dev_type, 0, 0) != 1:
        print("[ERROR] VCI_StartCAN failed")
        can_dll.VCI_CloseDevice(dev_type, 0)
        return

    print(f"[OK] CAN started at 500 kbps — waiting for data...")
    print("=" * 80)
    print(f"{'Time':<12} {'ID':<8} {'DLC':<5} {'Data (Hex)':<26} {'Decoded'}")
    print("=" * 80)

    # Receive buffer (read up to 50 frames at a time)
    buf = (VCI_CAN_OBJ * 50)()
    frame_count = 0

    try:
        while True:
            count = can_dll.VCI_Receive(dev_type, 0, 0, ctypes.byref(buf), 50, 100)
            if count > 0:
                for i in range(count):
                    msg = buf[i]
                    hex_data = ' '.join(f'{msg.Data[j]:02X}' for j in range(msg.DataLen))
                    decoded = decode_frame(msg)
                    ts = time.strftime("%H:%M:%S")
                    print(f"{ts:<12} 0x{msg.ID:03X}    {msg.DataLen:<5} {hex_data:<26} {decoded}")
                    frame_count += 1
            else:
                time.sleep(0.001)  # small sleep to avoid busy-wait

    except KeyboardInterrupt:
        print(f"\n\nStopping... Received {frame_count} total frames.")
    finally:
        can_dll.VCI_CloseDevice(dev_type, 0)
        print("[OK] Device closed.")

if __name__ == '__main__':
    main()
