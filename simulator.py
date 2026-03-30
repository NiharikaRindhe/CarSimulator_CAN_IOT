#!/usr/bin/env python3
"""
ADAS Car Simulator — Backend
Physics engine @ 50 Hz | CAN bus via ZLG USBCAN-2I+ | Real-time UI via Flask-SocketIO
"""

import time
import math
import struct
import threading
import logging
import os
import ctypes
import glob
from flask import Flask, render_template, jsonify
from flask_socketio import SocketIO, emit

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
log = logging.getLogger(__name__)

app = Flask(__name__)
app.config['SECRET_KEY'] = 'adas-simulator-2025'
app.config['TEMPLATES_AUTO_RELOAD'] = True
app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

# ─── VEHICLE STATE ────────────────────────────────────────────────────────────
state = {
    'speed': 0.0,           # km/h  (0–250)
    'rpm': 800.0,           # Engine RPM
    'steering_angle': 0.0,  # deg   (−540 to +540)
    'throttle': 0.0,        # 0–1
    'brake': 0.0,           # 0–1
    'gear': 3,              # 0=P 1=R 2=N 3=D
    'left_blinker': False,
    'right_blinker': False,
    'headlight': False,
    'high_beam': False,
    'driver_door': False,
    'seatbelt': True,
    'left_bsm': False,
    'right_bsm': False,
    'music_playing': False,
    'emergency_brake': False,
    'can_connected': False,
    'can_msgs_per_sec': 0,
    'can_demo_mode': True,
}

# Raw input flags from keyboard events
inputs = {
    'throttle': False,
    'brake': False,
    'steer_left': False,
    'steer_right': False,
    'emergency_brake': False,
}

# ─── PHYSICS CONSTANTS (50 Hz → each tick = 20 ms) ───────────────────────────
MAX_SPEED       = 250.0   # km/h
MAX_REVERSE     = 40.0    # km/h
ACCEL_RATE      = 1.2     # km/h per tick  ≈ 60 km/h/s
BRAKE_RATE      = 2.0     # km/h per tick
EBRAKE_RATE     = 5.0     # km/h per tick
FRICTION        = 0.18    # km/h per tick natural coast deceleration
THROTTLE_RISE   = 0.04    # throttle 0→1 rate
THROTTLE_FALL   = 0.08
BRAKE_RISE      = 0.06
BRAKE_FALL      = 0.10
MAX_STEER       = 540.0   # degrees
STEER_RATE      = 14.0    # deg per tick
STEER_RETURN    = 8.0     # deg per tick

# ─── UPDATED CAN INTEGRATION VIA UDP BRIDGE ───────────────────────────────────
import socket
import subprocess
import atexit
import serial
import serial.tools.list_ports

can_sock = None
bridge_proc = None
demo_mode = True

# ─── ADAS PC WIFI UDP FORWARDING ─────────────────────────────────────────────
ADAS_IP   = "192.168.0.13"   # IP address of the ADAS PC # - office 
ADAS_PORT = 20001              # UDP port the ADAS PC is listening on
adas_sock = None               # Socket for WiFi forwarding

def setup_adas_wifi():
    """Open a UDP socket to stream CAN frames to the ADAS PC over WiFi."""
    global adas_sock
    try:
        adas_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        log.info(f"ADAS WiFi UDP ready → {ADAS_IP}:{ADAS_PORT}")
    except Exception as e:
        log.error(f"ADAS WiFi init error: {e}")


# ─── SLCAN SERIAL OUTPUT ──────────────────────────────────────────────────────
serial_port = None          # pyserial Serial object
serial_enabled = False
SERIAL_BAUD = 115200        # default baud rate
SERIAL_COM  = None          # auto-detect or set manually, e.g. 'COM3'

