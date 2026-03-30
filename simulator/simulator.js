const awsIot = require('aws-iot-device-sdk');
const { io } = require('socket.io-client');

console.log("Starting AWS IoT MQTT Publisher with Flask integration...\n");

// ─── AWS IoT Configuration ───────────────────────────────────────────────────
const device = awsIot.device({
    keyPath: './certs/private.pem.key',
    certPath: './certs/certificate.pem.crt',
    caPath: './certs/AmazonRootCA1.pem',
    clientId: 'vehicle-simulator-' + Date.now(),   // unique client ID to avoid conflicts
    host: 'a2dt8bjflg2frz-ats.iot.ap-south-1.amazonaws.com',
    keepalive: 60,                                  // send PINGREQ every 60s
    protocol: 'mqtts',                              // explicit TLS
    maximumReconnectTimeMs: 8000,
    baseReconnectTimeMs: 1000,
    minimumConnectionTimeMs: 5000,
});

// ─── State ───────────────────────────────────────────────────────────────────
const targetVin = process.argv[2] || 'JHM FC18SXRR000001';
const topic = `vehicle/${targetVin}/telemetry`;
const cmdTopic = `vehicle/${targetVin}/command`;
let awsConnected = false;
let flaskConnected = false;
let latestState = null;
let publishInterval = null;

// ─── Connect to Flask Simulator via SocketIO ─────────────────────────────────
const flaskUrl = process.argv[3] || 'http://127.0.0.1:5000';
const socket = io(flaskUrl, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 2000,
});

socket.on('connect', () => {
    flaskConnected = true;
    console.log(`🔗 Connected to Flask Simulator at ${flaskUrl}`);
});

socket.on('disconnect', () => {
    flaskConnected = false;
    console.log('⚠️  Disconnected from Flask Simulator');
});

socket.on('state_update', (data) => {
    latestState = data;
});

socket.on('connect_error', (err) => {
    if (!flaskConnected) {
        console.log(`⚠️  Flask not running at ${flaskUrl} — using mock data`);
    }
});

// ─── AWS IoT Connection ──────────────────────────────────────────────────────
device.on('connect', () => {
    awsConnected = true;
    console.log('✅ Connected to AWS IoT Core!');
    console.log(`🤖 Target Vehicle: ${targetVin}`);
    console.log(`📡 Publishing to topic: ${topic}\n`);

    // Subscribe to our own telemetry topic to verify round-trip delivery
    device.subscribe(topic, { qos: 1 }, (err) => {
        if (err) {
            console.log('⚠️  Self-subscribe failed — policy may not allow iot:Subscribe');
        } else {
            console.log(`👂 Self-subscribed to ${topic} (will show ECHO ✓ if messages round-trip)`);
        }
    });

    // Subscribe to COMMAND topic for bidirectional control
    device.subscribe(cmdTopic, { qos: 1 }, (err) => {
        if (err) {
            console.log('⚠️  Command subscribe failed — check IoT policy allows iot:Subscribe on command topic');
        } else {
            console.log(`🎮 Listening for commands on ${cmdTopic}`);
            console.log(`   Publish from AWS Console to control the simulator!\n`);
        }
    });

    // Prevent duplicate intervals on reconnect
    if (publishInterval) {
        clearInterval(publishInterval);
    }

    publishInterval = setInterval(() => {
        let payload;

        if (latestState && flaskConnected) {
            // Real data from Flask simulator
            payload = {
                speed: latestState.speed || 0,
                rpm: latestState.rpm || 0,
                brake: parseFloat(((latestState.brake || 0) * 100).toFixed(1)),
                steeringAngle: latestState.steering || 0,
                gear: ['P', 'R', 'N', 'D'][latestState.gear] || 'P',
                music: {
                    isPlaying: latestState.music_playing || false,
                    track: "Synthwave Mix 2"
                }
            };
        } else {
            // Mock data
            payload = {
                speed: parseFloat((80.2 + (Math.random() - 0.5) * 2).toFixed(1)),
                rpm: Math.round(2456 + (Math.random() - 0.5) * 50),
                brake: 0.0,
                steeringAngle: parseFloat((-2.9 + (Math.random() - 0.5)).toFixed(1)),
                gear: 'D',
                music: {
                    isPlaying: false,
                    track: "Synthwave Mix 2"
                }
            };
        }

        const src = flaskConnected ? '🟢 LIVE' : '🟡 MOCK';
        console.log(`${src} → [${topic}]: Speed ${payload.speed}km/h | RPM ${payload.rpm} | Gear ${payload.gear} | Steering ${payload.steeringAngle}°`);


        device.publish(topic, JSON.stringify(payload), { qos: 1 }, (err) => {
            if (err) {
                console.error('❌ Publish FAILED:', err.message || err);
            }
        });
    }, 1000);
});

