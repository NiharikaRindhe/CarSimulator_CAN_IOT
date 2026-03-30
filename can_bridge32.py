import ctypes
import os
import struct
import socket
import logging

logging.basicConfig(level=logging.INFO, format='%(asctime)s [32BIT-CAN] %(message)s')
log = logging.getLogger(__name__)

# Device constants - using usbcan.dll directly (bypasses ControlCAN wrapper)
CAN_DEV_IDX  = 0
CAN_CHANNEL  = 0
# 500 kbps timing registers (standard ZLG values)
TIMING_500KBPS = (0x00, 0x1C)

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

def load_usbcan_dll():
    """Load usbcan.dll from kerneldlls folder (or CANalyst installation)."""
    search_paths = [
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "kerneldlls"),
        os.path.join(os.path.dirname(os.path.abspath(__file__))),
        r"C:\Program Files (x86)\CANalyst\kerneldlls",
        r"C:\Program Files (x86)\CANalyst",
    ]
    for path in search_paths:
        dll_file = os.path.join(path, "usbcan.dll")
        if os.path.exists(dll_file):
            # Add the folder to DLL search path so dependencies are found
            if hasattr(os, 'add_dll_directory'):
                os.add_dll_directory(path)
            log.info(f"Loading usbcan.dll from: {path}")
            return ctypes.windll.LoadLibrary(dll_file)
    raise RuntimeError("usbcan.dll not found in any known location.")

def run_bridge():
    can_dll = None
    dev_type = None

    try:
        can_dll = load_usbcan_dll()
        log.info("usbcan.dll loaded OK")

        # Find the correct device type (4=USBCAN2 is typical for 2-channel devices)
        for t in [4, 3, 21, 20]:
            ret = can_dll.VCI_OpenDevice(t, CAN_DEV_IDX, 0)
            if ret == 1:
                dev_type = t
                log.info(f"Device opened with type {t}")
                break
            else:
                can_dll.VCI_CloseDevice(t, CAN_DEV_IDX)

        if dev_type is None:
            raise RuntimeError("VCI_OpenDevice failed for all known types. Is the device plugged in?")

        cfg = VCI_INIT_CONFIG()
        cfg.AccCode  = 0
        cfg.AccMask  = 0xFFFFFFFF
        cfg.Reserved = 0
        cfg.Filter   = 0
        cfg.Timing0  = TIMING_500KBPS[0]
        cfg.Timing1  = TIMING_500KBPS[1]
        cfg.Mode     = 0

        if can_dll.VCI_InitCAN(dev_type, CAN_DEV_IDX, CAN_CHANNEL, ctypes.byref(cfg)) != 1:
            raise RuntimeError("VCI_InitCAN failed")

        if can_dll.VCI_StartCAN(dev_type, CAN_DEV_IDX, CAN_CHANNEL) != 1:
            raise RuntimeError("VCI_StartCAN failed")

        log.info(f"CAN started at 500 kbps on device type {dev_type}, channel {CAN_CHANNEL}")

        # Setup UDP socket to receive frames from 64-bit simulator
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.bind(('127.0.0.1', 10101))
        log.info("Listening on UDP 127.0.0.1:10101...")

        msg = VCI_CAN_OBJ()
        msg.SendType  = 0
        msg.RemoteFlag = 0
        msg.ExternFlag = 0

        while True:
            data, addr = sock.recvfrom(64)
            if data == b'QUIT':
                break

            if len(data) >= 5:
                # Format: 4-byte ID (little-endian) + 1..8 bytes payload
                arb_id  = struct.unpack('<I', data[:4])[0]
                payload = data[4:]

                msg.ID      = arb_id
                msg.DataLen = min(len(payload), 8)
                for i in range(msg.DataLen):
                    msg.Data[i] = payload[i]

                # Print to console so the user can see it in real-time!
                hex_data = ' '.join(f'{b:02X}' for b in payload)
                print(f"CAN TX -> ID: 0x{arb_id:03X}  DLC: {msg.DataLen}  Data: {hex_data}")

                can_dll.VCI_Transmit(dev_type, CAN_DEV_IDX, CAN_CHANNEL, ctypes.byref(msg), 1)

    except Exception as e:
        log.error(f"Bridge error: {e}")
    finally:
        if can_dll and dev_type is not None:
            try:
                can_dll.VCI_CloseDevice(dev_type, CAN_DEV_IDX)
            except:
                pass
        log.info("Bridge closed.")

if __name__ == '__main__':
    run_bridge()