def setup_serial():
    """Auto-detect and open a USB serial port for SLCAN output."""
    global serial_port, serial_enabled
    try:
        # If user specified a port, use it directly
        if SERIAL_COM:
            serial_port = serial.Serial(SERIAL_COM, SERIAL_BAUD, timeout=0.1)
            serial_enabled = True
            log.info(f"SLCAN Serial opened on {SERIAL_COM} @ {SERIAL_BAUD} baud")
            return

        # Auto-detect: pick the first available USB serial port
        ports = list(serial.tools.list_ports.comports())
        if not ports:
            log.warning("No serial ports found — SLCAN serial disabled.")
            return

        for p in ports:
            log.info(f"  Found serial port: {p.device} — {p.description}")

        chosen = ports[0].device
        serial_port = serial.Serial(chosen, SERIAL_BAUD, timeout=0.1)
        serial_enabled = True
        log.info(f"SLCAN Serial opened on {chosen} @ {SERIAL_BAUD} baud")

    except Exception as e:
        log.error(f"Serial init error: {e} — SLCAN serial disabled.")
        serial_enabled = False

def slcan_send(arb_id: int, data: bytes):
    """Send a single CAN frame in SLCAN 'tIIILDD...' text format over serial."""
    if not serial_enabled or serial_port is None:
        return
    try:
        # SLCAN format: t = standard frame, III = 3-hex-digit ID, L = data length
        # followed by 2-hex-digit per data byte, terminated with \r
        hex_data = ''.join(f'{b:02X}' for b in data)
        frame = f't{arb_id:03X}{len(data):01X}{hex_data}\r'
        serial_port.write(frame.encode('ascii'))
    except Exception as e:
        log.error(f"SLCAN write error: {e}")

def cleanup_serial():
    """Close serial port on shutdown."""
    if serial_port and serial_port.is_open:
        try:
            serial_port.close()
            log.info("SLCAN Serial port closed.")
        except:
            pass

def setup_can():
    """Start 32-bit Python bridge and setup UDP socket"""
    global can_sock, bridge_proc, demo_mode

    try:
        # Start the 32-bit bridge subprocess
        bridge_script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "can_bridge32.py")
        py32_exe = os.path.join(os.path.dirname(os.path.abspath(__file__)), "python32", "python.exe")
        
        if not os.path.exists(py32_exe):
            log.warning("32-bit Python not found, falling back to demo mode.")
            state['can_connected'] = False
            return
            
        bridge_proc = subprocess.Popen([py32_exe, bridge_script])
        
        # Give it a moment to start
        time.sleep(1.0)
        
        if bridge_proc.poll() is not None:
            log.error("CAN Bridge failed to start!")
            state['can_connected'] = False
            return

        can_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        state['can_connected'] = True
        demo_mode = False
        log.info("Connected to 32-bit CAN Bridge via UDP")

    except Exception as exc:
        log.error(f"CAN init error: {exc} → demo mode")
        state['can_connected'] = False
        demo_mode = True

def can_send(arb_id: int, data: bytes):
    """Send CAN frame via: USB CAN bridge | SLCAN serial | WiFi UDP to ADAS PC."""
    sent = False

    # Path 1: USB CAN hardware (via 32-bit UDP bridge)
    if can_sock is not None and not demo_mode:
        try:
            payload = struct.pack('<I', arb_id) + data
            can_sock.sendto(payload, ('127.0.0.1', 10101))
            sent = True
        except Exception as e:
            log.error(f"UDP send error: {e}")

    # Path 2: USB Serial cable (SLCAN text format)
    if serial_enabled:
        slcan_send(arb_id, data)
        sent = True

    # Path 3: WiFi UDP → ADAS PC (same format as python-can canalystii script)
    # Packet: struct.pack('>IB', arb_id, dlc) + data
    if adas_sock is not None:
        try:
            wifi_payload = struct.pack('>IB', arb_id, len(data)) + bytes(data)
            adas_sock.sendto(wifi_payload, (ADAS_IP, ADAS_PORT))
            sent = True
        except Exception as e:
            log.error(f"ADAS WiFi send error: {e}")

    return sent


