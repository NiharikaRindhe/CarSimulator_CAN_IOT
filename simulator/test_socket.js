const io = require('socket.io-client');
const socket = io('http://127.0.0.1:5000', { transports: ['websocket', 'polling'] });

let updates = 0;

socket.on('connect', () => {
    console.log('✅ Connected to Flask Simulator');
    
    // Toggle door
    console.log('Emitting toggle event for door (key 1)...');
    socket.emit('key_event', { action: 'toggle', key: '1' });

    setTimeout(() => {
        socket.disconnect();
        process.exit(0);
    }, 1500);
});

socket.on('state_update', (data) => {
    updates++;
    if (updates === 1 || updates === 10) {
        console.log(`Update ${updates} -> door: ${data.driver_door}`);
    }
});
