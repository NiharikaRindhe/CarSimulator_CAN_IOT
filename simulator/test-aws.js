// Deep AWS IoT diagnostic — self-subscribe + publish test
// This subscribes to its own topic, then publishes, to verify round-trip delivery

const awsIot = require('aws-iot-device-sdk');
const fs = require('fs');
const path = require('path');

console.log('🔬 Deep AWS IoT Diagnostic');
console.log('==========================\n');

// Check certs
const certDir = path.join(__dirname, 'certs');
['private.pem.key', 'certificate.pem.crt', 'AmazonRootCA1.pem'].forEach(f => {
    const p = path.join(certDir, f);
    const exists = fs.existsSync(p);
    console.log(`  ${exists ? '✅' : '❌'} ${f} ${exists ? `(${fs.statSync(p).size}b)` : 'MISSING'}`);
});

const clientId = 'deep-diag-' + Date.now();
const host = 'a2dt8bjflg2frz-ats.iot.ap-south-1.amazonaws.com';
const pubTopic = 'vehicle/DIAG/telemetry';
const subTopic = 'vehicle/DIAG/echo';

console.log(`\nEndpoint:  ${host}`);
console.log(`Client:    ${clientId}`);
console.log(`Pub Topic: ${pubTopic}`);
console.log(`Sub Topic: ${subTopic}\n`);

const device = awsIot.device({
    keyPath:   path.join(certDir, 'private.pem.key'),
    certPath:  path.join(certDir, 'certificate.pem.crt'),
    caPath:    path.join(certDir, 'AmazonRootCA1.pem'),
    clientId:  clientId,
    host:      host,
    keepalive: 30,
    protocol:  'mqtts',
    maximumReconnectTimeMs: 5000,
    baseReconnectTimeMs: 1000,
});

let connected = false;
let connectCount = 0;
let disconnectCount = 0;
let pubCount = 0;
let recvCount = 0;
let connectStart = Date.now();

device.on('connect', () => {
    connectCount++;
    connected = true;
    const elapsed = ((Date.now() - connectStart) / 1000).toFixed(1);
    console.log(`✅ CONNECTED (attempt #${connectCount}, took ${elapsed}s)`);

    // Step 1: Subscribe to echo topic
    console.log(`\n📥 Step 1: Subscribing to "${subTopic}"...`);
    device.subscribe(subTopic, { qos: 1 }, (err, granted) => {
        if (err) {
            console.log(`   ❌ Subscribe FAILED: ${err.message}`);
            console.log('   ⚠️  This means your IoT Policy does NOT allow iot:Subscribe');
            console.log('   👉 Go to AWS IoT Console → Security → Policies → Check your policy');
            finish();
            return;
        }
        console.log(`   ✅ Subscribed! Granted QoS: ${JSON.stringify(granted)}`);

        // Step 2: Publish to BOTH topics
        console.log(`\n📤 Step 2: Publishing test messages...`);

        // Publish to the echo topic (self-loopback)
        const echoMsg = JSON.stringify({ test: 'echo', ts: Date.now() });
        device.publish(subTopic, echoMsg, { qos: 1 }, (err) => {
            if (err) {
                console.log(`   ❌ Publish to ${subTopic} FAILED: ${err.message}`);
            } else {
                pubCount++;
                console.log(`   ✅ Published to ${subTopic} (self-echo)`);
            }
        });

        // Publish to the telemetry topic (what the simulator uses)
        const telMsg = JSON.stringify({
            source: 'diagnostic',
            timestamp: new Date().toISOString(),
            running: { speed: 99.9, rpm: 3000, gear: 'D' }
        });
        device.publish(pubTopic, telMsg, { qos: 1 }, (err) => {
            if (err) {
                console.log(`   ❌ Publish to ${pubTopic} FAILED: ${err.message}`);
            } else {
                pubCount++;
                console.log(`   ✅ Published to ${pubTopic} (telemetry)`);
            }
        });

        // Wait for echo message
        setTimeout(() => {
            console.log(`\n📊 RESULTS AFTER 5 SECONDS:`);
            console.log(`   Connects:    ${connectCount}`);
            console.log(`   Disconnects: ${disconnectCount}`);
            console.log(`   Published:   ${pubCount}`);
            console.log(`   Received:    ${recvCount}`);

            if (recvCount > 0) {
                console.log(`\n   🎉 SELF-ECHO WORKS! Messages ARE being delivered by AWS IoT.`);
                console.log(`   The issue might be with the MQTT test client in AWS Console.`);
                console.log(`   Try: Refresh the console page, re-subscribe to vehicle/SIM001/telemetry`);
            } else if (pubCount > 0 && recvCount === 0) {
                console.log(`\n   ⚠️  Published but NO echo received!`);
                console.log(`   This confirms AWS IoT is SILENTLY DROPPING messages.`);
                console.log(`\n   🔧 FIX: Go to AWS IoT Console and verify:`);
                console.log(`   1. Security → Certificates → Find your cert → Is it ACTIVE?`);
                console.log(`   2. Click your cert → Policies tab → Is a policy attached?`);
                console.log(`   3. Click the policy → Does it have iot:Connect, iot:Publish, iot:Subscribe, iot:Receive?`);
                console.log(`   4. Resource should be "*" or match your topics`);
            } else {
                console.log(`\n   ❌ Nothing worked. Connection issue.`);
            }

            finish();
        }, 5000);
    });
});

device.on('message', (topic, payload) => {
    recvCount++;
    console.log(`   📨 RECEIVED on "${topic}": ${payload.toString().substring(0, 80)}...`);
});

device.on('offline', () => {
    console.log('📴 OFFLINE');
});

device.on('close', () => {
    disconnectCount++;
    connected = false;
    console.log(`🔌 DISCONNECTED (total disconnects: ${disconnectCount})`);
});

device.on('error', (err) => {
    console.error(`❌ ERROR: ${err.message || err}`);
});

device.on('reconnect', () => {
    console.log('🔄 RECONNECTING...');
    connectStart = Date.now();
});

function finish() {
    console.log('\n🏁 Diagnostic complete.');
    device.end(false, () => process.exit(0));
}

setTimeout(() => {
    console.log('\n⏰ 30s timeout reached');
    finish();
}, 30000);