def cleanup_can():
    """Stop bridge, serial, and WiFi socket on shutdown"""
    global bridge_proc
    if can_sock:
        try: can_sock.sendto(b'QUIT', ('127.0.0.1', 10101))
        except: pass
        
    if bridge_proc and bridge_proc.poll() is None:
        try: bridge_proc.terminate()
        except: pass
        log.info("CAN Bridge stopped.")

    if adas_sock:
        try: adas_sock.close()
        except: pass

    cleanup_serial()


# ─── CAN MESSAGE BUILDERS ─────────────────────────────────────────────────────
# Each returns (arb_id, data_bytes) tuple for use with can_send()

def send_speed():
    # 0x180 | speed_uint16 (×100 = 0.01 km/h LSB) | 6 pad
    spd = int(state['speed'] * 100) & 0xFFFF
    return can_send(0x180, struct.pack('>H6x', spd))

def send_steering():
    # 0x1A0 | steering_int16 (×10 = 0.1 deg LSB) | 6 pad
    raw = max(-32768, min(32767, int(state['steering_angle'] * 10)))
    return can_send(0x1A0, struct.pack('>h6x', raw))

def send_pedals():
    # 0x1E0 | flags | brake_pct | gas_pct | 5 pad
    # flags: bit0=brake_pressed, bit1=gas_pressed
    gas_pressed = 1 if state['throttle'] > 0.01 else 0
    brake_pressed = 1 if state['brake'] > 0.01 or state['emergency_brake'] else 0
    flags = (gas_pressed << 1) | brake_pressed
    
    brk_pct = min(255, int((state['brake'] * 100) / 0.392157))
    gas_pct = min(255, int((state['throttle'] * 100) / 0.392157))
    if state['emergency_brake']: brk_pct = 255
    
    return can_send(0x1E0, struct.pack('>BBB5x', flags, brk_pct, gas_pct))

def send_lights():
    # 0x1C0 | flags byte | 7 pad
    f  = (0x01 if state['left_blinker']  else 0)
    f |= (0x02 if state['right_blinker'] else 0)
    f |= (0x04 if state['headlight']     else 0)
    f |= (0x08 if state['high_beam']     else 0)
    return can_send(0x1C0, struct.pack('>B7x', f))

def send_gear():
    # 0x200 | gear byte | 7 pad
    return can_send(0x200, struct.pack('>B7x', state['gear']))

def send_doors():
    # 0x220 | flags | 7 pad  (bit0=driver_door, bit5=seatbelt)
    f  = (0x01 if state['driver_door'] else 0)
    f |= (0x20 if state['seatbelt']    else 0)  # bit 5 = 1 << 5 = 0x20
    return can_send(0x220, struct.pack('>B7x', f))

def send_bsm():
    # 0x240 | flags | 7 pad
    f  = (0x01 if state['left_bsm']  else 0)
    f |= (0x02 if state['right_bsm'] else 0)
    return can_send(0x240, struct.pack('>B7x', f))