device.on('message', (incomingTopic, payload) => {
    const data = JSON.parse(payload.toString());

    // ── COMMAND from AWS Console → forward to Flask ──
    if (incomingTopic === cmdTopic) {
        console.log(`🎮 COMMAND received: ${JSON.stringify(data)}`);

        if (!flaskConnected) {
            console.log('   ⚠️  Flask not connected — command ignored');
            return;
        }

        const action = data.action;
        if (action === 'set_music') {
            socket.emit('key_event', { key: 'm', action: 'set_music', playing: data.playing });
            console.log(`   → Music set to: ${data.playing ? 'PLAYING' : 'PAUSED'}`);
        } else if (action === 'toggle_door') {
            socket.emit('key_event', { key: '1', action: 'toggle' });
            console.log('   → Door toggled');
        } else if (action === 'toggle_seatbelt') {
            socket.emit('key_event', { key: '2', action: 'toggle' });
            console.log('   → Seatbelt toggled');
        } else if (action === 'toggle_indicator') {
            const side = data.side === 'right' ? 'e' : 'q';
            socket.emit('key_event', { key: side, action: 'toggle' });
            console.log(`   → ${data.side || 'left'} indicator toggled`);
        } else if (action === 'set_gear') {
            const gearKeys = { 'P': 'p', 'R': 'r', 'N': 'n', 'D': 'g' };
            const gearKey = gearKeys[data.gear] || 'g';
            socket.emit('key_event', { key: gearKey, action: 'toggle' });
            console.log(`   → Gear set to: ${data.gear}`);
        } else {
            console.log(`   ⚠️  Unknown command action: ${action}`);
        }
        return;
    }

    // ── Self-echo for telemetry verification ──
    console.log(`   ECHO ✓ received on [${incomingTopic}] — Speed: ${data.speed}km/h`);
});

device.on('offline', () => {
    console.log('📴 Device is OFFLINE — messages will queue');
});

device.on('reconnect', () => {
    console.log('🔄 Reconnecting to AWS IoT Core...');
});

device.on('error', (error) => {
    console.error('❌ MQTT Connection Error:', error.message || error);
    console.log('\nTroubleshooting:');
    console.log('  1. Check certs in ./certs/ folder (private.pem.key, certificate.pem.crt, AmazonRootCA1.pem)');
    console.log('  2. Verify the IoT policy allows iot:Connect, iot:Publish');
    console.log('  3. Check the host endpoint matches your AWS region');
});

device.on('close', () => {
    awsConnected = false;
    console.log('🔌 AWS IoT connection closed');
});

// ─── Graceful Shutdown ───────────────────────────────────────────────────────
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down...');
    if (publishInterval) clearInterval(publishInterval);
    socket.disconnect();
    device.end(false, () => {
        console.log('✅ Disconnected cleanly.');
        process.exit(0);
    });
});

console.log(`⏳ Connecting to AWS IoT Core and Flask Simulator (${flaskUrl})...`);