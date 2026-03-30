const io = require('socket.io-client');
const socket = io('http://127.0.0.1:5000', { transports: ['websocket', 'polling'] });

socket.on('connect', () => {
    console.log('✅ Connected. Toggling: door, seatbelt, music, left indicator...');
    
    socket.emit('key_event', { action: 'toggle', key: '1' }); // door
    socket.emit('key_event', { action: 'toggle', key: '2' }); // seatbelt OFF
    socket.emit('key_event', { action: 'toggle', key: 'm' }); // music
    socket.emit('key_event', { action: 'toggle', key: 'q' }); // left blinker

    // Wait and check the state after toggles propagate
    setTimeout(() => {
        console.log('\nChecking state after toggles...');
    }, 500);

    setTimeout(() => {
        socket.disconnect();
        process.exit(0);
    }, 2000);
});

let count = 0;
socket.on('state_update', (data) => {
    count++;
    if (count === 15) {
        console.log(`\n=== STATE AFTER TOGGLES (update #${count}) ===`);
        console.log(`  door:         ${data.driver_door}`);
        console.log(`  seatbelt:     ${data.seatbelt}`);
        console.log(`  music:        ${data.music_playing}`);
        console.log(`  left_blinker: ${data.left_blinker}`);
        console.log(`  steering:     ${data.steering}`);
    }
});