# ─── PHYSICS ENGINE ───────────────────────────────────────────────────────────
def physics_tick():
    s = state
    inp = inputs

    # ── Throttle pedal ────
    if inp['throttle'] and not inp['brake'] and not inp['emergency_brake']:
        s['throttle'] = min(1.0, s['throttle'] + THROTTLE_RISE)
    else:
        s['throttle'] = max(0.0, s['throttle'] - THROTTLE_FALL)

    # ── Brake pedal ───────
    if inp['brake']:
        s['brake'] = min(1.0, s['brake'] + BRAKE_RISE)
    else:
        s['brake'] = max(0.0, s['brake'] - BRAKE_FALL)

    # ── Speed ─────────────
    if inp['emergency_brake']:
        s['speed'] = max(0.0, s['speed'] - EBRAKE_RATE)

    elif inp['brake']:
        if s['gear'] in (2, 3):          # N or D
            s['speed'] = max(0.0, s['speed'] - BRAKE_RATE * s['brake'])
        elif s['gear'] == 1:             # R
            s['speed'] = max(0.0, s['speed'] - BRAKE_RATE * s['brake'] * 0.7)

    elif inp['throttle']:
        if s['gear'] == 3:               # D
            s['speed'] = min(MAX_SPEED, s['speed'] + ACCEL_RATE * s['throttle'])
        elif s['gear'] == 1:             # R
            s['speed'] = min(MAX_REVERSE, s['speed'] + ACCEL_RATE * 0.4 * s['throttle'])

    # Natural friction
    if not inp['throttle']:
        friction = FRICTION * (3.0 if s['gear'] in (0, 2) else 1.0)
        s['speed'] = max(0.0, s['speed'] - friction)

    # Park hard-stop
    if s['gear'] == 0:
        s['speed'] = 0.0

    # ── Steering ──────────
    if inp['steer_left']:
        s['steering_angle'] = max(-MAX_STEER, s['steering_angle'] - STEER_RATE)
    elif inp['steer_right']:
        s['steering_angle'] = min(MAX_STEER,  s['steering_angle'] + STEER_RATE)
    else:
        if s['steering_angle'] > 0:
            s['steering_angle'] = max(0.0, s['steering_angle'] - STEER_RETURN)
        elif s['steering_angle'] < 0:
            s['steering_angle'] = min(0.0, s['steering_angle'] + STEER_RETURN)

    # ── RPM Simulation ────
    if s['gear'] in (0, 2): # Park, Neutral
        s['rpm'] = 800.0 + (s['throttle'] * 6200.0)
    elif s['gear'] == 1:    # Reverse
        s['rpm'] = 800.0 + (s['speed'] / MAX_REVERSE) * 5000.0 + (s['throttle'] * 1000.0)
    else:                   # Drive (CVT style limit)
        s['rpm'] = 800.0 + (s['speed'] / MAX_SPEED) * 5500.0 + (s['throttle'] * 1200.0)
    
    s['rpm'] = max(0.0, min(8000.0, s['rpm']))

# ─── MAIN SIMULATION LOOP ─────────────────────────────────────────────────────
def sim_loop():
    tick = 0
    mps_count = 0
    last_mps = time.time()

    while True:
        t0 = time.time()

        physics_tick()

        # CAN @ 50 Hz — high-priority signals
        if not demo_mode:
            try:
                if send_speed():    mps_count += 1
                if send_steering(): mps_count += 1
                if send_pedals():   mps_count += 1
            except Exception as e:
                log.error(f"CAN send: {e}")

        # CAN @ 10 Hz (every 5th tick) — low-priority signals
        if tick % 5 == 0 and not demo_mode:
            try:
                if send_lights(): mps_count += 1
                if send_gear():   mps_count += 1
                if send_doors():  mps_count += 1
                if send_bsm():   mps_count += 1
            except Exception as e:
                log.error(f"CAN send: {e}")

        # Update MPS counter every second
        now = time.time()
        if now - last_mps >= 1.0:
            state['can_msgs_per_sec'] = mps_count if not demo_mode else 0
            mps_count = 0
            last_mps = now

        # Broadcast to UI @ 25 Hz (every 2nd tick)
        if tick % 2 == 0:
            socketio.emit('state_update', {
                'speed':           round(state['speed'], 1),
                'rpm':             round(state['rpm'], 1),
                'steering':        round(state['steering_angle'], 1),
                'throttle':        round(state['throttle'], 3),
                'brake':           round(state['brake'], 3),
                'gear':            state['gear'],
                'left_blinker':    state['left_blinker'],
                'right_blinker':   state['right_blinker'],
                'headlight':       state['headlight'],
                'high_beam':       state['high_beam'],
                'driver_door':     state['driver_door'],
                'seatbelt':        state['seatbelt'],
                'left_bsm':        state['left_bsm'],
                'right_bsm':       state['right_bsm'],
                'music_playing':   state.get('music_playing', False),
                'can_connected':   state['can_connected'],
                'can_msgs_per_sec': state['can_msgs_per_sec'],
                'can_demo_mode':   demo_mode,
            })

        tick = (tick + 1) % 50
        elapsed = time.time() - t0
        sleep_t = max(0.0, 0.020 - elapsed)
        time.sleep(sleep_t)

