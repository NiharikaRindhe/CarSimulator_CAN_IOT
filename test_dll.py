import ctypes
import os

# Add CANalyst and kerneldlls to DLL search path
canalyst_path = r"C:\Program Files (x86)\CANalyst"
kerneldlls_path = r"C:\Program Files (x86)\CANalyst\kerneldlls"

for p in [canalyst_path, kerneldlls_path]:
    if os.path.exists(p):
        os.add_dll_directory(p)

# Test 1: Try opening directly with usbcan.dll from kerneldlls
print("=== Test 1: Direct usbcan.dll from CANalyst kerneldlls ===")
usbcan_path = os.path.join(kerneldlls_path, "usbcan.dll")
if os.path.exists(usbcan_path):
    try:
        usbcan = ctypes.windll.LoadLibrary(usbcan_path)
        print(f"Loaded usbcan.dll OK")
        for i in range(1, 10):
            ret = usbcan.VCI_OpenDevice(i, 0, 0)
            if ret == 1:
                print(f"  SUCCESS with type {i}!")
                usbcan.VCI_CloseDevice(i, 0)
            else:
                print(f"  Type {i}: {ret}")
    except Exception as e:
        print(f"Load error: {e}")
else:
    print(f"Not found: {usbcan_path}")

# Test 2: Try Ultra.dll (iTEK custom?)
print("\n=== Test 2: iTEK Ultra.dll ===")
ultra_path = os.path.join(canalyst_path, "Ultra.dll")
if os.path.exists(ultra_path):
    try:
        ultra = ctypes.windll.LoadLibrary(ultra_path)
        print("Loaded Ultra.dll OK")
        # Try VCI_OpenDevice
        for i in [3, 4, 21, 33]:
            try:
                ret = ultra.VCI_OpenDevice(i, 0, 0)
                print(f"  Ultra Type {i}: {ret}")
                if ret == 1:
                    ultra.VCI_CloseDevice(i, 0)
            except Exception as e2:
                print(f"  Ultra Type {i} error: {e2}")
    except Exception as e:
        print(f"Load error: {e}")
else:
    print(f"Not found: {ultra_path}")

print("\nDone.")
