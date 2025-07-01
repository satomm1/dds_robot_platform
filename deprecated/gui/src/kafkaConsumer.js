// kafkaConsumer.js
const kafka = require('kafka-node');
const WebSocket = require('ws');

const Consumer = kafka.Consumer;
const client = new kafka.KafkaClient({ kafkaHost: 'localhost:9092' });
const consumer = new Consumer(client, [{ topic: 'video', partition: 0 }], { autoCommit: true });

const wss = new WebSocket.Server({ port: 8080 });

consumer.on('message', (message) => {
    const imageBuffer = Buffer.from(message.value, 'binary');
    wss.clients.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(imageBuffer);
        }
    });
});

consumer.on('error', (err) => {
    console.error('Error:', err);
});

wss.on('connection', (ws) => {
    console.log('New WebSocket connection');
});