# ─── SOCKET.IO EVENTS ─────────────────────────────────────────────────────────
@socketio.on('connect')
def on_connect():
    log.info("Client connected")
    emit('state_update', {k: state[k] for k in state if k != 'emergency_brake'})

@socketio.on('disconnect')
def on_disconnect():
    log.info("Client disconnected")

@socketio.on('key_event')
def on_key(data):
    action = data.get('action')   # 'down' | 'up' | 'steer_absolute'
    key    = data.get('key', '')
    if isinstance(key, str):
        key = key.lower().strip()
    print(f"DEBUG on_key: action={repr(action)}, key={repr(key)}", flush=True)
    
    # Music — set absolute state from UI (avoids toggle desync)
    if action == 'set_music':
        state['music_playing'] = bool(data.get('playing', False))
        return

    # Mouse drag steering — set angle directly
    if action == 'steer_absolute':
        angle = data.get('angle', 0)
        angle = max(-540.0, min(540.0, float(angle)))
        state['steering_angle'] = angle
        return

    if action in ('down', 'toggle'):
        # Continuous inputs
        if key in ('w', 'arrowup'):        inputs['throttle']    = True
        elif key in ('s', 'arrowdown'):    inputs['brake']       = True
        elif key in ('a', 'arrowleft'):    inputs['steer_left']  = True
        elif key in ('d', 'arrowright'):   inputs['steer_right'] = True
        elif key == ' ':                   state['emergency_brake'] = True; inputs['emergency_brake'] = True

        # Toggle states
        elif key == 'q':
            state['left_blinker'] = not state['left_blinker']
            if state['left_blinker']: state['right_blinker'] = False
        elif key == 'e':
            state['right_blinker'] = not state['right_blinker']
            if state['right_blinker']: state['left_blinker'] = False
        elif key == 'p': state['gear'] = 0
        elif key == 'r': state['gear'] = 1
        elif key == 'n': state['gear'] = 2
        elif key == 'g': state['gear'] = 3
        elif key == '1': state['driver_door'] = not state['driver_door']
        elif key == '2': state['seatbelt']    = not state['seatbelt']
        elif key == '3': state['left_bsm']    = not state['left_bsm']
        elif key == '4': state['right_bsm']   = not state['right_bsm']
        elif key == 'l': state['headlight']   = not state['headlight']
        elif key == 'h': state['high_beam']   = not state['high_beam']
        elif key == 'm': state['music_playing'] = not state.get('music_playing', False)

    elif action == 'up':
        if key in ('w', 'arrowup'):        inputs['throttle']    = False
        elif key in ('s', 'arrowdown'):    inputs['brake']       = False
        elif key in ('a', 'arrowleft'):    inputs['steer_left']  = False
        elif key in ('d', 'arrowright'):   inputs['steer_right'] = False
        elif key == ' ':                   state['emergency_brake'] = False; inputs['emergency_brake'] = False

# ─── FLASK ROUTES ─────────────────────────────────────────────────────────────
@app.route('/')
def index():
    return render_template('dashboard.html')

@app.route('/api/state')
def api_state():
    return jsonify(state)

@app.route('/grid')
def grid_view():
    return render_template('grid.html')

# ─── ENTRY POINT ─────────────────────────────────────────────────────────────
if __name__ == '__main__':
    import atexit
    setup_can()
    setup_serial()
    setup_adas_wifi()
    # Enable sim loop sending if CAN, Serial, or WiFi is active
    if serial_enabled or adas_sock is not None:
        demo_mode = False
    state['can_demo_mode'] = demo_mode
    atexit.register(cleanup_can)

    t = threading.Thread(target=sim_loop, daemon=True, name='SimLoop')
    t.start()

    log.info("═══ ADAS Car Simulator ═══ http://0.0.0.0:5000")
    socketio.run(app, host='0.0.0.0', port=5000, debug=False, use_reloader=False, allow_unsafe_werkzeug=True)
